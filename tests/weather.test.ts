import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { CarPhysics } from '../src/car/physics.ts';
import { compoundGrip, compoundLife } from '../src/car/tyres.ts';
import { bandFor, bandOf, compoundsMet, pickCompound, tyreBand } from '../src/race/strategy.ts';
import { HANDLING } from '../src/config/handling.ts';
import { WEATHER, type Compound } from '../src/config/race.ts';
import { getSampleTrack } from '../src/editor/pipeline.ts';
import { AiDriver } from '../src/race/ai.ts';
import { assistDriver } from '../src/race/assists.ts';
import type { Progress } from '../src/race/session.ts';
import { Weather } from '../src/race/weather.ts';
import type { Track } from '../src/track/track.ts';

const DT = 1 / HANDLING.tickRate;

test('dry stays dry and rain stays rain; changing weather starts dry, rains, and the line dries first', () => {
  const dry = new Weather('dry', 300);
  const rain = new Weather('rain', 300);
  for (let i = 0; i < 1000; i++) {
    dry.step(0.1);
    rain.step(0.1);
  }
  assert.equal(dry.wetnessAt(0), 0);
  assert.equal(rain.wetnessAt(5), 1);
  // Rain from 20 % of the way (60 s of 300), heavy, and it stops at 55 % (165 s), without getting heavier or easing first.
  const w = new Weather('changing', 300, dice([0, 1, 0, 0, 1]));
  assert.equal(w.wetnessAt(0), 0);
  const at = (t: number) => {
    while (w.time < t) w.step(0.1);
  };
  at(50);
  const raining = () => w.rain;
  assert.equal(raining(), 0, 'no rain yet');
  assert.equal(w.forecast()?.to, 'rain', 'the forecast says rain is coming');
  at(150);
  assert.ok(raining() === 1 && w.lineWet > 0.85, `soaked: ${w.lineWet.toFixed(2)}`);
  at(260);
  assert.equal(raining(), 0, 'it has stopped');
  assert.ok(w.lineWet < w.offWet - 0.2, `the line dries first: line ${w.lineWet.toFixed(2)}, off it ${w.offWet.toFixed(2)}`);
  assert.equal(w.wetnessAt(0), w.lineWet);
  assert.equal(w.wetnessAt(10), w.offWet);
  // Somewhere along the way slicks and wets swap over.
  assert.ok(compoundGrip('wet', 0.7) > compoundGrip('medium', 0.7) && compoundGrip('wet', 0.2) < compoundGrip('medium', 0.2));
});

/** A random source that gives these numbers in turn (then 0.5). */
function dice(values: number[]): () => number {
  let i = 0;
  return () => (i < values.length ? values[i++] : 0.5);
}

test('a shower can be a drizzle that leaves the road damp, then get heavier; the forecast says which', () => {
  // A drizzle from 120 s (WEATHER.rainMin), not stopping, getting heavier (by WEATHER.shiftBy) 35 % of the way from there to the end: at 288 s.
  const w = new Weather('changing', 600, dice([0, 0, 0.99, 0, 0, 0]));
  const at = (t: number) => {
    while (w.time < t) w.step(0.1);
  };
  at(80);
  assert.equal(w.forecast()?.to, 'rain');
  assert.ok(Math.abs(w.forecast()!.rain - WEATHER.rainMin) < 1e-9, 'a light shower');
  at(270);
  assert.ok(Math.abs(w.rain - WEATHER.rainMin) < 1e-9, `drizzle: ${w.rain}`);
  assert.equal(bandFor(w.lineWet), 'inter', `damp, not soaked: ${w.lineWet.toFixed(2)}`);
  assert.equal(Weather.level(w.rain), 1);
  assert.equal(w.forecast()?.to, 'heavier');
  at(580);
  assert.ok(Math.abs(w.rain - (WEATHER.rainMin + WEATHER.shiftBy)) < 1e-9, `heavier: ${w.rain}`);
  // Heavy rain eases instead.
  const e = new Weather('changing', 600, dice([0, 1, 0.99, 0, 0, 0]));
  while (e.time < 580) e.step(0.1);
  assert.ok(Math.abs(e.rain - (1 - WEATHER.shiftBy)) < 1e-9, `easing: ${e.rain}`);
});

