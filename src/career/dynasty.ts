import { CAREER } from '../config/career.ts';
import { clamp } from '../core/math.ts';
import { hashString } from '../core/random.ts';
import type { CareerSave, RoundResult } from './career.ts';
import { driverDef, teamsFor } from './roster.ts';
import { carDevelopment } from './engineering.ts';
import { developRivals, type CarArea } from './carAreas.ts';
import { roundPoints } from './points.ts';
import { cleanPress, effectChips, freshDuels, freshRival, MEDIA, pressAfter, pressQuestion, principalOf, settleRivalry, type Duel, type Effects, type PressState, type RivalState } from './media.ts';

export type StaffRole = 'technical' | 'coach' | 'engineer';
export type Department = 'laboratory' | 'simulator' | 'commercial';
export type TrainingFocus = 'pace' | 'racecraft' | 'consistency';
export type WeekendApproach = 'balanced' | 'attack' | 'development';
export interface DriverProgress {
  xp: number; pace: number; racecraft: number; consistency: number; morale: number;
  training?: { season: number; round: number; focus: TrainingFocus };
}
export interface TeamNews { id: string; title: string; body: string; kind: 'team' | 'board' | 'rival' | 'milestone' | 'press'; season: number; round: number }
export const NEWS_KINDS: readonly TeamNews['kind'][] = ['team', 'board', 'rival', 'press', 'milestone'];
/** How many news items are kept. */
const NEWS_KEPT = 60;
export interface DynastyState {
  v: 1; confidence: number; reputation: number; fans: number; morale: number; insight: number;
  plan: { season: number; round: number; id: WeekendApproach };
  drivers: Record<string, DriverProgress>;
  staff: Partial<Record<StaffRole, string>>;
  departments: Record<Department, number>;
  /** Decisions made, newest first (`auto`: nobody answered in time, so the default went through). */
  decisions: { key: string; template: string; choice: number; season: number; round: number; auto?: true }[];
  news: TeamNews[]; achievements: string[];
  /** The season's rival team, and each of your drivers' duel with the rival driver in the same seat. */
  rival: RivalState;
  duels: Record<string, Duel>;
  /** The press conference waiting for answers, and the ones answered. */
  press: PressState | null;
  pressLog: { key: string; season: number; round: number; lines: string[] }[];
  /** The decision for the coming round (set when the round before it is settled), and follow-ups due later. */
  next: { key: string; id: DecisionId; driver?: string } | null;
  followUps: { id: DecisionId; season: number; round: number; driver?: string }[];
  /** The newest news item seen in the inbox (newer ones are marked new). */
  seen: string;
  settled: string; reviewed: number;
}

export const STAFF = [
  { id: 'hart', role: 'technical', name: 'Maya Hart', title: 'Technical director', level: 1, fee: 650_000, salary: 90_000, reputation: 0, detail: '8% lower research RP cost and 6% more performance from new designs.' },
  { id: 'mercer', role: 'technical', name: 'Ada Mercer', title: 'Technical director', level: 2, fee: 1_600_000, salary: 160_000, reputation: 40, detail: '14% lower research RP cost and 12% more performance from new designs.' },
  { id: 'soren', role: 'coach', name: 'Luca Soren', title: 'Driver coach', level: 1, fee: 550_000, salary: 75_000, reputation: 0, detail: '+10 XP to each commissioned driver training programme.' },
  { id: 'kade', role: 'coach', name: 'Rina Kade', title: 'Driver coach', level: 2, fee: 1_400_000, salary: 140_000, reputation: 40, detail: '+20 XP to training and a stronger driver-development programme.' },
  { id: 'vale', role: 'engineer', name: 'Noah Vale', title: 'Race engineer', level: 1, fee: 700_000, salary: 95_000, reputation: 0, detail: 'Reduces your AI cars’ mechanical failure chance by 0.6 percentage points.' },
  { id: 'tan', role: 'engineer', name: 'Esme Tan', title: 'Race engineer', level: 2, fee: 1_750_000, salary: 170_000, reputation: 40, detail: 'Reduces your AI cars’ mechanical failure chance by 1.2 percentage points.' },
] as const;
export const DEPARTMENTS = [
  { id: 'laboratory', name: 'Aerodynamics laboratory', icon: '↗', detail: 'Each level cuts research RP costs by 3% and increases the performance of new designs by 3%.' },
  { id: 'simulator', name: 'Driver performance centre', icon: '◈', detail: 'Each level adds 5 XP to training. Build your two drivers into a lasting advantage.' },
  { id: 'commercial', name: 'Commercial studio', icon: '◎', detail: 'Each level earns $75k and attracts 10% more fans after each race.' },
] as const;
export const TRAINING = [
  { id: 'pace', name: 'Qualifying pace', detail: 'Develop outright speed and improve the driver’s rating.', cost: 220_000 },
  { id: 'racecraft', name: 'Racecraft simulator', detail: 'Develop the driver’s race rating and experience.', cost: 220_000 },
  { id: 'consistency', name: 'Consistency programme', detail: 'Reduce mechanical failure risk when this driver is controlled by AI.', cost: 220_000 },
] as const;
export const APPROACHES = [
  { id: 'balanced', name: 'Balanced weekend', short: 'BALANCED', detail: 'Normal pace, reliability and development. Keep your options open.', pace: 0, risk: 0, work: 1 },
  { id: 'attack', name: 'Maximum attack', short: 'ATTACK', detail: 'More pace from both cars: +0.6 to your AI pace setting and +0.4% engine pull for your car. AI mechanical risk rises by 1.2 percentage points; team morale falls by 2 after the race.', pace: 0.006, risk: 0.012, work: 1 },
  { id: 'development', name: 'Development weekend', short: 'DEVELOP', detail: 'Double workshop progress and +12 XP for both drivers. In return, your AI pace setting falls by 0.6 and your car loses 0.4% engine pull. AI mechanical risk falls by 0.2 percentage points.', pace: -0.006, risk: -0.002, work: 2 },
] as const;
export const ACHIEVEMENTS = [
  ['first-points', 'Off the mark', 'Score your first constructors’ points.'],
  ['first-podium', 'The first champagne', 'Put either team car on a podium.'],
  ['first-win', 'A winning team', 'Win a Grand Prix with your team.'],
  ['constructors-title', 'World champions', 'Win the constructors’ championship.'],
  ['drivers-title', 'The complete package', 'Win the drivers’ championship with either car.'],
  ['rivalry-win', 'Win the battle', 'Finish a season with more head-to-head wins than your rival.'],
  ['developed-driver', 'Homegrown advantage', 'Develop a driver to level three.'],
] as const;

