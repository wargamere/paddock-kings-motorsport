/**
 * Race replays (race/replay.ts, race/replayScreen.ts).
 */
export const REPLAY = {
  /** A sample every this many physics ticks (120 Hz): 15 a second, smooth when played back between them. */
  everyTicks: 8,
  /** Floats per car per sample: x, y, z, heading, pitch, roll, steer, speed, race distance, retired (1) or not (0). */
  fields: 10,
  /** Samples per allocated block. */
  chunk: 900,
  /** Nothing past this much race (s) is kept: about 40 MB for a full grid at most. */
  maxSeconds: 3600,
  /** A pass counts between cars this close (m) along the race, and between the same two cars once in this long (s). */
  passReach: 40,
  passDebounce: 4,
  /** A hit this hard (m/s) is a moment worth seeing. */
  contactSpeed: 9,
  /** Highlights: at most this many moments; seconds before and after each (the start and the finish have their own). */
  maxHighlights: 14,
  span: [5, 3],
  startSpan: [1, 14],
  finishSpan: [4, 5],
  /** Playback speeds. */
  speeds: [0.5, 1, 2, 4],
  /**
   * TV cameras: one every `tvSpacing` m round the track, `tvOffset` m beyond
   * the road's edge on the outside of the bend there, `tvHeight` m up. A car
   * is filmed from the camera whose spot is nearest `tvLead` m ahead of it,
   * within `tvWindow` m behind and ahead, for at least `tvHold` s; the lens
   * zooms to keep the car about `tvFrame` m across the picture.
   */
  tvSpacing: 110,
  tvOffset: 9,
  tvHeight: 5,
  tvLead: 30,
  tvWindow: [45, 120],
  tvHold: 2.5,
  tvFrame: 14,
} as const;
