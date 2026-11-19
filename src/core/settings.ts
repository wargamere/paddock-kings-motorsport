import { cleanBindings, DEFAULT_BINDINGS, type KeyBindings } from '../car/bindings.ts';
import type { PaintId } from '../config/paint.ts';
import { SIM } from '../config/handling.ts';
import { DEFAULT_SETUP, SETUP, type CarSetup } from '../config/race.ts';
import type { RaceSetup } from './screen.ts';
import { loadJSON, saveJSON, storageReady } from '../platform/storage.ts';

/** Driving assists (see race/assists.ts), as an F1 game has them. */
export interface Assists {
  /** The racing line on the road: off, only at the corners (where to lift and brake), or all of it. */
  line: 'off' | 'brake' | 'full';
  /** Brakes for you before corners: off, or a little, more, or most of it. */
  brake: 'off' | 'low' | 'medium' | 'high';
  /** Steers along the racing line while you're not steering, and keeps the front tyres within their grip. */
  steer: boolean;
  /** Who changes gear: the automatic (a little slower) or you. */
  gears: 'auto' | 'manual';
  /** The brakes never lock. */
  abs: boolean;
  /** Traction control: off, medium (no wheelspin, but the throttle can still slide the rear in a bend), or full (and it catches the slide). */
  tc: 'off' | 'medium' | 'full';
}

export const DEFAULT_ASSISTS: Assists = { line: 'off', brake: 'off', steer: false, gears: 'auto', abs: true, tc: 'medium' };

/** The assists' presets: everything on, some, or none (the full sim). */
export const ASSIST_PRESETS: Record<'beginner' | 'intermediate' | 'expert', Assists> = {
  beginner: { line: 'full', brake: 'medium', steer: true, gears: 'auto', abs: true, tc: 'full' },
  intermediate: { line: 'brake', brake: 'off', steer: false, gears: 'auto', abs: true, tc: 'medium' },
  expert: { line: 'off', brake: 'off', steer: false, gears: 'manual', abs: false, tc: 'off' },
};

/** Saved assists, from any earlier version (the braking assist was once just on or off). */
function cleanAssists(saved: unknown): Assists {
  const s = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
  const one = <T extends string>(v: unknown, options: readonly T[], fallback: T): T => (typeof v === 'string' && (options as readonly string[]).includes(v) ? (v as T) : fallback);
  const D = DEFAULT_ASSISTS;
  return {
    line: one(s.line, ['off', 'brake', 'full'], D.line),
    brake: s.brake === true ? 'medium' : s.brake === false ? 'off' : one(s.brake, ['off', 'low', 'medium', 'high'], D.brake),
    steer: typeof s.steer === 'boolean' ? s.steer : D.steer,
    gears: one(s.gears, ['auto', 'manual'], D.gears),
    abs: typeof s.abs === 'boolean' ? s.abs : D.abs,
    tc: one(s.tc, ['off', 'medium', 'full'], D.tc),
  };
}

/** Player preferences, saved between visits. */
export interface Settings {
  muted: boolean;
  camera: 'chase' | 'cockpit' | 'bonnet';
  editorMode: 'draw' | 'dots' | 'height';
  /** Dragging a dot also moves its neighbours. */
  softEdit: boolean;
  smoothing: 'sharp' | 'normal' | 'smooth';
  snap: boolean;
  /** Selected car paint. */
  paint: PaintId;
  /** Paints unlocked by watching a rewarded ad. */
  adPaints: PaintId[];
  /** Finished runs (paints unlock as this grows). */
  runs: number;
  /** Has played before (a new player's first visit goes straight into a race). */
  played: boolean;
  /** Display: graphics quality, speed units, minimap in the race, corner numbers in the editor. */
  graphics: 'full' | 'fast';
  /** You've chosen the graphics yourself (else the game drops to Fast by itself if a race runs slowly). */
  graphicsChosen: boolean;
  units: 'kmh' | 'mph';
  minimap: boolean;
  cornerLabels: boolean;
  /** Editor: a little car laps the track on the map (the gold-medal lap). */
  editorCar: boolean;
  /** Editor sidebar section left open. */
  sidebarSection: number;
  assists: Assists;
  /** Keyboard keys for driving (see car/bindings.ts). */
  keys: KeyBindings;
  /** Your car's setup: wing, gears, brake balance (see SETUP). */
  carSetup: CarSetup;
  /** The timing tower in races with AI cars: every car, just the cars near you (and the leaders), or hidden. */
  tower: 'full' | 'compact' | 'off';
  /** Race setup choices (laps come from each track). */
  raceSetup: Omit<RaceSetup, 'laps'>;
}