const seats = (save: CareerSave) => teamsFor(save).find((t) => t.id === save.team)!.drivers;
const owned = (save: CareerSave, id: string) => seats(save).includes(id);
const freshDriver = (): DriverProgress => ({ xp: 0, pace: 0, racecraft: 0, consistency: 0, morale: 65 });
const roundKey = (save: CareerSave, round = save.done.length) => `${save.season}:${round}`;
export const managementOpen = (save: CareerSave) => !!save.owner && save.grid === null && save.done.length < save.calendar.length;
function rivalId(save: CareerSave): string {
  const rivals = teamsFor(save).filter((t) => t.id !== save.team);
  rivals.sort((a, b) => Math.abs(save.cars[a.id] - save.cars[save.team]) - Math.abs(save.cars[b.id] - save.cars[save.team]));
  return rivals[0].id;
}
export function createDynasty(save: CareerSave): DynastyState {
  const mine = seats(save), rival = teamsFor(save).find((t) => t.id === rivalId(save))!, achievements: string[] = [];
  const best = Math.min(99, ...save.done.flatMap((r) => mine.map((id) => r.dnf.includes(id) || !r.order.includes(id) ? 99 : r.order.indexOf(id) + 1)));
  if (best <= 10 || save.history.some((s) => s.points > 0)) achievements.push('first-points');
  if (best <= 3 || save.history.some((s) => s.podiums > 0)) achievements.push('first-podium');
  if (best === 1 || save.history.some((s) => s.wins > 0)) achievements.push('first-win');
  if (save.history.some((s) => s.teamPosition === 1)) achievements.push('constructors-title');
  if (save.history.some((s) => s.position === 1)) achievements.push('drivers-title');
  const battle = freshRival(rival.id);
  for (const r of save.done) { const a = points(r, mine), b = points(r, rival.drivers); if (a > b) battle.won++; else if (a < b) battle.lost++; else battle.tied++; }
  const w: DynastyState = { v: 1, confidence: 65, reputation: Math.round(15 + (save.cars[save.team] ?? 0.4) * 20), fans: 2000, morale: 65, insight: 0,
    plan: { season: save.season, round: save.done.length, id: 'balanced' }, drivers: Object.fromEntries(mine.map((id) => [id, { ...freshDriver(), xp: Math.min(500, save.done.length * 8) }])),
    staff: {}, departments: { laboratory: 0, simulator: 0, commercial: 0 }, decisions: [], achievements,
    news: [{ id: `welcome:${save.season}`, kind: 'team', title: 'Your team. Your era.', body: 'Choose your staff, develop both drivers and build a team that can fight for championships.', season: save.season, round: save.done.length }],
    rival: battle, duels: freshDuels(mine, rival.drivers), press: null, pressLog: [], next: null, followUps: [], seen: '',
    settled: roundKey(save), reviewed: save.done.length === save.calendar.length ? save.season : 0 };
  if (save.done.length < save.calendar.length) w.next = { key: roundKey(save), ...chooseDecision(save, w, save.done.length).pick };
  return w;
}
export function dynasty(save: CareerSave): DynastyState {
  if (!save.owner) throw new Error('An owner career is required');
  return save.owner.world ??= createDynasty(save);
}
export function driverProgress(save: CareerSave, id: string): DriverProgress {
  return save.owner?.world?.drivers[id] ?? freshDriver();
}
export function driverRating(save: CareerSave, id: string): number {
  const p = driverProgress(save, id);
  return clamp((driverDef(id)?.skill ?? 0.5) + Math.floor(p.xp / 100) * 0.008 + p.pace * 0.002 + p.racecraft * 0.001 + (p.morale - 65) * 0.0002, 0, 1);
}
export function weekendApproach(save: CareerSave, round = save.done.length) {
  if (save.owner?.engineering) return APPROACHES[0];
  const plan = save.owner?.world?.plan;
  return APPROACHES.find((p) => p.id === (plan?.season === save.season && plan.round === round ? plan.id : 'balanced')) ?? APPROACHES[0];
}
export function selectApproach(save: CareerSave, id: WeekendApproach): boolean {
  if (!managementOpen(save) || !APPROACHES.some((p) => p.id === id)) return false;
  dynasty(save).plan = { season: save.season, round: save.done.length, id }; return true;
}
export function staffMember(save: CareerSave, role: StaffRole) { return STAFF.find((p) => p.id === save.owner?.world?.staff[role] && p.role === role); }
export function researchDiscount(save: CareerSave): number { return (staffMember(save, 'technical')?.level === 2 ? 0.14 : staffMember(save, 'technical') ? 0.08 : 0) + (save.owner?.world?.departments.laboratory ?? 0) * 0.03; }
export function researchMultiplier(save: CareerSave): number { return 1 + (staffMember(save, 'technical')?.level ?? 0) * 0.06 + (save.owner?.world?.departments.laboratory ?? 0) * 0.03 + (save.owner?.world?.insight ?? 0) * 0.03; }
export function researchDuration(save: CareerSave, rounds: number): number { return Math.max(1, rounds - ((save.owner?.world?.departments.laboratory ?? 0) === 3 && rounds > 1 ? 1 : 0)); }
export function failureChance(save: CareerSave, id: string, round = save.done.length): number {
  if (!save.owner || !owned(save, id)) return CAREER.failure;
  return clamp(CAREER.failure + weekendApproach(save, round).risk - (staffMember(save, 'engineer')?.level ?? 0) * 0.006 - driverProgress(save, id).consistency * 0.0006 - carDevelopment(save, id).durability, 0.004, 0.12);
}
export function operatingCosts(save: CareerSave): number {
  const w = save.owner?.world;
  return (w ? STAFF.filter((p) => w.staff[p.role] === p.id).reduce((n, p) => n + p.salary, 0) + Object.values(w.departments).reduce((n, level) => n + level * 25_000, 0) : 0) + (save.owner?.engineering?.workforce ?? 0) * 4500;
}
function book(save: CareerSave, label: string, amount: number): boolean {
  const o = save.owner!;
  if (o.cash + amount < 0) return false;
  o.cash += amount; if (amount > 0) o.earned += amount; else o.spent -= amount;
  o.ledger ??= []; o.ledger.unshift({ label, amount, season: save.season, round: save.done.length }); o.ledger = o.ledger.slice(0, 20);
  return true;
}
/** How a rival's package in each area is named in the news. */
const AREA_NEWS: Record<CarArea, { name: string; part: string }> = {
  aero: { name: 'Aerodynamics', part: 'floor and wing package' },
  chassis: { name: 'Chassis', part: 'suspension package' },
  powertrain: { name: 'Power unit', part: 'power unit upgrade' },
};
function news(save: CareerSave, title: string, body: string, kind: TeamNews['kind'] = 'team'): void {
  const w = dynasty(save);
  w.news.unshift({ id: `${roundKey(save)}:${hashString(title + body)}`, title, body, kind, season: save.season, round: save.done.length }); w.news = w.news.slice(0, NEWS_KEPT);
}
export function hireStaff(save: CareerSave, id: string): boolean {
  const person = STAFF.find((s) => s.id === id);
  if (!managementOpen(save) || !person) return false;
  const w = dynasty(save);
  if (w.staff[person.role] === id || w.reputation < person.reputation || save.owner!.cash < person.fee + person.salary) return false;
  if (!book(save, `Signed ${person.name} · ${person.title}`, -person.fee)) return false;
  w.staff[person.role] = person.id; news(save, `${person.name} joins the team`, `${person.title}. ${person.detail}`); return true;
}
export function releaseStaff(save: CareerSave, role: StaffRole): boolean {
  if (!managementOpen(save)) return false;
  const w = dynasty(save), person = staffMember(save, role);
  if (!person) return false;
  delete w.staff[role]; news(save, `${person.name} leaves the team`, 'The role is open. There are no further salary payments.'); return true;
}
export function departmentCost(save: CareerSave, id: Department): number { return 750_000 * ((save.owner?.world?.departments[id] ?? 0) + 1) ** 2; }
export function upgradeDepartment(save: CareerSave, id: Department): boolean {
  if (!managementOpen(save) || !DEPARTMENTS.some((d) => d.id === id)) return false;
  const w = dynasty(save);
  if (w.departments[id] >= 3 || !book(save, `${DEPARTMENTS.find((d) => d.id === id)!.name} expansion`, -departmentCost(save, id))) return false;
  w.departments[id]++; return true;
}
export function trainDriver(save: CareerSave, id: string, focus: TrainingFocus): boolean {
  const spec = TRAINING.find((p) => p.id === focus);
  if (!managementOpen(save) || !owned(save, id) || !spec) return false;
  const w = dynasty(save), p = w.drivers[id] ??= freshDriver();
  if (p.training && (p.training.season !== save.season || p.training.round !== save.done.length)) delete p.training;
  if (p.training || p[focus] >= 8 || !book(save, `${driverDef(id)!.name} · ${spec.name}`, -spec.cost)) return false;
  p.training = { season: save.season, round: save.done.length, focus }; return true;
}

