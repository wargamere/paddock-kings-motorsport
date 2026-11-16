import { BufferGeometry, CanvasTexture, DoubleSide, Float32BufferAttribute, Group, Mesh, MeshBasicMaterial } from 'three';
import type { DrsZone } from '../race/drs.ts';
import { leftOf, sampleAt } from '../track/spline.ts';
import type { Track } from '../track/track.ts';
import { roadY } from './pitBoxMesh.ts';

/**
 * DRS zones painted on the road: a white line across it at each detection
 * point, and where each zone starts a green band with "DRS" across it (upright
 * to a car driving in), and a thin green line where it ends.
 */

const textures = new Map<string, CanvasTexture>();

/** A painted marking: `fill` the band, `text` across the middle, `edge` its outline (u across the road, v along it). */
function paint(key: string, w: number, hgt: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): CanvasTexture {
  const known = textures.get(key);
  if (known) return known;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = hgt;
  const g = c.getContext('2d');
  if (g) draw(g, w, hgt);
  const t = new CanvasTexture(c);
  t.anisotropy = 4;
  textures.set(key, t);
  return t;
}

const detectTexture = () =>
  paint('detect', 256, 32, (g, w, h) => {
    g.fillStyle = 'rgba(255, 255, 255, 0.92)';
    // Dashes across the road.
    for (let x = 4; x < w; x += 32) g.fillRect(x, 4, 22, h - 8);
  });

const startTexture = () =>
  paint('start', 256, 256, (g, w, h) => {
    g.fillStyle = 'rgba(34, 197, 94, 0.38)';
    g.fillRect(0, 0, w, h);
    g.fillStyle = '#22c55e';
    g.fillRect(0, h - 22, w, 22);
    g.fillStyle = '#ffffff';
    g.font = '900 150px system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // (The top of the canvas is the far end: upright to a car driving in.)
    g.fillText('DRS', w / 2, h / 2 - 8);
  });

const endTexture = () =>
  paint('end', 256, 16, (g, w, h) => {
    g.fillStyle = 'rgba(34, 197, 94, 0.9)';
    g.fillRect(0, 2, w, h - 4);
  });

/** A quad on the road across its width, from `s` to `s + length` m along it. */
function band(track: Track, s: number, length: number, map: CanvasTexture): Mesh {
  const c = track.center;
  const half = c.width / 2;
  const steps = Math.max(1, Math.ceil(length / 2));
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= steps; k++) {
    const x = s + (length * k) / steps;
    const { p, t } = sampleAt(c, x);
    const l = leftOf(t);
    // u from the road's left-hand edge (as you drive) to its right.
    for (const side of [1, -1]) {
      const lat = side * half;
      pos.push(p.x + l.x * lat, roadY(track, x, lat) + 0.03, p.y + l.y * lat);
      uv.push((1 - side) / 2, k / steps);
    }
  }
  for (let k = 0; k < steps; k++) {
    const a = k * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const m = new Mesh(g, new MeshBasicMaterial({ map, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: DoubleSide }));
  m.renderOrder = 1.6;
  return m;
}

/** The markings for `zones` on `track`, in one group (dispose with disposeDrsMarkings). */
export function buildDrsMarkings(track: Track, zones: readonly DrsZone[]): Group {
  const group = new Group();
  for (const z of zones) group.add(band(track, z.detect, 1, detectTexture()), band(track, z.from, 14, startTexture()), band(track, z.to - 0.6, 0.6, endTexture()));
  return group;
}

/** Frees a group's geometry and materials (the painted textures are shared and kept). */
export function disposeDrsMarkings(group: Group): void {
  for (const m of group.children as Mesh[]) {
    m.geometry.dispose();
    (m.material as MeshBasicMaterial).dispose();
  }
}
