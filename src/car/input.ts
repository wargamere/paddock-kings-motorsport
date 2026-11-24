import { HANDLING, INPUT } from '../config/handling.ts';
import { settings } from '../core/settings.ts';
import { actionMap, splitMaps, type DriveAction, type KeyBindings } from './bindings.ts';
import type { DriveInput } from './physics.ts';
import { PlayerSteering } from './playerSteering.ts';

export type InputAction = 'pause' | 'reset' | 'camera' | 'mute' | 'tower';
export type InputDevice = 'keyboard' | 'gamepad' | 'touch';

/** Written by the on-screen touch controls. */
export interface TouchState {
  throttle: boolean;
  brake: boolean;
  /** -1, 0 or +1 */
  steer: number;
  /** Gear changes asked for by the ▲ ▼ buttons and not yet made (+ up, - down). */
  shift: number;
  /** The BOOST button held. */
  boost: boolean;
}

/** Bound actions that fire once per press (the rest are held). */
const PRESS_ACTIONS: Partial<Record<DriveAction, InputAction>> = { pause: 'pause', reset: 'reset', camera: 'camera', mute: 'mute', tower: 'tower' };

/** Gamepads connected now. */
export function connectedPads(): number {
  try {
    return navigator.getGamepads ? Array.from(navigator.getGamepads()).filter((p) => !!p && p.connected).length : 0;
  } catch {
    return 0;
  }
}

/** Standard-mapping gamepad buttons. */
const PAD = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, lt: 6, rt: 7, back: 8, start: 9, left: 14, right: 15 } as const;
const PAD_ACTIONS: [number, InputAction][] = [
  [PAD.start, 'pause'],
  [PAD.back, 'reset'],
  [PAD.y, 'camera'],
];


/**
 * Merges keyboard, gamepad and touch into one DriveInput. Driving keys are read
 * as "held" state when the physics samples them; pause/reset/camera fire once
 * per press through `onAction`. Only browser-safe keys are bound.
 */
export class InputManager {
  onAction: (a: InputAction) => void = () => {};
  /** The device used most recently (the HUD shows matching hints). */
  lastDevice: InputDevice = 'keyboard';
  /** Raw driver intent, so line assistance yields even while steering is easing in. */
  steeringIntent = 0;
  readonly touch: TouchState = { throttle: false, brake: false, steer: 0, shift: 0, boost: false };
  /** Gear changes asked for (keyboard and gamepad) and not yet made. */
  private shifts = 0;
  /** The keyboard's and the touch pads' pedals, eased in (see INPUT.keyThrottleRise). */
  private keyThrottle = 0;
  private keyBrake = 0;
  private readonly steering = new PlayerSteering();
  private padDpad = 0;
  /** The key bindings in use, and what each key does (rebuilt when they change, or the player changes). */
  private bound: KeyBindings | null = null;
  private boundFor: 'solo' | 'p1' | 'p2' = 'solo';
  private keyActions = new Map<string, DriveAction>();
  /**
   * Who this is: the only player (every key, the first gamepad), or in split
   * screen player 1 or player 2 (their own keys: see splitMaps). Set before a race.
   */
  player: 'solo' | 'p1' | 'p2' = 'solo';
  /** Which connected gamepad this player reads (the n-th; null: none). */
  padSlot: number | null = 0;

  /** The current bindings (from the settings; they can change between races). */
  private bindings(): KeyBindings {
    const b = settings().keys;
    if (b !== this.bound || this.player !== this.boundFor) {
      this.bound = b;
      this.boundFor = this.player;
      this.keyActions = this.player === 'solo' ? actionMap(b) : splitMaps(b)[this.player];
    }
    return b;
  }

  /** What this player's keys do (built from the bindings). */
  private actionKeys(action: DriveAction): string[] {
    const out: string[] = [];
    for (const [k, a] of this.keyActions) if (a === action) out.push(k);
    return out;
  }

  private readonly keys = new Set<string>();
  private readonly pad: DriveInput = { throttle: 0, brake: 0, steer: 0, handbrake: false, boost: false };
  private padPressed: boolean[] = [];
  private abort: AbortController | null = null;

  attach(): void {
    this.detach();
    this.abort = new AbortController();
    const opts = { signal: this.abort.signal };
    window.addEventListener('keydown', (e) => this.onKey(e, true), opts);
    window.addEventListener('keyup', (e) => this.onKey(e, false), opts);
    window.addEventListener('blur', () => this.clear(), opts);
    document.addEventListener('visibilitychange', () => this.clear(), opts);
  }

  detach(): void {
    this.abort?.abort();
    this.abort = null;
    this.clear();
  }