export type DecisionId = 'vision' | 'media' | 'drivers' | 'reliability' | 'research' | 'community' | 'sponsor' | 'sponsorReview' | 'unhappy' | 'promise' | 'rivalry' | 'budget' | 'board' | 'poach';
/**
 * One way to answer a decision: what it costs (`cost`) or brings in (`cash`),
 * and what it does — to the board, team morale (and both drivers' mood),
 * reputation, fans, research insight, both drivers' XP and consistency, the
 * mood of the driver it's about (`driver`), the rivalry (`tension`) — and a
 * decision it leads to `in` rounds later (`followUp`).
 */
export interface DecisionOption extends Effects { label: string; note: string; cost: number; cash?: number; insight?: number; xp?: number; consistency?: number; followUp?: { id: DecisionId; in: number } }
/** `fallback`: the option taken if the team races without answering. Titles and bodies may name {driver}, {rival} and {principal}. */
interface DecisionTemplate { from: string; title: string; body: string; fallback: number; options: readonly DecisionOption[] }
export const DECISIONS: Record<DecisionId, DecisionTemplate> = {
  vision: { from: 'THE BOARD', title: 'What kind of team will you build?', body: 'Your first message sets the tone in the factory. The board wants ambition. Your people want a credible plan.', fallback: 2, options: [
    { label: 'Invest in the foundations', note: 'Facilities and processes first.', cost: 450_000, confidence: 6, morale: 4, insight: 1 },
    { label: 'Make a statement', note: 'Big words in public. The factory feels the pressure.', cost: 0, reputation: 6, morale: -3 },
    { label: 'Promise steady progress', note: 'A modest, credible plan.', cost: 0, confidence: 2, morale: 2 },
  ] },
  media: { from: 'COMMERCIAL DIRECTOR', title: 'The cameras are waiting.', body: 'A partner wants a team feature before the next race. It could bring new fans, but the drivers need their preparation time.', fallback: 2, options: [
    { label: 'Open the factory doors', note: 'Great content, a distracted team.', cost: 0, fans: 900, reputation: 3, morale: -4 },
    { label: 'Protect the race programme', note: 'Pay the partner off and keep the focus.', cost: 180_000, morale: 5, confidence: 2 },
    { label: 'A short team interview', note: 'A little of both.', cost: 0, fans: 250, reputation: 1 },
  ] },
  drivers: { from: 'DRIVER DEVELOPMENT', title: 'Talent needs time.', body: 'Both drivers have asked for more time in the simulator. You can back their development now or keep the budget free for the car.', fallback: 2, options: [
    { label: 'Fund a joint simulator camp', note: 'Both drivers get the extra hours.', cost: 350_000, xp: 25, morale: 4 },
    { label: 'Focus on the next car package', note: 'The simulator time goes to the engineers.', cost: 0, insight: 1, morale: -2 },
    { label: 'Keep the current programme', note: 'Nothing changes.', cost: 0 },
  ] },
  reliability: { from: 'RACE ENGINEERING', title: 'Bring both cars home.', body: 'The engineering team wants more preparation after a difficult weekend. Rebuild confidence or put resources into the next performance step.', fallback: 2, options: [
    { label: 'Run a reliability workshop', note: 'Every system checked twice.', cost: 300_000, consistency: 1, morale: 6, confidence: 3 },
    { label: 'Back the performance group', note: 'Speed first, reliability later.', cost: 0, insight: 2, morale: -3 },
    { label: 'Trust the existing process', note: 'Nothing changes.', cost: 0 },
  ] },
  research: { from: 'TECHNICAL GROUP', title: 'A concept worth pursuing.', body: 'Your engineers have found a promising direction. An extra test programme would turn the idea into insight for your next commissioned upgrade.', fallback: 2, options: [
    { label: 'Approve the extra tests', note: 'Wind tunnel time, booked.', cost: 400_000, insight: 2, confidence: 3 },
    { label: 'Give the team more time', note: 'Slower, but the engineers like it.', cost: 0, insight: 1, morale: 2 },
    { label: 'Stay with the proven concept', note: 'The board likes caution.', cost: 0, confidence: 2 },
  ] },
  community: { from: 'TEAM COMMUNICATIONS', title: 'More than two cars.', body: 'Supporters have organised a community day. Show them what the team stands for, or keep everyone focused on the championship fight.', fallback: 2, options: [
    { label: 'Make it a full team event', note: 'Drivers, cars and the whole factory.', cost: 250_000, fans: 1500, reputation: 4, morale: 3 },
    { label: 'Send a message from the factory', note: 'A video and a thank-you.', cost: 0, fans: 300, reputation: 1 },
    { label: 'Keep the weekend race-focused', note: 'The board approves.', cost: 0, confidence: 2 },
  ] },
  sponsor: { from: 'COMMERCIAL DIRECTOR', title: 'A title sponsor comes calling.', body: 'A global brand wants its name on the car. The money is serious, but they expect the drivers at events every weekend.', fallback: 2, options: [
    { label: 'Sign the full deal', note: 'Big money and busy drivers. They’ll want more later.', cost: 0, cash: 900_000, fans: 800, morale: -4, followUp: { id: 'sponsorReview', in: 3 } },
    { label: 'Negotiate a lighter deal', note: 'Less money, fewer demands.', cost: 0, cash: 400_000, fans: 300 },
    { label: 'Decline politely', note: 'The team stays focused.', cost: 0, reputation: 1, morale: 1 },
  ] },
  sponsorReview: { from: 'COMMERCIAL DIRECTOR', title: 'The sponsor wants more.', body: 'Your title partner is happy with the exposure but wants a bigger activation programme for the rest of the season.', fallback: 1, options: [
    { label: 'Give them more appearances', note: 'More money, tired drivers.', cost: 0, cash: 300_000, morale: -4 },
    { label: 'Hold the line', note: 'The contract says what it says.', cost: 0, confidence: -2, morale: 2 },
    { label: 'Offer a fan event instead', note: 'Everyone gets something.', cost: 120_000, fans: 900, reputation: 1 },
  ] },
  unhappy: { from: 'DRIVER MANAGEMENT', title: '{driver} is unhappy.', body: '{driver} feels the team isn’t backing them and has asked for a meeting. The mood in the garage is starting to suffer.', fallback: 2, options: [
    { label: 'Pay a performance bonus', note: 'Money talks.', cost: 250_000, driver: 12 },
    { label: 'Promise them a better car', note: 'They will hold you to it in three races.', cost: 0, driver: 6, followUp: { id: 'promise', in: 3 } },
    { label: 'Tell them to deliver first', note: 'The board likes it. {driver} doesn’t.', cost: 0, driver: -6, confidence: 2 },
  ] },
  promise: { from: 'DRIVER MANAGEMENT', title: '{driver} wants what you promised.', body: 'Three races ago you promised {driver} a better car. They want to know where it is.', fallback: 1, options: [
    { label: 'Fast-track a parts programme', note: 'Keep your word.', cost: 400_000, driver: 10, insight: 1 },
    { label: 'Ask for patience', note: 'It’s coming. Probably.', cost: 0, driver: -4 },
    { label: 'Admit the plan changed', note: 'Honest, and it hurts.', cost: 0, driver: -10, reputation: 1 },
  ] },
  rivalry: { from: 'TEAM COMMUNICATIONS', title: '{principal} goes public.', body: 'The {rival} principal has told reporters your team “copies everything and wins nothing”. The paddock is waiting for your reply.', fallback: 2, options: [
    { label: 'Fire back in public', note: 'The fans love it. The paddock notices.', cost: 0, tension: 15, fans: 800, morale: 3, reputation: -2 },
    { label: 'Protest to the stewards', note: 'Ask them to look at {rival}’s floor.', cost: 100_000, tension: 5, confidence: 2 },
    { label: 'Rise above it', note: 'Let the results talk.', cost: 0, tension: -10, reputation: 3 },
  ] },
  budget: { from: 'FINANCE DIRECTOR', title: 'Money is getting tight.', body: 'The finance team warns that operating costs are eating the budget. They propose savings before the next race.', fallback: 2, options: [
    { label: 'Cut travel and hospitality', note: 'Economy class for everyone.', cost: 0, cash: 350_000, morale: -5 },
    { label: 'Ask the board for an advance', note: 'They’ll remember it.', cost: 0, cash: 600_000, confidence: -6 },
    { label: 'Hold your nerve', note: 'No cuts yet.', cost: 0, morale: 1, confidence: -1 },
  ] },
  board: { from: 'THE BOARD', title: 'The board wants answers.', body: 'Board confidence is slipping. The chairman wants a clear plan before the next race.', fallback: 1, options: [
    { label: 'Present a recovery plan', note: 'Consultants, charts, a clear target.', cost: 150_000, confidence: 8 },
    { label: 'Ask for time and trust', note: 'The team appreciates the cover.', cost: 0, confidence: 3, morale: 2 },
    { label: 'Promise results next race', note: 'Pressure on everyone.', cost: 0, confidence: 5, morale: -3 },
  ] },
  poach: { from: 'TECHNICAL GROUP', title: 'A rival engineer wants to join.', body: 'A senior aerodynamicist from {rival} has approached you. Bringing them over costs money — and won’t go unnoticed.', fallback: 2, options: [
    { label: 'Sign them', note: '{principal} will be furious.', cost: 500_000, insight: 2, tension: 10 },
    { label: 'Offer a consultancy', note: 'Quietly, at arm’s length.', cost: 200_000, insight: 1 },
    { label: 'Not interested', note: 'Clean hands.', cost: 0, reputation: 1 },
  ] },
};
const POOL: readonly DecisionId[] = ['media', 'drivers', 'research', 'community'];
/** How often a fitting situation (an unhappy driver, a heated rivalry, money…) comes up instead of an everyday one (of 100). */
const SITUATION_CHANCE = 65;

