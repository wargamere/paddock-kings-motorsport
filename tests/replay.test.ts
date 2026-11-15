import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CarState } from '../src/car/physics.ts';
import { HANDLING } from '../src/config/handling.ts';
import { REPLAY } from '../src/config/replay.ts';
import { getSampleTrack } from '../src/editor/pipeline.ts';
import { distAt, highlights, orderAt, poseAt, ReplayRecorder, safetyCarAt, type RecordedCar } from '../src/race/replay.ts';

const TICK = 1 / HANDLING.tickRate;
const LAP = 1000;

/** A car the recorder sees: at `dist` m round the race, along the x axis. */
function car(dist: number, over: Partial<RecordedCar> = {}, heading = 0): RecordedCar {
  const st = new CarState();
  st.x = dist;
  st.z = 2;
  st.heading = heading;
  st.speed = 20;
  return { st, dist, racing: true, pitting: false, retired: false, present: true, hit: 0, ...over };
}

const names = [{ name: 'You', paint: 0, you: true }, { name: 'Bram', paint: 1, you: false }, { name: 'Cleo', paint: 2, you: false }];

/** 80 samples: you (car 0) catch and pass Bram; Cleo, leading, pits then retires; Bram takes a hard hit. */
function record() {
  const rec = new ReplayRecorder(names, LAP, TICK);
  rec.mark('start');
  for (let k = 0; k < 80; k++) {
    const t = k * rec.dt;
    const cleo = k < 30 ? car(500 + 25 * t) : k < 50 ? car(500 + 25 * t, { pitting: true }) : car(500 + 25 * 50 * rec.dt, { retired: true, racing: false });
    rec.sample([car(100 + 20 * t), car(110 + 15 * t, { hit: k === 40 ? 12 : 0 }), cleo], k >= 60 ? { x: 1, y: 0, z: 0, heading: 0 } : null);
    if (k === 60) rec.mark('safetyCar');
  }
  rec.mark('finish', 0);
  return rec.finish({ track: getSampleTrack(0), time: 'day', rain: false, laps: 2 });
}

test('the recorder: a sample every few ticks, every car each time, and the moments of the race', () => {
  const r = record();
  assert.equal(r.dt, TICK * REPLAY.everyTicks);
  assert.equal(r.count, 80);
  assert.equal(r.data.length, 80 * 3 * REPLAY.fields);
  const kinds = r.events.map((e) => e.kind);
  assert.deepEqual(kinds, ['start', 'pass', 'pit', 'contact', 'retire', 'safetyCar', 'finish']);
  for (let i = 1; i < r.events.length; i++) assert.ok(r.events[i].t >= r.events[i - 1].t, 'in time order');
  const pass = r.events.find((e) => e.kind === 'pass')!;
  assert.deepEqual(pass.cars, [0, 1], 'you pass Bram');
  assert.equal(pass.pos, 2, 'for second (Cleo leads)');
  assert.equal(pass.lap, 1);
  // You catch Bram 10 m back at 5 m/s faster: two seconds in.
  assert.ok(Math.abs(pass.t - 2) <= r.dt * 1.01, `passed at ${pass.t.toFixed(2)} s`);
  assert.deepEqual(r.events.find((e) => e.kind === 'pit')!.cars, [2]);
  assert.deepEqual(r.events.find((e) => e.kind === 'contact')!.cars, [1]);
  assert.deepEqual(r.events.find((e) => e.kind === 'retire')!.cars, [2]);
  assert.ok(!r.events.some((e) => e.kind === 'pass' && e.cars.includes(2)), 'a car pitting or retiring is not passed on the track');
  // The safety car only while it's out; the order and distance by time.
  assert.equal(safetyCarAt(r, 1), null);
  assert.deepEqual(safetyCarAt(r, 70 * r.dt), { x: 1, y: 0, z: 0, heading: 0 });
  assert.deepEqual(orderAt(r, 0), [2, 1, 0]);
  assert.deepEqual(orderAt(r, 79 * r.dt).slice(0, 2), [0, 1], 'Cleo, retired, last of those still running');
  assert.ok(Math.abs(distAt(r, 0, 10 * r.dt) - (100 + 20 * 10 * r.dt)) < 1e-3);
});

