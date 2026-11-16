import { STR, fmt } from '../config/strings.ts';
import { formatTime } from '../race/session.ts';
import { button, h } from './dom.ts';

/** One car on the grid after qualifying. */
export interface GridEntry {
  name: string;
  paint: number;
  /** Best clean qualifying lap, or null for no time. */
  time: number | null;
  you: boolean;
  /** Knocked out in this session (knockout qualifying). */
  out?: boolean;
}

/**
 * After qualifying: the grid, pole first, with each car's time and gap to
 * pole, where you start, and Start race (Enter) or Race settings.
 */
export class GridOverlay {
  readonly root: HTMLElement;
  private readonly title: HTMLElement;
  private readonly startBtn: HTMLButtonElement;
  private readonly note: HTMLElement;
  private readonly list: HTMLElement;
  private abort: AbortController | null = null;
  private readonly back: HTMLButtonElement;
  private readonly actions: { start(): void; settings(): void };

  constructor(actions: { start(): void; settings(): void }) {
    this.actions = actions;
    this.note = h('p', { class: 'grid-note' });
    this.list = h('ol', { class: 'standings' });
    this.back = button(STR.buttons.raceSettings, () => this.actions.settings(), { icon: '🏁' });
    this.title = h('h2', { text: STR.grid.title });
    this.startBtn = button(STR.grid.start, () => this.actions.start(), { icon: '▶', class: 'primary', key: 'Enter' });
    this.root = h(
      'div',
      { class: 'screen overlay grid-overlay' },
      h(
        'div',
        { class: 'panel' },
        this.title,
        this.note,
        this.list,
        h('div', { class: 'menu row setup-buttons' }, this.back, this.startBtn),
      ),
    );
    this.root.hidden = true;
  }

  /**
   * The grid (or with `session`, a knockout session's classification: its
   * title, what it means for you, and the button to the next session).
   */
  show(entries: readonly GridEntry[], session?: { title: string; note: string; next: string }): void {
    const ord = (i: number) => STR.results.ordinals[i] ?? String(i + 1);
    const pole = entries[0]?.time ?? null;
    const you = entries.findIndex((e) => e.you);
    this.title.textContent = session?.title ?? STR.grid.title;
    this.note.textContent = session?.note ?? fmt(STR.grid.youStart, { pos: ord(you), n: entries.length });
    const label = this.startBtn.querySelector('.btn-label');
    if (label) label.textContent = session?.next ?? STR.grid.start;
    this.root.classList.toggle('session', !!session);
    this.list.replaceChildren(
      ...entries.map((e, i) => {
        const dot = h('i', { class: 'car-dot' });
        dot.style.background = `#${e.paint.toString(16).padStart(6, '0')}`;
        const time = e.time === null ? STR.grid.noTime : i === 0 || pole === null ? formatTime(e.time) : fmt(STR.results.gap, { t: (e.time - pole).toFixed(2) });
        return h(
          'li',
          { class: `${e.you ? 'you' : ''}${e.out ? ' out' : ''}`.trim() },
          h('span', { class: 'standing-pos', text: ord(i) }),
          dot,
          h('span', { class: 'standing-name', text: e.name }),
          e.out ? h('span', { class: 'standing-out', text: STR.grid.outTag }) : null,
          h('span', { class: 'standing-time', text: time }),
        );
      }),
    );
    this.root.hidden = false;
    this.abort?.abort();
    this.abort = new AbortController();
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.code === 'Enter' || e.code === 'NumpadEnter') {
          e.preventDefault();
          this.actions.start();
        }
      },
      { signal: this.abort.signal },
    );
  }

  /** A championship round: the other button goes back to the paddock (the grid is kept) instead of to the race settings. */
  setCareer(on: boolean): void {
    const l = this.back.querySelector('.btn-label');
    if (l) l.textContent = on ? STR.career.paddock : STR.buttons.raceSettings;
    const i = this.back.querySelector('.btn-icon');
    if (i) i.textContent = on ? '🏆' : '🏁';
  }

  hide(): void {
    this.root.hidden = true;
    this.abort?.abort();
    this.abort = null;
  }

  get visible(): boolean {
    return !this.root.hidden;
  }
}
