import { Vector3, type PerspectiveCamera } from 'three';
import { CameraRig } from '../car/camera.ts';
import { CarModel } from '../car/model.ts';
import { CarState } from '../car/physics.ts';
import { REPLAY } from '../config/replay.ts';
import { STR, fmt } from '../config/strings.ts';
import type { GameContext, Screen } from '../core/screen.ts';
import { platform } from '../platform/services.ts';
import { leftOf, sampleAt } from '../track/spline.ts';
import { surfaceFor, terrainHeight } from '../track/surface.ts';
import type { Track } from '../track/track.ts';
import { button, h, segmented, type Choice } from '../ui/dom.ts';
import { distAt, highlights, orderAt, poseAt, safetyCarAt, type Highlight, type Replay, type ReplayEvent } from './replay.ts';
import { formatTime } from './session.ts';

type Cam = 'tv' | 'chase' | 'onboard' | 'heli';
const CAMS: readonly Cam[] = ['tv', 'chase', 'onboard', 'heli'];

/** A trackside TV camera: where it stands, and the point round the track it covers. */
interface TvCamera {
  s: number;
  x: number;
  y: number;
  z: number;
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;
const tvCache = new WeakMap<Track, TvCamera[]>();

/**
 * The TV cameras round a track: one every REPLAY.tvSpacing m, beyond the
 * barrier on the outside of the bend there (where real cameras stand to
 * see the cars come through), up on a stand.
 */
export function tvCameras(track: Track): TvCamera[] {
  const known = tvCache.get(track);
  if (known) return known;
  const c = track.center, R = REPLAY, terrain = surfaceFor(track).terrain;
  const out: TvCamera[] = [];
  for (let s = 0; s < c.length; s += R.tvSpacing) {
    const at = sampleAt(c, s), i = Math.round(s / c.spacing) % c.points.length;
    // (+ curvature is a right-hander: its outside is on the left.)
    const side = c.curvature[i] >= 0 ? 1 : -1;
    const l = leftOf(at.t), d = c.wallOffset + R.tvOffset;
    const x = at.p.x + l.x * side * d, z = at.p.y + l.y * side * d;
    out.push({ s, x, z, y: Math.max(at.h, terrainHeight(terrain, x, z)) + R.tvHeight });
  }
  tvCache.set(track, out);
  return out;
}

/**
 * REPLAY state: the last race again, from TV cameras round the track, the
 * chase or onboard camera, or a helicopter. Highlights plays the best
 * moments one after another (the start, passes, crashes, pit stops, the
 * finish), following the car in each; Full race plays it all, with a scrub
 * bar. Space plays and pauses, ← → skip, ↑ ↓ change the car followed, C the
 * camera, H highlights or the full race, 1–4 the speed, Esc goes back.
 */
export class ReplayScreen implements Screen {
  readonly layer = '3d';
  private readonly game: GameContext;
  private readonly root: HTMLElement;
  private readonly models: CarModel[] = [];
  private readonly labels: HTMLElement[] = [];
  private scModel: CarModel | null = null;
  private readonly poses: CarState[] = [];
  private readonly rig = new CameraRig();
  private replay: Replay | null = null;
  private clips: Highlight[] = [];
  private clip = 0;
  private t = 0;
  private playing = true;
  private speed = 1;
  private cam: Cam = 'tv';
  private follow = 0;
  private mode: 'highlights' | 'full' = 'highlights';
  /** The TV camera filming now, and for how long it has. */
  private tv = -1;
  private tvFor = 0;
  private readonly heli = new Vector3();
  private abort: AbortController | null = null;
  private restore: (() => void) | null = null;
  private readonly labelPos = new Vector3();
  // UI.
  private readonly caption: HTMLElement;
  private readonly lapLine: HTMLElement;
  private readonly modeLine: HTMLElement;
  private readonly order: HTMLElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly scrub: HTMLInputElement;
  private readonly clock: HTMLElement;
  private readonly followName: HTMLElement;
  private readonly camChoice: Choice<Cam>;
  private readonly speedChoice: Choice<number>;
  private readonly modeChoice: Choice<'highlights' | 'full'>;