/**
 * The decision for round `round`: the season opener's vision; a follow-up
 * that's due; reliability after a retirement; often a situation the team is
 * in (an unhappy driver, a heated rivalry, money running short, a nervous
 * board, a sponsor or an engineer interested in a team doing well);
 * otherwise an everyday one. Also which follow-up it used (-1: none).
 */
function chooseDecision(save: CareerSave, w: DynastyState, round: number): { pick: { id: DecisionId; driver?: string }; followUp: number } {
  if (save.season === 1 && round === 0) return { pick: { id: 'vision' }, followUp: -1 };
  const due = w.followUps.findIndex((f) => f.season === save.season && f.round <= round);
  if (due >= 0) {
    const f = w.followUps[due];
    return { pick: f.driver ? { id: f.id, driver: f.driver } : { id: f.id }, followUp: due };
  }
  const last = round > 0 ? save.done[round - 1] : undefined, mine = seats(save);
  if (last && mine.some((id) => last.dnf.includes(id))) return { pick: { id: 'reliability' }, followUp: -1 };
  const k = hashString(`${save.seed}:${save.season}:${round}:decision`);
  const thisSeason = (id: DecisionId) => w.decisions.some((d) => d.season === save.season && d.template === id);
  const situations: { id: DecisionId; driver?: string }[] = [];
  const glum = mine.map((id) => ({ id, m: w.drivers[id]?.morale ?? 65 })).sort((a, b) => a.m - b.m)[0];
  if (glum && glum.m < 45) situations.push({ id: 'unhappy', driver: glum.id });
  if (w.rival.tension >= MEDIA.heated) situations.push({ id: 'rivalry' });
  if (save.owner!.cash < 1_500_000) situations.push({ id: 'budget' });
  if (w.confidence < 40) situations.push({ id: 'board' });
  if (w.fans >= 5000 && w.reputation >= 25 && !thisSeason('sponsor')) situations.push({ id: 'sponsor' });
  if (w.reputation >= 40 && !thisSeason('poach')) situations.push({ id: 'poach' });
  const previous = w.decisions[0]?.template;
  const fresh = situations.filter((s) => s.id !== previous);
  if (fresh.length && k % 100 < SITUATION_CHANCE) return { pick: fresh[Math.floor(k / 100) % fresh.length], followUp: -1 };
  const pool = POOL.filter((id) => id !== previous);
  return { pick: { id: pool[k % pool.length] }, followUp: -1 };
}

