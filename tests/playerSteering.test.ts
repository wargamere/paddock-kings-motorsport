import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PlayerSteering } from '../src/car/playerSteering.ts';
import { InputManager } from '../src/car/input.ts';
import { CarPhysics, type DriveInput } from '../src/car/physics.ts';
import { HANDLING } from '../src/config/handling.ts';
import { cleanSteeringSensitivity, DEFAULT_ASSISTS, settings, updateSettings } from '../src/core/settings.ts';
import { applyAssists, assistDriver } from '../src/race/assists.ts';
import { getSampleTrack } from '../src/editor/pipeline.ts';
import { buildTrack } from '../src/track/track.ts';
import type { Dot } from '../src/core/math.ts';

const dt = 1 / HANDLING.tickRate;
const input = (): DriveInput => ({ throttle: 0, brake: 0, steer: 0, handbrake: false });
const hold = (s: PlayerSteering, digital: number, analog: number, speed: number, seconds: number, sensitivity = 100) => {
  let result = 0;
  for (let i = 0; i < Math.round(seconds / dt); i++) result = s.sample(digital, analog, speed, dt, sensitivity);
  return result;
};

test('short high-speed key taps are progressive, release promptly, and retain full low-speed lock', () => {
  const s = new PlayerSteering();
  const first = s.sample(1, 0, 300 / 3.6, dt);
  assert.ok(first > 0 && first < .02);
  const tap = hold(s, 1, 0, 300 / 3.6, .1);
  assert.ok(tap > .025 && tap < .05, `a small correction: ${tap}`);
  assert.equal(hold(s, 0, 0, 300 / 3.6, .15), 0);
  assert.equal(hold(s, 1, 0, 8, .4), 1, 'hairpins and pit manoeuvres retain full range');
  assert.equal(hold(s, -1, 0, 8, .4), -1);
});

test('reversals unwind through centre instead of snapping to opposite lock', () => {
  const s = new PlayerSteering();
  hold(s, 1, 0, 85, .6);
  const values = Array.from({ length: 72 }, () => s.sample(-1, 0, 85, dt));
  assert.ok(values[0] > 0 && values[5] > 0);
  assert.ok(values.some(v => Math.abs(v) < .04));
  assert.ok(values.at(-1)! < -.5, 'still responds to a committed direction change');
  for (let i = 1; i < values.length; i++) assert.ok(Math.abs(values[i] - values[i - 1]) < .05);
});

test('stick response is gentle near centre, symmetric, adjustable and independent of frame subdivisions', () => {
  const s = new PlayerSteering(), centre = hold(s, 0, .25, 85, .5);
  assert.ok(centre > .03 && centre < .07);
  const opposite = hold(new PlayerSteering(), 0, -.25, 85, .5);
  assert.ok(Math.abs(centre + opposite) < 1e-12);
  assert.ok(hold(new PlayerSteering(), 0, .25, 85, .5, 50) < centre);
  assert.ok(hold(new PlayerSteering(), 0, .25, 85, .5, 150) > centre);
  const run = (step: number) => { const c = new PlayerSteering(); let value = 0;
    for (const [seconds, key, stick] of [[.2, 1, .2], [.2, -1, -.2], [.2, 0, 0]])
      for (let i = 0; i < Math.round(seconds / step); i++) value = c.sample(key, stick, 80, step);
    return value;
  };
  assert.ok(Math.abs(run(1 / 30) - run(1 / 120)) < 1e-10);
});

test('keyboard/touch use the speed-aware path, reset clears held controls, and split-screen inputs stay independent', () => {
  const a = new InputManager(), b = new InputManager(), out = input();
  a.touch.steer = 1; a.touch.throttle = true;
  for (let i = 0; i < 12; i++) a.sample(out, 85);
  assert.ok(out.steer > 0 && out.steer < .2);
  assert.equal(b.sample(input(), 85).steer, 0);
  a.clear();
  assert.deepEqual(a.sample(input(), 85), { ...input(), boost: false, shift: 0 });
  const key = (code: string, down: boolean) => (b as unknown as { onKey(e: Partial<KeyboardEvent>, down: boolean): void })
    .onKey({ code, repeat: false, preventDefault() {} }, down);
  key('KeyA', true);
  assert.ok(b.sample(out, 85).steer < 0);
  key('KeyA', false);
  for (let i = 0; i < 20; i++) b.sample(out, 85);
  assert.equal(out.steer, 0);
});

test('sensitivity cleans old/corrupt saves and cannot poison the input filter', () => {
  for (const v of [undefined, null, '100', NaN, Infinity]) assert.equal(cleanSteeringSensitivity(v), 100);
  assert.equal(cleanSteeringSensitivity(-10), 50); assert.equal(cleanSteeringSensitivity(900), 150);
  const saved = settings().steeringSensitivity;
  try {
    updateSettings({ steeringSensitivity: 75 }); assert.equal(settings().steeringSensitivity, 75);
    updateSettings({ steeringSensitivity: NaN }); assert.equal(settings().steeringSensitivity, 100);
  } finally { updateSettings({ steeringSensitivity: saved }); }
});

