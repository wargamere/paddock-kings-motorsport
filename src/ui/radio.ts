import { ENGINEER } from '../config/race.ts';
import { STR } from '../config/strings.ts';
import { h } from './dom.ts';
import type { RadioCall } from '../race/engineer.ts';

/** Your race engineer's radio: the last message, for a few seconds (urgent ones in red). */
export class Radio {
  readonly root: HTMLElement;
  private readonly text: HTMLElement;
  private left = 0;

  constructor() {
    this.text = h('div', { class: 'radio-text' });
    const wave = h('span', { class: 'radio-wave' }, h('i'), h('i'), h('i'));
    wave.setAttribute('aria-hidden', 'true');
    this.root = h('div', { class: 'radio' }, h('div', { class: 'radio-label' }, wave, STR.engineer.label), this.text);
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
  }

  say(call: RadioCall): void {
    this.text.textContent = call.text;
    this.root.classList.toggle('urgent', call.urgent);
    this.root.classList.add('on');
    this.left = ENGINEER.show;
  }

  /** Real time passing (s): the message goes after a while. */
  tick(dt: number): void {
    if (this.left <= 0) return;
    this.left -= dt;
    if (this.left <= 0) this.root.classList.remove('on');
  }

  hide(): void {
    this.left = 0;
    this.root.classList.remove('on');
  }
}
