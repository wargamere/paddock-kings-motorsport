import { BoxGeometry, BufferGeometry, CylinderGeometry, Float32BufferAttribute, PlaneGeometry, Quaternion, SphereGeometry, Vector3 } from 'three';
import { HANDLING } from '../config/handling.ts';
import { merge, tint } from '../render/geom.ts';
import type { DamageLook } from './model.ts';

/**
 * An open-wheel formula car, built from simple solids. Local axes as the rest
 * of car/model.ts: +Z forward, +X to the car's left, +Y up. It keeps the
 * saloon's footprint (wheels at the same hubs, about 4.5 m long and 2 m wide
 * over the wings), so the physics, collisions and effects line up exactly.
 *
 * Parts: the painted bodywork (nose, tub, sidepods, engine cover); the
 * livery's second colour (stripes, see setPaint); the carbon trim (floor,
 * wings, halo, suspension, mirrors, the driver), which shows damage; lamps,
 * their glows at night, and the wheels.
 */

/** A cross-section of a lofted part: at `z`, `w` half-wide at the bottom (`tw` at the top), from `y0` up to `y1`, centred on `x`. */
interface Sec {
  z: number;
  w: number;
  y0: number;
  y1: number;
  tw?: number;
  x?: number;
}

const CARBON = 0x17191d;
const CARBON_LIGHT = 0x2a2d33;
const PLANK = 0x3a2e22;
const HELMET = 0xf3f3f1;
const VISOR = 0x0b0d12;

/**
 * A solid lofted through cross-sections (four corners each), flat shaded,
 * every face turned to face outwards; its ends closed.
 */
function loft(secs: readonly Sec[]): BufferGeometry {
  const corners = (s: Sec): Vector3[] => {
    const x = s.x ?? 0;
    const tw = s.tw ?? s.w;
    return [new Vector3(x + s.w, s.y0, s.z), new Vector3(x - s.w, s.y0, s.z), new Vector3(x - tw, s.y1, s.z), new Vector3(x + tw, s.y1, s.z)];
  };
  const centre = new Vector3();
  for (const s of secs) centre.add(new Vector3(s.x ?? 0, (s.y0 + s.y1) / 2, s.z));
  centre.divideScalar(secs.length);
  const pos: number[] = [];
  const e1 = new Vector3();
  const e2 = new Vector3();
  const mid = new Vector3();
  const tri = (a: Vector3, b: Vector3, c: Vector3) => {
    // Facing out: away from the part's middle.
    const n = e1.subVectors(b, a).cross(e2.subVectors(c, a));
    mid.copy(a).add(b).add(c).divideScalar(3).sub(centre);
    const [p, q, r] = n.dot(mid) >= 0 ? [a, b, c] : [a, c, b];
    pos.push(p.x, p.y, p.z, q.x, q.y, q.z, r.x, r.y, r.z);
  };
  const quad = (a: Vector3, b: Vector3, c: Vector3, d: Vector3) => {
    tri(a, b, c);
    tri(a, c, d);
  };
  const ring = secs.map(corners);
  for (let i = 0; i + 1 < ring.length; i++) {
    const A = ring[i];
    const B = ring[i + 1];
    for (let k = 0; k < 4; k++) quad(A[k], A[(k + 1) % 4], B[(k + 1) % 4], B[k]);
  }
  for (const end of [ring[0], ring[ring.length - 1]]) quad(end[0], end[1], end[2], end[3]);
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** A bar `t` thick from point `a` to point `b` (wishbones, the halo). */
function bar(a: [number, number, number], b: [number, number, number], t: number): BufferGeometry {
  const A = new Vector3(...a);
  const B = new Vector3(...b);
  const len = A.distanceTo(B);
  const g = new BoxGeometry(t, t, len);
  const q = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), B.clone().sub(A).normalize());
  g.applyQuaternion(q);
  const m = A.add(B).multiplyScalar(0.5);
  g.translate(m.x, m.y, m.z);
  return g;
}

/** Both sides: `make(s)` with s = +1 (left) and -1 (right). */
const both = (make: (s: number) => BufferGeometry): BufferGeometry[] => [make(1), make(-1)];