  constructor(game: GameContext) {
    this.game = game;
    const R = STR.replay;
    this.caption = h('div', { class: 'replay-caption' });
    this.lapLine = h('div', { class: 'replay-lap' });
    this.modeLine = h('div', { class: 'replay-mode' });
    this.order = h('ol', { class: 'replay-order' });
    this.playBtn = button('', () => this.togglePlay(), { icon: '⏸', class: 'compact', title: R.pause });
    this.scrub = h('input', { class: 'range replay-scrub' });
    this.scrub.type = 'range';
    this.scrub.min = '0';
    this.scrub.step = '0.1';
    this.scrub.tabIndex = -1;
    this.scrub.setAttribute('aria-label', R.scrub);
    this.scrub.addEventListener('input', () => this.seek(Number(this.scrub.value)));
    this.scrub.addEventListener('keydown', (e) => e.stopPropagation());
    this.clock = h('span', { class: 'replay-clock' });
    this.followName = h('span', { class: 'replay-follow-name' });
    this.camChoice = segmented<Cam>(CAMS.map((c) => [c, R.cams[c]]), (c) => this.setCam(c));
    this.speedChoice = segmented<number>(REPLAY.speeds.map((v) => [v, `${v}×`]), (v) => this.setSpeed(v));
    this.modeChoice = segmented<'highlights' | 'full'>([['highlights', R.highlights], ['full', R.full]], (m) => this.setMode(m));
    const bar = h(
      'div',
      { class: 'replay-bar' },
      h('div', { class: 'replay-row' },
        button('', () => this.skip(-1), { icon: '⏮', class: 'compact', title: R.back10 }),
        this.playBtn,
        button('', () => this.skip(1), { icon: '⏭', class: 'compact', title: R.next }),
        this.scrub,
        this.clock),
      h('div', { class: 'replay-row' },
        this.modeChoice.el,
        this.camChoice.el,
        h('div', { class: 'replay-follow' }, button('', () => this.cycleCar(-1), { icon: '‹', class: 'compact', title: R.prevCar }), this.followName, button('', () => this.cycleCar(1), { icon: '›', class: 'compact', title: R.nextCar })),
        this.speedChoice.el,
        button(R.close, () => this.close(), { icon: '✕', class: 'compact', key: 'Esc' })),
      h('p', { class: 'replay-keys', text: R.keys }),
    );
    this.root = h('div', { class: 'screen replay' }, h('div', { class: 'replay-top' }, h('span', { class: 'replay-badge', text: R.badge }), this.modeLine, this.lapLine), this.caption, this.order, bar);
  }

  enter(): void {
    const r = this.game.lastReplay;
    const v = this.game.view3d;
    if (!r || !v) {
      this.game.go(this.game.replayBack);
      return;
    }
    this.replay = r;
    platform.setGameplay(false);
    v.setTrack(r.track);
    v.setConditions({ time: r.time, rain: r.rain });
    this.restore = null;
    // A model and a name tag for every car.
    while (this.models.length < r.cars.length) {
      const m = new CarModel();
      m.root.visible = false;
      this.models.push(m);
      v.scene.add(m.root);
      const label = h('div', { class: 'ghost-label ai-label' });
      label.hidden = true;
      this.labels.push(label);
      this.poses.push(new CarState());
    }
    if (!this.scModel) {
      this.scModel = new CarModel(0xf4f4f0);
      v.scene.add(this.scModel.root);
    }
    r.cars.forEach((c, i) => {
      this.models[i].setPaint(c.paint, c.secondary);
      this.models[i].setLights(v.night, false);
      this.labels[i].textContent = c.name;
    });
    const terrain = surfaceFor(r.track).terrain;
    this.rig.groundAt = (x, z) => terrainHeight(terrain, x, z);
    this.scrub.max = String((r.count - 1) * r.dt);
    this.clips = highlights(r);
    this.follow = Math.max(0, r.cars.findIndex((c) => c.you));
    this.speed = 1;
    this.speedChoice.set(1);
    this.playing = true;
    this.setMode(this.clips.length ? 'highlights' : 'full');
    this.setCam('tv');
    this.game.ui.append(this.root);
    for (const l of this.labels) this.root.append(l);
    this.abort = new AbortController();
    window.addEventListener('keydown', (e) => this.onKey(e), { signal: this.abort.signal });
  }

  exit(): void {
    this.abort?.abort();
    this.abort = null;
    this.root.remove();
    for (const m of this.models) m.root.visible = false;
    for (const l of this.labels) l.hidden = true;
    if (this.scModel) this.scModel.root.visible = false;
    this.restore?.();
    this.game.view3d?.setConditions(null);
    this.replay = null;
  }

