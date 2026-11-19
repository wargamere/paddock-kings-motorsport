import { HANDLING, SIM } from '../config/handling.ts';
import { SETUP, type CarSetup } from '../config/race.ts';
import { clamp } from '../core/math.ts';

const G = 9.81;
const curveB = Math.tan(Math.PI / (2 * SIM.shape));
/** A signed, continuous peak and breakaway curve; the peak is exactly at |slip| = 1. */
export const tyreCurveForce = (slip: number): number => Math.sin(SIM.shape * Math.atan(curveB * slip));
const smooth = (x: number) => { const t = clamp(x, 0, 1); return t * t * (3 - 2 * t); };

/** All forces/loads are per unit vehicle mass (m/s²). Order: FL, FR, RL, RR. */
export class ContactPatch {
  load = 0;
  alpha = 0;
  slipRatio = 0;
  fx = 0;
  fy = 0;
  usage = 0;
  work = 0;
  sliding = 0;
  private excess = 0;

  reset(): void {
    this.load = this.alpha = this.slipRatio = this.fx = this.fy = this.usage = this.work = this.sliding = this.excess = 0;
  }

  solve(alpha: number, speed: number, demand: number, capX: number, capY: number, dt: number, abs: boolean, tc: boolean, fullTc: boolean, handbrake: boolean): void {
    // The carcass takes a short distance to build force. Release/reversal follows the same
    // distance, rather than snapping straight from understeer into full countersteer grip.
    const response = 1 - Math.exp(-dt / Math.max(SIM.relaxationMin, SIM.relaxationLength / Math.max(3, speed)));
    this.alpha += (alpha - this.alpha) * response;
    const lateral = tyreCurveForce(this.alpha / SIM.peakSlip);
    capX = Math.max(1e-9, capX); capY = Math.max(1e-9, capY);
    let ask = demand;
    if (ask < 0 && abs && !handbrake) ask = Math.max(ask, -capX * SIM.absMargin * Math.sqrt(Math.max(SIM.absSteerFloor, 1 - lateral * lateral)));
    if (ask > 0 && tc) ask = Math.min(ask, capX * SIM.tcMargin * (fullTc ? Math.sqrt(Math.max(SIM.tcFloor, 1 - lateral * lateral)) : 1));
    const ratio = Math.abs(ask) / capX;
    // The demand builds longitudinal slip after the peak, smoothly. This is a force-demand
    // approximation, not a separate wheel/drivetrain rotational solver (see docs/car-physics.md).
    const target = handbrake ? 4 : Math.max(0, ratio - 1);
    const time = target > this.excess ? SIM.slipBuild : SIM.slipRecover;
    this.excess += (target - this.excess) * (1 - Math.exp(-dt / time));
    const over = Math.max(0, this.excess);
    const longSlip = ratio <= 1 && over < 0.001 ? Math.tan(Math.asin(clamp(ratio, 0, 1)) / SIM.shape) / curveB : 1 + over * 5;
    this.slipRatio = Math.sign(ask) * SIM.peakLongSlip * longSlip;
    const peakForce = ratio > 1 || over >= 0.001 ? Math.abs(tyreCurveForce(longSlip)) : ratio;
    let x = Math.sign(ask) * capX * peakForce;
    let y = -lateral * capY * Math.sqrt(Math.max(0, 1 - peakForce * peakForce));
    const locked = ask < 0 ? smooth((over - 0.12) / 0.55) : 0;
    if (locked > 0) {
      x += (-SIM.slide * capX * Math.cos(alpha) - x) * locked;
      y += (-SIM.slide * capY * Math.sin(alpha) - y) * locked;
    }
    // A spinning rear tyre gradually sheds its ability to corner. Recovery is progressive too.
    if (ask > 0) y *= 1 - 0.8 * smooth(over / 0.65);
    // Slip memory reserves cornering grip, but without a wheel-inertia energy store it
    // cannot supply additional drive or braking force after a partial pedal release.
    x = clamp(x, -Math.abs(ask), Math.abs(ask));
    const usage = Math.hypot(x / capX, y / capY);
    const scale = usage > 1 ? 1 / usage : 1;
    this.fx = x * scale; this.fy = y * scale; this.usage = Math.min(1, usage);
    this.sliding = Math.max(Math.max(0, Math.abs(alpha) - SIM.slideFrom * SIM.peakSlip) * speed, speed * Math.min(1, over));
    this.work = Math.abs(this.fy) * speed * Math.min(2, Math.abs(Math.tan(alpha))) + Math.abs(this.fx) * speed * (over > 0.01 ? Math.min(1, SIM.peakLongSlip * longSlip) : 0.08 * ratio * ratio);
  }
}

