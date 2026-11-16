import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cleanCareer, lineup, newCareer, recordRound } from '../src/career/career.ts';
import { takeOwnership } from '../src/career/owner.ts';
import { answerPress, cleanDynasty, currentDecision, currentPress, DECISIONS, driverProgress, dynasty, resolveDecision } from '../src/career/dynasty.ts';
import { effectChips, MEDIA, principalOf } from '../src/career/media.ts';
import { teamsFor } from '../src/career/roster.ts';

const start = () => {
  const save = newCareer({ name: 'Principal', team: 'kestrel', difficulty: 60, length: 'short', rounds: 'standard' }, 1234);
  takeOwnership(save);
  return save;
};
type Save = ReturnType<typeof start>;
/** A result with `first` at the front (in that order) and everyone else behind. */
const result = (save: Save, first: string[], dnf: string[] = []) => ({ order: [...first, ...lineup(save).map((d) => d.id).filter((id) => !first.includes(id))], dnf, fastest: first[0] });
const rivalDrivers = (save: Save) => teamsFor(save).find((t) => t.id === dynasty(save).rival.id)!.drivers;
/** Answers whatever decision is waiting with its default (free, no follow-ups). */
const decide = (save: Save) => { const d = currentDecision(save); if (d) assert.ok(resolveDecision(save, d.key, DECISIONS[d.id].fallback)); };

test('a win brings the press: each answer moves the team once, and the conference is logged and saved', () => {
  const save = start(), w = dynasty(save);
  decide(save);
  recordRound(save, result(save, ['alm', 'whi']));
  const press = currentPress(save)!;
  assert.ok(press, 'the press want a word');
  assert.equal(press.questions[0].topic, 'win');
  assert.equal(press.questions[0].driver, 'alm');
  assert.ok(press.asked[0].text.includes('wins'));
  assert.ok(press.questions.length <= MEDIA.questions);
  assert.deepEqual(cleanCareer(JSON.parse(JSON.stringify(save))), save, 'a waiting press conference survives a save');
  const morale = w.morale, alm = driverProgress(save, 'alm').morale;
  // "This one belongs to the factory": +6 team morale, +2 for the winner.
  assert.ok(answerPress(save, 0, 2));
  assert.equal(w.morale, Math.min(100, morale + 6));
  assert.equal(driverProgress(save, 'alm').morale, Math.min(100, alm + 6 + 2));
  assert.equal(answerPress(save, 0, 1), false, 'answered already');
  assert.equal(answerPress(save, 9, 0), false);
  for (let i = 1; i < press.questions.length; i++) assert.ok(answerPress(save, i, 1));
  assert.equal(currentPress(save), null);
  assert.equal(w.pressLog.length, 1);
  assert.equal(w.pressLog[0].lines.length, press.questions.length);
  assert.equal(w.news[0].kind, 'press');
  assert.ok(w.news[0].title.includes('This one belongs to the factory'));
});

test('a quiet weekend has no press; one left unanswered closes at the next race and costs reputation', () => {
  const save = start(), w = dynasty(save), field = lineup(save).map((d) => d.id);
  decide(save);
  // Both cars in the midfield, the rival nowhere near: nothing to ask about.
  const mid = field.filter((id) => id !== 'alm' && id !== 'whi');
  recordRound(save, { order: [...mid.slice(0, 6), 'alm', 'whi', ...mid.slice(6)], dnf: [], fastest: mid[0] });
  assert.equal(w.rival.streak === 0 || Math.abs(w.rival.streak) < MEDIA.streak, true);
  assert.equal(currentPress(save), null);
  decide(save);
  recordRound(save, result(save, ['whi']));
  const press = currentPress(save)!;
  assert.equal(press.questions[0].topic, 'win');
  const rep = w.reputation;
  decide(save);
  recordRound(save, { order: [...mid, 'alm', 'whi'], dnf: [], fastest: mid[0] });
  assert.ok(w.pressLog[0].lines.every((l) => l.endsWith('No comment.')));
  assert.ok(w.news.some((n) => n.title === 'Empty chair at the press conference'));
  assert.ok(w.reputation <= rep, 'skipping the press costs reputation');
});

