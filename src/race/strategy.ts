import { compoundLife } from '../car/tyres.ts';
import { HANDLING } from '../config/handling.ts';
import { AI, CONDITIONS, DEFAULT_SETUP, PIT_LANE, SETUP, TYRES, WEATHER, type CarSetup, type Compound, type WingLevel } from '../config/race.ts';
import { clamp } from '../core/math.ts';
import { pitLane } from '../track/pitLane.ts';
import type { Track } from '../track/track.ts';
import { planLapTime, racingLine, roadPace, speedProfile, type Pace } from './racingLine.ts';

const works = new WeakMap<Track, number>();

/**
 * How hard a lap of `track` works the tyres: the speed turned through in the
 * bends (Σ v·|dθ|) plus the speed shed under braking, on the racing line
 * flat out. Longer tracks and more and faster bends work them harder.
 * Worked out once per track.
 */
export function trackWork(track: Track): number {
  const known = works.get(track);
  if (known !== undefined) return known;
  const line = racingLine(track);
  const top = AI.pace[AI.pace.length - 1];
  const plan = speedProfile(track, line, { grip: top[0], maxSpeed: HANDLING.maxSpeed * top[1], brake: top[2] });
  const n = plan.speed.length;
  let work = 0;
  for (let i = 0; i < n; i++) {
    work += plan.speed[i] * Math.abs(line.curvature[i]) * line.ds[i];
    work += Math.max(0, plan.speed[i] - plan.speed[(i + 1) % n]);
  }
  works.set(track, work);
  return work;
}

/** Laps medium tyres last on `track` before they go off: TYRES.lifeEasy on an easy track down to lifeHard on a hard one. */
export function trackTyreLife(track: Track): number {
  const T = TYRES;
  const hard = clamp((trackWork(track) - T.workEasy) / (T.workHard - T.workEasy), 0, 1);
  return T.lifeEasy + (T.lifeHard - T.lifeEasy) * hard;
}

/**
 * About how much time a pit stop costs on `track` (s): the service, slowing
 * for it and getting going again, and (with a pit lane) the stretch at the
 * speed limit instead of flat out.
 */
export function pitLoss(track: Track): number {
  const lane = pitLane(track);
  const slow = lane ? (lane.wallTo - lane.wallFrom) * (1 / PIT_LANE.limit - 1 / (HANDLING.maxSpeed * 0.85)) : 0;
  return CONDITIONS.service + CONDITIONS.pitLossExtra + slow;
}

/** The kind of tyres an AI prefers for a stint that won't reach the finish (by grid slot: a mix in the field). */
export function preferredCompound(slot: number): Compound {
  return (['medium', 'hard', 'soft'] as const)[slot % 3];
}

/** From this wet (0..1) the wets are the quicker tyres, and from INTER_FROM the intermediates (about where they cross; see TYRES.compounds). */
export const WET_FROM = WEATHER.wetFrom;
export const INTER_FROM = WEATHER.interFrom;

/** Which kind of tyre for the weather: slicks (soft, medium, hard), intermediates or wets. */
export type TyreBand = 'slick' | 'inter' | 'wet';
const RANK: Record<TyreBand, number> = { slick: 0, inter: 1, wet: 2 };
export const bandOf = (c: Compound): TyreBand => (c === 'inter' || c === 'wet' ? c : 'slick');
/** Intermediates or wets: tyres for a wet road. */
export const wetWeatherTyre = (c: Compound): boolean => bandOf(c) !== 'slick';
/** The tyres for a road `wetness` wet, by where they cross over. */
export const bandFor = (wetness: number): TyreBand => (wetness >= WET_FROM ? 'wet' : wetness >= INTER_FROM ? 'inter' : 'slick');
/** Whether band `a` is for a wetter road than `b`. */
export const wetterBand = (a: TyreBand, b: TyreBand): boolean => RANK[a] > RANK[b];

/**
 * The tyres a car on `current` should be on for a road `wetness` wet: a
 * wetter kind once the road is WEATHER.hysteresis past the crossover, a
 * drier one once it's that far back the other way (so nobody flip-flops).
 * `bias` is a gamble: + goes to wetter tyres sooner and back later.
 */