/** The painted bodywork: nose, tub, sidepods, engine cover and fin. */
export function formulaPaint(): BufferGeometry {
  const nose = loft([
    { z: 2.28, w: 0.09, y0: 0.24, y1: 0.33, tw: 0.07 },
    { z: 1.75, w: 0.17, y0: 0.18, y1: 0.45, tw: 0.13 },
    { z: 1.05, w: 0.29, y0: 0.12, y1: 0.6, tw: 0.21 },
  ]);
  const tub = loft([
    { z: 1.05, w: 0.29, y0: 0.12, y1: 0.6, tw: 0.21 },
    { z: 0.5, w: 0.36, y0: 0.07, y1: 0.67, tw: 0.27 },
    { z: -0.25, w: 0.36, y0: 0.07, y1: 0.67, tw: 0.27 },
  ]);
  const cover = loft([
    { z: -0.08, w: 0.3, y0: 0.2, y1: 0.7, tw: 0.2 },
    { z: -0.3, w: 0.32, y0: 0.2, y1: 1.02, tw: 0.11 },
    { z: -0.62, w: 0.33, y0: 0.2, y1: 0.9, tw: 0.13 },
    { z: -1.25, w: 0.22, y0: 0.08, y1: 0.58, tw: 0.09 },
    { z: -1.78, w: 0.12, y0: 0.14, y1: 0.42, tw: 0.06 },
  ]);
  const fin = loft([
    { z: -0.5, w: 0.012, y0: 0.9, y1: 1.0 },
    { z: -1.55, w: 0.012, y0: 0.55, y1: 0.98 },
  ]);
  // Sidepods: wide at the inlets, narrowing to the rear ("coke bottle").
  const pods = both((s) =>
    loft([
      { z: 0.6, w: 0.22, y0: 0.08, y1: 0.56, tw: 0.18, x: s * 0.6 },
      { z: 0.32, w: 0.29, y0: 0.07, y1: 0.6, tw: 0.25, x: s * 0.62 },
      { z: -0.55, w: 0.25, y0: 0.07, y1: 0.55, tw: 0.2, x: s * 0.56 },
      { z: -1.2, w: 0.1, y0: 0.08, y1: 0.38, tw: 0.07, x: s * 0.36 },
    ]),
  );
  return merge([nose, tub, cover, fin, ...pods]);
}

/** The livery's second colour: a stripe down the nose and the engine cover, and the sidepod tops. */
export function formulaAccent(): BufferGeometry {
  const noseStripe = loft([
    { z: 2.2, w: 0.035, y0: 0.335, y1: 0.345 },
    { z: 1.75, w: 0.06, y0: 0.455, y1: 0.465 },
    { z: 1.1, w: 0.09, y0: 0.605, y1: 0.615 },
  ]);
  const coverStripe = loft([
    { z: -0.32, w: 0.05, y0: 1.022, y1: 1.032 },
    { z: -0.62, w: 0.06, y0: 0.902, y1: 0.912 },
    { z: -1.25, w: 0.045, y0: 0.582, y1: 0.592 },
  ]);
  const podTops = both((s) =>
    loft([
      { z: 0.3, w: 0.12, y0: 0.6, y1: 0.61, x: s * 0.66 },
      { z: -0.55, w: 0.1, y0: 0.552, y1: 0.562, x: s * 0.6 },
    ]),
  );
  return merge([noseStripe, coverStripe, ...podTops]);
}

const trimCache = new Map<string, BufferGeometry>();

