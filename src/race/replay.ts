import type { CarState } from '../car/physics.ts';
import { REPLAY } from '../config/replay.ts';
import type { TimeOfDay } from '../config/track.ts';
import type { Track } from '../track/track.ts';

/**
 * A recorded race, to watch again: every car's pose REPLAY.rate times a
 * second (positions, heading, the ground's pitch and roll, steering and
 * speed, and how far round the race it is), the safety car when it's out,
 * and the moments worth seeing again (the start, passes, crashes, pit stops,
 * retirements, the finish). Kept in memory for the last race only; the
 * replay screen plays it back between the samples.
 */

/** A car in the recording. */
export interface ReplayCar {
  name: string;
  paint: number;
  secondary?: number;
  you: boolean;
}

export type ReplayEventKind = 'start' | 'pass' | 'contact' | 'pit' | 'retire' | 'safetyCar' | 'finish';

/** A moment worth seeing again. */
export interface ReplayEvent {
  /** Race time (s from the start of the recording). */
  t: number;
  kind: ReplayEventKind;
  /** The cars in it (indices into Replay.cars): the first is the one to watch. */
  cars: number[];
  /** How much it matters (passes for the lead and your own car most): for picking highlights. */
  weight: number;
  /** For the caption: the position fought for, the lap. */
  pos?: number;
  lap?: number;
}

export interface Replay {
  track: Track;
  time: TimeOfDay;
  rain: boolean;
  laps: number;
  cars: ReplayCar[];
  /** Samples: REPLAY.fields floats per car per sample; x is NaN when the car isn't on the track. */
  data: Float32Array;
  /** The safety car per sample: x, y, z, heading (x NaN when it isn't out). */
  safetyCar: Float32Array;
  count: number;
  /** Seconds between samples. */
  dt: number;
  events: ReplayEvent[];
}

/** What a car is at one sample (see REPLAY.fields). */
const X = 0, Y = 1, Z = 2, HEADING = 3, PITCH = 4, ROLL = 5, STEER = 6, SPEED = 7, DIST = 8, OUT = 9;

/** One car as the recorder sees it each sample. */
export interface RecordedCar {
  st: CarState;
  /** How far round the race (m), in the race (not retired, not finished), in the pits, on the track at all. */
  dist: number;
  racing: boolean;
  pitting: boolean;
  retired: boolean;
  present: boolean;
  /** Its hardest hit since the last sample (m/s). */
  hit: number;
}

/** Records a race as it's run (fed every REPLAY.everyTicks physics ticks by the race screen). */
export class ReplayRecorder {
  private readonly cars: ReplayCar[];
  private readonly n: number;
  private chunks: Float32Array[] = [];
  private sc: number[] = [];
  private count = 0;
  private readonly events: ReplayEvent[] = [];
  /** Last sample's race order (car indices), who was pitting, retired; when each pair last swapped. */
  private order: number[] = [];
  private wasPitting: boolean[] = [];
  private wasRetired: boolean[] = [];
  private swapped = new Map<string, number>();
  private lastContact: number[] = [];
  private readonly lapLength: number;
  readonly dt: number;

  constructor(cars: ReplayCar[], lapLength: number, tickDt: number) {
    this.cars = cars;
    this.n = cars.length;
    this.lapLength = lapLength;
    this.dt = tickDt * REPLAY.everyTicks;
  }

  /** Seconds recorded so far. */
  get time(): number {
    return this.count * this.dt;
  }

  /** Full: no more samples are kept (REPLAY.maxSeconds). */
  get full(): boolean {
    return this.time >= REPLAY.maxSeconds;
  }

  /** A note: the start (GO), the safety car, or the winner crossing the line (car `car`). */
  mark(kind: 'start' | 'safetyCar' | 'finish', car = 0): void {
    const weight = kind === 'start' ? 10 : kind === 'finish' ? 9 : 6;
    this.events.push({ t: this.time, kind, cars: [car], weight });
  }

