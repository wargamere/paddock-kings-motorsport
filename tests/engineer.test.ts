import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONDITIONS, DAMAGE, ENGINEER } from '../src/config/race.ts';
import { STR, fmt } from '../src/config/strings.ts';
import { RaceEngineer, type EngineerView } from '../src/race/engineer.ts';
import { pickCompound } from '../src/race/strategy.ts';

const E = STR.engineer;

/** A race at 60 s in, lap 3 of 10, P4 of 10, on mediums with plenty left; `over` changes it. */
function view(over: Partial<EngineerView> = {}, tyres: Partial<NonNullable<EngineerView['tyres']>> = {}): EngineerView {
  return {
    time: 60,
    lapsDone: 2,
    lapsToRun: 10,
    lapsLeft: 7.5,
    pos: 4,
    startPos: 4,
    cars: 10,
    ahead: { id: 3, name: 'Cleo', gap: 1.4, pitting: false, stops: 0 },
    behind: { id: 5, name: 'Esme', gap: 0.9, pitting: false, stops: 0 },
    pitting: false,
    stops: 0,
    tyres: { compound: 'medium', left: 0.7, lapsLeft: 3.5, mediumLife: 5, wetness: 0, ...tyres },
    damage: 0,
    forecast: null,
    safetyCar: 'none',
    safetyCarCount: 0,
    ...over,
  };
}

/** Everything the engineer says over `seconds` s (fed every 0.25 s) of the same race. */
function listen(eng: RaceEngineer, v: (t: number) => EngineerView, from: number, seconds: number): string[] {
  const out: string[] = [];
  for (let t = from; t < from + seconds; t += 0.25) {
    const c = eng.update({ ...v(t), time: t });
    if (c) out.push(c.text);
  }
  return out;
}

test('the box call: when the tyres would go off before the box comes round again, for the tyres that last the race, once a lap until you come in', () => {
  const eng = new RaceEngineer();
  const worn = (lap: number) => view({ lapsDone: lap, lapsLeft: 10 - lap - 0.5 }, { lapsLeft: 1, left: 0.2 });
  const want = pickCompound(7.5, 5, 0, 'medium');
  const said = listen(eng, () => worn(2), 60, 10);
  assert.deepEqual(said, [fmt(E.box.tyres, { tyres: E.tyres[want] })], 'once on this lap');
  assert.equal(eng.plan, want, 'the crew has them ready');
  // You stayed out: again on the next lap, and only once.
  assert.deepEqual(listen(eng, () => worn(3), 70, 10), [fmt(E.boxAgain, { tyres: E.tyres[pickCompound(6.5, 5, 0, 'medium')] })]);
  // In the pit lane: nothing.
  assert.deepEqual(listen(eng, () => view({ lapsDone: 4, pitting: true }, { lapsLeft: 0.5, left: 0.1 }), 80, 5), []);
});

test('no stop when the tyres (just about) last: look after them; and none at all in the last lap', () => {
  const eng = new RaceEngineer();
  assert.equal(RaceEngineer.stopCall(view({ lapsLeft: 1.2 }, { lapsLeft: 1.2 - CONDITIONS.pitEndSlack + 0.01, left: 0.2 })), null);
  assert.deepEqual(listen(eng, () => view({ lapsLeft: 1.2 }, { lapsLeft: 1, left: 0.2 }), 60, 5), [E.manage]);
  assert.equal(RaceEngineer.stopCall(view({ lapsLeft: 0.8 }, { lapsLeft: 0, left: 0 })), null);
});

