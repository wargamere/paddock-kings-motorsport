import { AI, DRS, SETUP } from '../config/race.ts';
import { HANDLING } from '../config/handling.ts';
import type { Track } from '../track/track.ts';
import { racingLine, roadPace, speedProfile } from './racingLine.ts';

/** A DRS zone: from `from` to `to` m along the track (it may run over the line), detected `detect` m along. */
export interface DrsZone {
  from: number;
  to: number;
  detect: number;
}

const zoneCache = new WeakMap<Track, DrsZone[]>();

/** Distance from `a` forward to `b` round a lap of `L` m (0..L). */
const ahead = (a: number, b: number, L: number) => (((b - a) % L) + L) % L;

/**
 * The track's DRS zones: its longest straights, taken flat out by the
 * quickest AI with a medium wing (no bend slows it), at most DRS.maxZones,
 * each of at least DRS.minLength m once trimmed to start a little after the
 * bend before and end before the braking for the next.
 */
export function drsZones(track: Track): DrsZone[] {
  const known = zoneCache.get(track);
  if (known) return known;
  const c = track.center;
  const L = c.length;
  const n = c.points.length;
  const line = racingLine(track);
  const top = AI.pace[AI.pace.length - 1];
  const pace = roadPace({ grip: top[0], maxSpeed: HANDLING.maxSpeed * top[1], brake: top[2] }, track);
  const plan = speedProfile(track, line, { ...pace, downforce: SETUP.wing.medium.downforce, drag: SETUP.wing.medium.drag });
  // (Nearly) flat out: nothing ahead holds the car much below its top speed.
  const flat = (i: number) => plan.limit[i] >= pace.maxSpeed * DRS.flat;
  // Runs of flat-out samples, joined over the line.
  const first = Array.from({ length: n }, (_, i) => i).find((i) => !flat(i));
  if (first === undefined) {
    zoneCache.set(track, []);
    return [];
  }
  const runs: { from: number; length: number }[] = [];
  let start = -1;
  for (let k = 1; k <= n; k++) {
    const i = (first + k) % n;
    if (flat(i) && start < 0) start = i;
    if ((!flat(i) || k === n) && start >= 0) {
      const end = flat(i) ? i : (i - 1 + n) % n;
      runs.push({ from: c.dist[start], length: ahead(c.dist[start], c.dist[end], L) + c.spacing });
      start = -1;
    }
  }
  const trimmed = runs.map((r) => ({ from: r.from + DRS.startAfter, length: r.length - DRS.startAfter - DRS.endBefore })).sort((a, b) => b.length - a.length);
  const long = trimmed.filter((r) => r.length >= DRS.minLength);
  // (Every track has one: its longest straight, if it's long enough at all.)
  const picked = long.length ? long : trimmed.filter((r) => r.length >= DRS.shortest).slice(0, 1);
  const zones = picked
    .slice(0, DRS.maxZones)
    .map((r) => {
      const from = ((r.from % L) + L) % L;
      return { from, to: (from + r.length) % L, detect: (((from - DRS.detect) % L) + L) % L };
    })
    .sort((a, b) => a.from - b.from);
  zoneCache.set(track, zones);
  return zones;
}

/** Whether `s` is within zone `z` (round a lap of `L` m). */
export function inZone(z: DrsZone, s: number, L: number): boolean {
  return ahead(z.from, s, L) <= ahead(z.from, z.to, L);
}

/**
 * Race control's DRS: which car may open its flap where. Each tick it's told
 * where every car is; a car crossing a zone's detection point within DRS.gap s
 * of the car that crossed it before is cleared for that zone until it leaves
 * it. Only while `enabled` (from the second lap, dry, no safety car).
 */
export class DrsControl {
  readonly zones: DrsZone[];
  private readonly length: number;
  /** Per car: where it was on the last tick (NaN: not seen yet), and the zone it's cleared for (-1: none). */
  private readonly lastS: Float64Array;
  private readonly cleared: Int8Array;
  /** Per zone: when the last car crossed its detection point, and which car. */
  private readonly crossed: { time: number; car: number }[];
  enabled = false;

  constructor(track: Track, cars: number) {
    this.zones = drsZones(track);
    this.length = track.center.length;
    this.lastS = new Float64Array(cars).fill(NaN);
    this.cleared = new Int8Array(cars).fill(-1);
    this.crossed = this.zones.map(() => ({ time: -Infinity, car: -1 }));
  }

  /** Car `car` is at `s` (m along the track) at race time `time` (s). Call every tick for every car on the track. */
  update(car: number, s: number, time: number): void {
    const L = this.length;
    const prev = this.lastS[car];
    this.lastS[car] = s;
    if (Number.isNaN(prev)) return;
    const moved = ahead(prev, s, L);
    if (moved <= 0 || moved > L / 2) return;
    // Over point `x` this tick (from just past `prev` up to `s`)?
    const over = (x: number) => {
      const d = ahead(prev, x, L);
      return d > 0 && d <= moved;
    };
    // Past the end of the zone it was cleared for: cleared no longer.
    const z = this.cleared[car];
    if (z >= 0 && over(this.zones[z].to)) this.cleared[car] = -1;
    this.zones.forEach((zone, k) => {
      // Over the detection point: within the gap of the car that crossed it before?
      if (!over(zone.detect)) return;
      const last = this.crossed[k];
      this.cleared[car] = this.enabled && last.car !== car && time - last.time <= DRS.gap ? k : -1;
      this.crossed[k] = { time, car };
    });
  }

  /** Car `car` may open DRS where it is now. */
  available(car: number, s: number): boolean {
    const z = this.cleared[car];
    return this.enabled && z >= 0 && inZone(this.zones[z], s, this.length);
  }

  /** Car `car` is cleared for a zone it hasn't reached the end of (for the HUD: DRS ready). */
  armed(car: number): boolean {
    return this.enabled && this.cleared[car] >= 0;
  }

  /** A car taken off the track, or put back on it somewhere else: it starts afresh. */
  forget(car: number): void {
    this.lastS[car] = NaN;
    this.cleared[car] = -1;
  }
}
