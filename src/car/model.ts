import {
  AdditiveBlending,
  BoxGeometry,
  BufferGeometry,
  CanvasTexture,
  CylinderGeometry,
  DynamicDrawUsage,
  ExtrudeGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  Object3D,
  PlaneGeometry,
  Quaternion,
  Shape,
  SpotLight,
  Vector3,
} from 'three';
import { HANDLING } from '../config/handling.ts';
import { DAMAGE_LOOK } from '../config/race.ts';
import { merge, tint } from '../render/geom.ts';
import type { CarState } from './physics.ts';

/** Default paint: the game's highlighter yellow. */
export const DEFAULT_PAINT = 0xf2b705;

/**
 * Side profile (z forward, y up) extruded across the car's width. Local axes:
 * +Z forward, +X to the car's left, +Y up.
 */
function profile(points: [number, number][], width: number): ExtrudeGeometry {
  const shape = new Shape();
  points.forEach(([z, y], i) => (i === 0 ? shape.moveTo(z, y) : shape.lineTo(z, y)));
  shape.closePath();
  const g = new ExtrudeGeometry(shape, { depth: width, bevelEnabled: false });
  // Shape x -> local z (forward); extrusion z -> local x (across), centred.
  g.rotateY(-Math.PI / 2);
  g.translate(width / 2, 0, 0);
  return g;
}

function paintGeometry() {
  const body = profile(
    [
      [-2.05, 0.28],
      [2.0, 0.28],
      [2.12, 0.42],
      [2.05, 0.62],
      [1.0, 0.78],
      [0.75, 0.8],
      [-1.55, 0.86],
      [-2.05, 0.82],
      [-2.12, 0.5],
    ],
    1.86,
  );
  const roof = new BoxGeometry(1.5, 0.08, 1.0).translate(0, 1.25, -0.45);
  return merge([body, roof]);
}

/** How damaged a car looks: the front bumper (on, hanging, gone), the rear wing (on, bent, gone), and scuffs. */
export interface DamageLook {
  front: 0 | 1 | 2;
  rear: 0 | 1 | 2;
  scuffs: boolean;
}

/** The look for front-wing damage `wing` and bodywork damage `body` (0..1). */
export function damageLook(wing: number, body: number): DamageLook {
  const D = DAMAGE_LOOK;
  return {
    front: wing >= D.frontGone ? 2 : wing >= D.frontHang ? 1 : 0,
    rear: body >= D.rearGone ? 2 : body >= D.rearBent ? 1 : 0,
    scuffs: Math.max(wing, body) >= D.scuffs,
  };
}

const trimCache = new Map<string, BufferGeometry>();

/** The dark trim (cabin, bumpers, skirts, rear wing), as damaged as `look` says (shared by every car with that look). */
function trimGeometry(look: DamageLook = { front: 0, rear: 0, scuffs: false }) {
  const key = `${look.front}${look.rear}${look.scuffs ? 1 : 0}`;
  const known = trimCache.get(key);
  if (known) return known;
  const cabin = tint(
    profile(
      [
        [0.8, 0.78],
        [0.15, 1.22],
        [-1.05, 1.25],
        [-1.6, 0.84],
      ],
      1.56,
    ),
    0x1d2633,
  );
  const parts = [cabin];
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, hex: number) =>
    parts.push(tint(new BoxGeometry(w, h, d).translate(x, y, z), hex));
  const part = (g: BufferGeometry, hex: number) => parts.push(tint(g, hex));
  // Front bumper: on; hanging off one side, its far end on the road; or gone (the crash structure bare).
  if (look.front === 0) box(1.7, 0.18, 0.1, 0, 0.38, 2.1, 0x24262b);
  else if (look.front === 1) part(new BoxGeometry(1.7, 0.18, 0.1).translate(0.85, 0, 0).rotateZ(-0.26).rotateY(-0.2).translate(-0.85, 0.36, 2.12), 0x24262b);
  else box(0.7, 0.12, 0.16, 0, 0.36, 2.02, 0x4a4d55);
  box(1.8, 0.16, 0.1, 0, 0.36, -2.12, 0x24262b); // rear bumper
  for (const sx of [-1, 1]) box(0.06, 0.13, 2.6, sx * 0.94, 0.33, 0, 0x24262b); // side skirt
  // Rear wing: on; bent (one strut gone, the wing twisted down at one end); or gone (just stubs).
  if (look.rear === 0) {
    for (const sx of [-1, 1]) box(0.06, 0.24, 0.12, sx * 0.6, 0.96, -1.85, 0x1b1b1b);
    box(1.8, 0.06, 0.38, 0, 1.1, -1.88, 0x1b1b1b);
  } else if (look.rear === 1) {
    box(0.06, 0.24, 0.12, 0.6, 0.96, -1.85, 0x1b1b1b);
    box(0.06, 0.1, 0.12, -0.6, 0.89, -1.85, 0x1b1b1b);
    part(new BoxGeometry(1.8, 0.06, 0.38).rotateZ(0.2).rotateX(0.18).translate(0.05, 1.03, -1.9), 0x1b1b1b);
  } else for (const sx of [-1, 1]) box(0.06, 0.08, 0.12, sx * 0.6, 0.88, -1.85, 0x1b1b1b);
  // Scuffs and scrapes on the paint.
  if (look.scuffs) {
    for (const sx of [-1, 1]) {
      box(0.02, 0.1, 0.7, sx * 0.945, 0.5, 1.25, 0x3b3d42);
      box(0.02, 0.07, 0.45, sx * 0.945, 0.62, -1.3, 0x3b3d42);
    }
    box(0.5, 0.02, 0.32, 0.35, 0.79, 1.55, 0x3b3d42);
  }
  const g = merge(parts);
  trimCache.set(key, g);
  return g;
}