test('the weather and damage: wets in the rain, slicks once it dries, repairs for damage', () => {
  assert.deepEqual(RaceEngineer.stopCall(view({}, { wetness: 0.5 })), { reason: 'rain', tyres: 'wet' });
  assert.deepEqual(RaceEngineer.stopCall(view({}, { compound: 'wet', wetness: 0.05 })), { reason: 'dry', tyres: pickCompound(7.5, 5, 0, 'medium') });
  assert.equal(RaceEngineer.stopCall(view({}, { compound: 'wet', wetness: 0.3 })), null, 'still damp: stay on wets');
  assert.equal(RaceEngineer.stopCall(view({ damage: DAMAGE.aiPitAt }))?.reason, 'damage');
  assert.equal(RaceEngineer.stopCall(view({ damage: DAMAGE.aiPitAt - 0.01 })), null);
  // Without tyre wear: repairs only.
  assert.deepEqual(RaceEngineer.stopCall(view({ tyres: null, damage: 0.6 })), { reason: 'damage', tyres: null });
  const eng = new RaceEngineer();
  const said = listen(eng, () => view({}, { wetness: 0.5 }), 60, 3);
  assert.deepEqual(said, [E.box.rain]);
  assert.equal(eng.plan, 'wet');
});

test('the plan for the stop ahead, and a forecast', () => {
  const eng = new RaceEngineer();
  const said = listen(eng, () => view({ forecast: { to: 'rain', in: 43 } }, { lapsLeft: 3.5 }), 60, 10);
  assert.ok(said.includes(fmt(E.plan, { n: Math.round(3.5 - 1 - ENGINEER.boxEarly), tyres: E.tyres[pickCompound(7.5 - (3.5 - 1 - ENGINEER.boxEarly), 5, 0, 'medium')] })), said.join(' | '));
  assert.ok(said.includes(fmt(E.rainComing, { s: 45 })), said.join(' | '));
});

test('one at a time: ordinary messages wait their turn, urgent ones go first, stale ones are dropped', () => {
  const eng = new RaceEngineer();
  // Two things to say at once (the start, and the plan): a gap between them.
  const said: { t: number; text: string }[] = [];
  for (let t = 20; t < 40; t += 0.25) {
    const c = eng.update(view({ time: t, lapsDone: t < 30 ? 0 : 1, pos: 2, startPos: 5 }, { lapsLeft: 3.5 }));
    if (c) said.push({ t, text: c.text });
  }
  assert.equal(said[0].text, fmt(E.startGained, { n: 3, pos: 2 }));
  for (let i = 1; i < said.length; i++) assert.ok(said[i].t - said[i - 1].t >= ENGINEER.gap - 1e-9);
  // An urgent call jumps the queue, and needs only a short gap.
  const e2 = new RaceEngineer();
  e2.update(view({ time: 20, lapsDone: 0, pos: 3, startPos: 3 }));
  const c = e2.update(view({ time: 20 + ENGINEER.urgentGap, safetyCar: 'out', safetyCarCount: 1 }));
  assert.equal(c?.text, E.scOut);
  assert.equal(c?.urgent, true);
  // Gaps that waited too long aren't worth saying.
  const e3 = new RaceEngineer();
  e3.update(view({ time: 10, safetyCar: 'out', safetyCarCount: 1 }));
  e3.lap(view({ time: 10.5, lapsDone: 3 }));
  assert.equal(e3.update(view({ time: 10.5 + ENGINEER.stale + ENGINEER.gap + 1, safetyCar: 'out', safetyCarCount: 1 })), null);
});

test('the safety car: a cheap stop when one is due, else hold position; and in this lap', () => {
  const eng = new RaceEngineer();
  const c = eng.update(view({ safetyCar: 'out', safetyCarCount: 1 }, { left: 0.4, lapsLeft: 2.2 }));
  assert.equal(c?.text, fmt(E.scBox, { tyres: E.tyres[eng.plan!] }));
  const e2 = new RaceEngineer();
  assert.equal(e2.update(view({ safetyCar: 'out', safetyCarCount: 1 }, { left: 0.9 }))?.text, E.scOut);
  assert.equal(e2.update(view({ time: 70, safetyCar: 'in', safetyCarCount: 1 }, { left: 0.9 }))?.text, E.scIn);
});

