import { clamp } from '../core/math.ts';
import { hashString } from '../core/random.ts';
import type { CareerSave, RoundResult } from './career.ts';
import { driverDef, teamsFor } from './roster.ts';

/**
 * The paddock around an owner's team: press conferences after big results
 * (each answer moves team morale, a driver's mood, reputation, fans, the
 * board and the rivalry), and rivalries that build over a season — with the
 * rival team (its principal, how heated it is, who's on a run) and between
 * each of your drivers and the rival driver in the same seat. Kept in the
 * team's DynastyState (career/dynasty.ts), which calls these after each race.
 */

/** What an answer (or a decision) does. `driver` is the mood of the driver it's about, `other` their teammate's. */
export interface Effects { morale?: number; confidence?: number; reputation?: number; fans?: number; tension?: number; driver?: number; other?: number }

export type PressTopic = 'win' | 'podium' | 'retire' | 'rivalStreak' | 'duelStreak' | 'beatRival' | 'lostRival' | 'teammates' | 'finale' | 'drought';
/** One question: its topic, who it's about (a driver of yours, the other one), a count (a run of races). */
export interface PressQuestion { topic: PressTopic; driver?: string; other?: string; n?: number }
/** A press conference waiting for answers (-1: not answered yet). */
export interface PressState { key: string; season: number; round: number; questions: PressQuestion[]; answers: number[] }
export interface Duel { rival: string; won: number; lost: number; streak: number }
export interface RivalState { id: string; won: number; lost: number; tied: number; streak: number; tension: number }

export const TOPICS: readonly PressTopic[] = ['win', 'podium', 'retire', 'rivalStreak', 'duelStreak', 'beatRival', 'lostRival', 'teammates', 'finale', 'drought'];
export const MEDIA = {
  /** Rivalry tension (0..100): where it starts, and from where it's "heated" (wins and losses then hit morale harder). */
  tension: 20,
  heated: 60,
  /** A run of this many races (team or driver) makes the news and the press. */
  streak: 3,
  /** Races without points before the press asks about it. */
  drought: 3,
  /** At most this many questions. */
  questions: 3,
  /** What skipping a question costs. */
  noComment: { reputation: -1 } as Effects,
  /** Press conferences kept in the log. */
  log: 20,
} as const;

const FIRST = ['Marco', 'Helena', 'Viktor', 'Sofia', 'Rafael', 'Ingrid', 'Tomas', 'Celine', 'Henrik', 'Aiko', 'Dario', 'Lena'];
const LAST = ['Brandt', 'Okafor', 'Lindqvist', 'Moreau', 'Castell', 'Novak', 'Hayes', 'Rossi', 'Varga', 'Sato', 'Keller', 'Duarte'];
const OUTLETS = ['Grid Weekly', 'Paddock Pass', 'Apex Radio', 'The Pit Lane Post', 'Velocity TV', 'Slipstream Magazine'];

/** The principal of another team (a made-up name, the same every time). */
export function principalOf(teamId: string): string {
  const k = hashString(`principal:${teamId}`);
  return `${FIRST[k % FIRST.length]} ${LAST[Math.floor(k / FIRST.length) % LAST.length]}`;
}

const teamName = (save: CareerSave, id: string) => teamsFor(save).find((t) => t.id === id)?.name ?? 'your rival';
const surname = (id: string | undefined) => (id ? driverDef(id)?.name ?? id : 'your driver');

/** Where a driver finished (99: retired or not classified). */
function placeOf(result: RoundResult, id: string): number {
  const i = result.order.indexOf(id);
  return i < 0 || result.dnf.includes(id) ? 99 : i + 1;
}

/** A fresh rivalry against team `id`. */
export const freshRival = (id: string, tension: number = MEDIA.tension): RivalState => ({ id, won: 0, lost: 0, tied: 0, streak: 0, tension });

