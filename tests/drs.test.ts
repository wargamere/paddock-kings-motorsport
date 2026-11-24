import assert from 'node:assert/strict';
import { test } from 'node:test';
import { damageLook } from '../src/car/model.ts';
import { CarPhysics, type DriveInput } from '../src/car/physics.ts';
import { DAMAGE_LOOK, DRS, DRS_REAL, ERS } from '../src/config/race.ts';
import { builtInTracks, getSampleTrack } from '../src/editor/pipeline.ts';
import { DrsControl, drsZones, inZone } from '../src/race/drs.ts';
import { buildTrack } from '../src/track/track.ts';

test('DRS zones: every real circuit has its real ones (where there is a straight for them), each a decent length, detected before it', () => {
  for (const b of builtInTracks()) {
    if (!b.def.id.startsWith('world-')) continue;
    const t = b.track();
    const L = t.center.length;
    const zones = drsZones(t);
    const real = DRS_REAL.zones[b.def.id];
    assert.ok(real, `${b.def.name} is listed`);
    assert.ok(zones.length >= 1 && zones.length <= real.length, `${b.def.name}: ${zones.length} zones`);
    for (const z of zones) {
      const length = (((z.to - z.from) % L) + L) % L;
      assert.ok(length >= DRS_REAL.shortest, `${b.def.name}: a ${length.toFixed(0)} m zone`);
      assert.ok(Math.abs((((z.from - z.detect) % L) + L) % L - DRS.detect) < 1e-6, 'detection before the zone');
      assert.ok(inZone(z, (z.from + 1) % L, L) && !inZone(z, z.detect, L));
    }
  }
  const count = (name: string) => drsZones(builtInTracks().find((b) => b.def.name === name)!.track()).length;
  assert.equal(count('Sakhir'), 3);
  // (Its back straights are one with the car's downforce: the kink between them is taken flat out.)
  assert.equal(count('Melbourne'), 4);
  assert.equal(count('Monza'), 2);
  assert.equal(count('Monaco'), 1);
  assert.equal(count('Suzuka'), 1);
  assert.equal(drsZones(getSampleTrack(0)), drsZones(getSampleTrack(0)), 'worked out once per track');
});

test('DRS zones drawn in the editor replace the track\'s own; ones too short are left out', () => {
  const base = getSampleTrack(0);
  const c = base.center;
  const p = (s: number) => c.points[Math.round(s / c.spacing) % c.points.length];
  const mark = (a: number, b: number) => ({ x: p(a).x + 2, y: p(a).y, x2: p(b).x, y2: p(b).y - 2 });
  const t = buildTrack({ ...base.def, extras: { drs: [mark(100, 300), mark(600, 620)] } });
  const zones = drsZones(t);
  assert.equal(zones.length, 1, 'the 20 m one is too short');
  assert.ok(Math.abs(zones[0].from - 100) <= c.spacing * 2 && Math.abs(zones[0].to - 300) <= c.spacing * 2, `${zones[0].from}..${zones[0].to}`);
  // Over the line: from near the end of the lap to just past the start.
  const L = c.length;
  const over = drsZones(buildTrack({ ...base.def, extras: { drs: [mark(L - 100, 80)] } }));
  assert.ok(Math.abs((((over[0].to - over[0].from) % L) + L) % L - 180) <= c.spacing * 3);
});