/** The carbon parts, as damaged as `look` says: the front wing (on, hanging, gone) and rear wing (on, bent, gone), and scuffs. */
export function formulaTrim(look: DamageLook): BufferGeometry {
  const key = `${look.front}${look.rear}${look.scuffs ? 1 : 0}`;
  const known = trimCache.get(key);
  if (known) return known;
  const parts: BufferGeometry[] = [];
  const add = (g: BufferGeometry, hex: number) => parts.push(tint(g, hex));
  const box = (w: number, h: number, d: number, x: number, y: number, z: number, hex = CARBON) => add(new BoxGeometry(w, h, d).translate(x, y, z), hex);

  // Floor, plank and diffuser.
  box(1.62, 0.03, 2.9, 0, 0.06, -0.3);
  box(0.3, 0.02, 2.4, 0, 0.04, -0.25, PLANK);
  add(loft([
    { z: -1.6, w: 0.55, y0: 0.05, y1: 0.08 },
    { z: -2.05, w: 0.55, y0: 0.08, y1: 0.36 },
  ]), CARBON);

  // Front wing: on; hanging off; or gone (the nose bare).
  const frontWing = (): BufferGeometry => {
    const w: BufferGeometry[] = [];
    const b = (wd: number, h: number, d: number, x: number, y: number, z: number, hex = CARBON) => w.push(tint(new BoxGeometry(wd, h, d).translate(x, y, z), hex));
    b(1.98, 0.035, 0.34, 0, 0.08, 2.16);
    w.push(tint(new BoxGeometry(1.9, 0.03, 0.2).rotateX(-0.25).translate(0, 0.14, 2.02), CARBON_LIGHT));
    w.push(tint(new BoxGeometry(1.8, 0.025, 0.14).rotateX(-0.45).translate(0, 0.2, 1.94), CARBON));
    for (const s of [1, -1]) b(0.03, 0.24, 0.42, s * 0.99, 0.16, 2.12);
    return merge(w);
  };
  if (look.front === 0) parts.push(frontWing());
  // (It hangs from its right end, its left end on the road, where the sparks fly: see carEffects.)
  else if (look.front === 1) parts.push(frontWing().translate(0.99, 0, 0).rotateZ(-0.05).rotateY(0.1).translate(-0.99, 0, 0.03));

  // Rear wing: on (endplates, main plane, DRS flap, beam wing, swan neck); bent (one endplate gone, twisted); or gone (stubs).
  const rearWing = (bent: boolean): BufferGeometry => {
    const w: BufferGeometry[] = [];
    const b = (wd: number, h: number, d: number, x: number, y: number, z: number, hex = CARBON) => w.push(tint(new BoxGeometry(wd, h, d).translate(x, y, z), hex));
    for (const s of bent ? [1] : [1, -1]) b(0.03, 0.62, 0.36, s * 0.5, 0.7, -2.0);
    b(1.0, 0.05, 0.3, 0, 0.94, -2.02, CARBON_LIGHT);
    b(1.0, 0.03, 0.17, 0, 1.03, -1.86);
    b(0.92, 0.03, 0.14, 0, 0.48, -2.06);
    b(0.05, 0.42, 0.08, 0, 0.72, -1.94);
    const g = merge(w);
    if (bent) g.translate(-0.5, -0.95, 2.0).rotateZ(0.22).rotateX(0.2).translate(0.5, 0.9, -2.02);
    return g;
  };
  if (look.rear === 0) parts.push(rearWing(false));
  else if (look.rear === 1) parts.push(rearWing(true));
  else for (const s of [1, -1]) box(0.03, 0.18, 0.2, s * 0.5, 0.45, -1.98);
  // Rear crash structure.
  box(0.18, 0.15, 0.4, 0, 0.36, -2.0);

  // The halo over the cockpit, and the mirrors.
  add(bar([0, 0.66, 0.6], [0, 0.95, 0.36], 0.06), CARBON);
  for (const s of [1, -1]) {
    add(bar([s * 0.06, 0.95, 0.36], [s * 0.27, 0.93, 0.05], 0.055), CARBON);
    add(bar([s * 0.27, 0.93, 0.05], [s * 0.3, 0.7, -0.24], 0.055), CARBON);
    box(0.14, 0.06, 0.04, s * 0.42, 0.74, 0.55, CARBON);
    add(bar([s * 0.3, 0.64, 0.55], [s * 0.4, 0.73, 0.55], 0.025), CARBON);
  }
  // The driver: helmet and visor.
  add(new SphereGeometry(0.135, 12, 8).translate(0, 0.79, 0.08), HELMET);
  box(0.2, 0.05, 0.05, 0, 0.8, 0.2, VISOR);

  // Suspension: wishbones from the tub to each hub.
  const r = HANDLING.wheelRadius;
  for (const s of [1, -1]) {
    for (const [z, inner] of [[1.3, 0.28], [-1.32, 0.3]] as const) {
      add(bar([s * inner, 0.46, z + 0.18], [s * 0.72, r + 0.06, z], 0.035), CARBON);
      add(bar([s * inner, 0.46, z - 0.18], [s * 0.72, r + 0.06, z], 0.035), CARBON);
      add(bar([s * inner, 0.24, z + 0.15], [s * 0.72, r - 0.08, z], 0.035), CARBON);
      add(bar([s * inner, 0.24, z - 0.15], [s * 0.72, r - 0.08, z], 0.035), CARBON);
    }
  }

  // Scuffs and scrapes.
  if (look.scuffs) {
    for (const s of [1, -1]) {
      box(0.02, 0.1, 0.5, s * 0.86, 0.42, 0.15, 0x45474d);
      box(0.02, 0.06, 0.35, s * 0.73, 0.35, -0.7, 0x45474d);
    }
    box(0.18, 0.02, 0.3, 0.05, 0.47, 1.6, 0x45474d);
  }
  const g = merge(parts);
  trimCache.set(key, g);
  return g;
}

/** Lamps: small lights at the nose (for night races) and the rain light at the back. */
export function formulaLamps(): BufferGeometry {
  return merge([
    ...both((s) => tint(new BoxGeometry(0.06, 0.04, 0.04).translate(s * 0.08, 0.3, 2.27), 0xfff6d0)),
    tint(new BoxGeometry(0.16, 0.07, 0.03).translate(0, 0.36, -2.21), 0xd8202a),
  ]);
}

/** Their glows at night: white at the front, red at the back. */
export function formulaGlows(): BufferGeometry {
  return merge(
    [tint(new PlaneGeometry(1.0, 0.55).translate(0, 0.3, 2.32), 0xfff1c8), tint(new PlaneGeometry(0.9, 0.55).rotateY(Math.PI).translate(0, 0.36, -2.24), 0xff2a2a)],
    true,
  );
}

/** A wheel: a wide slick on a dark rim with a bright hub nut (the same for all four). */
export function formulaWheel(): BufferGeometry {
  const r = HANDLING.wheelRadius;
  return merge([
    tint(new CylinderGeometry(r, r, 0.36, 18).rotateZ(Math.PI / 2), 0x151517),
    tint(new CylinderGeometry(r * 0.66, r * 0.66, 0.37, 14).rotateZ(Math.PI / 2), 0x2c2e33),
    tint(new CylinderGeometry(r * 0.13, r * 0.13, 0.39, 6).rotateZ(Math.PI / 2), 0xc9ccd2),
  ]);
}
