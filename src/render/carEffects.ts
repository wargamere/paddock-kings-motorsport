import { Color } from 'three';
import type { CarModel } from '../car/model.ts';
import type { CarPhysics, CarState } from '../car/physics.ts';
import { HANDLING } from '../config/handling.ts';
import { DAMAGE_LOOK } from '../config/race.ts';
import type { RaceEffects } from './effects.ts';

const SMOKE_GREY = new Color(0xd9dadc);
const SMOKE_DARK = new Color(0x26272b);
const TYRE_SMOKE = new Color(0xf4f4f5);
const SPARK = new Color(0xffb347);
const SPARK_HOT = new Color(0xfff1b0);
const TRIM = new Color(0x24262b);
const paintColour = new Color();

/** How many of something to emit this frame at `rate` a second (a fraction carried by chance). */
const count = (rate: number, dt: number) => Math.floor(rate * dt + Math.random());
const jitter = (n: number) => (Math.random() * 2 - 1) * n;

/**
 * What a car throws off this frame (`dt` s): smoke from a damaged car (black
 * once it's broken down), tyre smoke when it slides, sparks from a hanging
 * bumper and from hits, and bits of it when a part comes off or it's hit
 * hard. `view` is where it's drawn, `hit` its hardest hit since the last
 * frame (m/s), `paint` its colour. Also shows its damage on the model.
 */
export function carEffects(fx: RaceEffects, view: CarState, car: CarPhysics, model: CarModel, paint: number, hit: number, dt: number, lockup = false): void {
  const D = DAMAGE_LOOK;
  const h = view.heading;
  const fx_ = Math.cos(h);
  const fz = Math.sin(h);
  // The car's left, in the world (see leftOf in track/spline.ts).
  const lx = fz;
  const lz = -fx_;
  const at = (left: number, up: number, fwd: number): [number, number, number] => [view.x + fx_ * fwd + lx * left, view.y + up, view.z + fz * fwd + lz * left];
  const vx = view.vx;
  const vz = view.vz;
  const speed = Math.abs(view.speed);

  // Damage: the look, and the parts that have just come off on the road.
  const off = car.damageOn ? model.setDamage(car.wingDamage, car.bodyDamage) : model.setDamage(0, 0);
  paintColour.setHex(paint);
  for (const part of off) {
    const [x, y, z] = at(0, 0.5, part === 'front' ? 2.1 : -1.9);
    for (let i = 0; i < 5; i++) fx.debris.emit(x + jitter(0.5), y, z + jitter(0.5), vx * 0.7 + jitter(3), 1.5 + Math.random() * 2.5, vz * 0.7 + jitter(3), view.y, i % 2 ? TRIM : paintColour);
  }

  // Smoke: the worse the damage, the more (black from a car that's broken down).
  const damage = car.damageOn ? car.damage : 0;
  if (car.broken || damage >= D.smokeFrom) {
    const rate = car.broken ? 30 : 10 + 40 * Math.min(1, (damage - D.smokeFrom) / (1 - D.smokeFrom));
    const n = count(rate, dt);
    for (let i = 0; i < n; i++) {
      const [x, y, z] = at(jitter(0.4), 0.8, -1.6);
      // (Carried along at most of the car's speed, so the plume trails behind it, not straight past the camera.)
      fx.smoke.emit(x, y, z, vx * 0.85 + jitter(0.4), 0.8 + Math.random() * 0.8, vz * 0.85 + jitter(0.4), 1.6 + Math.random() * 0.8, 0.8, 3.6, car.broken ? 0.85 : 0.75, car.broken ? SMOKE_DARK : SMOKE_GREY);
    }
  }

  // Tyre smoke: sliding (worn-out tyres smoke sooner).
  const slipFrom = car.wear && car.tyreLeft <= 0.02 ? D.tyreSmokeSlip * 0.5 : D.tyreSmokeSlip;
  if (view.slip > slipFrom && speed > 4 && view.grass < 0.3) {
    const n = count(Math.min(40, (view.slip - slipFrom) * 12), dt);
    for (let i = 0; i < n; i++) {
      const [x, y, z] = at((i % 2 ? 1 : -1) * 0.86, 0.25, -1.3);
      fx.smoke.emit(x, y, z, vx * 0.7 + jitter(0.6), 0.4 + Math.random() * 0.5, vz * 0.7 + jitter(0.6), 0.9 + Math.random() * 0.5, 0.5, 2.6, 0.4, TYRE_SMOKE);
    }
  }

  // A lock-up: smoke from the front tyres.
  if (lockup && speed > 5) {
    const n = count(45, dt);
    for (let i = 0; i < n; i++) {
      const [x, y, z] = at((i % 2 ? 1 : -1) * 0.86, 0.25, 1.3);
      fx.smoke.emit(x, y, z, vx * 0.8 + jitter(0.5), 0.3 + Math.random() * 0.4, vz * 0.8 + jitter(0.5), 0.8 + Math.random() * 0.4, 0.4, 2.2, 0.5, TYRE_SMOKE);
    }
  }

  // Sparks: a hanging front wing (or bumper) scraping the road, and hits.
  const sparks = (n: number, left: number, up: number, fwd: number, spread: number) => {
    for (let i = 0; i < n; i++) {
      const [x, y, z] = at(left + jitter(0.3), up, fwd + jitter(0.3));
      fx.sparks.emit(x, y, z, vx * 0.75 + jitter(spread), 1.5 + Math.random() * 3, vz * 0.75 + jitter(spread), 0.45 + Math.random() * 0.4, 0.45, 0.12, 1, Math.random() < 0.3 ? SPARK_HOT : SPARK);
    }
  };
  // (The hanging end is on the car's left; its sparks fan out from under the side of the car.)
  if (model.hanging && speed > D.sparkSpeed) sparks(count(Math.min(70, speed * 1.5), dt), 0.85, 0.1, model.kind === 'formula' ? 2.1 : 1.6, 3.5);
  if (hit > D.sparkHit) {
    const side = Math.random() < 0.5 ? -1 : 1;
    sparks(Math.min(36, Math.round(hit * 2)), side * HANDLING.halfWidth, 0.4, jitter(1.5), 4);
    if (hit > D.debrisHit) {
      const [x, y, z] = at(side * HANDLING.halfWidth, 0.6, jitter(1.5));
      for (let i = 0; i < 3; i++) fx.debris.emit(x, y, z, vx * 0.6 + jitter(3), 1 + Math.random() * 2, vz * 0.6 + jitter(3), view.y, i ? paintColour : TRIM);
    }
  }
}