test('the undercut: a car close behind pitting (cover it if your stop is near), a car ahead pitting (push)', () => {
  const near = new RaceEngineer();
  near.update(view({ time: 0 }, { lapsLeft: 2.5 }));
  const behind = { id: 5, name: 'Esme', gap: 1.1, pitting: true, stops: 0 };
  const c = near.update(view({ time: 10, behind }, { lapsLeft: 2.5 }));
  assert.equal(c?.text, fmt(E.undercutCover, { name: 'Esme', tyres: E.tyres[near.plan!] }));
  assert.equal(c?.urgent, true);
  const far = new RaceEngineer();
  far.update(view({ time: 0 }, { lapsLeft: 5 }));
  assert.equal(far.update(view({ time: 10, behind }, { lapsLeft: 5 }))?.text, fmt(E.undercutStay, { name: 'Esme' }));
  // Too far back to matter, or already in the pits when first seen: nothing.
  const e3 = new RaceEngineer();
  e3.update(view({ time: 0 }));
  assert.equal(e3.update(view({ time: 10, behind: { ...behind, gap: ENGINEER.undercutGap + 1 } })), null);
  const ahead = new RaceEngineer();
  ahead.update(view({ time: 0 }, { lapsLeft: 5 }));
  assert.equal(ahead.update(view({ time: 10, ahead: { id: 3, name: 'Cleo', gap: 2, pitting: true, stops: 0 } }, { lapsLeft: 5 }))?.text, fmt(E.overcut, { name: 'Cleo' }));
});

test('each lap: the gaps either side and whether they are closing; the last lap; out of the pits; the flag', () => {
  const eng2 = new RaceEngineer();
  eng2.lap(view({ time: 50, lapsDone: 2 }));
  assert.equal(eng2.update(view({ time: 50 }))?.text, fmt(E.gaps, { pos: 4, gaps: `${fmt(E.gapAhead, { name: 'Cleo', gap: '1.4' })} ${fmt(E.gapBehind, { name: 'Esme', gap: '0.9' })}` }));
  eng2.lap(view({ time: 110, lapsDone: 3, ahead: { id: 3, name: 'Cleo', gap: 0.9, pitting: false, stops: 0 }, behind: { id: 5, name: 'Esme', gap: 1.5, pitting: false, stops: 0 } }));
  const text = eng2.update(view({ time: 110 }))?.text ?? '';
  assert.ok(text.includes(fmt(E.catching, { d: '0.5' })) && text.includes(fmt(E.pullingAway, { d: '0.6' })), text);
  // Leading.
  const e3 = new RaceEngineer();
  e3.lap(view({ pos: 1, ahead: null }));
  assert.match(e3.update(view({ time: 60 }))?.text ?? '', new RegExp(E.leading));
  // The last lap.
  const e4 = new RaceEngineer();
  e4.lap(view({ lapsDone: 9, lapsLeft: 1 }));
  assert.equal(e4.update(view({ lapsDone: 9, lapsLeft: 1 }))?.text, E.lastLap);
  // Out of the pits.
  const e5 = new RaceEngineer();
  e5.plan = 'hard';
  e5.pitDone(view({ stops: 1, pos: 7 }));
  assert.equal(e5.plan, null);
  assert.equal(e5.update(view({ stops: 1, pos: 7 }))?.text, fmt(E.pitDoneBehind, { pos: 7, name: 'Cleo' }));
  // The flag.
  const e6 = new RaceEngineer();
  assert.equal(e6.finish(1, 10).text, E.won);
  assert.equal(e6.finish(3, 10).text, fmt(E.podium, { pos: 3 }));
  assert.equal(e6.finish(8, 10).text, fmt(E.points, { pos: 8 }));
  assert.equal(e6.finish(14, 20).text, fmt(E.finished, { pos: 14 }));
  assert.equal(e6.finish(null, 10).text, E.retired);
  assert.equal(e6.finish(1, 1).text, E.finishedAlone);
});

