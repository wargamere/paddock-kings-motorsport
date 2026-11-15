import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Window } from 'happy-dom';
import type { CarPhysics } from '../src/car/physics.ts';
import { HANDLING } from '../src/config/handling.ts';
import { PIT_WALL, type Compound, type PaceMode } from '../src/config/race.ts';
import { STR } from '../src/config/strings.ts';
import { getSampleTrack } from '../src/editor/pipeline.ts';
import { AiDriver } from '../src/race/ai.ts';
import { pitLane, laneU } from '../src/track/pitLane.ts';
import type { Track } from '../src/track/track.ts';

const win = new Window({ url: 'https://pitwall.test/' });
for (const key of ['window', 'document', 'HTMLElement', 'HTMLButtonElement', 'Element', 'Node']) {
  Object.defineProperty(globalThis, key, { configurable: true, value: key === 'window' ? win : Reflect.get(win, key) });
}
const { PitWall } = await import('../src/ui/pitWall.ts');

const DT = 1 / HANDLING.tickRate;

const progressOf = (car: CarPhysics, track: Track) => {
  const st = car.state;
  const tg = track.center.tangents[Math.max(0, st.trackIndex)];
  return { s: st.s, lateral: st.lateral, along: st.vx * tg.x + st.vz * tg.y, offTrack: st.offTrack };
};

/** An AI alone with tyre wear for `laps` laps at pace mode `mode`: its race time and the tyre life it used. */
function stint(track: Track, mode: PaceMode, laps: number) {
  const ai = new AiDriver(track, { name: 'a', paint: 0, difficulty: 0.8, laps, slot: 0, tyreWear: true });
  ai.mode = mode;
  for (let tick = 0; tick < laps * 90 * HANDLING.tickRate && ai.session.phase !== 'finished'; tick++) {
    const prev = progressOf(ai.car, track);
    ai.car.step(ai.drive([ai.car.state], DT));
    ai.session.step(prev, progressOf(ai.car, track), []);
  }
  return { ai, time: (ai.session.runEnd ?? NaN) - ai.session.goTime, used: 1 - ai.car.tyreLeft };
}

test('pace modes: push is quicker and harder on the tyres, save slower and gentler; the car reckons its tyre life by the mode', () => {
  const t = getSampleTrack(2);
  const r = Object.fromEntries((['push', 'normal', 'save'] as const).map((m) => [m, stint(t, m, 2)])) as Record<PaceMode, ReturnType<typeof stint>>;
  for (const m of PIT_WALL.order) {
    assert.equal(r[m].ai.session.phase, 'finished', `${m}: finished`);
    assert.equal(r[m].ai.mode, m);
    assert.equal(r[m].ai.car.wearRate, PIT_WALL.modes[m].wear);
    assert.ok(r[m].ai.car.tyreLeft > 0, `${m}: tyres left`);
  }
  assert.ok(r.push.time < r.normal.time && r.normal.time < r.save.time, `push ${r.push.time.toFixed(2)} s, normal ${r.normal.time.toFixed(2)} s, save ${r.save.time.toFixed(2)} s`);
  assert.ok(r.push.used > r.normal.used * 1.15 && r.save.used < r.normal.used * 0.85, `tyre used: push ${r.push.used.toFixed(3)}, normal ${r.normal.used.toFixed(3)}, save ${r.save.used.toFixed(3)}`);
  // The laps the tyres have left follow the rate they're used at.
  const car = r.normal.ai.car;
  const left = car.tyreLapsLeft;
  car.wearRate = PIT_WALL.modes.save.wear;
  assert.ok(Math.abs(car.tyreLapsLeft - left / PIT_WALL.modes.save.wear) < 1e-9);
});

test('a box call from the pit wall: the teammate stops next time by and fits the tyres you chose', () => {
  const t = getSampleTrack(0);
  const lane = pitLane(t)!;
  const ai = new AiDriver(t, { name: 'a', paint: 0, difficulty: 0.75, laps: 3, slot: 0, tyreWear: true });
  const start = ai.car.compound;
  const want: Compound = start === 'hard' ? 'soft' : 'hard';
  let called = false;
  for (let tick = 0; tick < 400 * HANDLING.tickRate && ai.session.phase !== 'finished'; tick++) {
    const prev = progressOf(ai.car, t);
    if (!called && ai.session.lapStart !== null && laneU(lane, ai.car.state.s) < 0 && ai.session.raceDistance(ai.car.state.s) > t.center.length * 0.3) {
      ai.boxCall = want;
      called = true;
    }
    ai.car.step(ai.drive([ai.car.state], DT));
    ai.session.step(prev, progressOf(ai.car, t), []);
  }
  assert.equal(ai.session.phase, 'finished');
  assert.equal(ai.crew?.stops, 1, 'one stop');
  assert.equal(ai.car.compound, want, `on ${want}s after the stop`);
  assert.equal(ai.boxCall, null, 'the call is done with');
});

