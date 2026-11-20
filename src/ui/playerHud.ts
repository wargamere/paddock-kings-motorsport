import { STR } from '../config/strings.ts';
import { h } from './dom.ts';
import { DrivingIndicators } from './drivingIndicators.ts';

/** What player 2's HUD shows, each frame. */
export interface PlayerHudState {
  /** "P3/8", "LAP 2/5", the lap time. */
  pos: string;
  lap: string;
  time: string;
  speed: number;
  gear: number;
  /** Tyres left (0..1; null without tyre wear), damage (null: off). */
  tyres: number | null;
  damage: number | null;
  /** DRS and the boost (null: not in this race). */
  power: { drs: 'off' | 'armed' | 'open'; battery: number; boosting: boolean } | null;
  /** In the pit lane, or the safety car is out, or a yellow flag: a line across the top. */
  flag: string | null;
}

/**
 * Split screen: player 2's HUD, on the bottom half of the screen. Who it is,
 * position, lap and lap time at the top; speed, gear, tyres, damage, DRS and
 * the boost at the bottom right; messages (lap times, the flag) in the middle.
 */
export class PlayerHud {
  readonly driving = new DrivingIndicators();
  readonly root: HTMLElement;
  private readonly pos: HTMLElement;
  private readonly lap: HTMLElement;
  private readonly time: HTMLElement;
  private readonly speed: HTMLElement;
  private readonly gear: HTMLElement;
  private readonly tyres: HTMLElement;
  private readonly damage: HTMLElement;
  private readonly power: HTMLElement;
  private readonly drs: HTMLElement;
  private readonly ers: HTMLElement;
  private readonly flagLine: HTMLElement;
  private readonly msg: HTMLElement;
  private msgLeft = 0;
  private last: Record<string, string> = {};

  constructor() {
    const P = STR.race;
    this.pos = h('span', { class: 'p2-pos' });
    this.lap = h('span', { class: 'p2-lap' });
    this.time = h('span', { class: 'p2-time' });
    this.speed = h('span', { class: 'p2-speed' });
    this.gear = h('span', { class: 'p2-gear' });
    this.tyres = h('span', { class: 'p2-tyres' });
    this.damage = h('span', { class: 'p2-damage' });
    this.drs = h('span', { class: 'drs-chip', text: P.drs });
    this.ers = h('div', { class: 'ers-fill' });
    this.power = h('div', { class: 'hud-power p2-power' }, this.drs, h('span', { class: 'ers-label', text: P.boost }), h('div', { class: 'ers-bar' }, this.ers), h('span', { class: 'ers-key', text: P.p2BoostKey }));
    this.flagLine = h('div', { class: 'p2-flag' });
    this.msg = h('div', { class: 'p2-msg' });
    this.root = h(
      'div',
      { class: 'screen p2-hud' },
      h('div', { class: 'p2-top' }, h('span', { class: 'p2-name', text: P.player2 }), this.pos, this.lap, this.time),
      this.flagLine,
      this.msg,
      this.driving.root,
      h('div', { class: 'p2-panel' }, h('div', { class: 'p2-row' }, this.gear, this.speed, h('span', { class: 'speed-unit', text: P.speedUnit })), h('div', { class: 'p2-row p2-small' }, this.tyres, this.damage), this.power),
    );
  }

  /** Sets an element's text only when it changed (no layout work otherwise). */
  private text(key: string, el: HTMLElement, value: string): void {
    if (this.last[key] === value) return;
    this.last[key] = value;
    el.textContent = value;
  }

  update(s: PlayerHudState): void {
    this.text('pos', this.pos, s.pos);
    this.text('lap', this.lap, s.lap);
    this.text('time', this.time, s.time);
    this.text('speed', this.speed, String(Math.round(Math.abs(s.speed) * 3.6)));
    this.text('gear', this.gear, String(s.gear));
    this.text('tyres', this.tyres, s.tyres === null ? '' : `${STR.race.tyresShort} ${Math.round(s.tyres * 100)}%`);
    this.text('damage', this.damage, s.damage === null || s.damage < 0.01 ? '' : `${STR.race.damageShort} ${Math.round(s.damage * 100)}%`);
    this.damage.classList.toggle('bad', (s.damage ?? 0) >= 0.5);
    this.power.hidden = !s.power;
    if (s.power) {
      this.text('drs', this.drs, s.power.drs === 'armed' ? STR.race.drsReady : STR.race.drs);
      if (this.drs.className !== `drs-chip ${s.power.drs}`) this.drs.className = `drs-chip ${s.power.drs}`;
      this.text('ers', this.ers, '');
      const pct = `${Math.round(s.power.battery * 50) * 2}%`;
      if (this.ers.style.width !== pct) this.ers.style.width = pct;
      this.power.classList.toggle('boosting', s.power.boosting);
    }
    this.text('flag', this.flagLine, s.flag ?? '');
    this.flagLine.hidden = !s.flag;
  }

  /** A message across player 2's half for `seconds` s. */
  flash(text: string, seconds = 2): void {
    this.msg.textContent = text;
    this.msg.classList.add('on');
    this.msgLeft = seconds;
  }

  tick(dt: number): void {
    if (this.msgLeft <= 0) return;
    this.msgLeft -= dt;
    if (this.msgLeft <= 0) this.msg.classList.remove('on');
  }

  clear(): void {
    this.driving.clear();
    this.msgLeft = 0;
    this.msg.classList.remove('on');
  }
}