/** A template's words with the driver, rival team and its principal filled in. */
function fill(save: CareerSave, w: DynastyState, text: string, driver?: string): string {
  return text.replaceAll('{driver}', driver ? driverDef(driver)?.name ?? 'Your driver' : 'Your driver').replaceAll('{rival}', teamsFor(save).find((t) => t.id === w.rival.id)?.name ?? 'your rival').replaceAll('{principal}', principalOf(w.rival.id));
}

/** The decision for round `round` as it reads, or null if it's been made (or the season is over). */
function decisionAt(save: CareerSave, round: number) {
  if (!save.owner || round >= save.calendar.length) return null;
  const w = dynasty(save), key = roundKey(save, round);
  if (w.decisions.some((d) => d.key === key)) return null;
  const pick = w.next?.key === key ? w.next : chooseDecision(save, w, round).pick;
  const t = DECISIONS[pick.id], driver = pick.driver;
  const options = t.options.map((o) => ({ ...o, note: fill(save, w, o.note, driver), chips: effectChips(o, driver) }));
  return { ...t, id: pick.id, key, driver, title: fill(save, w, t.title, driver), body: fill(save, w, t.body, driver), options };
}
export function currentDecision(save: CareerSave) {
  if (!save.owner || save.done.length >= save.calendar.length) return null;
  return decisionAt(save, save.done.length);
}

/** What an answer (decision or press) does to the team and its drivers. */
function applyEffects(save: CareerSave, w: DynastyState, e: Effects & { insight?: number; xp?: number; consistency?: number }, driver?: string, other?: string): void {
  w.confidence = clamp(w.confidence + (e.confidence ?? 0), 0, 100); w.morale = clamp(w.morale + (e.morale ?? 0), 0, 100);
  w.reputation = clamp(w.reputation + (e.reputation ?? 0), 0, 100); w.fans = Math.max(0, w.fans + (e.fans ?? 0)); w.insight = Math.min(3, w.insight + (e.insight ?? 0));
  w.rival.tension = clamp(w.rival.tension + (e.tension ?? 0), 0, 100);
  for (const id of seats(save)) {
    const p = w.drivers[id] ??= freshDriver(); p.xp = Math.min(500, p.xp + (e.xp ?? 0));
    p.morale = clamp(p.morale + (e.morale ?? 0) + (id === driver ? e.driver ?? 0 : 0) + (id === other ? e.other ?? 0 : 0), 0, 100);
    p.consistency = Math.min(8, p.consistency + (e.consistency ?? 0));
  }
}