/** Head and tail lights (their own unlit material, so they can shine at night). */
function lampGeometry() {
  const parts = [];
  for (const sx of [-1, 1]) {
    parts.push(tint(new BoxGeometry(0.38, 0.09, 0.06).translate(sx * 0.6, 0.52, 2.08), 0xfff6d0));
    parts.push(tint(new BoxGeometry(0.42, 0.1, 0.06).translate(sx * 0.6, 0.66, -2.11), 0xd8202a));
  }
  return merge(parts);
}

/** Soft glows round the lamps at night: white ones facing forward, red ones facing back. */
function glowGeometry() {
  const parts = [];
  for (const sx of [-1, 1]) {
    parts.push(tint(new PlaneGeometry(1.1, 0.7).translate(sx * 0.6, 0.52, 2.13), 0xfff1c8));
    parts.push(tint(new PlaneGeometry(1.0, 0.65).rotateY(Math.PI).translate(sx * 0.6, 0.66, -2.16), 0xff2a2a));
  }
  return merge(parts, true);
}

let glowTex: CanvasTexture | null = null;
function glowTexture(): CanvasTexture {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  glowTex = new CanvasTexture(c);
  return glowTex;
}

function wheelGeometry() {
  const r = HANDLING.wheelRadius;
  return merge([
    tint(new CylinderGeometry(r, r, 0.28, 12).rotateZ(Math.PI / 2), 0x1a1a1c),
    tint(new CylinderGeometry(r * 0.55, r * 0.55, 0.3, 8).rotateZ(Math.PI / 2), 0xb8bcc4),
  ]);
}

function shadowTexture(): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 4, 32, 32, 32);
    g.addColorStop(0, 'rgba(0,0,0,0.85)');
    g.addColorStop(0.6, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  return new CanvasTexture(c);
}

/** Wheel hubs in local space: front-left, front-right, rear-left, rear-right. */
const WHEELS: [number, number, number][] = [
  [0.86, HANDLING.wheelRadius, 1.3],
  [-0.86, HANDLING.wheelRadius, 1.3],
  [0.86, HANDLING.wheelRadius, -1.32],
  [-0.86, HANDLING.wheelRadius, -1.32],
];

/** The player's car: paint body, dark trim, four instanced wheels and a blob shadow (4 draw calls). */
export class CarModel {
  readonly root = new Group();
  private readonly body = new Group();
  private readonly paint: MeshLambertMaterial;
  private readonly accent: Mesh;
  private readonly lampMat: MeshBasicMaterial;
  private readonly glow: Mesh;
  /** The player's headlight beam (see addHeadlight()). */
  private beam: SpotLight | null = null;
  private readonly wheels: InstancedMesh;
  /** The dark trim (it changes as the car is damaged), and the look it has. */
  private readonly trim: Mesh;
  private look: DamageLook = { front: 0, rear: 0, scuffs: false };
  private roll = 0;
  private pitch = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly qs = new Quaternion();
  private readonly v = new Vector3();
  private readonly one = new Vector3(1, 1, 1);
  private readonly axisX = new Vector3(1, 0, 0);
  private readonly axisY = new Vector3(0, 1, 0);

