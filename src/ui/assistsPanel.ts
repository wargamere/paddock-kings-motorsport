import { keysText } from '../car/bindings.ts';
import { STR, fmt } from '../config/strings.ts';
import { ASSIST_PRESETS, settings, updateSettings, type Assists } from '../core/settings.ts';
import { button, h, segmented, type Choice } from './dom.ts';

/** One line for the race setup, as in "Racing line, ABS, traction control · automatic gears". */
export function assistsSummary(a: Assists): string {
  const A = STR.assists;
  const on = [a.line !== 'off' ? A.summaryLine : '', a.brake !== 'off' ? A.summaryBrake : '', a.steer ? A.summarySteer : '', a.abs ? A.summaryAbs : '', a.tc !== 'off' ? A.summaryTc : ''].filter(Boolean);
  const gears = a.gears === 'manual' ? A.summaryManual : A.summaryAuto;
  if (!on.length) return a.gears === 'manual' ? gears.charAt(0).toUpperCase() + gears.slice(1) : A.summaryNone;
  const list = on.join(', ');
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} · ${gears}`;
}

/** The preset the assists match, if any. */
function presetOf(a: Assists): keyof typeof ASSIST_PRESETS | null {
  for (const [name, p] of Object.entries(ASSIST_PRESETS) as [keyof typeof ASSIST_PRESETS, Assists][]) {
    if ((Object.keys(p) as (keyof Assists)[]).every((k) => p[k] === a[k])) return name;
  }
  return null;
}

/**
 * The assists, as an F1 game has them: presets (Beginner, Intermediate,
 * Expert), then each one: racing line (off / corners / full), braking assist
 * (off / low / medium / high), steering assist, ABS, traction control (off /
 * medium / full), automatic or manual gears. Changes apply straight away and
 * are remembered. Opens over the race setup or the pause menu.
 */
export class AssistsPanel {
  readonly root: HTMLElement;
  private readonly preset: Choice<keyof typeof ASSIST_PRESETS | ''>;
  private readonly line: Choice<Assists['line']>;
  private readonly brake: Choice<Assists['brake']>;
  private readonly steer: Choice<boolean>;
  private readonly abs: Choice<boolean>;
  private readonly tc: Choice<Assists['tc']>;
  private readonly gears: Choice<Assists['gears']>;
  private readonly gearsHint: HTMLElement;
  private onClose: () => void = () => {};

  constructor() {
    const A = STR.assists;
    const set = (patch: Partial<Assists>) => {
      updateSettings({ assists: { ...settings().assists, ...patch } });
      this.render();
    };
    this.preset = segmented<keyof typeof ASSIST_PRESETS | ''>(
      [
        ['beginner', A.beginner],
        ['intermediate', A.intermediate],
        ['expert', A.expert],
      ],
      (v) => {
        if (v) set({ ...ASSIST_PRESETS[v] });
      },
    );
    this.line = segmented<Assists['line']>(
      [
        ['off', A.lineOff],
        ['brake', A.lineBrake],
        ['full', A.lineFull],
      ],
      (v) => set({ line: v }),
    );
    this.brake = segmented<Assists['brake']>(
      [
        ['off', A.brakeOff],
        ['low', A.brakeLow],
        ['medium', A.brakeMedium],
        ['high', A.brakeHigh],
      ],
      (v) => set({ brake: v }),
    );
    const onOff = (pick: (v: boolean) => void) =>
      segmented<boolean>(
        [
          [false, A.off],
          [true, A.on],
        ],
        pick,
      );
    this.steer = onOff((v) => set({ steer: v }));
    this.abs = onOff((v) => set({ abs: v }));
    this.tc = segmented<Assists['tc']>(
      [
        ['off', A.tcOff],
        ['medium', A.tcMedium],
        ['full', A.tcFull],
      ],
      (v) => set({ tc: v }),
    );
    this.gears = segmented<Assists['gears']>(
      [
        ['auto', A.gearsAuto],
        ['manual', A.gearsManual],
      ],
      (v) => set({ gears: v }),
    );
    const field = (label: string, control: HTMLElement, hint: string | HTMLElement) => {
      control.setAttribute('aria-label', label);
      return h('div', { class: 'field' }, h('span', { class: 'label', text: label }), control, typeof hint === 'string' ? h('p', { class: 'setup-hint', text: hint }) : hint);
    };
    this.gearsHint = h('p', { class: 'setup-hint' });
    const panel = h(
      'div',
      { class: 'panel assists-panel' },
      h('h2', { text: A.title }),
      h('p', { class: 'assists-intro', text: A.intro }),
      field(A.presets, this.preset.el, A.presetsHint),
      field(A.line, this.line.el, A.lineHint),
      field(A.brake, this.brake.el, A.brakeHint),
      field(A.steer, this.steer.el, A.steerHint),
      field(A.abs, this.abs.el, A.absHint),
      field(A.tc, this.tc.el, A.tcHint),
      field(A.gears, this.gears.el, this.gearsHint),
      h('div', { class: 'menu row' }, button(A.done, () => this.close(), { icon: '✓', class: 'primary', key: 'Esc' })),
    );
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', A.title);
    this.root = h('div', { class: 'screen overlay assists-overlay' }, panel);
    this.root.hidden = true;
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.close();
    });
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** Shows it over `host`; `onClose` runs when it's closed. */
  open(host: HTMLElement, onClose: () => void = () => {}): void {
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
    const a = settings().assists;
    this.preset.set(presetOf(a) ?? '');
    this.line.set(a.line);
    this.brake.set(a.brake);
    this.steer.set(a.steer);
    this.abs.set(a.abs);
    this.tc.set(a.tc);
    this.gears.set(a.gears);
    // The gear keys as you have them.
    const keys = settings().keys;
    this.gearsHint.textContent = fmt(STR.assists.gearsHint, { up: keysText(keys, 'gearUp') || '—', down: keysText(keys, 'gearDown') || '—' });
  }
}