export function tyreBand(current: TyreBand, wetness: number, bias = 0): TyreBand {
  const w = wetness + bias;
  const up = bandFor(w - WEATHER.hysteresis);
  if (RANK[up] > RANK[current]) return up;
  const down = bandFor(w + WEATHER.hysteresis);
  if (RANK[down] < RANK[current]) return down;
  return current;
}

/**
 * The tyres to fit for `lapsLeft` laps: intermediates or wets on a wet road
 * (by where they cross over); in the dry the quickest kind that lasts to the
 * finish (going off at most CONDITIONS.pitEndSlack laps before it), else
 * `preference` (there will be another stop anyway).
 */
export function pickCompound(lapsLeft: number, mediumLife: number, wetness: number, preference: Compound): Compound {
  const band = bandFor(wetness);
  if (band !== 'slick') return band;
  for (const c of ['soft', 'medium', 'hard'] as const) if (compoundLife(c, 0, mediumLife) + CONDITIONS.pitEndSlack >= lapsLeft) return c;
  return wetWeatherTyre(preference) ? 'medium' : preference;
}

/**
 * The two-compound rule (a championship's Grands Prix in the dry): met once a
 * car has raced on two different dry compounds, or on intermediates or wets at all.
 */
export function compoundsMet(used: readonly Compound[]): boolean {
  return used.some(wetWeatherTyre) || new Set(used).size >= 2;
}

/**
 * The tyres for a stop under the two-compound rule: `want`, unless the rule
 * isn't met yet and `want` is the kind already run. Then another dry kind:
 * the quickest that lasts the `lapsLeft` laps, else the longest-lasting.
 */
export function ruleCompound(want: Compound, used: readonly Compound[], lapsLeft: number, mediumLife: number): Compound {
  if (wetWeatherTyre(want) || compoundsMet(used) || !used.includes(want)) return want;
  const others = (['soft', 'medium', 'hard'] as const).filter((c) => !used.includes(c));
  const lasts = others.find((c) => compoundLife(c, 0, mediumLife) + CONDITIONS.pitEndSlack >= lapsLeft);
  return lasts ?? others[others.length - 1] ?? want;
}

/**
 * When the two-compound rule makes a car stop that wouldn't otherwise: once
 * the race is about half run (give or take `early` laps), with at least a
 * lap and a half to go.
 */
export function ruleStopDue(lapsLeft: number, lapsToRun: number, early = 0): boolean {
  return lapsLeft >= CONDITIONS.pitMinLaps + 0.5 && lapsLeft <= lapsToRun * 0.5 + early;
}

const wingLaps = new WeakMap<Track, Record<WingLevel, number>>();

/** The flat-out planned lap on `track` with each wing (s): low wing wins where the straights are long, high where the bends are fast. */
export function wingLapTimes(track: Track): Record<WingLevel, number> {
  const known = wingLaps.get(track);
  if (known) return known;
  const line = racingLine(track);
  const top = AI.pace[AI.pace.length - 1];
  const base: Pace = roadPace({ grip: top[0], maxSpeed: HANDLING.maxSpeed * top[1], brake: top[2] }, track);
  const lap = (w: WingLevel) => planLapTime(line, speedProfile(track, line, { ...base, downforce: SETUP.wing[w].downforce, drag: SETUP.wing[w].drag }));
  const times = { low: lap('low'), medium: lap('medium'), high: lap('high') };
  wingLaps.set(track, times);
  return times;
}

/** The quickest wing for `track` (ties go to medium). */
export function bestWing(track: Track): WingLevel {
  const t = wingLapTimes(track);
  let best: WingLevel = 'medium';
  for (const w of ['low', 'high'] as const) if (t[w] < t[best] - 0.02) best = w;
  return best;
}

/** The setup the AI teams run on `track` (and the one suggested to you): the quickest wing, standard gears and brakes. */
export function suggestedSetup(track: Track): CarSetup {
  return { ...DEFAULT_SETUP, wing: bestWing(track) };
}

const lapTimes = new WeakMap<Track, number>();

/** About how long a lap of `track` takes in a race (s): the medal pace's planned lap. */
export function trackLapTime(track: Track): number {
  const known = lapTimes.get(track);
  if (known !== undefined) return known;
  const line = racingLine(track);
  const p = AI.pace[3];
  const t = planLapTime(line, speedProfile(track, line, roadPace({ grip: p[0], maxSpeed: HANDLING.maxSpeed * p[1], brake: p[2] }, track)));
  lapTimes.set(track, t);
  return t;
}
