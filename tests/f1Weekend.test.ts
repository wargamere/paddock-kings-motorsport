import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CarPhysics } from '../src/car/physics.ts';
import { cleanCareer, driverStandings, lineup, newCareer, nextRound, recordRound, recordSprint, roundPoints, setGrid, sprintLaps, sprintRound, teamStandings, type CareerSave } from '../src/career/career.ts';
import { CAREER } from '../src/config/career.ts';
import { HANDLING } from '../src/config/handling.ts';
import { KNOCKOUT } from '../src/config/race.ts';
import { getSampleTrack } from '../src/editor/pipeline.ts';
import { AiDriver, YOU } from '../src/race/ai.ts';
import { knockoutGrid, knockoutOut, knockoutSession, trackEvolution } from '../src/race/knockout.ts';
import { compoundsMet, ruleCompound, ruleStopDue } from '../src/race/strategy.ts';
import type { Track } from '../src/track/track.ts';

const career = (rounds: 'short' | 'standard' | 'full' = 'standard'): CareerSave => newCareer({ name: 'Oskar', team: 'kestrel', difficulty: 60, length: 'medium', rounds }, 4242);
const ids = (save: CareerSave) => lineup(save).map((e) => e.id);

test('sprint weekends: about one round in four, spread through the season, never the first or the last', () => {
  for (const [rounds, n] of [['short', 8], ['standard', 16], ['full', 24]] as const) {
    const save = career(rounds);
    assert.equal(save.calendar.length, n);
    const sprints = save.calendar.map((_, i) => i).filter((i) => sprintRound(save, i));
    assert.equal(sprints.length, Math.floor(n / CAREER.sprintEvery), `${rounds}: ${sprints.join(',')}`);
    assert.ok(!sprints.includes(0) && !sprints.includes(n - 1));
    for (let i = 1; i < sprints.length; i++) assert.ok(sprints[i] - sprints[i - 1] >= 2, 'spread out');
  }
  assert.equal(sprintRound({ calendar: ['a', 'b', 'c'] }, 1), false, 'none in a season of three');
  assert.equal(sprintLaps(10), 3);
  assert.equal(sprintLaps(4), CAREER.sprintMinLaps);
});

test('a sprint weekend: qualifying sets the sprint grid, the sprint the Grand Prix grid; sprint points for the top eight; pole stays qualifying’s', () => {
  const save = career();
  const sprintAt = save.calendar.findIndex((_, i) => sprintRound(save, i));
  // Run the rounds before it.
  while (nextRound(save)! < sprintAt) {
    setGrid(save, ids(save));
    recordRound(save, { order: ids(save), dnf: [], fastest: null });
  }
  assert.equal(recordSprint(save, { order: ids(save), dnf: [] }), null, 'not before qualifying');
  const quali = ids(save);
  setGrid(save, quali);
  // The sprint: reversed order, the last two retired.
  const order = [...quali].reverse();
  const dnf = order.slice(-2);
  const sprint = recordSprint(save, { order, dnf })!;
  assert.deepEqual(sprint.order, order);
  assert.deepEqual(save.grid, order, 'the sprint sets the Grand Prix grid');
  assert.equal(save.sprint?.pole, quali[0]);
  assert.equal(recordSprint(save, { order, dnf }), null, 'once');
  // The Grand Prix: the qualifying order.
  const round = recordRound(save, { order: quali, dnf: [], fastest: quali[3] })!;
  assert.deepEqual(round.sprint, { order, dnf });
  assert.equal(round.pole, quali[0], 'pole from qualifying, not the sprint');
  assert.equal(save.sprint, undefined);
  // Points: 25 for the Grand Prix winner, plus the sprint's 8 for its winner.
  assert.equal(roundPoints(round, quali[0]), 25);
  assert.equal(roundPoints(round, order[0]), CAREER.sprintPoints[0]);
  assert.equal(roundPoints(round, order[7]), CAREER.sprintPoints[7]);
  assert.equal(roundPoints(round, order[8]), 0, 'no sprint points below eighth');
  assert.equal(roundPoints(round, dnf[0]), CAREER.points[quali.indexOf(dnf[0])] ?? 0, 'nothing for the sprint they retired from');
  // The standings count both.
  const rows = driverStandings(save);
  const total = (id: string) => save.done.reduce((n, r) => n + roundPoints(r, id), 0);
  for (const r of rows) assert.equal(r.points, total(r.id), r.name);
  assert.equal(teamStandings(save).reduce((n, t) => n + t.points, 0), rows.reduce((n, r) => n + r.points, 0));
});

test('sprint weekends and disqualifications are saved and come back the same, and bad data is dropped', () => {
  const save = career();
  const sprintAt = save.calendar.findIndex((_, i) => sprintRound(save, i));
  while (nextRound(save)! < sprintAt) {
    setGrid(save, ids(save));
    recordRound(save, { order: ids(save), dnf: [], fastest: null, dsq: nextRound(save) === 0 ? [ids(save)[2]] : [] });
  }
  setGrid(save, ids(save));
  recordSprint(save, { order: [...ids(save)].reverse(), dnf: [] });
  const back = cleanCareer(JSON.parse(JSON.stringify(save)))!;
  assert.deepEqual(back.done, save.done);
  assert.deepEqual(back.sprint, save.sprint);
  assert.deepEqual(back.grid, save.grid);
  const first = back.done[0];
  assert.deepEqual(first.dsq, [ids(save)[2]]);
  assert.equal(first.order[first.order.length - 1], ids(save)[2], 'disqualified last');
  assert.equal(roundPoints(first, ids(save)[2]), 0);
  // A sprint saved on a weekend that isn't one, or without a grid, is dropped.
  const raw = JSON.parse(JSON.stringify(save));
  raw.grid = null;
  assert.equal(cleanCareer(raw)!.sprint, undefined);
});