  resize(): void {
    const s = this.game.surface;
    this.game.view3d?.resize(s.w, s.h);
  }

  private onKey(e: KeyboardEvent): void {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const act: Record<string, () => void> = {
      Escape: () => this.close(),
      Space: () => this.togglePlay(),
      ArrowLeft: () => this.skip(-1),
      ArrowRight: () => this.skip(1),
      ArrowUp: () => this.cycleCar(-1),
      ArrowDown: () => this.cycleCar(1),
      KeyC: () => this.setCam(CAMS[(CAMS.indexOf(this.cam) + 1) % CAMS.length]),
      KeyH: () => this.setMode(this.mode === 'highlights' ? 'full' : 'highlights'),
      Digit1: () => this.setSpeed(REPLAY.speeds[0]),
      Digit2: () => this.setSpeed(REPLAY.speeds[1]),
      Digit3: () => this.setSpeed(REPLAY.speeds[2]),
      Digit4: () => this.setSpeed(REPLAY.speeds[3]),
    };
    const a = act[e.code];
    if (!a || (e.repeat && e.code !== 'ArrowLeft' && e.code !== 'ArrowRight')) return;
    e.preventDefault();
    a();
  }

  private close(): void {
    this.game.go(this.game.replayBack);
  }

  private togglePlay(): void {
    const r = this.replay;
    if (!r) return;
    // At the end: from the start again.
    if (!this.playing && this.t >= (r.count - 1) * r.dt - 0.05) this.seek(this.mode === 'highlights' && this.clips.length ? this.clips[0].from : 0, this.mode === 'highlights' ? 0 : undefined);
    this.playing = !this.playing;
    this.renderButtons();
  }

  private setSpeed(v: number): void {
    this.speed = v;
    this.speedChoice.set(v);
  }

  private setCam(c: Cam): void {
    this.cam = c;
    this.camChoice.set(c);
    this.tv = -1;
    const st = this.poses[this.follow];
    if (st && this.replay && poseAt(this.replay, this.follow, this.t, st)) {
      this.rig.mode = c === 'onboard' ? 'bonnet' : 'chase';
      this.rig.snap(st);
      this.heli.set(st.x, st.y + 30, st.z);
    }
  }

  private setMode(m: 'highlights' | 'full'): void {
    this.mode = m;
    this.modeChoice.set(m);
    if (m === 'highlights' && this.clips.length) {
      // The highlight under way, or the next one.
      const k = this.clips.findIndex((c) => c.to > this.t);
      this.seek(this.clips[Math.max(0, k)].from, Math.max(0, k));
    }
    this.renderButtons();
  }

  /** Jumps to `t` (s); in highlights, to clip `clip` (following its car). */
  private seek(t: number, clip?: number): void {
    const r = this.replay;
    if (!r) return;
    this.t = Math.max(0, Math.min((r.count - 1) * r.dt, t));
    if (clip !== undefined && this.clips[clip]) {
      this.clip = clip;
      this.follow = this.clips[clip].car;
    }
    this.tv = -1;
    this.setCam(this.cam);
  }

  /** Back or on: the previous or next highlight; in the full race, 10 s. */
  private skip(d: number): void {
    if (this.mode === 'highlights' && this.clips.length) {
      // (Back to the start of this one if it's well under way.)
      const k = d < 0 && this.t - this.clips[this.clip].from > 3 ? this.clip : Math.max(0, Math.min(this.clips.length - 1, this.clip + d));
      this.seek(this.clips[k].from, k);
    } else this.seek(this.t + d * 10);
  }

  private cycleCar(d: number): void {
    const r = this.replay;
    if (!r) return;
    // In race order: the car ahead or behind the one followed.
    const order = orderAt(r, this.t);
    const k = order.indexOf(this.follow);
    this.follow = order[(k + d + order.length) % order.length];
    this.tv = -1;
    this.setCam(this.cam);
  }

  private renderButtons(): void {
    const icon = this.playBtn.querySelector('.btn-icon');
    if (icon) icon.textContent = this.playing ? '⏸' : '▶';
    this.playBtn.title = this.playing ? STR.replay.pause : STR.replay.play;
    this.root.classList.toggle('highlights', this.mode === 'highlights');
  }

