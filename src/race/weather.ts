import { WEATHER } from '../config/race.ts';
import type { Weather as WeatherKind } from '../core/screen.ts';

/** A change in the weather: from `t` s into the run, rain this hard (0 dry … 1 heavy). */
interface Change {
  t: number;
  rain: number;
}

/**
 * The weather through a run, and how wet the road is. Dry stays dry and
 * rain stays rain; changing weather starts dry, then a shower comes at a
 * random point in the race: a drizzle that leaves the road damp (for
 * intermediates) or heavy rain that soaks it (for wets), often getting
 * heavier or easing part-way through, and maybe stopping again; in practice
 * it changes every few minutes. The road gets as wet as the rain makes it
 * and dries out after, the racing line first (the cars clear it), so for a
 * while there's a dry line on a damp track. Deterministic for a given
 * random source.
 */
export class Weather {
  readonly kind: WeatherKind;
  /** How hard it's raining now (0..1). */
  rain: number;
  /** How wet the road is on the racing line and off it (0..1). */
  lineWet: number;
  offWet: number;
  /** Seconds into the run. */
  time = 0;
  private readonly changes: Change[] = [];
  private target: number;
  private readonly rand: () => number;
  /** In practice: when the next change is generated from. */
  private readonly practice: boolean;

  /** `raceSeconds`: about how long the race lasts (Infinity: practice, changing every few minutes). */
  constructor(kind: WeatherKind, raceSeconds: number, rand: () => number = Math.random) {
    this.kind = kind;
    this.rand = rand;
    const wet = kind === 'rain' ? 1 : 0;
    this.rain = this.target = this.lineWet = this.offWet = wet;
    this.practice = !Number.isFinite(raceSeconds);
    if (kind !== 'changing') return;
    const W = WEATHER;
    if (this.practice) this.planPractice(0);
    else {
      const between = (a: number, b: number) => raceSeconds * (a + (b - a) * rand());
      const start = between(W.rainFrom, W.rainTo);
      const first = this.strength();
      this.changes.push({ t: start, rain: first });
      const stops = rand() < W.stopChance;
      const end = stops ? between(W.stopFrom, W.stopTo) : raceSeconds;
      // Part-way through the shower: heavier (a drizzle) or easing (heavy rain).
      if (rand() < W.shiftChance && end > start + 2 * W.rainRamp) {
        const shifted = first < (1 + W.rainMin) / 2 ? Math.min(1, first + W.shiftBy + (1 - first - W.shiftBy) * rand()) : Math.max(W.rainMin, first - W.shiftBy - (first - W.shiftBy - W.rainMin) * rand());
        this.changes.push({ t: start + (end - start) * (0.35 + 0.3 * rand()), rain: shifted });
      }
      if (stops) this.changes.push({ t: end, rain: 0 });
    }
  }

  /** How hard a shower is: between WEATHER.rainMin and 1. */
  private strength(): number {
    return WEATHER.rainMin + (1 - WEATHER.rainMin) * this.rand();
  }

  /** Practice: the next change after `from` s: rain if it was dry, dry if it was raining. */
  private planPractice(from: number): void {
    const W = WEATHER;
    const last = this.changes.length ? this.changes[this.changes.length - 1].rain : this.target;
    const t = from + W.practiceMin + (W.practiceMax - W.practiceMin) * this.rand();
    this.changes.push({ t, rain: last > 0 ? 0 : this.strength() });
  }

  /** Moves the weather on by `dt` s. */
  step(dt: number): void {
    if (this.kind !== 'changing') return;
    const W = WEATHER;
    this.time += dt;
    while (this.changes.length && this.changes[0].t <= this.time) {
      const c = this.changes.shift();
      if (!c) break;
      this.target = c.rain;
      if (this.practice) this.planPractice(c.t);
    }
    // Rain comes in, or eases off, over a little while.
    const ramp = dt / W.rainRamp;
    this.rain = this.target > this.rain ? Math.min(this.target, this.rain + ramp) : Math.max(this.target, this.rain - ramp);
    // The road gets wet as fast as it rains; it dries on its own, the line first.
    const toward = (w: number, tau: number) => w + (this.rain - w) * (1 - Math.exp(-dt / tau));
    this.lineWet = this.rain > this.lineWet ? toward(this.lineWet, W.wetting) : toward(this.lineWet, W.dryingLine);
    this.offWet = this.rain > this.offWet ? toward(this.offWet, W.wetting) : toward(this.offWet, W.dryingOff);
  }

  /** How wet the road is `off` m from the racing line. */
  wetnessAt(off: number): number {
    const W = WEATHER;
    const k = Math.min(1, Math.max(0, (Math.abs(off) - W.lineHalf) / W.lineBlend));
    return this.lineWet + (this.offWet - this.lineWet) * k;
  }

  /** The next change if it's within the forecast (WEATHER.forecast s): rain coming (and how hard), stopping, getting heavier or easing. */
  forecast(): { to: 'rain' | 'dry' | 'heavier' | 'lighter'; in: number; rain: number } | null {
    const c = this.changes[0];
    if (!c || c.t - this.time > WEATHER.forecast || Math.abs(c.rain - this.target) < 0.05) return null;
    const to = this.target === 0 ? 'rain' : c.rain === 0 ? 'dry' : c.rain > this.target ? 'heavier' : 'lighter';
    return { to, in: Math.max(0, c.t - this.time), rain: c.rain };
  }

  /** How hard it's raining, in words: 0 dry, 1 drizzle, 2 rain, 3 heavy rain. */
  static level(rain: number): 0 | 1 | 2 | 3 {
    return rain > 0.8 ? 3 : rain > 0.5 ? 2 : rain > 0.05 ? 1 : 0;
  }
}