  /** One sample of every car (and the safety car's pose, or null). */
  sample(cars: readonly RecordedCar[], safetyCar: { x: number; y: number; z: number; heading: number } | null): void {
    if (this.full) return;
    const F = REPLAY.fields;
    const per = this.n * F;
    const k = this.count % REPLAY.chunk;
    if (k === 0) this.chunks.push(new Float32Array(per * REPLAY.chunk));
    const buf = this.chunks[this.chunks.length - 1];
    const o = k * per;
    for (let i = 0; i < this.n; i++) {
      const c = cars[i], b = o + i * F;
      if (!c || !c.present) {
        buf[b + X] = NaN;
        buf[b + OUT] = c?.retired ? 1 : 0;
        continue;
      }
      const st = c.st;
      buf[b + X] = st.x;
      buf[b + Y] = st.y;
      buf[b + Z] = st.z;
      buf[b + HEADING] = st.heading;
      buf[b + PITCH] = st.pitch;
      buf[b + ROLL] = st.roll;
      buf[b + STEER] = st.steer;
      buf[b + SPEED] = st.speed;
      buf[b + DIST] = c.dist;
      buf[b + OUT] = c.retired ? 1 : 0;
    }
    if (safetyCar) this.sc.push(safetyCar.x, safetyCar.y, safetyCar.z, safetyCar.heading);
    else this.sc.push(NaN, 0, 0, 0);
    this.notice(cars);
    this.count++;
  }

  /** The moments in this sample: passes, hard hits, pit stops, retirements. */
  private notice(cars: readonly RecordedCar[]): void {
    const t = this.time, L = this.lapLength, R = REPLAY;
    const lap = (i: number) => Math.max(1, Math.floor(cars[i].dist / L) + 1);
    const ranked = cars.map((c, i) => ({ i, d: c.retired ? -1e9 + c.dist : c.dist })).sort((a, b) => b.d - a.d).map((x) => x.i);
    const place = new Map(ranked.map((i, p) => [i, p]));
    if (this.order.length) {
      const before = new Map(this.order.map((i, p) => [i, p]));
      for (let p = 0; p < ranked.length; p++) {
        const a = ranked[p], ca = cars[a];
        for (let q = p + 1; q < ranked.length; q++) {
          const b = ranked[q], cb = cars[b];
          // a is ahead of b now and wasn't: a pass, on the track, between cars racing on the same lap.
          if ((before.get(a) ?? 0) <= (before.get(b) ?? 0)) continue;
          if (!ca.racing || !cb.racing || ca.pitting || cb.pitting || this.wasPitting[a] || this.wasPitting[b]) continue;
          if (Math.abs(ca.dist - cb.dist) > R.passReach) continue;
          const key = a < b ? `${a}:${b}` : `${b}:${a}`;
          if (t - (this.swapped.get(key) ?? -Infinity) < R.passDebounce) continue;
          this.swapped.set(key, t);
          const pos = p + 1, you = this.cars[a].you || this.cars[b].you;
          this.events.push({ t, kind: 'pass', cars: [a, b], pos, lap: lap(a), weight: 4 + Math.max(0, 6 - pos) + (you ? 4 : 0) });
        }
      }
    }
    cars.forEach((c, i) => {
      if (c.present && c.hit >= R.contactSpeed && t - (this.lastContact[i] ?? -Infinity) > R.passDebounce) {
        this.lastContact[i] = t;
        this.events.push({ t, kind: 'contact', cars: [i], lap: lap(i), weight: 3 + Math.min(5, c.hit / 4) + (this.cars[i].you ? 3 : 0) });
      }
      if (c.pitting && !this.wasPitting[i]) this.events.push({ t, kind: 'pit', cars: [i], lap: lap(i), pos: (place.get(i) ?? 0) + 1, weight: 2 + (this.cars[i].you ? 2 : 0) });
      if (c.retired && !this.wasRetired[i]) this.events.push({ t, kind: 'retire', cars: [i], lap: lap(i), weight: 5 + (this.cars[i].you ? 3 : 0) });
      this.wasPitting[i] = c.pitting;
      this.wasRetired[i] = c.retired;
    });
    this.order = ranked;
  }

  /** The finished recording. */
  finish(info: { track: Track; time: TimeOfDay; rain: boolean; laps: number }): Replay {
    const per = this.n * REPLAY.fields;
    const data = new Float32Array(this.count * per);
    this.chunks.forEach((c, i) => data.set(c.subarray(0, Math.min(REPLAY.chunk, this.count - i * REPLAY.chunk) * per), i * REPLAY.chunk * per));
    return { ...info, cars: this.cars, data, safetyCar: Float32Array.from(this.sc), count: this.count, dt: this.dt, events: [...this.events].sort((a, b) => a.t - b.t) };
  }
}

/** Wraps an angle into (−π, π]. */
const wrapAngle = (a: number) => a - 2 * Math.PI * Math.round(a / (2 * Math.PI));

/**
 * Car `car` at replay time `t` (s), written into `out` (a CarState, as the car
 * model and the cameras take it). False if it isn't on the track then.
 */
