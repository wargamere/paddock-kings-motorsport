import { INPUT } from '../config/handling.ts';
import { clamp } from '../core/math.ts';

const move = (from: number, to: number, amount: number) => from + clamp(to - from, -amount, amount);

/** Player controls only: no racing-line guidance, tyre forces or AI steering changes. */
export class PlayerSteering {
  private digital = 0;
  private stick = 0;

  reset(): void { this.digital = this.stick = 0; }

  /** Normalized steering request, before the car's physical steering actuator. */
  sample(digital: number, stick: number, speed: number, dt: number, sensitivity = 100): number {
    const S = INPUT.steering;
    const gain = clamp(Number.isFinite(sensitivity) ? sensitivity / 100 : 1, .5, 1.5);
    const u = clamp((Math.abs(speed) - S.slowSpeed) / (S.fastSpeed - S.slowSpeed), 0, 1);
    const fast = u * u * (3 - 2 * u);
    const rise = (S.riseSlow + (S.riseFast - S.riseSlow) * fast) / gain;
    const release = S.release / Math.sqrt(gain);
    const target = clamp(digital, -1, 1);
    let left = dt;
    // A reversal unwinds the old lock first. Spend any remaining time building
    // the opposite lock, rather than jumping directly through the centre.
    if (target * this.digital < 0) {
      const toCentre = Math.abs(this.digital) * release;
      this.digital = move(this.digital, 0, dt / release);
      left = Math.max(0, dt - toCentre);
    }
    this.digital = move(this.digital, target, left / (Math.abs(target) < Math.abs(this.digital) ? release : rise));

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
