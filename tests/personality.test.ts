import assert from 'node:assert/strict';
import { test } from 'node:test';
import { splitMaps, DEFAULT_BINDINGS, P2_KEYS } from '../src/car/bindings.ts';
import type { CarPhysics } from '../src/car/physics.ts';
import { HANDLING } from '../src/config/handling.ts';
import { PERSONALITY } from '../src/config/race.ts';
import { builtInTracks, getSampleTrack } from '../src/editor/pipeline.ts';
import { AiDriver } from '../src/race/ai.ts';
import { personalityFor, traits, type MistakeKind, type Personality } from '../src/race/personality.ts';
import type { Track } from '../src/track/track.ts';

const neutral: Personality = { style: 0, rain: 0, tyres: 0, consistency: 0.7 };

test('personalities: the same for a driver every time, spread across the field, a trait only past the threshold', () => {
  assert.deepEqual(personalityFor('gp-piastra'), personalityFor('gp-piastra'));
  assert.notDeepEqual(personalityFor('Ada'), personalityFor('Bram'));
  const many = Array.from({ length: 400 }, (_, i) => personalityFor(`driver-${i}`));
  for (const p of many) {
    for (const v of [p.style, p.rain, p.tyres]) assert.ok(v >= -1 && v <= 1);
    assert.ok(p.consistency >= 0.4 && p.consistency <= 1);
  }
  const share = (f: (p: Personality) => boolean) => many.filter(f).length / many.length;
  const T = PERSONALITY.traitFrom;
  for (const side of [(p: Personality) => p.style >= T, (p: Personality) => p.style <= -T]) {
    const s = share(side);
    assert.ok(s > 0.15 && s < 0.35, `about a quarter each way: ${s.toFixed(2)}`);
  }
  assert.deepEqual(traits(neutral), []);
  assert.deepEqual(traits({ style: 0.9, rain: -0.5, tyres: 0, consistency: 0.7 }), ['aggressive', 'poorInRain']);
  assert.deepEqual(traits({ style: -0.5, rain: 0.2, tyres: 0.8, consistency: 0.45 }), ['tyreWhisperer', 'erratic', 'defensive'].sort((a, b) => (a === 'tyreWhisperer' ? -1 : b === 'tyreWhisperer' ? 1 : a === 'erratic' ? -1 : 1)));
});

const progressOf = (car: CarPhysics, track: Track) => {
  const st = car.state;
  const tg = track.center.tangents[Math.max(0, st.trackIndex)];
  return { s: st.s, lateral: st.lateral, along: st.vx * tg.x + st.vz * tg.y, offTrack: st.offTrack };
};

/** An AI alone for `laps` laps: its race time, the tyre life it used, and the mistakes it made. */
function solo(track: Track, laps: number, personality: Personality | undefined, opts: { wet?: boolean; tyreWear?: boolean } = {}) {
  const ai = new AiDriver(track, { name: 'Test', paint: 0, difficulty: 0.8, laps, slot: 0, personality, ...opts });
  const mistakes: MistakeKind[] = [];
  ai.onMistake = (k) => mistakes.push(k);
  for (let tick = 0; tick < laps * 120 * HANDLING.tickRate && ai.session.phase !== 'finished'; tick++) {
    const prev = progressOf(ai.car, track);
    ai.car.step(ai.drive([ai.car.state], 1 / HANDLING.tickRate));
    ai.session.step(prev, progressOf(ai.car, track), []);
  }
  return { time: (ai.session.runEnd ?? NaN) - ai.session.goTime, used: 1 - ai.car.tyreLeft, mistakes, ai };
}

