import { INPUT } from '../config/handling.ts';
import { clamp } from '../core/math.ts';

const move = (from: number, to: number, amount: number) => from + clamp(to - from, -amount, amount);

function pressTravel(fraction: number): number {
  const { tapGain, blendTravel } = INPUT.steering;
  const t = Math.min(1, fraction / blendTravel);
  return fraction * (tapGain + (1 - tapGain) * t * t * (3 - 2 * t));
}

/** Player controls only: no racing-line guidance, tyre forces or AI steering changes. */
export class PlayerSteering {
  private digital = 0;
  private direction = 0;
  private heldFraction = 0;
  private riseScale = 1;
  private stick = 0;

  reset(): void {
    this.digital = this.direction = this.heldFraction = this.stick = 0;
    this.riseScale = 1;
  }

  /** Normalized steering request, before the car's physical steering actuator. */
  sample(digital: number, stick: number, speed: number, dt: number, sensitivity = 100): number {
    const S = INPUT.steering;
    const gain = clamp(Number.isFinite(sensitivity) ? sensitivity / 100 : 1, .5, 1.5);
    const u = clamp((Math.abs(speed) - S.slowSpeed) / (S.fastSpeed - S.slowSpeed), 0, 1);
    const fast = u * u * (3 - 2 * u);
    const rise = (S.riseSlow + (S.riseFast - S.riseSlow) * fast) / gain;
    const release = S.release / Math.sqrt(gain);
    const target = Math.sign(digital);
    if (target !== this.direction) {
      this.heldFraction = 0;
      // A driver already cornering hard needs a quicker change of direction.
      const opposingLock = Math.max(0, -target * this.digital);
      this.riseScale = 1 - opposingLock * (1 - S.chicaneRiseScale);
    }
    this.direction = target;
    let left = dt;
    // A reversal unwinds the old lock first. Spend any remaining time building
    // the opposite lock, rather than jumping directly through the centre.
    if (target * this.digital < 0) {
      const unwind = S.reversal / Math.sqrt(gain);
      const toCentre = Math.abs(this.digital) * unwind;
      this.digital = move(this.digital, 0, dt / unwind);
      left = Math.max(0, dt - toCentre);
    }
    if (target === 0) {
      this.digital = move(this.digital, 0, left / release);
    } else if (left > 0) {
      // Each new press starts in the fine range, including a corrective tap
      // while the wheels are returning. A continued press reaches full lock.
      const next = Math.min(1, this.heldFraction + left / (rise * this.riseScale));
      this.digital = move(this.digital, target, pressTravel(next) - pressTravel(this.heldFraction));
      this.heldFraction = next;
    }

    const axis = clamp(stick, -1, 1);
    const shaped = Math.sign(axis) * Math.abs(axis) ** (S.stickExponent / gain);
    this.stick += (shaped - this.stick) * (1 - Math.exp(-dt * gain / S.stickResponse));
    if (Math.abs(this.stick) < 1e-6) this.stick = 0;
    // Keep full manoeuvring lock at low speed; a key/stick throw at 300 km/h
    // should request useful cornering lock rather than saturating the front tyres.
    const authority = 1 - (1 - S.fastAuthority) * fast;
    return clamp(this.digital + this.stick, -1, 1) * authority;
  }
}
