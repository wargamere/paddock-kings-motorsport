import { CONDITIONS, DAMAGE, ENGINEER, type Compound } from '../config/race.ts';
import { STR, fmt } from '../config/strings.ts';
import { compoundsMet, pickCompound, ruleCompound, ruleStopDue, WET_FROM } from './strategy.ts';
import type { Trait } from './personality.ts';

/** A car next to you in the race, as your engineer sees it. */
export interface EngineerCar {
  /** Which car (stays the same all race). */
  id: number;
  name: string;
  /** Gap to you (s), always positive; null when not timed yet. */
  gap: number | null;
  pitting: boolean;
  stops: number;
  /** What the driver is known for (an AI's personality; none for player 2). */
  traits?: readonly Trait[];
}

/** What your engineer knows of the race (taken from the race screen a few times a second). */
export interface EngineerView {
  /** Race time (s since GO). */
  time: number;
  /** Laps done, laps in the race, laps (and part laps) still to go. */
  lapsDone: number;
  lapsToRun: number;
  lapsLeft: number;
  /** Your place (1 = leading), where you started, and how many cars there are (1: you're alone). */
  pos: number;
  startPos: number;
  cars: number;
  ahead: EngineerCar | null;
  behind: EngineerCar | null;
  /** In the pit lane (or stopped in the box), and the stops made. */
  pitting: boolean;
  stops: number;
  /** Tyres (null without tyre wear): the kind, share of their life left, laps they've left at this rate, a medium's life here, the road's wetness. */
  tyres: { compound: Compound; left: number; lapsLeft: number; mediumLife: number; wetness: number } | null;
  /** Damage 0..1 (null: no damage in this race). */
  damage: number | null;
  /** The weather to come: rain or dry in `in` s. */
  forecast: { to: 'rain' | 'dry'; in: number } | null;
  /** The safety car, and how many times it has been out. */
  safetyCar: 'none' | 'out' | 'in';
  safetyCarCount: number;
  /** The two-compound rule, if it's in force: the kinds of tyre you've run so far. */
  rule?: { used: readonly Compound[] } | null;
  /** DRS is enabled (from the second lap, in the dry, with no safety car). */
  drs?: boolean;
  /** The race has the overtake boost: the key (or button) that works it. */
  boostKey?: string;
}

/** A radio message. `urgent`: a call to act on now (box, the safety car, the weather). */
export interface RadioCall {
  text: string;
  urgent: boolean;
}

/** Why you'd stop now: worn tyres, the weather, damage; and the tyres to fit. */
export interface StopCall {
  reason: 'tyres' | 'rain' | 'dry' | 'damage' | 'rule';
  tyres: Compound | null;
}

interface Pending {
  key: string;
  call: RadioCall;
  at: number;
}

/**
 * Your race engineer: watches your race and talks to you on the radio. When
 * to box and for which tyres (worn tyres, rain, a drying track, damage, a
 * cheap stop under the safety car), the plan for the stop ahead, a rival
 * pitting just ahead or behind (the undercut), the gaps each lap, the start,
 * the last lap and the result. Each thing is said once (a box call once a
 * lap until you come in), and never two at once.
 *
 * Plain logic: the race screen feeds it an EngineerView and shows what it says.
 */
export class RaceEngineer {
  private readonly said = new Set<string>();
  private queue: Pending[] = [];
  private lastTalk = -Infinity;
  /** Last lap's gaps ahead and behind (to say whether they're closing). */
  private lastAhead: { id: number; gap: number } | null = null;
  private lastBehind: { id: number; gap: number } | null = null;
  private prev: EngineerView | null = null;
  /** The lap the box call was first made on (it's made again each lap after, until you come in). */
  private boxLap = 0;
  /** The tyres your engineer wants on at the next stop (the pit crew has them ready). */
  plan: Compound | null = null;

  /** The two-compound rule is in force and not met yet. */
  private static owed(v: EngineerView): boolean {
    return !!v.rule && !compoundsMet(v.rule.used);
  }

