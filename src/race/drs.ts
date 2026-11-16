import { AI, DRS, DRS_CUSTOM, DRS_REAL, SETUP } from '../config/race.ts';
import { HANDLING } from '../config/handling.ts';
import { roadDistance, type DrsMark } from '../track/extras.ts';
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

/** A zone from `from` m for `length` m, detected DRS.detect m before it. */
function zoneAt(from: number, length: number, L: number): DrsZone {
  const f = ((from % L) + L) % L;
  return { from: f, to: (f + length) % L, detect: (((f - DRS.detect) % L) + L) % L };
}

/**
 * The track's straights: runs of road where nothing ahead holds the quickest
 * AI (medium wing) below `flat` of its top speed, joined over the line, each
 * trimmed to start DRS.startAfter m past the bend before and end DRS.endBefore
 * m before the braking for the next; longest first.
 */
function straights(track: Track, flatFrac: number): { from: number; length: number }[] {
  const c = track.center;
  const L = c.length;
  const n = c.points.length;
  const line = racingLine(track);
  const top = AI.pace[AI.pace.length - 1];
  const pace = roadPace({ grip: top[0], maxSpeed: HANDLING.maxSpeed * top[1], brake: top[2] }, track);
  const plan = speedProfile(track, line, { ...pace, downforce: SETUP.wing.medium.downforce, drag: SETUP.wing.medium.drag });
  const flat = (i: number) => plan.limit[i] >= pace.maxSpeed * flatFrac;
  const first = Array.from({ length: n }, (_, i) => i).find((i) => !flat(i));
  if (first === undefined) return [];
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
  return runs.map((r) => ({ from: r.from + DRS.startAfter, length: r.length - DRS.startAfter - DRS.endBefore })).sort((a, b) => b.length - a.length);
}

/** Zones drawn in the editor: each from the road nearest its start forwards to the road nearest its end. */
function drawnZones(track: Track, marks: readonly DrsMark[]): DrsZone[] {
  const c = track.center;
  const L = c.length;
  const out: DrsZone[] = [];
  for (const m of marks.slice(0, DRS_CUSTOM.max)) {
    const a = roadDistance(track, m.x, m.y);
    const b = roadDistance(track, m.x2, m.y2);
    const length = ahead(c.dist[a.i], c.dist[b.i], L);
    if (length >= DRS_CUSTOM.shortest) out.push(zoneAt(c.dist[a.i], length, L));
  }
  return out;
}

/**
 * A real circuit's zones, where they are in the real world (DRS_REAL): for
 * each, the straight nearest that point of the lap (each straight used once).
 */
function realZones(track: Track, at: readonly number[]): DrsZone[] {
  const L = track.center.length;
  const runs = straights(track, DRS_REAL.flat).filter((r) => r.length >= DRS_REAL.shortest);
  const used = new Set<number>();
  const out: DrsZone[] = [];
  for (const f of at) {
    const s = f * L;
    // How far the point is from the straight (0 if it's on it).
    const off = (r: { from: number; length: number }) => {
      const into = ahead(r.from, s, L);
      return into <= r.length ? 0 : Math.min(into - r.length, L - into);
    };
    let best = -1;
    runs.forEach((r, k) => {
      if (!used.has(k) && off(r) <= DRS_REAL.reach * L && (best < 0 || off(r) < off(runs[best]))) best = k;
    });
    if (best < 0) continue;
    used.add(best);
    out.push(zoneAt(runs[best].from, runs[best].length, L));
  }
  return out;
}

/**
 * The track's DRS zones: the ones drawn on it in the editor if there are any;
 * on a real circuit, where its real ones are (DRS_REAL); otherwise its
 * longest straights, at most DRS.maxZones, each at least DRS.minLength m
 * (every track gets its longest straight of at least DRS.shortest m).
 */
export function drsZones(track: Track): DrsZone[] {
  const known = zoneCache.get(track);
  if (known) return known;
  const L = track.center.length;
  let zones: DrsZone[] = [];
  const marks = track.def.extras?.drs;
  const real = DRS_REAL.zones[track.def.id];
  if (marks?.length) zones = drawnZones(track, marks);
  else if (real) zones = realZones(track, real);
  if (!zones.length && !marks?.length) {
    const trimmed = straights(track, DRS.flat);
    const long = trimmed.filter((r) => r.length >= DRS.minLength);
    const picked = long.length ? long : trimmed.filter((r) => r.length >= DRS.shortest).slice(0, 1);
    zones = picked.slice(0, DRS.maxZones).map((r) => zoneAt(r.from, r.length, L));
  }
  zones.sort((a, b) => a.from - b.from);
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