/** Each of your drivers against the rival team's driver in the same seat. */
export function freshDuels(mine: readonly string[], theirs: readonly string[]): Record<string, Duel> {
  const out: Record<string, Duel> = {};
  mine.forEach((id, i) => {
    const rival = theirs[i] ?? theirs[0];
    if (rival) out[id] = { rival, won: 0, lost: 0, streak: 0 };
  });
  return out;
}

/** A run: +1 more for a win, -1 more for a loss, 0 for neither. */
const run = (streak: number, outcome: number) => (outcome > 0 ? Math.max(0, streak) + 1 : outcome < 0 ? Math.min(0, streak) - 1 : 0);

/** A rival principal's line for the news, by how heated it is and who's on top. */
function quote(save: CareerSave, ahead: boolean, tension: number): string {
  const k = hashString(`${save.seed}:${save.season}:${save.done.length}:quote`);
  const lines = ahead
    ? tension >= MEDIA.heated
      ? ['They talk a lot for a team that keeps finishing behind us.', 'I don’t lose sleep over them.', 'Maybe they should spend less time in front of the cameras.']
      : ['We respect them, but we are focused on our own job.', 'A good weekend for us. They will push back.', 'It’s close, and we like it that way.']
    : tension >= MEDIA.heated
      ? ['One bad weekend doesn’t make them champions.', 'Enjoy it. It won’t last.', 'We know exactly where we lost it — it won’t happen again.']
      : ['Credit to them, they did a better job today.', 'We have work to do.', 'They were quicker this weekend. We will respond.'];
  return lines[k % lines.length];
}

/** What a round did to the rivalries, with what the news says about it. */
export interface RivalryReport { pts: number; theirs: number; news: { title: string; body: string }[]; morale: number; drivers: Record<string, number> }

/**
 * After a race: the head-to-head with the rival team (combined points), its
 * run and how heated it is, and each driver's duel (who finished ahead).
 */
export function settleRivalry(save: CareerSave, rival: RivalState, duels: Record<string, Duel>, result: RoundResult, mine: readonly string[], points: (ids: readonly string[]) => number): RivalryReport {
  const team = teamsFor(save).find((t) => t.id === rival.id);
  const pts = points(mine);
  const theirs = team ? points(team.drivers) : 0;
  const outcome = Math.sign(pts - theirs);
  if (outcome > 0) rival.won++;
  else if (outcome < 0) rival.lost++;
  else rival.tied++;
  const before = rival.streak;
  rival.streak = run(rival.streak, outcome);
  // Close fights, runs and a run ending heat it up; one-sided weekends cool it a little.
  const myBest = Math.min(...mine.map((id) => placeOf(result, id)));
  const theirBest = team ? Math.min(...team.drivers.map((id) => placeOf(result, id))) : 99;
  const close = Math.abs(pts - theirs) <= 6 || Math.abs(myBest - theirBest) <= 2;
  rival.tension = clamp(rival.tension + (close ? 5 : -1) + (Math.abs(rival.streak) >= 2 ? 3 : 0) + (before * rival.streak < 0 ? 3 : 0), 0, 100);
  const heated = rival.tension >= MEDIA.heated;
  const name = team?.name ?? 'your rival';
  const boss = principalOf(rival.id);
  const report: RivalryReport = { pts, theirs, news: [], morale: heated ? outcome * 2 : 0, drivers: {} };
  const tally = `${pts}–${theirs} on points this weekend. Head-to-head: ${rival.won} wins, ${rival.lost} losses.`;
  const n = Math.abs(rival.streak);
  if (n >= MEDIA.streak) {
    report.news.push(rival.streak > 0
      ? { title: `${n} in a row over ${name}`, body: `${boss}: “${quote(save, false, rival.tension)}” ${tally}` }
      : { title: `${name} have beaten you ${n} races in a row`, body: `${boss}: “${quote(save, true, rival.tension)}” ${tally}` });
  } else {
    const title = outcome > 0 ? 'Advantage, your team.' : outcome < 0 ? 'Your rival strikes back.' : 'Nothing between the teams.';
    report.news.push({ title, body: `${tally}${heated && outcome ? ` ${boss}: “${quote(save, outcome < 0, rival.tension)}”` : ''}` });
  }
  // The drivers' duels.
  for (const id of mine) {
    const d = duels[id];
    if (!d) continue;
    const a = placeOf(result, id);
    const b = placeOf(result, d.rival);
    if (a === 99 && b === 99) continue;
    const o = Math.sign(b - a);
    if (o > 0) d.won++;
    else if (o < 0) d.lost++;
    d.streak = run(d.streak, o);
    const k = Math.abs(d.streak);
    if (k >= MEDIA.streak && o !== 0) {
      report.drivers[id] = (report.drivers[id] ?? 0) + (d.streak > 0 ? 2 : -3);
      report.news.push(d.streak > 0
        ? { title: `${surname(id)} has the upper hand`, body: `${surname(id)} has finished ahead of ${surname(d.rival)} ${k} races running. ${d.won}–${d.lost} in their duel this season.` }
        : { title: `${surname(d.rival)} has beaten ${surname(id)} ${k} races in a row`, body: `${surname(d.rival)} of ${name} keeps finishing ahead. ${d.won}–${d.lost} in their duel this season. ${surname(id)}’s mood is suffering.` });
    }
  }
  return report;
}