  /** Releases everything (e.g. when the window loses focus mid-press). */
  clear(): void {
    this.keys.clear();
    this.touch.throttle = false;
    this.touch.brake = false;
    this.touch.steer = 0;
    this.touch.shift = 0;
    this.touch.boost = false;
    this.shifts = 0;
    this.keyThrottle = this.keyBrake = 0;
    this.steering.reset();
    this.steeringIntent = 0;
    this.padDpad = 0;
    this.pad.throttle = this.pad.brake = this.pad.steer = 0;
    this.pad.boost = false;
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return; // never interfere with browser shortcuts
    this.bindings();
    const bound = this.keyActions.get(e.code);
    if (!bound) return;
    e.preventDefault(); // arrows would otherwise scroll the host page
    this.lastDevice = 'keyboard';
    if (down) {
      this.keys.add(e.code);
      if (e.repeat) return;
      const action = PRESS_ACTIONS[bound];
      if (action) this.onAction(action);
      // Gear changes (manual gearbox): one per press.
      if (bound === 'gearUp') this.shifts++;
      if (bound === 'gearDown') this.shifts--;
    } else {
      this.keys.delete(e.code);
    }
  }

  /** Reads the gamepad. Call once per frame, before the physics steps. */
  pollGamepad(): void {
    let pads: (Gamepad | null)[] = [];
    try {
      pads = navigator.getGamepads ? Array.from(navigator.getGamepads()) : [];
    } catch {
      pads = []; // blocked by permissions policy in some iframes
    }
    const gp = this.padSlot === null ? undefined : pads.filter((p): p is Gamepad => !!p && p.connected)[this.padSlot];
    const p = this.pad;
    if (!gp) {
      p.throttle = p.brake = p.steer = 0;
      this.padDpad = 0;
      p.boost = false;
      this.padPressed = [];
      return;
    }
    const btn = (i: number) => gp.buttons[i]?.value ?? 0;
    const pressed = (i: number) => !!gp.buttons[i]?.pressed;
    const dz = (v: number, zone: number) => (Math.abs(v) < zone ? 0 : (v - Math.sign(v) * zone) / (1 - zone));
    const stick = dz(gp.axes[0] ?? 0, INPUT.stickDeadZone);
    const dpad = (pressed(PAD.right) ? 1 : 0) - (pressed(PAD.left) ? 1 : 0);
    p.steer = stick;
    this.padDpad = dpad;
    p.throttle = Math.max(dz(btn(PAD.rt), INPUT.triggerDeadZone), pressed(PAD.a) ? 1 : 0);
    p.brake = Math.max(dz(btn(PAD.lt), INPUT.triggerDeadZone), pressed(PAD.x) ? 1 : 0);
    p.boost = pressed(PAD.b);
    if (p.steer || dpad || p.throttle || p.brake) this.lastDevice = 'gamepad';
    for (const [i, dir] of [[PAD.rb, 1], [PAD.lb, -1]] as const) {
      if (pressed(i) && !this.padPressed[i]) {
        this.lastDevice = 'gamepad';
        this.shifts += dir;
      }
    }
    for (const [i, action] of PAD_ACTIONS) {
      if (pressed(i) && !this.padPressed[i]) {
        this.lastDevice = 'gamepad';
        this.onAction(action);
      }
    }
    this.padPressed = gp.buttons.map((b) => b.pressed);
  }

  /** The combined input for one physics tick. */
  sample(out: DriveInput, speed = 0): DriveInput {
    this.bindings();
    const held = (a: DriveAction) => this.actionKeys(a).some((c) => this.keys.has(c));
    const t = this.touch;
    const keySteer = (held('right') ? 1 : 0) - (held('left') ? 1 : 0);
    // A key is all or nothing: its pedal goes down over a moment, as a foot would (a gamepad's
    // triggers are the driver's own), and comes up at once.
    const dt = 1 / HANDLING.tickRate;
    const ease = (now: number, down: boolean, rise: number) => (down ? Math.min(1, now + dt / rise) : 0);
    this.keyThrottle = ease(this.keyThrottle, held('throttle') || t.throttle, INPUT.keyThrottleRise);
    this.keyBrake = ease(this.keyBrake, held('brake') || t.brake, INPUT.keyBrakeRise);
    out.throttle = Math.max(this.keyThrottle, this.pad.throttle);
    out.brake = Math.max(this.keyBrake, this.pad.brake);
    const digital = keySteer + this.padDpad + t.steer;
    this.steeringIntent = Math.min(1, Math.abs(digital) + Math.abs(this.pad.steer));
    out.steer = this.steering.sample(digital, this.pad.steer, speed, dt, settings().steeringSensitivity);
    out.handbrake = false; // the handbrake is switched off for now
    out.boost = held('boost') || !!this.pad.boost || t.boost;
    // One gear change per tick, so quick presses go through one after the other.
    const want = this.shifts + t.shift;
    out.shift = Math.sign(want);
    if (this.shifts) this.shifts -= Math.sign(this.shifts);
    else if (t.shift) t.shift -= Math.sign(t.shift);
    return out;
  }
}