  /** The tyres for a stint of `laps` laps from now: what lasts it (wets in the wet), and under the two-compound rule a second dry kind. */
  static tyresFor(v: EngineerView, laps: number, wetness: number): Compound | null {
    const t = v.tyres;
    if (!t) return null;
    const c = pickCompound(laps, t.mediumLife, wetness, 'medium');
    return v.rule ? ruleCompound(c, v.rule.used, laps, t.mediumLife) : c;
  }

  /** Whether you should come in now, and for what (null: stay out). */
  static stopCall(v: EngineerView): StopCall | null {
    const C = CONDITIONS;
    const t = v.tyres;
    if (v.lapsLeft < C.pitMinLaps || v.pitting) return null;
    const tyresFor = (wetness: number) => RaceEngineer.tyresFor(v, v.lapsLeft, wetness);
    if (t) {
      const wet = t.wetness >= WET_FROM;
      if (wet && t.compound !== 'wet') return { reason: 'rain', tyres: 'wet' };
      // (Slicks once the line is well dry: a little drier than wets need.)
      if (!wet && t.compound === 'wet' && t.wetness < WET_FROM * 0.6) return { reason: 'dry', tyres: tyresFor(0) };
    }
    if (v.damage !== null && v.damage >= DAMAGE.aiPitAt) return { reason: 'damage', tyres: t ? tyresFor(t.wetness) : null };
    if (t && t.lapsLeft < 1 + ENGINEER.boxEarly && v.lapsLeft > t.lapsLeft + C.pitEndSlack) return { reason: 'tyres', tyres: tyresFor(t.wetness) };
    if (t && RaceEngineer.owed(v) && ruleStopDue(v.lapsLeft, v.lapsToRun)) return { reason: 'rule', tyres: tyresFor(t.wetness) };
    return null;
  }

  /** Laps until the next stop (Infinity: the tyres last the race and none is owed, or there's no wear). */
  private static stopIn(v: EngineerView): number {
    const t = v.tyres;
    if (!t) return Infinity;
    const worn = v.lapsLeft <= t.lapsLeft + CONDITIONS.pitEndSlack ? Infinity : Math.max(0, t.lapsLeft - 1 - ENGINEER.boxEarly);
    // (The two-compound rule: a stop about half-way, if it's not too late.)
    const rule = RaceEngineer.owed(v) && v.lapsLeft >= CONDITIONS.pitMinLaps + 0.5 ? Math.max(0, v.lapsLeft - v.lapsToRun * 0.5) : Infinity;
    return Math.min(worn, rule);
  }

  /** Something to say: kept until it can be (or it's stale). Each key is said once. */
  private want(key: string, text: string, urgent: boolean, now: number): void {
    if (this.said.has(key) || this.queue.some((p) => p.key === key)) return;
    this.queue.push({ key, call: { text, urgent }, at: now });
  }