  /** The words for a moment of the race. */
  private describe(e: ReplayEvent): string {
    const R = STR.replay, cars = this.replay!.cars, a = cars[e.cars[0]]?.name ?? '', b = cars[e.cars[1]]?.name ?? '';
    const lap = e.lap ? fmt(R.lap, { n: e.lap }) + ' · ' : '';
    const you = !!cars[e.cars[0]]?.you, youB = !!cars[e.cars[1]]?.you, Y = R.yours;
    const pos = e.pos ?? 0;
    switch (e.kind) {
      case 'start': return R.events.start;
      case 'pass': return lap + fmt(you ? Y.pass : youB ? Y.passed : R.events.pass, { a, b, pos });
      case 'contact': return lap + (you ? Y.contact : fmt(R.events.contact, { a }));
      case 'pit': return lap + fmt(you ? Y.pit : R.events.pit, { a, pos });
      case 'retire': return lap + (you ? Y.retire : fmt(R.events.retire, { a }));
      case 'safetyCar': return R.events.safetyCar;
      case 'finish': return you ? Y.finish : fmt(R.events.finish, { a });
    }
  }

  frame(dt: number): void {
    const v = this.game.view3d, r = this.replay;
    if (!v || !r) return;
    const end = (r.count - 1) * r.dt;
    if (this.playing) {
      this.t += dt * this.speed;
      if (this.mode === 'highlights' && this.clips.length) {
        // The end of a highlight: on to the next one, or stop after the last.
        const c = this.clips[this.clip];
        if (this.t > c.to) {
          if (this.clip + 1 < this.clips.length) this.seek(this.clips[this.clip + 1].from, this.clip + 1);
          else {
            this.t = Math.min(c.to, end);
            this.playing = false;
            this.renderButtons();
          }
        }
      }
      if (this.t >= end) {
        this.t = end;
        this.playing = false;
        this.renderButtons();
      }
    }
    // The cars.
    r.cars.forEach((_, i) => {
      const st = this.poses[i], m = this.models[i];
      const on = poseAt(r, i, this.t, st);
      m.root.visible = on;
      if (!on) return;
      st.spin = (st.spin + st.speed * dt * this.speed * (this.playing ? 1 : 0) / 0.33) % (Math.PI * 2);
      m.update(st, dt);
    });
    const sc = safetyCarAt(r, this.t);
    if (this.scModel) {
      this.scModel.root.visible = !!sc;
      if (sc) this.scModel.setPose(sc.x, sc.y, sc.z, sc.heading, 0, 0);
    }
    // The car followed may have gone (retired and taken away): the leader then.
    if (!poseAt(r, this.follow, this.t, this.poses[this.follow])) this.follow = orderAt(r, this.t)[0];
    this.placeCamera(v.camera, dt);
    for (let i = 0; i < r.cars.length; i++) this.placeLabel(i, v.camera);
    v.render();
    this.renderOverlay();
  }

  private placeCamera(cam: PerspectiveCamera, dt: number): void {
    const r = this.replay!, st = this.poses[this.follow];
    if (this.cam === 'chase' || this.cam === 'onboard') {
      this.rig.update(cam, st, dt);
      return;
    }
    let fov = 55;
    if (this.cam === 'heli') {
      // High behind, easing after the car.
      const back = 38, k = 1 - Math.exp(-2.5 * dt);
      this.heli.lerp(this.labelPos.set(st.x - Math.cos(st.heading) * back, st.y + 30, st.z - Math.sin(st.heading) * back), k);
      cam.position.copy(this.heli);
      fov = 50;
    } else {
      // TV: the trackside camera covering where the car is; it cuts when the car has gone by.
      const cams = tvCameras(r.track), L = r.track.center.length, R = REPLAY;
      const s = ((distAt(r, this.follow, this.t) % L) + L) % L;
      const ahead = (k: number) => {
        let d = (cams[k].s - s) % L;
        if (d < -L / 2) d += L;
        if (d > L / 2) d -= L;
        return d;
      };
      const inView = (k: number) => k >= 0 && ahead(k) >= -R.tvWindow[0] && ahead(k) <= R.tvWindow[1];
      this.tvFor += dt;
      if (!inView(this.tv) || (this.tvFor > R.tvHold * 3 && ahead(this.tv) < -R.tvWindow[0] / 2)) {
        let best = -1;
        for (let k = 0; k < cams.length; k++) if (inView(k) && (best < 0 || Math.abs(ahead(k) - R.tvLead) < Math.abs(ahead(best) - R.tvLead))) best = k;
        if (best !== this.tv) this.tvFor = 0;
        this.tv = best;
      }
      const c = cams[this.tv];
      if (c) {
        cam.position.set(c.x, c.y, c.z);
        const d = Math.hypot(st.x - c.x, st.z - c.z, st.y - c.y);
        fov = Math.max(6, Math.min(60, (2 * Math.atan(R.tvFrame / 2 / Math.max(1, d)) * 180) / Math.PI));
      } else cam.position.set(st.x - Math.cos(st.heading) * 12, st.y + 5, st.z - Math.sin(st.heading) * 12);
    }
    cam.up.set(0, 1, 0);
    cam.lookAt(st.x, st.y + 0.7, st.z);
    if (Math.abs(cam.fov - fov) > 0.01) {
      cam.fov = fov;
      cam.updateProjectionMatrix();
    }
  }