test('intermediates: quickest on a damp road, between slicks and wets', () => {
  const best = (w: number) => (['soft', 'medium', 'hard', 'inter', 'wet'] as const).reduce((a, b) => (compoundGrip(b, w) > compoundGrip(a, w) ? b : a));
  assert.equal(best(0), 'soft');
  assert.equal(best(0.2), 'soft');
  assert.equal(best(0.35), 'inter');
  assert.equal(best(0.5), 'inter');
  assert.equal(best(0.65), 'wet');
  assert.equal(best(1), 'wet');
  // The bands the strategy uses agree.
  assert.equal(bandFor(0.2), 'slick');
  assert.equal(bandFor(0.4), 'inter');
  assert.equal(bandFor(0.7), 'wet');
  assert.equal(pickCompound(10, 5, 0.4, 'medium'), 'inter');
  // A change needs the road a little past the crossover, and a gamble moves it.
  assert.equal(tyreBand('slick', WEATHER.interFrom + 0.01), 'slick');
  assert.equal(tyreBand('slick', WEATHER.interFrom + 0.06), 'inter');
  assert.equal(tyreBand('slick', WEATHER.interFrom + 0.01, 0.07), 'inter', 'an early gambler');
  assert.equal(tyreBand('inter', WEATHER.interFrom - 0.01), 'inter');
  assert.equal(tyreBand('inter', WEATHER.interFrom - 0.06), 'slick');
  // Inters wear fast in the dry; under the two-compound rule they count as wet-weather tyres.
  assert.ok(compoundLife('inter', 0, 5) < compoundLife('soft', 0, 5));
  assert.ok(compoundsMet(['medium', 'inter']) && compoundsMet(['inter']));
});

test('practice weather keeps changing', () => {
  const w = new Weather('changing', Infinity, () => 0.5);
  let flips = 0;
  let raining = false;
  for (let t = 0; t < 2000; t += 0.5) {
    w.step(0.5);
    const now = w.rain > 0.5;
    if (now !== raining) flips++;
    raining = now;
  }
  const every = (WEATHER.practiceMin + WEATHER.practiceMax) / 2;
  assert.ok(flips >= Math.floor(2000 / every) - 1, `${flips} changes in 2000 s`);
});

const progressOf = (car: CarPhysics, track: Track): Progress => {
  const st = car.state;
  const tg = track.center.tangents[Math.max(0, st.trackIndex)];
  return { s: st.s, lateral: st.lateral, along: st.vx * tg.x + st.vz * tg.y, offTrack: st.offTrack };
};

test('in changing weather the AI pits for wets as the road gets wet, and back to slicks as it dries', () => {
  const t = getSampleTrack(0);
  // (Long enough for the line to dry back past where it goes back to slicks, with a lap to go.)
  const laps = 8;
  // Heavy rain from 20 % of ~245 s, stopping at 55 %.
  const weather = new Weather('changing', 245, dice([0, 1, 0, 0, 1]));
  const ai = new AiDriver(t, { name: 'a', paint: 0, difficulty: 0.75, laps, slot: 1, tyreWear: true });
  const line = assistDriver(t);
  const fitted: string[] = [ai.car.compound];
  let off = 0;
  for (let tick = 0; tick < 600 * HANDLING.tickRate && ai.session.phase !== 'finished'; tick++) {
    if (ai.session.phase === 'racing') {
      weather.step(DT);
      ai.car.wetness = weather.wetnessAt(ai.car.state.lateral - line.lateralAt(ai.car.state.s));
    }
    const prev = progressOf(ai.car, t);
    ai.car.step(ai.drive([ai.car.state], DT));
    if (ai.car.state.offTrack) off++;
    if (ai.car.compound !== fitted[fitted.length - 1]) fitted.push(ai.car.compound);
    ai.session.step(prev, progressOf(ai.car, t), []);
  }
  assert.equal(ai.session.phase, 'finished');
  const wets = fitted.indexOf('wet');
  assert.ok(wets > 0, `on to wets: ${fitted.join(' → ')}`);
  assert.equal(bandOf(fitted[fitted.length - 1] as Compound), 'slick', `and back to slicks: ${fitted.join(' → ')}`);
  assert.ok(off * DT < 1, `${(off * DT).toFixed(1)} s past the track limits`);
});