test('character on track: a rain master is quicker in the wet, careful tyres last longer; without a personality nothing changes', () => {
  const t = getSampleTrack(2);
  const calm = { ...neutral, consistency: 1 };
  // (No mistakes in these: a perfectly consistent driver, and the dice set to never.)
  const base = PERSONALITY.mistake.base;
  (PERSONALITY.mistake as { base: number }).base = 0;
  try {
    const master = solo(t, 2, { ...calm, rain: 1 }, { wet: true });
    const poor = solo(t, 2, { ...calm, rain: -1 }, { wet: true });
    assert.ok(master.time < poor.time - 0.3, `wet: ${master.time.toFixed(2)} s vs ${poor.time.toFixed(2)} s`);
    const gentle = solo(t, 2, { ...calm, tyres: 1 }, { tyreWear: true });
    const harsh = solo(t, 2, { ...calm, tyres: -1 }, { tyreWear: true });
    assert.ok(gentle.used < harsh.used * 0.8, `tyres: ${gentle.used.toFixed(3)} vs ${harsh.used.toFixed(3)}`);
    assert.equal(gentle.ai.car.wearRate, 1 - PERSONALITY.tyreWear);
    // Neutral in the dry: the same race as the plain AI.
    const plain = solo(t, 2, undefined);
    const same = solo(t, 2, calm);
    assert.equal(same.time, plain.time);
  } finally {
    (PERSONALITY.mistake as { base: number }).base = base;
  }
});

test('mistakes: rare, on the driver’s own dice (the same race twice is the same), more for an erratic driver, and they cost time', () => {
  const t = builtInTracks().find((b) => b.def.id === 'world-at-1969')!.track();
  const erratic = { ...neutral, consistency: 0.4 };
  const a = solo(t, 4, erratic);
  const b = solo(t, 4, erratic);
  assert.deepEqual(a.mistakes, b.mistakes, 'repeatable');
  assert.equal(a.time, b.time);
  // Often enough to notice with the dice loaded, and each costs time.
  const base = PERSONALITY.mistake.base;
  (PERSONALITY.mistake as { base: number }).base = 1;
  try {
    const sloppy = solo(t, 2, erratic);
    (PERSONALITY.mistake as { base: number }).base = 0;
    const clean = solo(t, 2, erratic);
    assert.ok(sloppy.mistakes.length >= 10, `${sloppy.mistakes.length} mistakes`);
    for (const k of ['lockup', 'wide', 'spin'] as const) assert.ok(sloppy.mistakes.includes(k), `a ${k}`);
    assert.ok(sloppy.time > clean.time + 5, `${sloppy.mistakes.length} mistakes: ${sloppy.time.toFixed(2)} s vs ${clean.time.toFixed(2)} s`);
    assert.equal(clean.mistakes.length, 0);
  } finally {
    (PERSONALITY.mistake as { base: number }).base = base;
  }
  assert.equal(solo(t, 1, undefined).mistakes.length, 0, 'no personality: no mistakes');
});

test('split screen on one keyboard: player 1 has W A S D (and every other key), player 2 the arrows, Right Shift and /', () => {
  const { p1, p2 } = splitMaps(DEFAULT_BINDINGS);
  for (const [k, a] of [['KeyW', 'throttle'], ['KeyS', 'brake'], ['KeyA', 'left'], ['KeyD', 'right'], ['Space', 'boost'], ['KeyR', 'reset'], ['KeyC', 'camera'], ['Escape', 'pause']] as const) assert.equal(p1.get(k), a, k);
  for (const k of ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', P2_KEYS.boost, P2_KEYS.reset]) assert.equal(p1.has(k), false, `${k} isn't player 1's`);
  for (const [k, a] of [['ArrowUp', 'throttle'], ['ArrowDown', 'brake'], ['ArrowLeft', 'left'], ['ArrowRight', 'right'], [P2_KEYS.boost, 'boost'], [P2_KEYS.reset, 'reset']] as const) assert.equal(p2.get(k), a, k);
  assert.equal(p2.has('KeyW'), false);
  // Rebound second keys go to player 2.
  const custom = { ...DEFAULT_BINDINGS, throttle: ['KeyW', 'KeyI'], brake: ['KeyS', 'KeyK'] };
  const m = splitMaps(custom);
  assert.equal(m.p2.get('KeyI'), 'throttle');
  assert.equal(m.p2.get('KeyK'), 'brake');
  assert.equal(m.p1.has('KeyI'), false);
});
