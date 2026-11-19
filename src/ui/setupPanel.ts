import { DEFAULT_SETUP, SETUP, type CarSetup, type GearSet, type WingLevel } from '../config/race.ts';
import { STR, fmt } from '../config/strings.ts';
import { settings, updateSettings, withFine } from '../core/settings.ts';
import { suggestedSetup, wingLapTimes } from '../race/strategy.ts';
import type { Track } from '../track/track.ts';
import { button, h, segmented, slider, type Choice, type Slider } from './dom.ts';

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One line for the race setup: "Wings 6 / 8 · 58 % front · diff 75 % · medium gears", or "Standard". */
export function setupSummary(setup: CarSetup): string {
  const s = withFine(setup);
  const F = SETUP.fine;
  if (s.frontWing === F.wingMid && s.rearWing === F.wingMid && s.brakeBias === F.biasMid && s.diff === F.diffMid && s.gears === DEFAULT_SETUP.gears) return STR.carSetup.summaryStandard;
  const L = STR.carSetup.lower;
  return cap(fmt(STR.carSetup.summaryFine, { front: s.frontWing!, rear: s.rearWing!, bias: s.brakeBias!, diff: s.diff!, gears: L[s.gears] }));
}

/** "−0.08" / "+0.23": seconds against medium wing. */
const signed = (x: number) => `${x < 0 ? '−' : '+'}${Math.abs(x).toFixed(2)}`;

/** The wing level a rear wing setting is nearest (what the AI teams and the strategy go by). */
const levelOf = (rear: number): WingLevel => (rear <= 3 ? 'low' : rear >= 9 ? 'high' : 'medium');

/**
 * The car setup, as an F1 game has it: front and rear wing (1–11), brake bias
 * (% front), the differential's lock on the throttle (%), and the gears, with
 * what the low and high wings are worth on this track and the setup
 * suggested for it. Changes apply straight away and are remembered. Opens
 * over the race setup.
 */
export class SetupPanel {
  readonly root: HTMLElement;
  private readonly frontWing: Slider;
  private readonly rearWing: Slider;
  private readonly brakeBias: Slider;
  private readonly diff: Slider;
  private readonly gears: Choice<GearSet>;
  private readonly wingLine: HTMLElement;
  private readonly suggested: HTMLElement;
  private track: Track | null = null;
  private onClose: () => void = () => {};

  constructor() {
    const C = STR.carSetup;
    const F = SETUP.fine;
    const set = (patch: Partial<CarSetup>) => {
      const next = withFine({ ...settings().carSetup, ...patch });
      // (The levels follow the fine settings: what the strategy and the rest go by.)
      next.wing = levelOf(next.rearWing!);
      next.brakes = next.brakeBias! >= F.biasMid + 3 ? 'front' : next.brakeBias! <= F.biasMid - 4 ? 'rear' : 'balanced';
      updateSettings({ carSetup: next });
      this.render();
    };
    const done = () => this.render();
    this.frontWing = slider(1, 11, 1, (v) => set({ frontWing: v }), done, (v) => String(v));
    this.rearWing = slider(1, 11, 1, (v) => set({ rearWing: v }), done, (v) => String(v));
    this.brakeBias = slider(F.biasMin, F.biasMax, 1, (v) => set({ brakeBias: v }), done, (v) => fmt(C.biasValue, { n: v }));
    this.diff = slider(F.diffMin, F.diffMax, 5, (v) => set({ diff: v }), done, (v) => fmt(C.diffValue, { n: v }));
    this.gears = segmented<GearSet>(
      (['short', 'medium', 'long'] as const).map((v) => [v, C.gearSets[v]] as [GearSet, string]),
      (v) => set({ gears: v }),
    );
    const field = (label: string, control: HTMLElement, ...hints: HTMLElement[]) => {
      control.setAttribute('aria-label', label);
      return h('div', { class: 'field' }, h('span', { class: 'label', text: label }), control, ...hints);
    };
    const hint = (text: string) => h('p', { class: 'setup-hint', text });
    this.wingLine = h('p', { class: 'setup-hint setup-numbers' });
    this.suggested = h('span', { class: 'setup-suggested' });
    const panel = h(
      'div',
      { class: 'panel assists-panel car-setup-panel' },
      h('h2', { text: C.title }),
      h('p', { class: 'assists-intro', text: C.intro }),
      field(C.frontWing, this.frontWing.el, hint(C.frontWingHint)),
      field(C.rearWing, this.rearWing.el, hint(C.rearWingHint), this.wingLine),
      field(C.brakeBias, this.brakeBias.el, hint(C.brakeBiasHint)),
      field(C.diff, this.diff.el, hint(C.diffHint)),
      field(C.gears, this.gears.el, hint(C.gearsHint)),
      h(
        'div',
        { class: 'setup-suggest-row' },
        this.suggested,
        button(C.useSuggested, () => this.track && set(withFine(suggestedSetup(this.track))), { icon: '★', class: 'compact' }),
        button(C.reset, () => set(withFine(DEFAULT_SETUP)), { icon: '↺', class: 'compact' }),
      ),
      h('div', { class: 'menu row' }, button(C.done, () => this.close(), { icon: '✓', class: 'primary', key: 'Esc' })),
    );
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', C.title);
    this.root = h('div', { class: 'screen overlay assists-overlay' }, panel);
    this.root.hidden = true;
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Shows it over `host` for `track`; `onClose` runs when it's closed. */
  open(host: HTMLElement, track: Track, onClose: () => void = () => {}): void {
    this.track = track;
    this.onClose = onClose;
    this.render();
    host.append(this.root);
    this.root.hidden = false;
  }

  close(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.root.remove();
    this.onClose();
  }

  private render(): void {
    const s = withFine(settings().carSetup);
    this.frontWing.set(s.frontWing!);
    this.rearWing.set(s.rearWing!);
    this.brakeBias.set(s.brakeBias!);
    this.diff.set(s.diff!);
    this.gears.set(s.gears);
    const t = this.track;
    if (!t) return;
    const laps = wingLapTimes(t);
    this.wingLine.textContent = fmt(STR.carSetup.wingLine, { low: signed(laps.low - laps.medium), high: signed(laps.high - laps.medium) });
    this.suggested.textContent = fmt(STR.carSetup.suggested, { wing: STR.carSetup.lower[suggestedSetup(t).wing] });
  }
}
