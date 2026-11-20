import type { CarPhysics, CarState } from '../car/physics.ts';
import { STR } from '../config/strings.ts';
import { GripFeedback, proximity, type ProximityState } from '../race/awareness.ts';
import { h } from './dom.ts';

/** Shared by both players; quiet until a rival is alongside or a tyre loses grip. */
export class DrivingIndicators {
  readonly root: HTMLElement;
  private readonly left = h('span', { class: 'proximity-side left', text: `◀ ${STR.driving.left}` });
  private readonly right = h('span', { class: 'proximity-side right', text: `${STR.driving.right} ▶` });
  private readonly grip = h('span', { class: 'grip-warning' });
  private readonly feedback = new GripFeedback();
  private readonly sides: ProximityState = { left: 0, right: 0 };
  private key = '';

  constructor() {
    this.root = h('div', { class: 'driving-indicators' }, h('div', { class: 'proximity-alerts' }, this.left, this.right), this.grip);
    this.root.hidden = true;
    this.root.setAttribute('role', 'status');
    this.root.setAttribute('aria-live', 'polite');
  }

  clear(): void { this.feedback.reset(); this.key = ''; this.root.hidden = true; }

  update(me: CarState, cars: readonly CarState[], car: CarPhysics, dt: number, radar: boolean, feedback: boolean): void {
    if (radar) proximity(me, cars, this.sides); else this.sides.left = this.sides.right = 0;
    const contacts = car.contacts;
    const front = Math.max(Math.abs(contacts[0].alpha), Math.abs(contacts[1].alpha));
    const rear = Math.max(Math.abs(contacts[2].alpha), Math.abs(contacts[3].alpha));
    if (!feedback) this.feedback.reset();
    const warning = feedback ? this.feedback.update(car.state.lockup, car.state.wheelspin, front, rear, Math.abs(car.state.speed), dt) : '';
    const { left, right } = this.sides, key = `${left}:${right}:${warning}`;
    if (key === this.key) return; this.key = key;
    this.left.hidden = !left; this.right.hidden = !right;
    this.left.dataset.severity = String(left); this.right.dataset.severity = String(right);
    this.grip.hidden = !warning; this.grip.textContent = warning ? STR.driving[warning] : '';
    this.root.hidden = !left && !right && !warning;
  }
}
