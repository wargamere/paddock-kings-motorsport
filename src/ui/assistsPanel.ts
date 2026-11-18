import { keysText } from '../car/bindings.ts';
import { STR, fmt } from '../config/strings.ts';
import { settings, updateSettings, type Assists } from '../core/settings.ts';
import { button, h, segmented, type Choice } from './dom.ts';

/** One line for the race setup, as in "Racing line, braking · automatic gears". */
export function assistsSummary(a: Assists): string {
  const A = STR.assists;
  const on = [a.line !== 'off' ? A.summaryLine : '', a.brake ? A.summaryBrake : '', a.steer ? A.summarySteer : ''].filter(Boolean);
  const gears = a.gears === 'manual' ? A.summaryManual : A.summaryAuto;
  const aidsOff = [a.abs, a.tc, a.stability, a.steerHelp].filter((x) => !x).length;
  const aids = aidsOff ? ` · ${fmt(A.summaryAidsOff, { n: aidsOff })}` : '';
  if (!on.length) return (a.gears === 'manual' ? gears.charAt(0).toUpperCase() + gears.slice(1) : A.summaryNone) + aids;
  const list = on.join(', ');
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} · ${gears}${aids}`;
}

/**
 * The assists: racing line (off / braking / full), braking and steering
 * assists, automatic or manual gears. Changes apply straight away and are
 * remembered. Opens over the race setup or the pause menu.
 */
export class AssistsPanel {
  readonly root: HTMLElement;
  private readonly line: Choice<Assists['line']>;
  private readonly brake: Choice<boolean>;
  private readonly steer: Choice<boolean>;
  private readonly gears: Choice<Assists['gears']>;
  /** The car's own aids. */
  private readonly aids: { key: 'abs' | 'tc' | 'stability' | 'steerHelp'; choice: Choice<boolean> }[];
  private readonly gearsHint: HTMLElement;
  private onClose: () => void = () => {};

  constructor() {
    const A = STR.assists;
    const set = (patch: Partial<Assists>) => {
      updateSettings({ assists: { ...settings().assists, ...patch } });
      this.render();
    };
    this.line = segmented<Assists['line']>(
      [
        ['off', A.lineOff],
        ['brake', A.lineBrake],
        ['full', A.lineFull],
      ],
      (v) => set({ line: v }),
    );
    const onOff = (pick: (v: boolean) => void) =>
      segmented<boolean>(
        [
          [false, A.off],
          [true, A.on],
        ],
        pick,
      );
    this.brake = onOff((v) => set({ brake: v }));
    this.steer = onOff((v) => set({ steer: v }));
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
    const aidKeys = ['abs', 'tc', 'stability', 'steerHelp'] as const;
    this.aids = aidKeys.map((key) => ({ key, choice: onOff((v) => set({ [key]: v })) }));
    const hints = { abs: A.absHint, tc: A.tcHint, stability: A.stabilityHint, steerHelp: A.steerHelpHint };
    const panel = h(
      'div',
      { class: 'panel assists-panel' },
      h('h2', { text: A.title }),
      h('p', { class: 'assists-intro', text: A.intro }),
      field(A.line, this.line.el, A.lineHint),
      field(A.brake, this.brake.el, A.brakeHint),
      field(A.steer, this.steer.el, A.steerHint),
      field(A.gears, this.gears.el, this.gearsHint),
      h('h3', { text: A.car }),
      h('p', { class: 'assists-intro', text: A.carIntro }),
      ...this.aids.map(({ key, choice }) => field(A[key], choice.el, hints[key])),
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
    this.line.set(a.line);
    this.brake.set(a.brake);
    this.steer.set(a.steer);
    this.gears.set(a.gears);
    for (const { key, choice } of this.aids) choice.set(a[key]);
    // The gear keys as you have them.
    const keys = settings().keys;
    this.gearsHint.textContent = fmt(STR.assists.gearsHint, { up: keysText(keys, 'gearUp') || '—', down: keysText(keys, 'gearDown') || '—' });
  }
}