test('knockout qualifying: five of twenty out after Q1 and Q2, the grid Q3 first, then the Q2 and Q1 fallers in their order', () => {
  assert.equal(knockoutOut(20), 5);
  assert.equal(knockoutOut(24), 6);
  assert.equal(knockoutOut(KNOCKOUT.minCars - 1), 0, 'too few cars: one session');
  const cars = Array.from({ length: 19 }, (_, k) => k);
  // Q1: you (YOU) 12th; times by car number, car 18 with no time.
  const q1 = new Map<number, number | null>([[YOU, 70.5], ...cars.map((k): [number, number | null] => [k, k === 18 ? null : 60 + k])]);
  const s1 = knockoutSession(q1, 1, 20);
  assert.equal(s1.out.length, 5);
  assert.deepEqual(s1.out, [14, 15, 16, 17, 18], 'the slowest five, no time last');
  assert.ok(s1.through.includes(YOU));
  const q2 = new Map<number, number | null>(s1.through.map((k) => [k, k === YOU ? 59 : 60 + k]));
  const s2 = knockoutSession(q2, 2, 20);
  assert.deepEqual(s2.order[0], YOU, 'quickest in Q2');
  assert.deepEqual(s2.out, [9, 10, 11, 12, 13]);
  const q3 = new Map<number, number | null>(s2.through.map((k) => [k, k === YOU ? 61 : 60 + k]));
  const s3 = knockoutSession(q3, 3, 20);
  assert.deepEqual(s3.out, [], 'nobody out of Q3');
  const grid = knockoutGrid([s1, s2, s3]);
  assert.equal(grid.length, 20);
  assert.deepEqual(grid.slice(0, 10), s3.order);
  assert.deepEqual(grid.slice(10, 15), s2.out);
  assert.deepEqual(grid.slice(15), s1.out);
  assert.equal(new Set(grid).size, 20);
  assert.ok(trackEvolution(3) < trackEvolution(2) && trackEvolution(2) < trackEvolution(1) && trackEvolution(1) === 1, 'the track quicker each session');
});

test('the two-compound rule: two dry kinds or any wets meet it; a stop for it about half-way, on another kind that lasts', () => {
  assert.equal(compoundsMet(['medium']), false);
  assert.equal(compoundsMet(['medium', 'medium']), false);
  assert.equal(compoundsMet(['medium', 'hard']), true);
  assert.equal(compoundsMet(['soft', 'wet']), true);
  // Already met, or a different kind anyway: as wanted.
  assert.equal(ruleCompound('soft', ['medium', 'hard'], 5, 5), 'soft');
  assert.equal(ruleCompound('hard', ['medium'], 5, 5), 'hard');
  assert.equal(ruleCompound('wet', ['medium'], 5, 5), 'wet');
  // The same kind again: another, the quickest that lasts (mediums last 5 laps here, softs 3.25, hards 8).
  assert.equal(ruleCompound('medium', ['medium'], 3, 5), 'soft');
  assert.equal(ruleCompound('medium', ['medium'], 6, 5), 'hard');
  assert.equal(ruleCompound('hard', ['hard'], 3.4, 5), 'soft', 'softs last 3.25 + slack');
  assert.equal(ruleCompound('hard', ['hard'], 4, 5), 'medium', 'softs would not last');
  assert.equal(ruleCompound('hard', ['hard'], 20, 5), 'medium', 'none lasts: the longest-lasting other kind');
  assert.equal(ruleStopDue(5, 10), true);
  assert.equal(ruleStopDue(6, 10), false, 'not before half-way');
  assert.equal(ruleStopDue(1.2, 10), false, 'too late');
});

const progressOf = (car: CarPhysics, track: Track) => {
  const st = car.state;
  const tg = track.center.tangents[Math.max(0, st.trackIndex)];
  return { s: st.s, lateral: st.lateral, along: st.vx * tg.x + st.vz * tg.y, offTrack: st.offTrack };
};

/** An AI alone in a race of `laps` laps with tyres that last it: the kinds of tyre it ran. */
function race(track: Track, laps: number, twoCompounds: boolean) {
  const ai = new AiDriver(track, { name: 'a', paint: 0, difficulty: 0.75, laps, slot: 0, tyreWear: true, mediumLife: laps * 2, twoCompounds });
  for (let tick = 0; tick < (laps * 90 + 60) * HANDLING.tickRate && ai.session.phase !== 'finished'; tick++) {
    const prev = progressOf(ai.car, track);
    ai.car.step(ai.drive([ai.car.state], 1 / HANDLING.tickRate));
    ai.session.step(prev, progressOf(ai.car, track), []);
  }
  return ai;
}

test('the AI keeps the two-compound rule: one stop, about half-way, onto another dry kind (and none without the rule)', () => {
  const t = getSampleTrack(0);
  const free = race(t, 4, false);
  assert.equal(free.session.phase, 'finished');
  assert.equal(free.crew?.stops, 0, 'tyres that last: no stop');
  assert.equal(compoundsMet(free.car.tyresUsed), false);
  const ruled = race(t, 4, true);
  assert.equal(ruled.session.phase, 'finished');
  assert.equal(ruled.crew?.stops, 1, 'one stop for the rule');
  assert.equal(compoundsMet(ruled.car.tyresUsed), true, ruled.car.tyresUsed.join(', '));
  assert.equal(ruled.boxCall, null);
});