/**
 * The press conference after a race, or null if nothing big happened: a win
 * or podium, a retirement, a long run against the rival team or in a
 * driver's duel, a points drought or the end of the season; then, if there's
 * room, the rival and the teammates.
 */
export function pressAfter(save: CareerSave, result: RoundResult, mine: readonly string[], rival: RivalState, duels: Record<string, Duel>, pointsIn: (r: RoundResult) => number, finale: boolean): PressState | null {
  const q: PressQuestion[] = [];
  const places = mine.map((id) => ({ id, at: placeOf(result, id) })).sort((a, b) => a.at - b.at);
  const [best, other] = places;
  if (best.at === 1) q.push({ topic: 'win', driver: best.id, other: other?.id });
  else if (best.at <= 3) q.push({ topic: 'podium', driver: best.id, other: other?.id });
  const out = places.find((p) => result.dnf.includes(p.id));
  if (out) q.push({ topic: 'retire', driver: out.id, other: mine.find((id) => id !== out.id) });
  if (Math.abs(rival.streak) >= MEDIA.streak) q.push({ topic: 'rivalStreak', n: rival.streak });
  const slump = mine.map((id) => ({ id, d: duels[id] })).find((x) => x.d && x.d.streak <= -MEDIA.streak);
  if (slump) q.push({ topic: 'duelStreak', driver: slump.id, other: slump.d.rival, n: -slump.d.streak });
  let dry = 0;
  for (let i = save.done.length - 1; i >= 0 && !pointsIn(save.done[i]); i--) dry++;
  if (dry >= MEDIA.drought && dry % MEDIA.drought === 0) q.push({ topic: 'drought', n: dry });
  if (finale) q.push({ topic: 'finale' });
  if (!q.length) return null;
  if (q.length < MEDIA.questions && !q.some((x) => x.topic === 'rivalStreak') && rival.streak) q.push({ topic: rival.streak > 0 ? 'beatRival' : 'lostRival' });
  if (q.length < MEDIA.questions && other && best.at < 99 && other.at < 99 && other.at - best.at >= 5) q.push({ topic: 'teammates', driver: best.id, other: other.id });
  const questions = q.slice(0, MEDIA.questions);
  return { key: `${save.season}:${save.done.length}`, season: save.season, round: save.done.length, questions, answers: questions.map(() => -1) };
}

export interface PressAnswer { tone: string; label: string; effects: Effects }
export interface PressText { outlet: string; text: string; answers: PressAnswer[] }