test('rivalries build: a run of defeats makes the news, heats up, brings the press and hurts', () => {
  const save = start(), w = dynasty(save), theirs = rivalDrivers(save);
  assert.ok(Object.keys(w.duels).length === 2, 'each of your drivers has a duel');
  const tension = w.rival.tension;
  for (let i = 0; i < 3; i++) {
    decide(save);
    if (currentPress(save)) for (let q = 0; q < currentPress(save)!.questions.length; q++) answerPress(save, q, 2);
    recordRound(save, result(save, [...theirs]));
  }
  assert.equal(w.rival.lost, 3);
  assert.equal(w.rival.streak, -3);
  assert.ok(w.rival.tension > tension, `${tension} → ${w.rival.tension}`);
  const name = teamsFor(save).find((t) => t.id === w.rival.id)!.name;
  assert.ok(w.news.some((n) => n.title === `${name} have beaten you 3 races in a row` && n.body.includes(principalOf(w.rival.id))), 'the news reacts');
  assert.ok(w.news.some((n) => n.title.includes('races in a row') && n.title.includes('has beaten')), 'and to the drivers’ duels');
  for (const d of Object.values(w.duels)) assert.equal(d.streak, -3);
  const press = currentPress(save)!;
  assert.ok(press.questions.some((q) => q.topic === 'rivalStreak' && q.n === -3));
  assert.ok(press.questions.some((q) => q.topic === 'duelStreak'));
  // Firing back heats it up.
  const before = w.rival.tension;
  const i = press.questions.findIndex((q) => q.topic === 'rivalStreak');
  assert.ok(answerPress(save, i, 0));
  assert.equal(w.rival.tension, Math.min(100, before + 15));
  // Then a win ends the run.
  decide(save);
  recordRound(save, result(save, ['alm', 'whi']));
  assert.equal(w.rival.streak, 1);
});

test('decisions: a default goes through when nobody answers; follow-ups come back with the same driver', () => {
  const save = start(), w = dynasty(save);
  assert.equal(currentDecision(save)!.id, 'vision');
  const cash = save.owner!.cash;
  recordRound(save, result(save, ['alm', 'whi']));
  assert.equal(w.decisions[0].template, 'vision');
  assert.equal(w.decisions[0].choice, DECISIONS.vision.fallback);
  assert.equal(w.decisions[0].auto, true);
  assert.ok(save.owner!.cash >= cash, 'the default costs nothing');
  assert.ok(w.news.some((n) => n.title.startsWith('No reply')));
  // An unhappy driver, promised a better car: they ask again three rounds later.
  w.next = { key: `${save.season}:${save.done.length}`, id: 'unhappy', driver: 'whi' };
  const d = currentDecision(save)!;
  assert.ok(d.title.includes('is unhappy') && !d.title.includes('{driver}'));
  assert.ok(d.options[1].chips.some((c) => c.includes('mood')));
  const mood = driverProgress(save, 'whi').morale;
  assert.ok(resolveDecision(save, d.key, 1));
  assert.ok(driverProgress(save, 'whi').morale > mood);
  const due = save.done.length + 3;
  assert.deepEqual(w.followUps, [{ id: 'promise', season: save.season, round: due, driver: 'whi' }]);
  while (save.done.length < due) {
    decide(save);
    recordRound(save, result(save, ['alm', 'whi']));
  }
  const promise = currentDecision(save)!;
  assert.equal(promise.id, 'promise');
  assert.equal(promise.driver, 'whi');
  assert.equal(w.followUps.length, 0);
  assert.deepEqual(cleanCareer(JSON.parse(JSON.stringify(save))), save);
});

test('every decision has a free default; effect chips read clearly', () => {
  for (const [id, t] of Object.entries(DECISIONS)) {
    assert.equal(t.options.length, 3, id);
    assert.equal(t.options[t.fallback].cost, 0, `${id}: the default is free`);
    assert.equal(t.options[t.fallback].followUp, undefined, `${id}: and leads nowhere`);
  }
  assert.deepEqual(effectChips({ cost: 450_000, confidence: 6, morale: -3 }), ['−$450k', '+6 board', '−3 team morale']);
  assert.deepEqual(effectChips({}), ['No immediate change']);
});

test('saved press, rivalry and decisions are cleaned', () => {
  const save = start(), w = dynasty(save);
  const raw = JSON.parse(JSON.stringify(w));
  raw.press = { key: '1:1', season: 1, round: 1, questions: [{ topic: 'nonsense' }], answers: [-1] };
  raw.next = { key: '1:0', id: 'hack' };
  raw.followUps = [{ id: 'promise', season: 1, round: 3, driver: 'nobody' }, { id: 'nope', season: 1, round: 2 }];
  raw.rival.tension = 900;
  raw.news.push({ id: 'x', title: 'Press', body: '', kind: 'press', season: 1, round: 0 }, { id: 'y', title: 'Bad', body: '', kind: 'gossip', season: 1, round: 0 });
  const clean = cleanDynasty(raw)!;
  assert.equal(clean.press, null);
  assert.equal(clean.next, null);
  assert.deepEqual(clean.followUps, [{ id: 'promise', season: 1, round: 3 }]);
  assert.equal(clean.rival.tension, 100);
  assert.ok(clean.news.some((n) => n.kind === 'press') && !clean.news.some((n) => n.title === 'Bad'));
  // An old save without any of it gets a calm, empty start.
  const old = cleanDynasty({ v: 1, rival: { id: 'x', won: 1, lost: 0, tied: 0 } })!;
  assert.equal(old.rival.streak, 0);
  assert.equal(old.rival.tension, MEDIA.tension);
  assert.deepEqual(old.duels, {});
  assert.equal(old.press, null);
});
