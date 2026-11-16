import { CAREER } from '../config/career.ts';
import type { RoundResult } from './career.ts';

/**
 * Points: the Grand Prix's for the top ten, the sprint's for the top eight on
 * a sprint weekend. A car that retired or was disqualified scores nothing.
 */

/** Points for finishing the Grand Prix in `place` (1-based). */
export function pointsFor(place: number): number {
  return CAREER.points[place - 1] ?? 0;
}

/** Points for finishing a sprint in `place` (1-based). */
export function sprintPointsFor(place: number): number {
  return CAREER.sprintPoints[place - 1] ?? 0;
}

/** Points driver `id` scored in the Grand Prix of a round. */
export function racePoints(r: RoundResult, id: string): number {
  if (r.dnf.includes(id) || r.dsq?.includes(id)) return 0;
  const i = r.order.indexOf(id);
  return i < 0 ? 0 : pointsFor(i + 1);
}

/** Points driver `id` scored in a round's sprint (0 without one). */
export function sprintPoints(r: RoundResult, id: string): number {
  const s = r.sprint;
  if (!s || s.dnf.includes(id)) return 0;
  const i = s.order.indexOf(id);
  return i < 0 ? 0 : sprintPointsFor(i + 1);
}

/** Everything driver `id` scored in a round: the Grand Prix and the sprint. */
export function roundPoints(r: RoundResult, id: string): number {
  return racePoints(r, id) + sprintPoints(r, id);
}
