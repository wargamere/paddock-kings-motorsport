import type { CarState } from '../car/physics.ts';

export type SideAlert = 0 | 1 | 2;
export interface ProximityState { left: SideAlert; right: SideAlert }

/** Nearby cars in the driver's frame, including a short closing window. No track-distance wrap ambiguity. */
export function proximity(me: CarState, cars: readonly CarState[], out: ProximityState): ProximityState {
  out.left = out.right = 0;
  const c = Math.cos(me.heading), s = Math.sin(me.heading);
  for (const car of cars) {
    if (car === me || car.inPits !== me.inPits || Math.abs(car.y - me.y) > 2) continue;
    const dx = car.x - me.x, dz = car.z - me.z;
    if (Math.abs(dx) > 16 || Math.abs(dz) > 16) continue;
    const along = dx * c + dz * s, side = -dx * s + dz * c;
    if (Math.abs(side) < .7 || Math.abs(side) > 5.5) continue;
    const closing = (car.vx - me.vx) * c + (car.vz - me.vz) * s;
    const predicted = along + closing * .45;
    const alongside = Math.abs(along) < 5.2;
    const approaching = Math.abs(along) < 12 && Math.abs(predicted) < 5.2;
    if (!alongside && !approaching) continue;
    const severity: SideAlert = Math.abs(along) < 4.5 && Math.abs(side) < 2.6 ? 2 : 1;
    if (side < 0) out.left = Math.max(out.left, severity) as SideAlert;
    else out.right = Math.max(out.right, severity) as SideAlert;
  }
  return out;
}

export type GripWarning = '' | 'lock' | 'spin' | 'front';

/** Suppresses one-tick tyre spikes and holds useful feedback briefly after a correction. */
export class GripFeedback {
  warning: GripWarning = '';
  private pending: GripWarning = '';
  private elapsed = 0;
  private hold = 0;

  reset(): void { this.warning = this.pending = ''; this.elapsed = this.hold = 0; }

  update(lock: number, spin: number, front: number, rear: number, speed: number, dt: number): GripWarning {
    if (speed < 8) { this.reset(); return ''; }
    const next: GripWarning = lock > .2 ? 'lock' : spin > .2 ? 'spin' : front > .14 && front > rear * 1.2 ? 'front' : '';
    dt = Math.max(0, Math.min(.1, dt));
    if (next !== this.pending) { this.pending = next; this.elapsed = 0; }
    this.elapsed += dt;
    if (next && this.elapsed >= .1) { this.warning = next; this.hold = .35; }
    else if ((this.hold -= dt) <= 0) this.warning = '';
    return this.warning;
  }
}