/** Puts decision option `choice` into effect (`auto`: the default, taken because nobody answered). */
function applyDecision(save: CareerSave, decision: NonNullable<ReturnType<typeof decisionAt>>, choice: number, auto: boolean): boolean {
  const option = decision.options[choice], w = dynasty(save);
  if (option.cost && !book(save, decision.title, -option.cost)) return false;
  if (option.cash) book(save, decision.title, option.cash);
  applyEffects(save, w, option, decision.driver);
  const round = Number(decision.key.split(':')[1]);
  if (option.followUp) w.followUps.push({ id: option.followUp.id, season: save.season, round: round + option.followUp.in, ...(decision.driver ? { driver: decision.driver } : {}) });
  w.decisions.unshift({ key: decision.key, template: decision.id, choice, season: save.season, round, ...(auto ? { auto: true as const } : {}) }); w.decisions = w.decisions.slice(0, 80);
  if (w.next?.key === decision.key) w.next = null;
  news(save, auto ? `No reply: ${decision.title}` : decision.title, `${auto ? 'Nobody answered before the race, so the default went through: ' : ''}${option.label}. ${option.chips.join(' · ')}`, auto ? 'board' : 'team');
  return true;
}

export function resolveDecision(save: CareerSave, key: string, choice: number): boolean {
  if (!managementOpen(save) || !Number.isInteger(choice)) return false;
  const decision = currentDecision(save), option = decision?.options[choice];
  if (!decision || decision.key !== key || !option || save.owner!.cash < option.cost) return false;
  return applyDecision(save, decision, choice, false);
}

/** The press conference waiting for answers, as asked (null: none). */
export function currentPress(save: CareerSave) {
  const w = save.owner?.world, p = w?.press;
  if (!w || !p) return null;
  return { ...p, asked: p.questions.map((q, i) => pressQuestion(save, w.rival.id, q, i)) };
}

/** Gives answer `choice` to question `index` of the waiting press conference; when it's all answered, it's logged and in the news. */
export function answerPress(save: CareerSave, index: number, choice: number): boolean {
  const press = currentPress(save), w = save.owner?.world;
  if (!press || !w || !Number.isInteger(index) || !Number.isInteger(choice)) return false;
  const q = press.questions[index], answer = press.asked[index]?.answers[choice];
  if (!q || !answer || press.answers[index] !== -1) return false;
  applyEffects(save, w, answer.effects, q.driver, q.other);
  w.press!.answers[index] = choice;
  if (w.press!.answers.every((a) => a >= 0)) closePress(save);
  return true;
}

/** Ends the waiting press conference; questions not answered get "no comment" (which costs a little reputation). */
function closePress(save: CareerSave): void {
  const w = dynasty(save), p = currentPress(save);
  if (!p) return;
  const lines: string[] = [];
  p.questions.forEach((q, i) => {
    const a = p.answers[i];
    if (a < 0) applyEffects(save, w, MEDIA.noComment, q.driver, q.other);
    lines.push(`${p.asked[i].text} — ${a >= 0 ? `“${p.asked[i].answers[a].label}”` : 'No comment.'}`);
  });
  w.pressLog.unshift({ key: p.key, season: p.season, round: p.round, lines }); w.pressLog = w.pressLog.slice(0, MEDIA.log);
  const said = p.answers.map((a, i) => (a >= 0 ? p.asked[i].answers[a].label : '')).find(Boolean);
  w.press = null;
  news(save, !said ? 'Empty chair at the press conference' : `“${said}”`, !said ? `You skipped the press after round ${p.round}. ${lines.length} questions went unanswered, and the paddock noticed.` : `The principal on the record after round ${p.round}. ${lines.join(' ')}`, 'press');
}