/** A question as asked (who asks, what) and the three ways to answer it. */
export function pressQuestion(save: CareerSave, rivalId: string, q: PressQuestion, index: number): PressText {
  const D = surname(q.driver);
  const O = surname(q.other);
  const R = teamName(save, rivalId);
  const P = principalOf(rivalId);
  const n = Math.abs(q.n ?? 0);
  const outlet = OUTLETS[hashString(`${save.seed}:${save.season}:${save.done.length}:${index}`) % OUTLETS.length];
  const a = (tone: string, label: string, effects: Effects): PressAnswer => ({ tone, label, effects });
  const ask = (text: string, ...answers: PressAnswer[]): PressText => ({ outlet, text, answers });
  switch (q.topic) {
    case 'win':
      return ask(`${D} wins! Is this team ready to fight for championships?`,
        a('Confident', 'We came here to win titles', { reputation: 4, fans: 600, confidence: 2, tension: 8 }),
        a('Humble', 'One weekend at a time', { morale: 3, confidence: 1 }),
        a('Team first', 'This one belongs to the factory', { morale: 6, driver: 2 }));
    case 'podium':
      return ask(`A podium for ${D}. Was that the maximum today?`,
        a('Hungry', 'There was more in it — we want the top step', { reputation: 2, confidence: 2, driver: -2 }),
        a('Praise', `A brilliant drive by ${D}`, { driver: 6, morale: 2 }),
        a('Team first', 'The whole team earned this', { morale: 4 }));
    case 'retire':
      return ask(`${D} retired. Is reliability holding this team back?`,
        a('Responsible', 'That’s on us, not the driver', { driver: 5, morale: 2, confidence: -2 }),
        a('Shrug', 'Racing can be cruel — we move on', { confidence: -1, morale: 1 }),
        a('Blunt', 'We need fewer mistakes from the cockpit', { driver: -8, confidence: 2, other: -2 }));
    case 'rivalStreak':
      return (q.n ?? 0) > 0
        ? ask(`${n} in a row over ${R}. Have you got into ${P}’s head?`,
          a('Provocative', `Ask ${P} — they seem rattled`, { tension: 15, fans: 700, reputation: 1 }),
          a('Gracious', 'They’ll be back. We stay humble', { tension: -6, reputation: 3, confidence: 1 }),
          a('Team first', 'The credit goes to our people', { morale: 4 }))
        : ask(`${R} have beaten you ${n} races in a row, and ${P} says you’re no threat. Your reply?`,
          a('Fire back', `Tell ${P} to enjoy it while it lasts`, { tension: 15, fans: 500, morale: 3, reputation: -1 }),
          a('Respect', 'They’re doing a good job. We’ll close the gap', { tension: -8, confidence: 2, reputation: 2 }),
          a('Focused', 'We only look at our own car', { morale: 1 }));
    case 'duelStreak':
      return ask(`${O} has beaten ${D} ${n} races in a row. Is ${D}’s seat safe?`,
        a('Supportive', `Full support — ${D} is our driver`, { driver: 8, confidence: -2 }),
        a('Demanding', `We expect more, and ${D} knows it`, { driver: -6, confidence: 3 }),
        a('Deflect', 'The car is the problem, not the driver', { driver: 4, morale: -2 }));
    case 'beatRival':
      return ask(`You finished ahead of ${R} today. Are they your benchmark now?`,
        a('Provocative', 'They should be looking over their shoulder', { tension: 10, fans: 300 }),
        a('Respect', 'Beating a team that good means something', { tension: -4, reputation: 2 }),
        a('Ambitious', 'Our benchmark is the front of the grid', { confidence: 2 }));
    case 'lostRival':
      return ask(`${R} were ahead again. What’s missing?`,
        a('Combative', 'Nothing a few upgrades won’t fix', { tension: 6, morale: 2, confidence: -1 }),
        a('Honest', 'They did a better job this weekend', { reputation: 2, morale: -2 }),
        a('The plan', 'Our development plan will close the gap', { confidence: 2 }));
    case 'teammates':
      return ask(`${D} finished well ahead of ${O}. Who is your number one?`,
        a('Equal', 'Both get exactly the same treatment', { driver: 1, other: 2, morale: 2 }),
        a('Pick one', `Right now, ${D} has earned it`, { driver: 5, other: -6 }),
        a('Challenge', `${O} will answer on the track`, { other: 3, confidence: 1 }));
    case 'drought':
      return ask(`${n} races without a point. Is the project stalling?`,
        a('Calm', 'The trend is improving behind the scenes', { confidence: 1 }),
        a('Frank', 'We are not where we want to be', { reputation: 2, morale: -2 }),
        a('Defiant', 'Write us off at your peril', { morale: 3, fans: 200, confidence: -1 }));
    case 'finale':
      return ask('The season is over. How do you sum it up?',
        a('Proud', 'Proud of every person in this team', { morale: 6 }),
        a('Ambitious', 'Not good enough — next year we go further', { confidence: 4, morale: -2, reputation: 2 }),
        a('Delivered', 'We did what we promised the board', { confidence: 2, reputation: 1 }));
  }
}