const DEFAULTS: Settings = {
  muted: false,
  camera: 'chase',
  editorMode: 'dots',
  softEdit: true,
  smoothing: 'normal',
  snap: false,
  paint: 'yellow',
  adPaints: [],
  runs: 0,
  played: false,
  graphics: 'full',
  graphicsChosen: false,
  units: 'kmh',
  minimap: true,
  cornerLabels: true,
  // Off by default for people who'd rather things on screen stayed still.
  editorCar: !(typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches),
  sidebarSection: 0,
  assists: DEFAULT_ASSISTS,
  keys: DEFAULT_BINDINGS,
  tower: 'full',
  carSetup: DEFAULT_SETUP,
  raceSetup: { mode: 'race', ghost: true, opponents: 3, difficulty: 50, grid: 'pick', startSlot: 4, weather: 'dry', time: 'track', tyreWear: false, tyres: 'medium', damage: false, safetyCar: false },
};
const KEY = 'settings';

let current: Settings | null = null;

/** A saved setup, made safe: anything unknown is the standard choice. */
function cleanSetup(saved: unknown): CarSetup {
  const s = saved && typeof saved === 'object' ? (saved as Record<string, unknown>) : {};
  const pick = <K extends 'wing' | 'gears' | 'brakes'>(k: K, options: object): CarSetup[K] => (typeof s[k] === 'string' && s[k] in options ? (s[k] as CarSetup[K]) : DEFAULT_SETUP[k]);
  const num = (k: 'frontWing' | 'rearWing' | 'brakeBias' | 'diff', lo: number, hi: number) => (typeof s[k] === 'number' && Number.isFinite(s[k]) ? Math.min(hi, Math.max(lo, Math.round(s[k] as number))) : undefined);
  const F = SETUP.fine;
  return withFine({
    wing: pick('wing', SETUP.wing),
    gears: pick('gears', SETUP.gears),
    brakes: pick('brakes', SETUP.brakes),
    frontWing: num('frontWing', 1, 11),
    rearWing: num('rearWing', 1, 11),
    brakeBias: num('brakeBias', F.biasMin, F.biasMax),
    diff: num('diff', F.diffMin, F.diffMax),
  });
}

/**
 * A setup with its fine settings filled in (SETUP.fine), from its levels where
 * it hasn't any: low, medium and high wing are rear wing 1, 6 and 11, the
 * brake balance's front and rear a few % either side, the differential the
 * standard lock. (So a setup from before they existed drives just as it did.)
 */
export function withFine(s: CarSetup): CarSetup {
  const F = SETUP.fine;
  return {
    ...s,
    frontWing: s.frontWing ?? F.wingMid,
    rearWing: s.rearWing ?? (s.wing === 'low' ? 1 : s.wing === 'high' ? 11 : F.wingMid),
    brakeBias: s.brakeBias ?? F.biasMid + Math.round((SIM.brakeBias[s.brakes] - SIM.brakeBias.balanced) * 100),
    diff: s.diff ?? F.diffMid,
  };
}

export function settings(): Settings {
  if (!current) {
    const saved = loadJSON<Partial<Settings>>(KEY, {});
    const read: Settings = { ...DEFAULTS, ...saved, assists: cleanAssists(saved.assists), keys: cleanBindings(saved.keys), carSetup: cleanSetup(saved.carSetup) };
    // (Read before the saved data is ready, e.g. on CrazyGames before the SDK has started:
    // used, but not kept, so the real saved settings are read once they're there.)
    if (!storageReady()) return read;
    current = read;
  }
  return current;
}

export function updateSettings(patch: Partial<Settings>): void {
  current = { ...settings(), ...patch };
  saveJSON(KEY, current);
}