  /** Called a few times a second during the race; returns what to say now, if anything. */
  update(v: EngineerView): RadioCall | null {
    const E = ENGINEER, R = STR.engineer, now = v.time, p = this.prev;
    const t = v.tyres;
    const stint = v.stops;
    const tyres = (c: Compound | null) => (c ? R.tyres[c] : '');

    // The start: how it went, once it has settled down.
    if (v.cars > 1 && now >= E.startAfter && v.lapsDone === 0) {
      const d = v.startPos - v.pos;
      this.want('start', d > 0 ? fmt(R.startGained, { n: d, pos: v.pos }) : d < 0 ? fmt(R.startLost, { n: -d, pos: v.pos }) : fmt(R.startHeld, { pos: v.pos }), false, now);
    }

    // The two-compound rule: a reminder at the start, and a warning once it's too late.
    if (RaceEngineer.owed(v)) {
      if (v.lapsDone === 0 && now >= E.ruleAfter) this.want('rule', R.ruleReminder, false, now);
      if (!v.pitting && v.lapsLeft < CONDITIONS.pitMinLaps + 0.5) this.want('ruleMissed', R.ruleMissed, true, now);
    }

    // The boost, at the start: how to use it.
    if (v.boostKey && v.cars > 1 && now >= E.boostAfter) this.want('boost', fmt(R.boostTip, { key: v.boostKey }), false, now);

    // DRS enabled.
    if (v.drs && !p?.drs && v.cars > 1) this.want('drs', R.drsOn, false, now);

    // The weather to come.
    if (v.forecast && v.lapsLeft > 0.5) {
      const s = Math.max(5, Math.round(v.forecast.in / 5) * 5);
      this.want(`forecast:${v.forecast.to}:${Math.round((now + v.forecast.in) / 30)}`, fmt(v.forecast.to === 'rain' ? R.rainComing : R.dryComing, { s }), false, now);
    }

    // The safety car: out (a cheap stop, if one is due soon), and in.
    if (v.safetyCar === 'out' && p?.safetyCar !== 'out') {
      const cheap = t && !v.pitting && v.lapsLeft >= 2 && t.left < E.scStopBelow && RaceEngineer.stopIn(v) < Infinity;
      if (cheap) {
        this.plan = RaceEngineer.tyresFor(v, v.lapsLeft, t.wetness);
        this.want(`sc:${v.safetyCarCount}`, fmt(R.scBox, { tyres: tyres(this.plan) }), true, now);
      } else this.want(`sc:${v.safetyCarCount}`, R.scOut, true, now);
    }
    if (v.safetyCar === 'in' && p?.safetyCar === 'out') this.want(`scIn:${v.safetyCarCount}`, R.scIn, true, now);

    // Box calls: the weather, damage, worn tyres. Once a lap until you come in.
    const call = RaceEngineer.stopCall(v);
    if (call) {
      if (call.tyres) this.plan = call.tyres;
      const first = `box:${stint}:${call.reason}`;
      if (!this.said.has(first)) {
        this.want(first, fmt(R.box[call.reason], { tyres: tyres(call.tyres) }), true, now);
        this.boxLap = v.lapsDone;
      } else if (v.lapsDone > this.boxLap) this.want(`${first}:${v.lapsDone}`, fmt(R.boxAgain, { tyres: tyres(call.tyres) }), true, now);
    } else if (t && !v.pitting) {
      const stopIn = RaceEngineer.stopIn(v);
      // The plan for the stop ahead.
      if (stopIn <= E.planFrom && stopIn >= 1 && v.lapsDone >= 1) {
        this.plan = RaceEngineer.tyresFor(v, v.lapsLeft - stopIn, t.wetness);
        this.want(`plan:${stint}`, fmt(R.plan, { n: Math.round(stopIn), tyres: tyres(this.plan) }), false, now);
      }
      // Tyres that just about last: stay out and look after them.
      if (stopIn === Infinity && t.lapsLeft < v.lapsLeft && v.lapsLeft > 1) this.want(`manage:${stint}`, R.manage, false, now);
    }
    // The tyres gone: you're losing a lot of time.
    if (t && t.left <= 0 && !v.pitting && v.lapsLeft > 0.5) this.want(`gone:${stint}`, R.tyresGone, true, now);
    // Damage: one more hit could be the end.
    if (v.damage !== null && v.damage >= E.damageWarn) this.want(`fragile:${stint}`, R.fragile, true, now);

    // A rival close ahead or behind for the first time: what to expect of them (their best-known trait).
    for (const [side, c] of [['ahead', v.ahead], ['behind', v.behind]] as const) {
      const trait = c?.traits?.find((t) => t !== 'rainMaster' && t !== 'poorInRain' ? true : (v.tyres?.wetness ?? 0) >= WET_FROM);
      if (!c || !trait || c.gap === null || c.gap > E.rivalGap || v.lapsDone < 1) continue;
      this.want(`rival:${c.id}`, fmt(STR.traits[trait][side], { name: c.name }), false, now);
    }

    // Rivals pitting just ahead or behind: the undercut.
    if (t && !v.pitting && v.lapsLeft > 1.5) {
      const b = v.behind;
      if (b && b.pitting && p?.behind?.id === b.id && !p.behind.pitting && b.gap !== null && b.gap <= E.undercutGap) {
        const cover = RaceEngineer.stopIn(v) <= E.coverLaps;
        if (cover) this.plan = RaceEngineer.tyresFor(v, v.lapsLeft, t.wetness);
        this.want(`undercut:${b.id}:${b.stops}`, fmt(cover ? R.undercutCover : R.undercutStay, { name: b.name, tyres: tyres(this.plan) }), cover, now);
      }
      const a = v.ahead;
      if (a && a.pitting && p?.ahead?.id === a.id && !p.ahead.pitting && a.gap !== null && a.gap <= E.undercutGap) this.want(`overcut:${a.id}:${a.stops}`, fmt(R.overcut, { name: a.name }), false, now);
    }

    this.prev = v;
    return this.speak(now);
  }