  /** A car's name tag over it on screen (near the camera only). */
  private placeLabel(i: number, cam: PerspectiveCamera): void {
    const el = this.labels[i], st = this.poses[i], m = this.models[i];
    const near = m.root.visible && cam.position.distanceTo(this.labelPos.set(st.x, st.y, st.z)) < (this.cam === 'tv' ? 160 : 90);
    if (!near) {
      el.hidden = true;
      return;
    }
    const p = this.labelPos.set(st.x, st.y + 2.3, st.z).project(cam);
    const visible = p.z < 1 && Math.abs(p.x) < 1.05 && Math.abs(p.y) < 1.05;
    el.hidden = !visible;
    if (!visible) return;
    const s = this.game.surface;
    el.style.transform = `translate(${((p.x + 1) / 2) * s.w}px, ${((1 - p.y) / 2) * s.h}px) translate(-50%, -100%)`;
    el.classList.toggle('followed', i === this.follow);
  }

  private renderOverlay(): void {
    const r = this.replay!, R = STR.replay;
    const end = (r.count - 1) * r.dt;
    if (document.activeElement !== this.scrub) this.scrub.value = String(this.t);
    const clock = `${formatTime(this.t).slice(0, -3)} / ${formatTime(end).slice(0, -3)}`;
    if (this.clock.textContent !== clock) this.clock.textContent = clock;
    const L = r.track.center.length, lead = orderAt(r, this.t)[0];
    const lap = fmt(R.lapOf, { n: Math.min(r.laps, Math.max(1, Math.floor(distAt(r, lead, this.t) / L) + 1)), total: r.laps });
    if (this.lapLine.textContent !== lap) this.lapLine.textContent = lap;
    const mode = this.mode === 'highlights' && this.clips.length ? fmt(R.clipOf, { n: this.clip + 1, total: this.clips.length }) : R.full;
    if (this.modeLine.textContent !== mode) this.modeLine.textContent = mode;
    const name = r.cars[this.follow]?.name ?? '';
    if (this.followName.textContent !== name) this.followName.textContent = name;
    // The moment on screen: the highlight's own, or in the full race any moment just now.
    const near = this.mode === 'highlights' && this.clips.length ? this.clips[this.clip].event : r.events.filter((e) => e.t <= this.t && this.t - e.t < 4).at(-1);
    const caption = near && Math.abs(this.t - near.t) < 6 ? this.describe(near) : '';
    if (this.caption.textContent !== caption) this.caption.textContent = caption;
    this.caption.hidden = !caption;
    // The order: the top ten, and the car followed.
    const order = orderAt(r, this.t);
    const rows = order.slice(0, 10);
    if (!rows.includes(this.follow)) rows.push(this.follow);
    const key = rows.join(',') + '|' + this.follow;
    if (this.order.dataset.key === key) return;
    this.order.dataset.key = key;
    this.order.replaceChildren(...rows.map((i) => {
      const c = r.cars[i];
      const dot = h('i', { class: 'car-dot' });
      dot.style.background = hex(c.paint);
      return h('li', { class: `${i === this.follow ? 'followed' : ''}${c.you ? ' you' : ''}`.trim() }, h('span', { class: 'replay-pos', text: String(order.indexOf(i) + 1) }), dot, h('span', { text: c.name }));
    }));
  }
}