export interface DynamicsInput {
  vf: number; vr: number; yaw: number; steer: number; drive: number; coast: number;
  body: number; brake: number; resist: number; lat: number; bite: number; downforce: number;
  aeroFront: number; setup: CarSetup; dt: number; abs: boolean; tc: boolean; fullTc: boolean;
  stability: boolean; handbrake: boolean; heat: readonly number[]; surface: readonly number[];
}

/** Four tyres on a planar chassis, with damped pitch/roll load transfer and a torque-biasing differential. */
export class ChassisDynamics {
  readonly wheels = [new ContactPatch(), new ContactPatch(), new ContactPatch(), new ContactPatch()] as const;
  private pitch = 0;
  private pitchSpeed = 0;
  private roll = 0;
  private rollSpeed = 0;
  private ax = 0;
  private ay = 0;
  private readonly capsX = [0, 0, 0, 0];
  private readonly capsY = [0, 0, 0, 0];
  private readonly heat = [0, 0, 0, 0];
  private readonly result = { vf: 0, vr: 0, yaw: 0, heading: 0, slide: 0, lockup: 0, wheelspin: 0 };

  reset(): void {
    this.pitch = this.pitchSpeed = this.roll = this.rollSpeed = this.ax = this.ay = 0;
    this.heat.fill(0);
    for (const w of this.wheels) w.reset();
  }

