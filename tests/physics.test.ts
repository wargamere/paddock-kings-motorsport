import assert from 'node:assert/strict';
import { test } from 'node:test';
import { angleDelta, CarPhysics, raceFuel, type DriveInput } from '../src/car/physics.ts';
import { FUEL } from '../src/config/race.ts';
import { HANDLING } from '../src/config/handling.ts';
import { FixedStep } from '../src/core/fixedStep.ts';
import type { Vec2 } from '../src/core/math.ts';
import { rng } from '../src/core/random.ts';
import { getSampleTrack, SAMPLE_COUNT } from '../src/editor/pipeline.ts';
import { placeTrees } from '../src/track/placement.ts';
import { buildTrack } from '../src/track/track.ts';
import { botInput } from '../src/race/bot.ts';

const input = (throttle: number, brake: number, steer: number, handbrake = false): DriveInput => ({ throttle, brake, steer, handbrake });

/** A stadium-shaped track with two 1.6 km straights (no trees near the straights, no barriers). */
function longStraightTrack() {
  const control: Vec2[] = [];
  for (let x = -800; x <= 800; x += 50) control.push({ x, y: -300 });
  for (let a = 1; a < 12; a++) control.push({ x: 800 + 300 * Math.sin((a / 12) * Math.PI), y: -300 * Math.cos((a / 12) * Math.PI) });
  for (let x = 800; x >= -800; x -= 50) control.push({ x, y: 300 });
  for (let a = 1; a < 12; a++) control.push({ x: -800 - 300 * Math.sin((a / 12) * Math.PI), y: 300 * Math.cos((a / 12) * Math.PI) });
  return buildTrack({ id: 'test-straights', name: 'straights', control, options: { walls: false } });
}

/** Car at rest at (x, z) heading east. */
function carAt(track = longStraightTrack(), x = -700, z = -300): CarPhysics {
  const car = new CarPhysics(track);
  Object.assign(car.state, { x, z, heading: 0, vx: 0, vz: 0, trackIndex: -1 });
  return car;
}

/** Scripted driving that depends only on the physics tick number. */
function scripted(tick: number): DriveInput {
  const t = tick / HANDLING.tickRate;
  return input(t < 6 || t > 7 ? 1 : 0, t > 6 && t < 7 ? 1 : 0, Math.sin(t * 1.3) * 0.8, t > 8 && t < 8.5);
}

/** Runs ~10 s of driving with the given frame times and records the state after every physics tick. */
function runAtFrameRate(frameTimes: () => number): string[] {
  const track = getSampleTrack(0);
  const car = new CarPhysics(track);
  const fixed = new FixedStep(HANDLING.tickRate);
  const states: string[] = [];
  while (fixed.tick < 1200) {
    fixed.advance(frameTimes(), () => {
      car.step(scripted(fixed.tick));
      const s = car.state;
      states.push([s.x, s.z, s.heading, s.vx, s.vz, s.yawRate, s.steer].join(','));
    });
  }
  return states.slice(0, 1200);
}

test('driving is identical at 60, 144 and 240 Hz, and with jittery frame times', () => {
  const at60 = runAtFrameRate(() => 1 / 60);
  const at144 = runAtFrameRate(() => 1 / 144);
  const at240 = runAtFrameRate(() => 1 / 240);
  const r = rng(42);
  const jitter = runAtFrameRate(() => 0.004 + r() * 0.03);
  assert.equal(at60.length, 1200);
  assert.deepEqual(at144, at60);
  assert.deepEqual(at240, at60);
  assert.deepEqual(jitter, at60);
});

test('a 1/60 s frame is exactly two physics steps', () => {
  const f = new FixedStep(120);
  let steps = 0;
  for (let i = 0; i < 600; i++) f.advance(1 / 60, () => steps++);
  assert.equal(steps, 1200);
});

test('the test driver laps every sample track without touching the grass', () => {
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const t = getSampleTrack(i);
    const car = new CarPhysics(t);
    const L = t.center.length;
    let half = false;
    let prevS = car.state.s;
    let lapTicks = 0;
    let grassTicks = 0;
    for (let k = 1; k < HANDLING.tickRate * 120; k++) {
      car.step(botInput(car.state, t));
      const s = car.state.s;
      if (car.state.grass > 0) grassTicks++;
      if (s > L * 0.4 && s < L * 0.6) half = true;
      if (half && prevS > L * 0.8 && s < L * 0.2) {
        lapTicks = k;
        break;
      }
      prevS = s;
    }
    const lapTime = lapTicks / HANDLING.tickRate;
    assert.ok(lapTicks > 0, `${t.def.name}: no lap`);
    assert.ok(lapTime > 15 && lapTime < 75, `${t.def.name}: lap ${lapTime}s`);
    assert.equal(grassTicks, 0, `${t.def.name}: ${grassTicks} ticks on grass`);
  }
});