function points(result: RoundResult, ids: readonly string[]): number { return ids.reduce((n, id) => n + roundPoints(result, id), 0); }
function unlock(save: CareerSave, id: string): void {
  const w = dynasty(save), spec = ACHIEVEMENTS.find((a) => a[0] === id);
  if (!spec || w.achievements.includes(id)) return;
  w.achievements.push(id); news(save, spec[1], spec[2], 'milestone');
}
/** New-round hook only; replaying the hub or cleaning a save never advances the world or pays money. */
export function settleDynastyRound(save: CareerSave, result: RoundResult, teamPosition: number, champion: string | null, standing: readonly string[] = []): void {
  if (!save.owner) return;
  const w = dynasty(save), key = roundKey(save);
  if (w.settled === key) return;
  w.settled = key;
  // Deadlines: a decision nobody answered before the race takes its default; a press conference nobody finished closes.
  const missed = decisionAt(save, save.done.length - 1);
  if (missed && w.next?.key === missed.key) applyDecision(save, missed, DECISIONS[missed.id].fallback, true);
  if (w.press) closePress(save);
  const mine = seats(save), pts = points(result, mine);
  if (!Object.keys(w.duels).length) w.duels = freshDuels(mine, teamsFor(save).find((t) => t.id === w.rival.id)?.drivers ?? []);
  const rivalry = settleRivalry(save, w.rival, w.duels, result, mine, (ids) => points(result, ids));
  const best = Math.min(...mine.map((id) => result.dnf.includes(id) ? 99 : result.order.indexOf(id) + 1));
  const retired = mine.filter((id) => result.dnf.includes(id)).length;
  const target = save.owner.target ?? teamsFor(save).length;
  w.confidence = clamp(w.confidence + (best <= 3 ? 5 : best <= target * 2 + 1 ? 2 : -3) - retired * 3, 0, 100);
  const approach = weekendApproach(save, save.done.length - 1);
  w.morale = clamp(w.morale + (pts ? 2 : -1) - retired * 3 - (approach.id === 'attack' ? 2 : 0) + rivalry.morale, 0, 100);
  w.reputation = clamp(w.reputation + (best === 1 ? 4 : best <= 3 ? 2 : pts ? 1 : 0), 0, 100);
  w.fans = Math.min(2_000_000_000, w.fans + Math.round((200 + pts * 50) * (1 + w.departments.commercial * 0.1)));
  for (const id of mine) {
    const p = w.drivers[id] ??= freshDriver(), place = result.order.indexOf(id) + 1;
    p.morale = clamp(p.morale + (result.dnf.includes(id) ? -7 : place <= 3 ? 5 : place <= 10 ? 2 : -1) + (rivalry.drivers[id] ?? 0), 0, 100);
    p.xp = Math.min(500, p.xp + 8 + (approach.id === 'development' ? 12 : 0));
    if (p.training?.season === save.season && p.training.round === save.done.length - 1) {
      p[p.training.focus] = Math.min(8, p[p.training.focus] + 1);
      p.xp = Math.min(500, p.xp + 24 + (staffMember(save, 'coach')?.level ?? 0) * 10 + w.departments.simulator * 5);
      news(save, `${driverDef(id)!.name} completes training`, `${TRAINING.find((t) => t.id === p.training!.focus)!.name} delivered. Their development follows them through the career.`);
      delete p.training;
    }
    if (p.xp >= 200) unlock(save, 'developed-driver');
  }
  const commercial = w.departments.commercial * 75_000;
  if (commercial) book(save, 'Commercial studio income', commercial);
  const costs = operatingCosts(save);
  if (costs) {
    const available = Math.min(costs, save.owner.cash); if (available) book(save, 'Staff and department operations', -available);
    if (available < costs) { w.staff = {}; w.confidence = Math.max(0, w.confidence - 8); news(save, 'Payroll shortfall', 'Staff contracts were released after the team could not cover operating costs. Department levels remain. No debt is carried forward.', 'board'); }
  }
  if (pts > 0) unlock(save, 'first-points'); if (best <= 3) unlock(save, 'first-podium'); if (best === 1) unlock(save, 'first-win');
  for (const n of rivalry.news) news(save, n.title, n.body, 'rival');
  // The rival teams' development: packages for the next round, each to an area (carAreas.ts).
  const packages = developRivals(save, standing);
  const near = packages.filter((p) => p.team === w.rival.id || Math.abs(standing.indexOf(p.team) - standing.indexOf(save.team)) <= 2);
  for (const p of near.slice(0, 2)) {
    const t = teamsFor(save).find((x) => x.id === p.team)!, area = AREA_NEWS[p.area];
    news(save, p.flop ? `${t.name}'s ${area.part} disappoints` : `${t.name} bring a new ${area.part}`, p.flop
      ? `Their ${area.part} hasn't delivered what the wind tunnel promised: a small step in ${area.name.toLowerCase()} at best.`
      : `A step in ${area.name.toLowerCase()} (+${Math.round(p.gain * 700)} PI there) for the next round. Compare the cars in Engineering → Vehicle.`, 'rival');
  }
  if (packages.length > near.length) news(save, 'The grid keeps moving.', `${packages.length} rival ${packages.length === 1 ? 'team brings' : 'teams bring'} upgrades to the next round. Engineering → Vehicle shows where every car is strong.`, 'rival');
  if (save.done.length === save.calendar.length && w.reviewed !== save.season) {
    w.reviewed = save.season;
    if (teamPosition <= target) { const bonus = 800_000 + Math.round(w.confidence) * 10_000; book(save, 'Board objective bonus', bonus); news(save, 'Objective achieved.', 'The board has paid your season performance bonus. Keep building.', 'board'); }
    else news(save, 'A season to learn from.', `Finished P${teamPosition} against the board’s P${target} target. Your team and progress continue next season.`, 'board');
    if (teamPosition === 1) unlock(save, 'constructors-title'); if (champion && mine.includes(champion)) unlock(save, 'drivers-title');
    if (w.rival.won > w.rival.lost) unlock(save, 'rivalry-win');
  }
  // The press, after a big result; and the decision waiting for the next round.
  w.press = pressAfter(save, result, mine, w.rival, w.duels, (r) => points(r, mine), save.done.length === save.calendar.length);
  if (w.press) news(save, 'The press want a word', `${w.press.questions.length} ${w.press.questions.length === 1 ? 'question' : 'questions'} after round ${save.done.length}. Answer them in the Inbox before the next race.`, 'press');
  scheduleDecision(save, w);
}

/** Picks the decision for the coming round (using up a follow-up if one is due). */
function scheduleDecision(save: CareerSave, w: DynastyState): void {
  w.next = null;
  if (save.done.length >= save.calendar.length) return;
  const { pick, followUp } = chooseDecision(save, w, save.done.length);
  if (followUp >= 0) w.followUps.splice(followUp, 1);
  w.next = { key: roundKey(save), ...pick };
}
export function startDynastySeason(save: CareerSave): void {
  if (!save.owner) return;
  const w = dynasty(save); w.plan = { season: save.season, round: 0, id: 'balanced' }; w.settled = roundKey(save);
  // A new rival (or the same one, still a little heated), new duels; last season's follow-ups are dropped.
  const rival = rivalId(save), theirs = teamsFor(save).find((t) => t.id === rival)!.drivers;
  w.rival = freshRival(rival, rival === w.rival.id ? Math.round((w.rival.tension + MEDIA.tension) / 2) : MEDIA.tension);
  w.duels = freshDuels(seats(save), theirs); w.followUps = []; w.press = null;
  for (const p of Object.values(w.drivers)) { delete p.training; p.morale = Math.round((p.morale + 70) / 2); }
  news(save, `Season ${save.season}. A new chapter.`, `Driver moves are now active. A fresh car programme and sponsor window have opened. Your staff, facilities, driver development and car foundations carry forward.`, 'board');
  news(save, `${teamsFor(save).find((t) => t.id === rival)!.name} are your rivals this season`, `${principalOf(rival)}’s team is the closest match to yours. Every race compares your points; your drivers each have a duel with theirs.`, 'rival');
  scheduleDecision(save, w);
}