const info = (over: Partial<Parameters<InstanceType<typeof PitWall>['show']>[0]> = {}) => ({
  name: 'Almeida', pos: 7, gapAhead: '1.4', tyre: 'soft' as Compound, tyreAge: 3.6, tyreLeft: 0.15, lapsLeft: 6.2, mode: 'normal' as PaceMode, boxCall: null, pitting: false, out: false, ...over,
});

test('the pit wall panel: shows the teammate, calls them in for the suggested or chosen tyres, cancels, and cycles the pace', () => {
  const calls: (Compound | null)[] = [];
  const modes: PaceMode[] = [];
  const wall = new PitWall({ box: (c) => calls.push(c), mode: (m) => modes.push(m) });
  document.body.append(wall.root);
  // Nothing to show until there's a car.
  assert.equal(wall.root.hidden, true);
  wall.toggleBox();
  wall.cycleMode();
  assert.deepEqual([calls, modes], [[], []]);

  wall.suggest('medium');
  wall.show(info());
  assert.equal(wall.root.hidden, false);
  const text = wall.root.textContent ?? '';
  assert.match(text, /Almeida · P7/);
  assert.match(text, /1\.4 s to the car ahead/);
  assert.match(text, /Soft · 3 laps old · 15% left · 7 laps to go/);
  assert.ok(wall.root.querySelector('.pit-wall-tyres.low'), 'tyres nearly gone are flagged');
  assert.equal(wall.root.querySelector('.tyre-choice.on')?.getAttribute('data-compound'), 'medium', 'the suggestion is picked');

  wall.toggleBox();
  assert.deepEqual(calls, ['medium'], 'boxed for the suggestion');
  // Choosing other tyres: a later suggestion doesn't override them, and a call already made moves to them.
  wall.show(info({ boxCall: 'medium' }));
  assert.match(wall.root.textContent ?? '', /box this lap for medium/);
  (wall.root.querySelector('[data-compound="hard"]') as HTMLButtonElement).click();
  assert.deepEqual(calls, ['medium', 'hard']);
  wall.suggest('soft');
  assert.equal(wall.tyres, 'hard');
  wall.show(info({ boxCall: 'hard' }));
  wall.toggleBox();
  assert.deepEqual(calls, ['medium', 'hard', null], 'and the second press cancels');

  // Pace: normal → push → save → normal.
  for (const m of ['normal', 'push', 'save'] as const) {
    wall.show(info({ mode: m }));
    wall.cycleMode();
  }
  assert.deepEqual(modes, ['push', 'save', 'normal']);
  assert.equal(wall.root.querySelector('.pit-wall-modes .on')?.textContent?.trim(), STR.pitWall.modes.save);

  // In the pits or out of the race: no calls.
  wall.show(info({ pitting: true }));
  wall.toggleBox();
  wall.show(info({ out: true }));
  wall.toggleBox();
  wall.cycleMode();
  assert.equal(calls.length, 3);
  assert.equal(modes.length, 3);
  assert.ok((wall.root.textContent ?? '').includes(STR.pitWall.out));

  wall.setRadio('Box, box');
  assert.equal(wall.root.querySelector('.pit-wall-radio')?.textContent, 'Box, box');
  wall.hide();
  assert.equal(wall.root.hidden, true);
  assert.equal((wall.root.querySelector('.pit-wall-radio') as HTMLElement).hidden, true);
  wall.root.remove();
});

test('an AI driver starts at normal pace, at the normal tyre rate', () => {
  const ai = new AiDriver(getSampleTrack(0), { name: 'a', paint: 0, difficulty: 0.75, laps: 3, slot: 0, tyreWear: true });
  assert.equal(ai.mode, 'normal');
  assert.equal(ai.car.wearRate, 1);
  ai.mode = 'push';
  assert.equal(ai.car.wearRate, PIT_WALL.modes.push.wear);
});