test('line assistance yields to an intentional key press while its physical steering ramps in', () => {
  const track = getSampleTrack(0), car = new CarPhysics(track), im = new InputManager();
  car.placeAt(100, assistDriver(track).lateralAt(100) + 2); car.state.speed = 80;
  im.touch.steer = -1;
  const request = im.sample(input(), car.state.speed), before = request.steer;
  const result = applyAssists(track, car.state, request, { ...DEFAULT_ASSISTS, steer: true }, false, car.tune, car.setup, im.steeringIntent);
  assert.equal(result.steer, before, 'line guidance never fights the new gradual player input');
  const handsOff = applyAssists(track, car.state, input(), { ...DEFAULT_ASSISTS, steer: true });
  assert.ok(Math.abs(handsOff.steer) > .01, 'hands-off guidance still works');
});

test('gamepad stick and D-pad receive their own analog/digital shaping, including disconnect', () => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const buttons = Array.from({ length: 16 }, () => ({ value: 0, pressed: false }));
  const pad = { connected: true, axes: [.5], buttons };
  let connected = true;
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { getGamepads: () => connected ? [pad] : [] } });
  try {
    const im = new InputManager(), out = input();
    im.pollGamepad();
    for (let i = 0; i < 60; i++) im.sample(out, 85);
    assert.ok(out.steer > .08 && out.steer < .16, `small stick correction: ${out.steer}`);
    im.clear(); pad.axes[0] = 0; buttons[15].pressed = true;
    im.pollGamepad();
    for (let i = 0; i < 12; i++) im.sample(out, 85);
    assert.equal(out.steer, hold(new PlayerSteering(), 1, 0, 85, .1), 'D-pad matches a 100 ms key press');
    assert.equal(im.lastDevice, 'gamepad');
    connected = false; im.pollGamepad();
    for (let i = 0; i < 60; i++) im.sample(out, 85);
    assert.equal(out.steer, 0);
  } finally {
    if (previous) Object.defineProperty(globalThis, 'navigator', previous);
    else delete (globalThis as Record<string, unknown>).navigator;
  }
});

function straight() {
  const control: Dot[] = [];
  for (let x = -1400; x <= 1400; x += 100) control.push({ x, y: -400 });
  for (let i = 1; i < 20; i++) control.push({ x: 1400 + 400 * Math.sin(i * Math.PI / 20), y: -400 * Math.cos(i * Math.PI / 20) });
  for (let x = 1400; x >= -1400; x -= 100) control.push({ x, y: 400 });
  for (let i = 1; i < 20; i++) control.push({ x: -1400 - 400 * Math.sin(i * Math.PI / 20), y: 400 * Math.cos(i * Math.PI / 20) });
  return buildTrack({ id: 'steering-straight', name: 'Steering', control, options: { walls: false, pits: false, trees: 'sparse', runoff: 'tarmac' } });
}

test('actual 300 km/h physics: a brief tap gives a small lane correction instead of a violent yaw impulse', context => {
  const t = straight();
  const run = (filtered: boolean) => {
    const car = new CarPhysics(t), control = new PlayerSteering();
    car.placeAt(300); const h = car.state.heading;
    Object.assign(car.state, { vx: Math.cos(h) * 300 / 3.6, vz: Math.sin(h) * 300 / 3.6, speed: 300 / 3.6 });
    car.abs = car.tc = car.tcFull = car.stability = car.steerHelp = false;
    let peakYaw = 0, peakYawAcceleration = 0, previousYaw = 0;
    for (let i = 0; i < 90; i++) {
      const key = i < 12 ? 1 : 0;
      car.step({ ...input(), steer: filtered ? control.sample(key, 0, car.state.speed, dt) : key });
      peakYaw = Math.max(peakYaw, Math.abs(car.state.yawRate));
      peakYawAcceleration = Math.max(peakYawAcceleration, Math.abs(car.state.yawRate - previousYaw) / dt); previousYaw = car.state.yawRate;
    }
    return { peakYaw, peakYawAcceleration, lateral: Math.abs(car.state.lateral), speed: car.state.speed };
  };
  const raw = run(false), smooth = run(true);
  assert.ok(smooth.peakYaw < raw.peakYaw * .5, JSON.stringify({ raw, smooth }));
  assert.ok(smooth.peakYawAcceleration < raw.peakYawAcceleration * .5);
  assert.ok(smooth.lateral > .1 && smooth.lateral < .35, JSON.stringify(smooth));
  context.diagnostic(JSON.stringify({ raw, smooth }));
});