/** Strict optional migration. Missing campaign data stays absent until the owner hub initializes it. */
export function cleanDynasty(raw: unknown): DynastyState | undefined {
  if (!raw || typeof raw !== 'object' || (raw as { v?: number }).v !== 1) return undefined;
  const r = raw as Record<string, unknown>, object = (x: unknown): Record<string, unknown> => x && typeof x === 'object' && !Array.isArray(x) ? x as Record<string, unknown> : {};
  const n = (x: unknown, lo: number, hi: number, fallback: number) => typeof x === 'number' && Number.isFinite(x) ? clamp(x, lo, hi) : fallback;
  const text = (x: unknown, max = 160) => typeof x === 'string' ? x.slice(0, max) : '';
  const plan = object(r.plan), dep = object(r.departments), staff = object(r.staff), rival = object(r.rival);
  const out: DynastyState = { v: 1, confidence: n(r.confidence, 0, 100, 65), reputation: n(r.reputation, 0, 100, 15), fans: Math.floor(n(r.fans, 0, 2e9, 2000)), morale: n(r.morale, 0, 100, 65), insight: Math.floor(n(r.insight, 0, 3, 0)),
    plan: { season: Math.floor(n(plan.season, 1, 9999, 1)), round: Math.floor(n(plan.round, 0, 24, 0)), id: APPROACHES.some((p) => p.id === plan.id) ? plan.id as WeekendApproach : 'balanced' },
    drivers: {}, staff: {}, departments: { laboratory: Math.floor(n(dep.laboratory, 0, 3, 0)), simulator: Math.floor(n(dep.simulator, 0, 3, 0)), commercial: Math.floor(n(dep.commercial, 0, 3, 0)) },
    decisions: [], news: [], achievements: Array.isArray(r.achievements) ? [...new Set(r.achievements.filter((id): id is string => ACHIEVEMENTS.some((a) => a[0] === id)))].slice(0, 10) : [],
    rival: { id: text(rival.id, 40), won: Math.floor(n(rival.won, 0, 24, 0)), lost: Math.floor(n(rival.lost, 0, 24, 0)), tied: Math.floor(n(rival.tied, 0, 24, 0)), streak: Math.floor(n(rival.streak, -24, 24, 0)), tension: n(rival.tension, 0, 100, MEDIA.tension) },
    duels: {}, press: cleanPress(r.press, (id) => !!driverDef(id)), pressLog: [], next: null, followUps: [], seen: text(r.seen, 80),
    settled: text(r.settled, 30), reviewed: Math.floor(n(r.reviewed, 0, 9999, 0)) };
  for (const [id, value] of Object.entries(object(r.duels))) {
    const d = object(value);
    if (driverDef(id) && typeof d.rival === 'string' && driverDef(d.rival)) out.duels[id] = { rival: d.rival, won: Math.floor(n(d.won, 0, 24, 0)), lost: Math.floor(n(d.lost, 0, 24, 0)), streak: Math.floor(n(d.streak, -24, 24, 0)) };
  }
  if (Array.isArray(r.pressLog)) for (const item of r.pressLog.slice(0, MEDIA.log)) {
    const a = object(item); if (!Array.isArray(a.lines)) continue;
    out.pressLog.push({ key: text(a.key, 30), season: Math.floor(n(a.season, 1, 9999, 1)), round: Math.floor(n(a.round, 0, 24, 0)), lines: a.lines.slice(0, 3).map((l) => text(l, 300)) });
  }
  const decision = (x: unknown) => { const d = object(x); return Object.hasOwn(DECISIONS, text(d.id, 30)) ? { id: d.id as DecisionId, ...(typeof d.driver === 'string' && driverDef(d.driver) ? { driver: d.driver } : {}) } : null; };
  const next = decision(r.next);
  if (next) out.next = { key: text(object(r.next).key, 30), ...next };
  if (Array.isArray(r.followUps)) for (const item of r.followUps.slice(0, 8)) {
    const f = decision(item), o = object(item);
    if (f) out.followUps.push({ ...f, season: Math.floor(n(o.season, 1, 9999, 1)), round: Math.floor(n(o.round, 0, 30, 0)) });
  }
  for (const role of ['technical', 'coach', 'engineer'] as const) if (STAFF.some((p) => p.role === role && p.id === staff[role])) out.staff[role] = staff[role] as string;
  for (const [id, value] of Object.entries(object(r.drivers))) if (driverDef(id)) {
    const p = object(value), training = object(p.training);
    out.drivers[id] = { xp: Math.floor(n(p.xp, 0, 500, 0)), pace: Math.floor(n(p.pace, 0, 8, 0)), racecraft: Math.floor(n(p.racecraft, 0, 8, 0)), consistency: Math.floor(n(p.consistency, 0, 8, 0)), morale: n(p.morale, 0, 100, 65) };
    if (TRAINING.some((t) => t.id === training.focus)) out.drivers[id].training = { season: Math.floor(n(training.season, 1, 9999, 1)), round: Math.floor(n(training.round, 0, 23, 0)), focus: training.focus as TrainingFocus };
  }
  if (Array.isArray(r.decisions)) for (const item of r.decisions.slice(0, 80)) {
    const d = object(item); if (!Object.hasOwn(DECISIONS, text(d.template)) || !Number.isInteger(d.choice) || (d.choice as number) < 0 || (d.choice as number) > 2) continue;
    out.decisions.push({ key: text(d.key, 30), template: text(d.template, 30), choice: d.choice as number, season: Math.floor(n(d.season, 1, 9999, 1)), round: Math.floor(n(d.round, 0, 24, 0)), ...(d.auto === true ? { auto: true as const } : {}) });
  }
  if (Array.isArray(r.news)) for (const item of r.news.slice(0, NEWS_KEPT)) {
    const a = object(item); if (!a.title || !NEWS_KINDS.includes(a.kind as TeamNews['kind'])) continue;
    out.news.push({ id: text(a.id, 80), title: text(a.title, 100), body: text(a.body, 300), kind: a.kind as TeamNews['kind'], season: Math.floor(n(a.season, 1, 9999, 1)), round: Math.floor(n(a.round, 0, 24, 0)) });
  }
  return out;
}