test('DRS control: within a second of the car before at the detection point, cleared for that zone only while in it; never while disabled', () => {
  const t = getSampleTrack(0);
  const L = t.center.length;
  const drs = new DrsControl(t, 3);
  const z = drs.zones[0];
  const at = (d: number) => (((z.detect + d) % L) + L) % L;
  drs.enabled = true;
  // Car 0 crosses at 10 s, car 1 0.6 s later, car 2 1.5 s after car 1.
  drs.update(0, at(-2), 9.9);
  drs.update(1, at(-30), 9.9);
  drs.update(2, at(-60), 9.9);
  drs.update(0, at(1), 10);
  drs.update(1, at(-1), 10.5);
  drs.update(1, at(1), 10.6);
  drs.update(2, at(-1), 12);
  drs.update(2, at(1), 12.1);
  assert.equal(drs.armed(0), false, 'nobody ahead of the first car');
  assert.equal(drs.armed(1), true, '0.6 s behind');
  assert.equal(drs.armed(2), false, '1.5 s behind');
  assert.equal(drs.available(1, at(1)), false, 'not yet in the zone');
  // On to the zone and through it, a tick at a time (half a metre each): cleared all the way to its end.
  const span = (((z.to - at(1)) % L) + L) % L;
  let open = 0;
  for (let d = 0.5; d <= span + 5; d += 0.5) {
    const s = (at(1) + d) % L;
    drs.update(1, s, 10.6 + d / 50);
    if (drs.available(1, s)) open++;
    if (d < span - 1) assert.equal(drs.armed(1), true, `still cleared ${d} m on`);
  }
  const zoneLength = (((z.to - z.from) % L) + L) % L;
  assert.ok(Math.abs(open * 0.5 - zoneLength) < 1.5, `open for ${open * 0.5} m of a ${zoneLength.toFixed(0)} m zone`);
  // Past the end: cleared no longer.
  assert.equal(drs.armed(1), false);
  assert.equal(drs.available(1, (z.from + 5) % L), false);
  // Disabled (first lap, rain, safety car): nobody.
  const off = new DrsControl(t, 2);
  off.update(0, at(-1), 1);
  off.update(0, at(1), 1.01);
  off.update(1, at(-1), 1.2);
  off.update(1, at(1), 1.21);
  assert.equal(off.armed(1), false);
  // A car put back on the road starts afresh.
  drs.update(0, at(-1), 20);
  drs.update(0, at(1), 20.01);
  drs.update(2, at(-1), 20.2);
  drs.forget(2);
  drs.update(2, at(1), 20.21);
  assert.equal(drs.armed(2), false, 'no crossing seen after being forgotten');
});

/** A car `ticks` ticks flat out from `speed` m/s down the first DRS zone of the sample track: its speed at the end, and its battery. */
function run(ticks: number, speed: number, set: (car: CarPhysics) => void, input: Partial<DriveInput> = {}) {
  const t = getSampleTrack(0);
  const car = new CarPhysics(t);
  car.placeAt(drsZones(t)[0].from);
  const st = car.state;
  st.vx = Math.cos(st.heading) * speed;
  st.vz = Math.sin(st.heading) * speed;
  set(car);
  for (let i = 0; i < ticks; i++) car.step({ throttle: 1, brake: 0, steer: 0, handbrake: false, ...input });
  return car;
}

test('DRS open and the boost: quicker down a straight; the boost drains the battery, braking charges it', () => {
  // Above the traction-limited launch phase, additional wheel power is usable.
  const plain = run(120, 65, () => {});
  const drs = run(120, 65, (c) => (c.drs = true));
  const boost = run(120, 65, () => {}, { boost: true });
  for (const c of [plain, drs, boost]) assert.equal(c.state.offTrack, false, 'still on the straight');
  assert.ok(drs.state.speed > plain.state.speed + 0.2, `DRS ${drs.state.speed.toFixed(2)} vs ${plain.state.speed.toFixed(2)} m/s`);
  assert.ok(boost.state.speed > plain.state.speed + 0.3, `boost ${boost.state.speed.toFixed(2)} vs ${plain.state.speed.toFixed(2)} m/s`);
  assert.ok(Math.abs(boost.ers - (1 - ERS.drain)) < 0.01, `battery ${boost.ers.toFixed(3)} after 1 s`);
  assert.equal(plain.ers, 1, 'not used, still full');
  // An empty battery: no boost.
  const empty = run(120, 65, (c) => (c.ers = 0), { boost: true });
  assert.ok(Math.abs(empty.state.speed - plain.state.speed) < 1e-9);
  assert.equal(empty.boosting, false);
  // Braking hard charges it.
  const brake = run(120, 40, (c) => (c.ers = 0.2), { throttle: 0, brake: 1 });
  assert.ok(brake.ers > 0.2 + ERS.harvest * 0.5, `charged to ${brake.ers.toFixed(3)}`);
});

test('damage you can see: the bumper hangs then goes, the rear wing bends then goes, scuffs early on', () => {
  const D = DAMAGE_LOOK;
  assert.deepEqual(damageLook(0, 0), { front: 0, rear: 0, scuffs: false });
  assert.deepEqual(damageLook(D.frontHang, 0), { front: 1, rear: 0, scuffs: true });
  assert.deepEqual(damageLook(D.frontGone, D.rearBent), { front: 2, rear: 1, scuffs: true });
  assert.deepEqual(damageLook(0.1, D.rearGone), { front: 0, rear: 2, scuffs: true });
  assert.deepEqual(damageLook(D.scuffs - 0.01, 0), { front: 0, rear: 0, scuffs: false });
});