export function poseAt(r: Replay, car: number, t: number, out: CarState): boolean {
  const F = REPLAY.fields, per = r.cars.length * F;
  const f = Math.max(0, Math.min(r.count - 1, t / r.dt));
  const i = Math.floor(f), j = Math.min(r.count - 1, i + 1), u = f - i;
  const a = i * per + car * F, b = j * per + car * F, d = r.data;
  if (Number.isNaN(d[a + X])) return false;
  // (The next sample missing: hold this one.)
  const v = Number.isNaN(d[b + X]) ? 0 : u, bb = Number.isNaN(d[b + X]) ? a : b;
  const lerp = (k: number) => d[a + k] + (d[bb + k] - d[a + k]) * v;
  out.x = lerp(X);
  out.y = lerp(Y);
  out.z = lerp(Z);
  out.heading = d[a + HEADING] + wrapAngle(d[bb + HEADING] - d[a + HEADING]) * v;
  out.pitch = lerp(PITCH);
  out.roll = lerp(ROLL);
  out.steer = lerp(STEER);
  out.speed = lerp(SPEED);
  // (Body lean, from how the car's speed and heading change between samples.)
  const dt = r.dt;
  out.longAccel = (d[bb + SPEED] - d[a + SPEED]) / dt;
  out.latAccel = (wrapAngle(d[bb + HEADING] - d[a + HEADING]) / dt) * out.speed;
  out.vx = Math.cos(out.heading) * out.speed;
  out.vz = Math.sin(out.heading) * out.speed;
  return true;
}

/** How far round the race car `car` is at time `t` (m; −Infinity if it isn't on the track). */
export function distAt(r: Replay, car: number, t: number): number {
  const F = REPLAY.fields, per = r.cars.length * F;
  const i = Math.max(0, Math.min(r.count - 1, Math.round(t / r.dt)));
  const x = r.data[i * per + car * F + X];
  return Number.isNaN(x) ? -Infinity : r.data[i * per + car * F + DIST];
}

/** The race order at time `t` (car indices, the leader first; retired cars after those running, cars not on the track last). */
export function orderAt(r: Replay, t: number): number[] {
  const F = REPLAY.fields, per = r.cars.length * F;
  const k = Math.max(0, Math.min(r.count - 1, Math.round(t / r.dt))) * per;
  const out = (i: number) => r.data[k + i * F + OUT] === 1;
  return r.cars
    .map((_, i) => ({ i, d: distAt(r, i, t), out: out(i) }))
    .sort((a, b) => Number(a.out) - Number(b.out) || b.d - a.d)
    .map((x) => x.i);
}

/** The safety car at time `t`, or null when it isn't out. */
export function safetyCarAt(r: Replay, t: number): { x: number; y: number; z: number; heading: number } | null {
  const i = Math.max(0, Math.min(r.count - 1, Math.round(t / r.dt)));
  const s = r.safetyCar;
  return Number.isNaN(s[i * 4]) ? null : { x: s[i * 4], y: s[i * 4 + 1], z: s[i * 4 + 2], heading: s[i * 4 + 3] };
}

/** A stretch of the race to show in the highlights: from `from` to `to` (s), following `car`. */
export interface Highlight {
  from: number;
  to: number;
  car: number;
  event: ReplayEvent;
}

/**
 * The highlights: the start, then the best moments in race order (the most
 * important first when there are too many), each with a little before and
 * after, overlapping ones merged, and the finish.
 */
export function highlights(r: Replay): Highlight[] {
  const R = REPLAY, end = r.count * r.dt;
  // The start and the finish always; the weightiest of the rest in the room left.
  const always = (e: ReplayEvent) => e.kind === 'start' || e.kind === 'finish';
  const fixed = r.events.filter(always);
  const rest = r.events.filter((e) => !always(e)).sort((a, b) => b.weight - a.weight).slice(0, Math.max(0, R.maxHighlights - fixed.length));
  const pick = [...fixed, ...rest].sort((a, b) => a.t - b.t);
  const out: Highlight[] = [];
  for (const e of pick) {
    const span = e.kind === 'start' ? R.startSpan : e.kind === 'finish' ? R.finishSpan : R.span;
    const from = Math.max(0, e.t - span[0]), to = Math.min(end, e.t + span[1]);
    const last = out[out.length - 1];
    if (last && from <= last.to + 0.5) last.to = Math.max(last.to, to);
    else out.push({ from, to, car: e.cars[0], event: e });
  }
  return out;
}
