import { KNOCKOUT } from '../config/race.ts';
import { qualifyingOrder } from './ai.ts';

/**
 * Knockout qualifying: Q1, Q2 and Q3. The slowest KNOCKOUT.outShare of the
 * field drop out after Q1 and after Q2, starting in the places they reached;
 * Q3 sets the top of the grid. Cars are numbered as the race screen numbers
 * them (YOU for you, else the AI's place in the field).
 */

/** Cars out after each of Q1 and Q2 in a field of `cars` (0: a field too small for knockout qualifying). */
export function knockoutOut(cars: number): number {
  return cars >= KNOCKOUT.minCars ? Math.round(cars * KNOCKOUT.outShare) : 0;
}

/** One session done: its order (quickest first, no time last), who goes through and who's out. */
export function knockoutSession(times: ReadonlyMap<number, number | null>, part: 1 | 2 | 3, field: number): { order: number[]; through: number[]; out: number[] } {
  const order = qualifyingOrder(times);
  const n = part < 3 ? knockoutOut(field) : 0;
  return { order, through: order.slice(0, order.length - n), out: order.slice(order.length - n) };
}

/** The grid from the sessions' results: Q3's order, then those out in Q2, then those out in Q1 (each in the order they qualified). */
export function knockoutGrid(sessions: readonly { order: readonly number[]; out: readonly number[] }[]): number[] {
  const last = sessions[sessions.length - 1];
  const grid = last.order.filter((k) => !last.out.includes(k));
  for (let i = sessions.length - 1; i >= 0; i--) grid.push(...sessions[i].out);
  return grid;
}

/** How much quicker the track is in session `part` than in Q1 (a share of the lap). */
export function trackEvolution(part: 1 | 2 | 3): number {
  return 1 - KNOCKOUT.evolution * (part - 1);
}