/** Short chips for effects: "+4 morale", "+600 fans", "rivalry +8"… */
export function effectChips(e: Effects & { cost?: number; cash?: number; insight?: number; xp?: number; consistency?: number }, driver?: string, other?: string): string[] {
  const out: string[] = [];
  const k = (n: number) => (Math.abs(n) >= 1_000_000 ? `${(n / 1_000_000).toFixed(n % 1_000_000 ? 2 : 0)}m` : `${Math.round(n / 1000)}k`);
  const signed = (n: number | undefined, what: string) => { if (n) out.push(`${n > 0 ? '+' : '−'}${Math.abs(n).toLocaleString('en-GB')} ${what}`); };
  if (e.cost) out.push(`−$${k(e.cost)}`);
  if (e.cash) out.push(`+$${k(e.cash)}`);
  signed(e.confidence, 'board');
  signed(e.morale, 'team morale');
  signed(e.reputation, 'reputation');
  signed(e.fans, 'fans');
  signed(e.insight, 'insight');
  signed(e.xp, 'XP each');
  signed(e.consistency, 'consistency each');
  signed(e.driver, `${surname(driver)} mood`);
  signed(e.other, `${surname(other)} mood`);
  signed(e.tension, 'rivalry');
  return out.length ? out : ['No immediate change'];
}

/** Cleans a saved press conference (null if it's not well formed). */
export function cleanPress(raw: unknown, isDriver: (id: string) => boolean): PressState | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.questions) || !Array.isArray(r.answers) || typeof r.key !== 'string') return null;
  const questions: PressQuestion[] = [];
  for (const x of r.questions.slice(0, MEDIA.questions)) {
    const o = (x ?? {}) as Record<string, unknown>;
    if (!TOPICS.includes(o.topic as PressTopic)) return null;
    const q: PressQuestion = { topic: o.topic as PressTopic };
    if (typeof o.driver === 'string' && isDriver(o.driver)) q.driver = o.driver;
    if (typeof o.other === 'string' && isDriver(o.other)) q.other = o.other;
    if (typeof o.n === 'number' && Number.isInteger(o.n) && Math.abs(o.n) <= 30) q.n = o.n;
    questions.push(q);
  }
  const answers = questions.map((_, i) => { const v = (r.answers as unknown[])[i]; return Number.isInteger(v) && (v as number) >= -1 && (v as number) <= 2 ? (v as number) : -1; });
  const int = (v: unknown, hi: number) => (typeof v === 'number' && Number.isInteger(v) ? clamp(v, 0, hi) : 0);
  return questions.length ? { key: r.key.slice(0, 30), season: Math.max(1, int(r.season, 9999)), round: int(r.round, 24), questions, answers } : null;
}
