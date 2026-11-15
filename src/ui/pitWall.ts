import { PIT_WALL, TYRES, type Compound, type PaceMode } from '../config/race.ts';
import { STR, fmt } from '../config/strings.ts';
import { button, h } from './dom.ts';

/** What the pit wall shows about your teammate's car. */
export interface PitWallInfo {
  name: string;
  /** Race position, and the gap to the car ahead (null: leading, or not timed yet). */
  pos: number;
  gapAhead: string;
  /** Tyres: kind, laps on them, share of their life left; and laps of the race left. */
  tyre: Compound | null;
  tyreAge: number;
  tyreLeft: number;
  lapsLeft: number;
  mode: PaceMode;
  /** Called in, for these tyres (null: not called in). */
  boxCall: Compound | null;
  /** In the pit lane now. */
  pitting: boolean;
  /** Out of the race. */
  out: boolean;
}

export interface PitWallActions {
  box(tyres: Compound | null): void;
  mode(m: PaceMode): void;
}

/**
 * The pit wall in a championship race: your AI teammate's car (position,
 * tyres, the pace it's been told to run at) and the calls you can make for
 * it: box this lap for the tyres you choose, or push / normal / save the
 * tyres. Your race engineer's last radio message sits under it.
 */
export class PitWall {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly status: HTMLElement;
  private readonly tyreLine: HTMLElement;
  private readonly modes = new Map<PaceMode, HTMLButtonElement>();
  private readonly tyreButtons = new Map<Compound, HTMLButtonElement>();
  private readonly boxBtn: HTMLButtonElement;
  private readonly radio: HTMLElement;
  /** The tyres the next box call is for (chosen with the chips; a suggestion until you pick). */
  tyres: Compound = 'medium';
  private picked = false;
  private info: PitWallInfo | null = null;
  private readonly actions: PitWallActions;

  constructor(actions: PitWallActions) {
    this.actions = actions;
    const P = STR.pitWall;
    this.title = h('div', { class: 'pit-wall-title' });
    this.status = h('div', { class: 'pit-wall-status' });
    this.tyreLine = h('div', { class: 'pit-wall-tyres' });
    const modes = h('div', { class: 'pit-wall-modes segmented' });
    modes.setAttribute('role', 'group');
    modes.setAttribute('aria-label', P.paceLabel);
    for (const m of PIT_WALL.order) {
      const b = button(P.modes[m], () => this.actions.mode(m), { class: 'compact' });
      this.modes.set(m, b);
      modes.append(b);
    }
    const chips = h('div', { class: 'pit-wall-chips' });
    chips.setAttribute('role', 'group');
    chips.setAttribute('aria-label', P.tyresLabel);
    for (const c of TYRES.order) {
      const b = button(STR.tyres.letters[c], () => this.pick(c), { class: 'compact tyre-choice', title: STR.tyres.names[c] });
      b.dataset.compound = c;
      this.tyreButtons.set(c, b);
      chips.append(b);
    }
    this.boxBtn = button(P.box, () => this.toggleBox(), { class: 'compact primary', key: 'B' });
    this.radio = h('div', { class: 'pit-wall-radio' });
    this.radio.setAttribute('role', 'status');
    this.root = h('div', { class: 'pit-wall' }, h('div', { class: 'label', text: P.title }), this.title, this.status, this.tyreLine, modes, h('div', { class: 'pit-wall-box' }, chips, this.boxBtn), this.radio);
    this.root.hidden = true;
    // (Clicks here are the pit wall's, not the race's.)
    this.root.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  hide(): void {
    this.root.hidden = true;
    this.info = null;
    this.picked = false;
    this.setRadio('');
  }

  /** The tyres to box for: your pick, or until you pick, `suggested`. */
  suggest(suggested: Compound): void {
    if (!this.picked) this.tyres = suggested;
  }

  private pick(c: Compound): void {
    this.tyres = c;
    this.picked = true;
    // Already called in: for these tyres now.
    if (this.info?.boxCall) this.actions.box(c);
    if (this.info) this.show(this.info);
  }

  /** Calls the teammate in (for the chosen tyres), or cancels the call. */
  toggleBox(): void {
    const i = this.info;
    if (!i || i.out || i.pitting) return;
    this.actions.box(i.boxCall ? null : this.tyres);
  }

  /** The next pace mode (J): normal → push → save → normal. */
  cycleMode(): void {
    const i = this.info;
    if (!i || i.out) return;
    const order = PIT_WALL.order;
    this.actions.mode(order[(order.indexOf(i.mode) + 1) % order.length]);
  }

  /** Your race engineer on the radio. */
  setRadio(text: string): void {
    if (this.radio.textContent !== text) this.radio.textContent = text;
    this.radio.hidden = !text;
  }

  show(i: PitWallInfo): void {
    const P = STR.pitWall;
    this.info = i;
    this.root.hidden = false;
    const title = fmt(P.car, { name: i.name, pos: i.pos });
    if (this.title.textContent !== title) this.title.textContent = title;
    const status = i.out ? P.out : i.pitting ? P.pitting : i.boxCall ? fmt(P.called, { tyres: STR.tyres.lower[i.boxCall] }) : i.gapAhead ? fmt(P.gap, { gap: i.gapAhead }) : P.leading;
    if (this.status.textContent !== status) this.status.textContent = status;
    this.status.className = `pit-wall-status${i.boxCall && !i.pitting ? ' called' : ''}`;
    const tyres = i.tyre ? fmt(P.tyres, { kind: STR.tyres.names[i.tyre], age: Math.floor(i.tyreAge), left: Math.round(i.tyreLeft * 100), laps: Math.max(0, Math.ceil(i.lapsLeft)) }) : '';
    if (this.tyreLine.textContent !== tyres) this.tyreLine.textContent = tyres;
    this.tyreLine.classList.toggle('low', !!i.tyre && i.tyreLeft < PIT_WALL.tyresLow);
    for (const [m, b] of this.modes) {
      b.classList.toggle('on', m === i.mode);
      b.setAttribute('aria-pressed', String(m === i.mode));
      b.disabled = i.out;
    }
    for (const [c, b] of this.tyreButtons) {
      const on = c === (i.boxCall ?? this.tyres);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
      b.disabled = i.out || i.pitting;
    }
    const label = this.boxBtn.querySelector('.btn-label');
    const text = i.boxCall ? P.cancel : P.box;
    if (label && label.textContent !== text) label.textContent = text;
    this.boxBtn.disabled = i.out || i.pitting || !i.tyre;
  }
}