test('the two-compound rule: a reminder at the start, a stop for it about half-way onto another kind, a warning once it is too late', () => {
  const rule = (used: ('soft' | 'medium' | 'hard' | 'wet')[]) => ({ used });
  // Tyres that last the race: no stop needed, but one is owed.
  const owed = (over: Partial<EngineerView>) => view({ rule: rule(['medium']), ...over }, { lapsLeft: 12, left: 0.9 });
  const eng = new RaceEngineer();
  assert.equal(eng.update(owed({ time: ENGINEER.ruleAfter, lapsDone: 0, lapsLeft: 9.8 }))?.text, E.ruleReminder);
  assert.equal(RaceEngineer.stopCall(owed({ lapsLeft: 7.5 })), null, 'not yet');
  const call = RaceEngineer.stopCall(owed({ lapsLeft: 5 }));
  assert.equal(call?.reason, 'rule');
  assert.notEqual(call?.tyres, 'medium', 'another kind');
  assert.equal(call?.tyres, RaceEngineer.tyresFor(owed({ lapsLeft: 5 }), 5, 0));
  // The plan says so before the stop, not "stay out to the end".
  const e2 = new RaceEngineer();
  const said = listen(e2, () => owed({ lapsLeft: 7 }), 60, 20);
  assert.ok(said.some((s) => s.startsWith(E.plan.split('{')[0])), said.join(' | '));
  assert.ok(!said.includes(E.manage));
  // Met (two kinds, or wets): nothing.
  assert.equal(RaceEngineer.stopCall(view({ rule: rule(['medium', 'hard']), lapsLeft: 5 }, { lapsLeft: 12 })), null);
  assert.equal(RaceEngineer.stopCall(view({ rule: rule(['wet']), lapsLeft: 5 }, { compound: 'wet', lapsLeft: 12, wetness: 0.6 })), null);
  // Too late.
  const e3 = new RaceEngineer();
  assert.equal(e3.update(owed({ lapsDone: 9, lapsLeft: 0.9 }))?.text, E.ruleMissed);
});

test('DRS enabled: said once', () => {
  const eng = new RaceEngineer();
  eng.update(view({ time: 50, drs: false }));
  assert.equal(eng.update(view({ time: 60, drs: true }))?.text, E.drsOn);
  assert.equal(eng.update(view({ time: 70, drs: true })), null);
});

test('the boost: how to use it, once, at the start of a race with other cars', () => {
  const eng = new RaceEngineer();
  assert.equal(eng.update(view({ time: ENGINEER.boostAfter - 0.5, lapsDone: 0, boostKey: 'Space' })), null);
  assert.equal(eng.update(view({ time: ENGINEER.boostAfter, lapsDone: 0, boostKey: 'Space' }))?.text, fmt(E.boostTip, { key: 'Space' }));
  assert.equal(new RaceEngineer().update(view({ time: 5, lapsDone: 0, cars: 1, ahead: null, behind: null, boostKey: 'Space' })), null, 'alone: no boost');
});

test('rivals: a word on the character of a car close ahead or behind, once each; rain traits only in the wet; and their mistakes', () => {
  const eng = new RaceEngineer();
  const behind = { id: 5, name: 'Esme', gap: 0.6, pitting: false, stops: 0, traits: ['aggressive' as const] };
  assert.equal(eng.update(view({ time: 100, behind, tyres: null }))?.text, fmt(STR.traits.aggressive.behind, { name: 'Esme' }));
  assert.equal(eng.update(view({ time: 120, behind, tyres: null })), null, 'once');
  const e2 = new RaceEngineer();
  const rainy = { id: 3, name: 'Cleo', gap: 0.8, pitting: false, stops: 0, traits: ['rainMaster' as const, 'defensive' as const] };
  assert.equal(e2.update(view({ time: 100, ahead: rainy, tyres: null }))?.text, fmt(STR.traits.defensive.ahead, { name: 'Cleo' }), 'dry: not the rain trait');
  const e3 = new RaceEngineer();
  assert.equal(e3.update(view({ time: 100, ahead: rainy }, { wetness: 0.6, compound: 'wet', lapsLeft: 12 }))?.text, fmt(STR.traits.rainMaster.ahead, { name: 'Cleo' }));
  assert.equal(new RaceEngineer().update(view({ time: 100, behind: { ...behind, gap: ENGINEER.rivalGap + 0.5 }, tyres: null })), null, 'too far back');
  const e4 = new RaceEngineer();
  e4.note('mistake:1', fmt(STR.mistakes.spin, { name: 'Ada' }), 100);
  assert.equal(e4.update(view({ time: 100, tyres: null }))?.text, fmt(STR.mistakes.spin, { name: 'Ada' }));
});