test('the car is much slower on grass', () => {
  const road = carAt();
  const grass = carAt(undefined, -700, -520); // 220 m off the straight, beyond the trees
  for (let k = 0; k < HANDLING.tickRate * 20; k++) {
    road.step(input(1, 0, 0));
    grass.step(input(1, 0, 0));
  }
  assert.equal(road.state.grass, 0);
  assert.equal(grass.state.grass, 1);
  assert.ok(road.state.speed > 40, `road top speed ${road.state.speed}`);
  assert.ok(grass.state.speed < road.state.speed * 0.4, `grass ${grass.state.speed} vs road ${road.state.speed}`);
});

test('steering lock reduces with speed', () => {
  const lockAt = (speed: number) => {
    const car = carAt();
    car.state.vx = speed;
    for (let k = 0; k < HANDLING.tickRate; k++) {
      car.step(input(0, 0, 1));
      car.state.vx = speed * Math.cos(car.state.heading);
      car.state.vz = speed * Math.sin(car.state.heading);
    }
    return car.state.steer;
  };
  const slow = lockAt(5);
  const fast = lockAt(40);
  assert.ok(slow > 0 && fast > 0, 'positive steer turns right');
  assert.ok(fast < slow * 0.5, `lock ${fast} at 40 m/s vs ${slow} at 5 m/s`);
});

test('the car slides a little in fast corners but not on the straight', () => {
  const car = carAt();
  for (let k = 0; k < HANDLING.tickRate * 4; k++) car.step(input(1, 0, 0));
  assert.ok(car.state.slip < 0.05);
  let maxSlip = 0;
  for (let k = 0; k < HANDLING.tickRate * 1.5; k++) {
    car.step(input(1, 0, 1));
    maxSlip = Math.max(maxSlip, car.state.slip);
  }
  assert.ok(maxSlip > 0.5 && maxSlip < 8, `slip ${maxSlip}`);
});

test('holding brake at a standstill reverses, up to the reverse speed limit', () => {
  const car = carAt();
  for (let k = 0; k < HANDLING.tickRate * 6; k++) car.step(input(0, 1, 0));
  assert.ok(car.state.speed < -HANDLING.reverseMaxSpeed * 0.9 && car.state.speed >= -HANDLING.reverseMaxSpeed - 0.01);
});

test('reset puts the car back on the centre line facing along the track', () => {
  const t = getSampleTrack(1);
  const car = new CarPhysics(t);
  for (let k = 0; k < HANDLING.tickRate * 3; k++) car.step(input(1, 0, 1));
  car.resetToRoad();
  const s = car.state;
  assert.equal(s.speed, 0);
  assert.ok(Math.abs(s.lateral) < 0.5, `lateral ${s.lateral}`);
  const tan = t.center.tangents[s.trackIndex];
  assert.ok(Math.abs(angleDelta(s.heading, Math.atan2(tan.y, tan.x))) < 0.15);
});

test('trees stop the car instead of letting it drive through', () => {
  const t = getSampleTrack(0);
  const tree = placeTrees(t).find((p) => Math.abs(p.x) < 300 && Math.abs(p.z) < 150);
  assert.ok(tree, 'sample track has a tree in the middle');
  if (!tree) return;
  const car = new CarPhysics(t);
  Object.assign(car.state, { x: tree.x - 40, z: tree.z, heading: 0, vx: 0, vz: 0, trackIndex: -1 });
  let minDist = Infinity;
  for (let k = 0; k < HANDLING.tickRate * 8; k++) {
    car.step(input(1, 0, 0));
    minDist = Math.min(minDist, Math.hypot(car.state.x - tree.x, car.state.z - tree.z));
  }
  assert.ok(minDist >= HANDLING.carRadius + 0.5 * tree.scale - 0.01, `got within ${minDist} m of the trunk`);
  assert.ok(car.state.x < tree.x + 5, 'did not pass through');
});