test('passes: a swap back and forth within the debounce counts once, and cars far apart never pass', () => {
  const rec = new ReplayRecorder(names.slice(0, 2), LAP, TICK);
  // Side by side for a second, swapping every sample; then car 1 a lap down being lapped.
  for (let k = 0; k < 15; k++) rec.sample([car(100 + (k % 2 ? 1 : -1)), car(100)], null);
  for (let k = 0; k < 20; k++) rec.sample([car(2000 + k * 10), car(1100 + k * 30)], null);
  const r = rec.finish({ track: getSampleTrack(0), time: 'day', rain: false, laps: 3 });
  assert.equal(r.events.filter((e) => e.kind === 'pass').length, 1);
});

test('a long race spans several blocks, every sample kept in order', () => {
  const rec = new ReplayRecorder(names.slice(0, 1), LAP, TICK);
  const n = REPLAY.chunk * 2 + 17;
  for (let k = 0; k < n; k++) rec.sample([car(k)], null);
  const r = rec.finish({ track: getSampleTrack(0), time: 'day', rain: false, laps: 1 });
  assert.equal(r.count, n);
  for (const k of [0, REPLAY.chunk - 1, REPLAY.chunk, REPLAY.chunk * 2, n - 1]) assert.equal(distAt(r, 0, k * r.dt), k);
});

test('poses between samples: positions blend, the heading the short way round (across ±π), and a car off the track is not shown', () => {
  const rec = new ReplayRecorder(names.slice(0, 2), LAP, TICK);
  rec.sample([car(10, {}, 3.1), car(0)], null);
  rec.sample([car(20, {}, -3.1), car(0, { present: false })], null);
  const r = rec.finish({ track: getSampleTrack(0), time: 'day', rain: false, laps: 1 });
  const out = new CarState();
  assert.ok(poseAt(r, 0, r.dt / 2, out));
  assert.ok(Math.abs(out.x - 15) < 1e-4);
  assert.ok(Math.abs(Math.abs(out.heading) - Math.PI) < 0.01, `heading ${out.heading.toFixed(3)}, not through 0`);
  assert.ok(Math.abs(out.vx - Math.cos(out.heading) * 20) < 1e-4);
  // Car 1 is there for the first sample (held, not blended toward nothing), then gone.
  assert.ok(poseAt(r, 1, r.dt / 2, out));
  assert.equal(out.x, 0);
  assert.equal(poseAt(r, 1, r.dt, out), false);
  assert.equal(distAt(r, 1, r.dt), -Infinity);
});

test('highlights: the start, the moments that matter most in race order, overlaps merged, and the finish', () => {
  // Everything in this short race is within the start's clip: one highlight.
  const short = highlights(record());
  assert.equal(short.length, 1);
  assert.equal(short[0].event.kind, 'start');
  // A ten-minute race with a hard hit every 20 s: too many moments, so only the weightiest make it.
  const rec = new ReplayRecorder(names.slice(0, 1), LAP, TICK);
  rec.mark('start');
  for (let k = 0; k < 15 * 600; k++) rec.sample([car(k, { hit: k % 300 === 150 ? 10 + ((k / 300) | 0) % 7 : 0 })], null);
  rec.mark('finish');
  const r = rec.finish({ track: getSampleTrack(0), time: 'day', rain: false, laps: 1 });
  const h = highlights(r);
  assert.ok(r.events.length > REPLAY.maxHighlights);
  assert.equal(h.length, REPLAY.maxHighlights);
  assert.equal(h[0].event.kind, 'start');
  // The finish has the last clip.
  assert.equal(h[h.length - 1].event.kind, 'finish');
  const finish = r.events.find((e) => e.kind === 'finish')!;
  assert.ok(h[h.length - 1].from <= finish.t && finish.t <= h[h.length - 1].to);
  const end = r.count * r.dt;
  for (let i = 0; i < h.length; i++) {
    assert.ok(h[i].from < h[i].to && h[i].from >= 0 && h[i].to <= end);
    if (i) assert.ok(h[i].from > h[i - 1].to, 'in race order, no overlaps');
  }
  // Your own hits here outweigh the finish: it's in anyway, and no hit heavier than one shown is left out.
  assert.ok(r.events.filter((e) => e.kind === 'contact' && e.weight > finish.weight).length >= REPLAY.maxHighlights);
  const cut = Math.min(...h.filter((c) => c.event.kind === 'contact').map((c) => c.event.weight));
  assert.ok(r.events.filter((e) => e.weight > cut && e.kind === 'contact').every((e) => h.some((c) => c.event === e)), 'none heavier left out');
});