  /** `ghostOpacity` > 0 makes a see-through ghost car (no shadow). */
  constructor(paint = DEFAULT_PAINT, ghostOpacity = 0) {
    const ghost = ghostOpacity > 0;
    const see = ghost ? { transparent: true, opacity: ghostOpacity, depthWrite: false } : {};
    this.paint = new MeshLambertMaterial({ color: paint, flatShading: true, ...see });
    const stripes = [
      new BoxGeometry(.3, .025, 1.0).translate(.28, .79, 1.32),
      new BoxGeometry(.3, .025, .94).translate(.28, 1.305, -.45),
      new BoxGeometry(.025, .12, 2.6).translate(.945, .55, 0),
      new BoxGeometry(.025, .12, 2.6).translate(-.945, .55, 0),
    ];
    this.accent = new Mesh(merge(stripes), new MeshLambertMaterial({ color: 0xffffff, flatShading: true, ...see }));
    this.accent.visible = false;
    const trimMat = new MeshLambertMaterial({ vertexColors: true, flatShading: true, ...see });
    this.lampMat = new MeshBasicMaterial({ vertexColors: true, color: 0xd4d4d4, ...see });
    this.glow = new Mesh(glowGeometry(), new MeshBasicMaterial({ map: glowTexture(), vertexColors: true, transparent: true, depthWrite: false, blending: AdditiveBlending }));
    this.glow.visible = false;
    this.glow.renderOrder = 3;
    this.trim = new Mesh(trimGeometry(), trimMat);
    this.body.add(new Mesh(paintGeometry(), this.paint), this.accent, this.trim, new Mesh(lampGeometry(), this.lampMat), this.glow);
    // Sharing this material with the non-instanced trim makes the renderer
    // switch shader variants twice per car, every frame (especially costly at night).
    this.wheels = new InstancedMesh(wheelGeometry(), trimMat.clone(), 4);
    this.wheels.instanceMatrix.setUsage(DynamicDrawUsage);
    if (!ghost) {
      const shadow = new Mesh(
        new PlaneGeometry(2.4, 4.8).rotateX(-Math.PI / 2),
        new MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false, opacity: 0.6 }),
      );
      shadow.position.y = 0.04;
      shadow.renderOrder = 1;
      this.root.add(shadow);
    }
    this.root.add(this.body, this.wheels);
    if (ghost) this.root.traverse((o) => (o.renderOrder = 2));
    this.placeWheels(0, 0);
    // Wheel centres and their geometry's bounding spheres do not change as
    // they steer/spin. Keep a stable conservative bound so offscreen wheels cull.
    this.wheels.computeBoundingSphere();
  }

  /** Places a ghost from a recorded pose (no suspension or wheel animation needed). */
  setPose(x: number, y: number, z: number, heading: number, pitch: number, roll: number): void {
    this.root.position.set(x, y, z);
    this.root.rotation.set(-pitch, Math.PI / 2 - heading, roll, 'YXZ');
  }

  setPaint(hex: number, secondary?: number): void {
    this.paint.color.setHex(hex);
    this.accent.visible = secondary !== undefined;
    if (secondary !== undefined) (this.accent.material as MeshLambertMaterial).color.setHex(secondary);
  }

  /** Lights on (night): the lamps shine and glow, and the headlight beam (if it has one, and `beam`) lights the road. */
  setLights(on: boolean, beam = on): void {
    this.lampMat.color.setHex(on ? 0xffffff : 0xd4d4d4);
    this.glow.visible = on;
    if (this.beam) this.beam.visible = on && beam;
  }

  /** Gives the car a real headlight beam (the player's car only: lights cost). */
  addHeadlight(): void {
    if (this.beam) return;
    const beam = new SpotLight(0xfff2d8, 90, 130, 0.5, 0.6, 1.1);
    beam.position.set(0, 1.1, 1.6);
    const target = new Object3D();
    target.position.set(0, 0, 28);
    beam.target = target;
    beam.visible = false;
    this.body.add(beam, target);
    this.beam = beam;
  }

  /**
   * Shows damage: front-wing damage `wing` and bodywork damage `body` (0..1).
   * Returns the parts that have just come off ('front': the bumper, 'rear': the
   * rear wing), for the bits on the road.
   */
  setDamage(wing: number, body: number): ('front' | 'rear')[] {
    const look = damageLook(wing, body);
    const was = this.look;
    if (look.front === was.front && look.rear === was.rear && look.scuffs === was.scuffs) return [];
    this.look = look;
    this.trim.geometry = trimGeometry(look);
    const off: ('front' | 'rear')[] = [];
    if (look.front === 2 && was.front < 2) off.push('front');
    if (look.rear === 2 && was.rear < 2) off.push('rear');
    return off;
  }

  /** The front bumper is hanging off (it scrapes the road: sparks). */
  get hanging(): boolean {
    return this.look.front === 1;
  }

  /** Places the model from an (interpolated) physics state. */
  update(st: CarState, dt: number): void {
    this.root.position.set(st.x, st.y, st.z);
    // Local +Z must point along the heading (cos h, sin h) in world (x, z); local +X is
    // the car's left. Yaw first, then the ground's pitch (nose up) and roll (left up).
    this.root.rotation.set(-st.pitch, Math.PI / 2 - st.heading, st.roll, 'YXZ');

    // Body leans out of corners and pitches under braking/acceleration (visual only).
    const k = 1 - Math.exp(-8 * dt);
    const targetRoll = Math.max(-0.06, Math.min(0.06, -st.latAccel * 0.003));
    const targetPitch = Math.max(-0.05, Math.min(0.05, -st.longAccel * 0.0025));
    this.roll += (targetRoll - this.roll) * k;
    this.pitch += (targetPitch - this.pitch) * k;
    this.body.rotation.set(this.pitch, 0, this.roll);

    this.placeWheels(st.steer, st.spin);
  }

  private placeWheels(steerAngle: number, spin: number): void {
    WHEELS.forEach(([x, y, z], i) => {
      const steer = i < 2 ? -steerAngle : 0; // + steer = right = towards local -X
      this.q.setFromAxisAngle(this.axisY, steer).multiply(this.qs.setFromAxisAngle(this.axisX, spin));
      this.m.compose(this.v.set(x, y, z), this.q, this.one);
      this.wheels.setMatrixAt(i, this.m);
    });
    this.wheels.instanceMatrix.needsUpdate = true;
  }
}
