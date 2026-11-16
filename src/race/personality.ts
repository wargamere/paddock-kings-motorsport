import { PERSONALITY } from '../config/race.ts';
import { hashString, rng } from '../core/random.ts';

/** An AI driver's character: see PERSONALITY. */
export interface Personality {
  /** −1 defensive … +1 aggressive. */
  style: number;
  /** −1 struggles in the wet … +1 a rain master. */
  rain: number;
  /** −1 hard on the tyres … +1 easy on them. */
  tyres: number;
  /** 0 erratic … 1 a metronome. */
  consistency: number;
}

/** The traits a driver is known for. */
export type Trait = 'aggressive' | 'defensive' | 'rainMaster' | 'poorInRain' | 'tyreWhisperer' | 'hardOnTyres' | 'erratic' | 'metronome';

/** A value in −1..1: a quarter of drivers past either end's trait (PERSONALITY.traitFrom). */
const axis = (u: number) => (u * 2 - 1) * 0.9;

/** A driver's personality, the same every race: from `key` (a championship driver's id, else the name). */
export function personalityFor(key: string): Personality {
  const r = rng(hashString(`personality:${key}`));
  return { style: axis(r()), rain: axis(r()), tyres: axis(r()), consistency: 0.4 + 0.6 * r() };
}

/** The traits a personality shows (the strongest first). */
export function traits(p: Personality): Trait[] {
  const T = PERSONALITY.traitFrom;
  const out: [Trait, number][] = [];
  if (p.style >= T) out.push(['aggressive', p.style]);
  if (p.style <= -T) out.push(['defensive', -p.style]);
  if (p.rain >= T) out.push(['rainMaster', p.rain]);
  if (p.rain <= -T) out.push(['poorInRain', -p.rain]);
  if (p.tyres >= T) out.push(['tyreWhisperer', p.tyres]);
  if (p.tyres <= -T) out.push(['hardOnTyres', -p.tyres]);
  if (p.consistency < 0.55) out.push(['erratic', (0.55 - p.consistency) * 5]);
  if (p.consistency > 0.9) out.push(['metronome', (p.consistency - 0.9) * 10]);
  return out.sort((a, b) => b[1] - a[1]).map(([t]) => t);
}

/** The kinds of mistake an AI driver makes. */
export type MistakeKind = 'lockup' | 'wide' | 'spin';