test('a car leaning on a barrier at an angle can steer away from it and drive off (scraping only checks a turn into it)', () => {
  const t = getSampleTrack(0);
  const car = new CarPhysics(t);
  const c = t.center;
  // On a straight, nose 25° into the left barrier and pressed against it, crawling.
  const s = 60;
  car.placeAt(s, c.wallOffset - HANDLING.halfWidth - 0.05);
  const st = car.state;
  st.heading -= 0.45; // (heading grows clockwise, to the right)
  st.vx = Math.cos(st.heading) * 4;
  st.vz = Math.sin(st.heading) * 4;
  let scraped = false;
  for (let k = 0; k < 4 * HANDLING.tickRate; k++) {
    // Steering right (away from it), on the throttle. (The old rule held it there, turned in, for good.)
    car.step({ throttle: 0.7, brake: 0, steer: 1, handbrake: false });
    scraped ||= st.wallHit > 0;
  }
  assert.ok(scraped, 'it was against the barrier');
  assert.ok(st.lateral < c.wallOffset - HANDLING.halfWidth - 2, `away from it: ${st.lateral.toFixed(2)} m left of the centre`);
  assert.ok(st.speed > 6, `and driving off: ${st.speed.toFixed(1)} m/s`);
});

test('the full car model: brakes lock without ABS, the rear spins up without traction control, and the aids stop both', () => {
  const brakeFrom = (speed: number, abs: boolean) => {
    const car = carAt();
    car.abs = abs;
    Object.assign(car.state, { vx: speed, speed });
    let locked = 0;
    for (let k = 0; k < HANDLING.tickRate * 0.3; k++) {
      car.step(input(0, 1, 0));
      locked = Math.max(locked, car.state.lockup);
    }
    return locked;
  };
  // Slowly, a stamp on the brakes locks them; at speed the downforce holds them.
  assert.equal(brakeFrom(20, false), 1, 'locks without ABS');
  assert.equal(brakeFrom(20, true), 0, 'not with ABS');
  assert.equal(brakeFrom(55, false), 0, 'at speed the tyres can take it');
  // Flooring it out of a slow bend: without traction control the rear spins up and steps out.
  const exit = (tc: boolean) => {
    const car = carAt();
    car.tc = tc;
    car.stability = tc;
    car.steerHelp = false;
    Object.assign(car.state, { vx: 10, speed: 10 });
    let spin = 0;
    let slip = 0;
    for (let k = 0; k < HANDLING.tickRate * 1.5; k++) {
      car.step(input(1, 0, 0.7));
      spin = Math.max(spin, car.state.wheelspin);
      slip = Math.max(slip, car.state.slip);
    }
    return { spin, slip };
  };
  const raw = exit(false);
  const aided = exit(true);
  assert.equal(raw.spin, 1, 'wheelspin without traction control');
  assert.equal(aided.spin, 0, 'none with it');
  assert.ok(raw.slip > aided.slip * 2, `the rear steps out: sliding ${raw.slip.toFixed(1)} m/s vs ${aided.slip.toFixed(1)}`);
});

test('the full car model: it brakes harder at speed (downforce), and at the limit the front lets go first', () => {
  const decel = (speed: number) => {
    const car = carAt();
    Object.assign(car.state, { vx: speed, speed });
    car.step(input(0, 1, 0));
    car.step(input(0, 1, 0));
    return -car.state.longAccel;
  };
  assert.ok(decel(55) > decel(15) * 1.25, `${decel(55).toFixed(1)} m/s² from 55 m/s vs ${decel(15).toFixed(1)} from 15`);
  // Turning in hard at speed: it runs wide (the front slides more than the rear), it doesn't spin.
  const car = carAt();
  car.steerHelp = false;
  Object.assign(car.state, { vx: 35, speed: 35 });
  let maxYaw = 0;
  for (let k = 0; k < HANDLING.tickRate * 0.8; k++) {
    car.step(input(0.3, 0, 1));
    maxYaw = Math.max(maxYaw, Math.abs(car.state.yawRate));
  }
  const kinematic = (35 * Math.tan(car.state.steer)) / HANDLING.wheelBase;
  assert.ok(maxYaw < kinematic, `understeers: yaw ${maxYaw.toFixed(2)} rad/s vs ${kinematic.toFixed(2)} the wheels point to`);
  assert.ok(maxYaw < 1.5, 'and no spin');
});

test('fuel: a full car is slower to accelerate and to stop, and the tank burns down as it goes', () => {
  const run = (fuel: number) => {
    const car = carAt();
    car.fuel = fuel;
    for (let k = 0; k < HANDLING.tickRate * 6; k++) car.step(input(1, 0, 0));
    return car;
  };
  const light = run(0);
  const full = run(100);
  assert.ok(full.state.speed < light.state.speed - 1, `${full.state.speed.toFixed(1)} m/s full vs ${light.state.speed.toFixed(1)} empty after 6 s`);
  assert.ok(full.fuel < 100 && full.fuel > 90, `burnt ${(100 - full.fuel).toFixed(2)} kg`);
  assert.equal(light.fuel, 0);
  assert.ok(raceFuel(2000, 5) > raceFuel(2000, 2) && raceFuel(5000, 50) === FUEL.max, 'filled for the distance, up to the most the tank holds');
});