  step(p: DynamicsInput) {
    const S = SIM, L = HANDLING.wheelBase, half = HANDLING.halfTrack;
    const a = L * (1 - S.frontWeight), b = L * S.frontWeight;
    const h = p.dt / S.substeps, cs = Math.cos(p.steer), sn = Math.sin(p.steer);
    const total = G * p.downforce, shift = G * (p.downforce - 1) * p.aeroFront;
    const bias = clamp((p.setup.brakeBias ?? SETUP.fine.biasMid + Math.round((S.brakeBias[p.setup.brakes] - S.brakeBias.balanced) * 100)) / 100, 0.2, 0.85);
    const diff = clamp((p.setup.diff ?? SETUP.fine.diffMid) / 100, 0, 1);
    const omega = 2 * Math.PI * S.suspensionHz;
    let vf = p.vf, vr = p.vr, yaw = p.yaw, heading = 0, slide = 0, lockup = 0, wheelspin = 0;
    this.heat.fill(0);
    for (let k = 0; k < S.substeps; k++) {
      const targetPitch = clamp(this.ax * S.cgHeight / L, -S.transferMax * total, S.transferMax * total);
      const targetRoll = clamp(this.ay * S.cgHeight / (2 * half), -total * .42, total * .42);
      this.pitchSpeed += (omega * omega * (targetPitch - this.pitch) - 2 * S.suspensionDamping * omega * this.pitchSpeed) * h;
      this.rollSpeed += (omega * omega * (targetRoll - this.roll) - 2 * S.suspensionDamping * omega * this.rollSpeed) * h;
      this.pitch += this.pitchSpeed * h; this.roll += this.rollSpeed * h;
      const front = clamp(total * S.frontWeight - this.pitch + shift, total * .08, total * .92), rear = total - front;
      const rf = clamp(this.roll * S.rollFront, -front * .48, front * .48), rr = clamp(this.roll * (1 - S.rollFront), -rear * .48, rear * .48);
      for (let i = 0; i < 4; i++) {
        const f = i < 2, left = i % 2 === 0, axle = f ? front : rear;
        const load = axle / 2 + (left ? 1 : -1) * (f ? rf : rr);
        this.wheels[i].load = load;
        const rest = total * (f ? S.frontWeight : 1 - S.frontWeight) / 2;
        const sensitivity = clamp(1 - S.loadSensitivity * (load / rest - 1), .55, 1.25);
        const tyre = sensitivity * p.heat[i] * p.surface[i] * (f ? 1 : S.rearGrip);
        this.capsY[i] = (p.lat / G) * S.grip * load * tyre;
        this.capsX[i] = (HANDLING.maxLateralAccel / G) * S.grip * S.longGrip * p.bite * load * tyre;
      }
      // The differential sends some available torque to the loaded rear tyre, bounded to 3:1.
      const driveLeft = p.drive * clamp(.5 + diff * .5 * (this.capsY[2] - this.capsY[3]) / Math.max(.001, this.capsY[2] + this.capsY[3]), .25, .75);
      let along = 0, across = 0, moment = 0;
      for (let i = 0; i < 4; i++) {
        const f = i < 2, y = i % 2 === 0 ? -half : half, x = f ? a : -b;
        const wx = vf - yaw * y, wy = vr + yaw * x;
        const long = f ? wx * cs + wy * sn : wx, side = f ? -wx * sn + wy * cs : wy;
        const alpha = Math.atan2(side, Math.max(2, Math.abs(long)));
        const brake = p.brake * (f ? bias : 1 - bias) / 2;
        const drive = f ? 0 : (i === 2 ? driveLeft : p.drive - driveLeft) - p.coast / 2;
        const demand = drive - brake;
        const capX = demand > 0 ? this.capsY[i] * S.driveGrip : this.capsX[i];
        const w = this.wheels[i];
        w.solve(alpha, Math.abs(long), demand, capX, this.capsY[i], h, p.abs, p.tc, p.fullTc, !f && p.handbrake);
        const fx = f ? w.fx * cs - w.fy * sn : w.fx, fy = f ? w.fx * sn + w.fy * cs : w.fy;
        along += fx; across += fy; moment += x * fy - y * fx;
        this.heat[i] += w.work / S.substeps;
        slide = Math.max(slide, w.sliding);
        if (demand < 0 && !p.abs) lockup = Math.max(lockup, smooth((Math.abs(w.slipRatio) - S.peakLongSlip) / .18));
        if (!f && demand > 0 && !p.tc) wheelspin = Math.max(wheelspin, smooth((w.slipRatio - S.peakLongSlip) / .18));
      }
      // Locking the differential resists different rear wheel speeds under power.
      if (p.drive > 0) moment -= SETUP.fine.diffYaw * ((diff - .75) * .7) * Math.min(1, p.drive / Math.max(1, this.capsY[2] + this.capsY[3])) * yaw;
      if (p.stability) {
        const af = (this.wheels[0].alpha + this.wheels[1].alpha) / 2, ar = (this.wheels[2].alpha + this.wheels[3].alpha) / 2;
        const out = Math.abs(ar) - Math.max(S.escFrom * S.peakSlip, Math.abs(af));
        if (out > 0 && Math.sign(ar) === -Math.sign(yaw)) moment -= Math.sign(yaw) * Math.min(S.escMax, S.escGain * out) * total * S.yawInertia;
      }
      const next = vf + (along + p.body) * h;
      vf = Math.abs(next) <= p.resist * h ? 0 : next - Math.sign(next) * p.resist * h;
      vr += across * h;
      const nextYaw = yaw + moment / S.yawInertia * h;
      const turn = (yaw + nextYaw) * .5 * h;
      yaw = nextYaw; heading += turn;
      // Velocities follow the rotating chassis between substeps; return in the original frame.
      const c = Math.cos(turn), s = Math.sin(turn), v = vf;
      vf = v * c + vr * s; vr = -v * s + vr * c;
      this.ax = along - p.resist; this.ay = across;
    }
    const c = Math.cos(heading), s = Math.sin(heading);
    const r = this.result;
    r.vf = vf * c - vr * s; r.vr = vf * s + vr * c; r.yaw = yaw;
    r.heading = heading; r.slide = slide; r.lockup = lockup; r.wheelspin = wheelspin;
    return r;
  }

  get work(): readonly number[] { return this.heat; }
}
