import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CarPhysics } from '../src/car/physics.ts';
import { terminalSpeed } from '../src/car/powertrain.ts';
import { HANDLING } from '../src/config/handling.ts';
import { builtInTrack, builtInTracks } from '../src/editor/pipeline.ts';
import { readDraft, writeDraft } from '../src/editor/draft.ts';
import { fitView, toScreen } from '../src/editor/render2d.ts';
import { paperFor } from '../src/track/bounds.ts';
import { CIRCUIT_LENGTHS } from '../src/track/circuitScale.ts';
import { decodeTrack, encodeTrack } from '../src/track/code.ts';
import { cleanPaintFrame, editablePaint, paintCell, paintCode, paintDab, paintGrid } from '../src/track/extras.ts';
import { surfaceFor } from '../src/track/surface.ts';
import { RecordBook } from '../src/race/records.ts';
import { loadJSON, saveJSON, storage } from '../src/platform/storage.ts';

test('real acceleration reaches 300 km/h through eight gears, with drag-limited top speed', () => {
  const car = new CarPhysics(builtInTrack('world-it-1922')!);
  car.placeAt(10);
  const { x, z, heading } = car.state;
  const reached = [100, 200, 300].map(() => 0);
  for (let tick = 1; tick <= HANDLING.tickRate * 30; tick++) {
    car.step({ throttle: 1, brake: 0, steer: 0, handbrake: false });
    const st = car.state, v = st.speed;
    [100, 200, 300].forEach((kmh, i) => { if (!reached[i] && v * 3.6 >= kmh) reached[i] = tick * car.dt; });
    // Endless straight: retain real drivetrain/tyre state, prevent running into a corner.
    Object.assign(st, { x, z, heading, yawRate: 0, vx: Math.cos(heading) * v, vz: Math.sin(heading) * v });
  }
  assert.ok(reached[0] > 2 && reached[0] < 3.5, `0–100: ${reached[0]}`);
  assert.ok(reached[1] > 4 && reached[1] < 6.5, `0–200: ${reached[1]}`);
  assert.ok(reached[2] > 8 && reached[2] < 12, `0–300: ${reached[2]}`);
  assert.equal(car.state.gear, 8);
  assert.ok(car.state.speed * 3.6 > 315 && car.state.speed * 3.6 < 335);
  assert.ok(Math.abs(car.state.speed - terminalSpeed()) < .3, 'planning equilibrium agrees with physics');
});

test('physical distance advances in metres at the displayed speed, beyond the old world boundary', () => {
  const t = builtInTrack('world-it-1922')!, car = new CarPhysics(t);
  const index = t.center.points.findIndex(p => Math.max(Math.abs(p.x), Math.abs(p.y)) > 1000);
  assert.ok(index >= 0);
  car.placeAt(index * t.center.spacing);
  const start = { x: car.state.x, z: car.state.z };
  const h = car.state.heading;
  Object.assign(car.state, { vx: Math.cos(h) * 80, vz: Math.sin(h) * 80, speed: 80 });
  car.step({ throttle: 1, brake: 0, steer: 0, handbrake: false });
  assert.ok(Math.abs(Math.hypot(car.state.x - start.x, car.state.z - start.z) - car.state.speed * car.dt) < .03);
  assert.ok(Math.max(Math.abs(car.state.x), Math.abs(car.state.z)) > 1000, 'no invisible ±900 m clamp');
});

test('all real circuits retain full scale through share codes, bounded terrain and phone editor fitting', () => {
  const entries = builtInTracks().filter(e => e.group === 'world');
  assert.equal(entries.length, Object.keys(CIRCUIT_LENGTHS).length);
  for (const e of entries) {
    const t = e.track(), decoded = decodeTrack(encodeTrack(e.def.name, e.def.control, e.def.options));
    assert.ok(decoded.ok, e.def.name);
    if (decoded.ok) assert.deepEqual(decoded.dots, e.def.control);
    const terrain = surfaceFor(t).terrain;
    assert.ok(terrain.nx * terrain.nz <= 182 ** 2, `${e.def.name}: bounded terrain allocation`);
    const v = fitView(844, 390, 45, 40, 60, 20, paperFor(e.def.control));
    for (const p of e.def.control) {
      const s = toScreen(v, p);
      assert.ok(s.x >= 60 && s.x <= 824 && s.y >= 45 && s.y <= 350, e.def.name);
      assert.ok(p.x >= terrain.x0 && p.x <= terrain.x0 + (terrain.nx - 1) * terrain.step);
      assert.ok(p.y >= terrain.z0 && p.y <= terrain.z0 + (terrain.nz - 1) * terrain.step);
    }
  }
});

test('full-size runoff paint and editor drafts survive reload and sharing outside the old paper', () => {
  const t = builtInTrack('world-it-1922')!;
  const { grid, frame } = editablePaint({}, t.def.control);
  assert.ok(frame && grid.length <= 40000);
  const p = t.def.control.find(p => Math.abs(p.x) > 400)!;
  paintDab(grid, p.x, p.y, 20, 2, frame);
  const extras = { paint: paintCode(grid), paintFrame: frame };
  const decoded = decodeTrack(encodeTrack('Large paint', t.def.control, t.def.options, extras));
  assert.ok(decoded.ok);
  if (!decoded.ok) return;
  assert.deepEqual(decoded.extras, extras);
  const restored = paintGrid(decoded.extras?.paint, decoded.extras?.paintFrame);
  assert.equal(restored[paintCell(p.x, p.y, frame)], 2);
  writeDraft({ dots: t.def.control, closed: true, name: 'Full circuit', options: t.options, extras });
  assert.deepEqual(readDraft()?.dots, t.def.control);
  assert.deepEqual(readDraft()?.extras, extras);
  storage.removeItem('editor.draft.v1');
  assert.equal(cleanPaintFrame({ x0: 0, y0: 0, cell: 4, cols: 1000000, rows: 1000000 }), null);
});

test('compact circuit personal bests stay stored and never compete against full-size laps', () => {
  const id = 'world-it-1922', oldKey = `records.${id}`;
  const old = { scoreV: 2, best: { time: 35, splits: [] }, bestScore: 1600, ghost: null };
  saveJSON(oldKey, old);
  const book = new RecordBook();
  assert.equal(book.get(id).best, null);
  book.get(id).best = { time: 82, splits: [] };
  book.save(id);
  assert.equal(new RecordBook().summary(id).best?.time, 82);
  assert.deepEqual(loadJSON(oldKey, null), old);
  book.forget(id);
  assert.deepEqual(loadJSON(oldKey, null), old);
  storage.removeItem(oldKey);
});