  /** A lap done (not the last): the gaps, and the last lap to come. */
  lap(v: EngineerView): void {
    const R = STR.engineer, E = ENGINEER, now = v.time;
    if (v.lapsDone === v.lapsToRun - 1) this.want('lastLap', R.lastLap, true, now);
    else if (v.cars > 1 && !v.pitting) {
      const trend = (g: number, last: { id: number; gap: number } | null, id: number, closing: string, opening: string) => {
        if (!last || last.id !== id) return '';
        const d = g - last.gap;
        return Math.abs(d) < E.trend ? '' : ' ' + fmt(d < 0 ? closing : opening, { d: Math.abs(d).toFixed(1) });
      };
      const parts: string[] = [];
      const a = v.ahead, b = v.behind;
      if (a?.gap != null) parts.push(fmt(R.gapAhead, { name: a.name, gap: a.gap.toFixed(1) }) + trend(a.gap, this.lastAhead, a.id, R.catching, R.losing));
      else if (v.pos === 1) parts.push(R.leading);
      if (b?.gap != null) parts.push(fmt(R.gapBehind, { name: b.name, gap: b.gap.toFixed(1) }) + trend(b.gap, this.lastBehind, b.id, R.closingIn, R.pullingAway));
      if (parts.length) this.want(`gaps:${v.lapsDone}`, fmt(R.gaps, { pos: v.pos, gaps: parts.join(' ') }), false, now);
    }
    this.lastAhead = v.ahead?.gap != null ? { id: v.ahead.id, gap: v.ahead.gap } : null;
    this.lastBehind = v.behind?.gap != null ? { id: v.behind.id, gap: v.behind.gap } : null;
  }

  /** Something to tell you from outside (a rival's mistake near you): said once per `key`, if there's room for it. */
  note(key: string, text: string, now: number): void {
    this.want(key, text, false, now);
  }

  /** Out of the box after a stop: where you are. */
  pitDone(v: EngineerView): void {
    const R = STR.engineer;
    this.plan = null;
    // (The calls for the old tyres are done with.)
    this.queue = this.queue.filter((p) => !p.call.urgent);
    const text = v.cars <= 1 ? R.pitDoneAlone : v.ahead ? fmt(R.pitDoneBehind, { pos: v.pos, name: v.ahead.name }) : fmt(R.pitDone, { pos: v.pos });
    this.want(`pitDone:${v.stops}`, text, false, v.time);
  }

  /** The end of your race: the flag (in place `pos`), or broken down. Said at once. */
  finish(pos: number | null, cars: number): RadioCall {
    const R = STR.engineer;
    this.queue = [];
    if (pos === null) return { text: R.retired, urgent: true };
    if (cars <= 1) return { text: R.finishedAlone, urgent: false };
    const text = pos === 1 ? R.won : pos <= 3 ? fmt(R.podium, { pos }) : pos <= 10 ? fmt(R.points, { pos }) : fmt(R.finished, { pos });
    return { text, urgent: false };
  }

  /** What to say now: the most urgent waiting message, if it's been long enough since the last. */
  private speak(now: number): RadioCall | null {
    const E = ENGINEER;
    this.queue = this.queue.filter((p) => p.call.urgent || now - p.at <= E.stale);
    if (!this.queue.length) return null;
    const k = Math.max(0, this.queue.findIndex((p) => p.call.urgent));
    const next = this.queue[k];
    if (now - this.lastTalk < (next.call.urgent ? E.urgentGap : E.gap)) return null;
    this.queue.splice(k, 1);
    this.said.add(next.key);
    this.lastTalk = now;
    return next.call;
  }
}
