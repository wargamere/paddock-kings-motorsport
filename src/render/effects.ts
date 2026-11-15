import {
  AdditiveBlending,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  NormalBlending,
  Points,
  Quaternion,
  ShaderMaterial,
  UniformsLib,
  UniformsUtils,
  Vector3,
  type Blending,
  type Scene,
  type Texture,
} from 'three';

/**
 * Smoke, sparks and bits of car (race/raceScreen.ts drives them). Smoke and
 * sparks are point sprites that grow, drift and fade; the bits are little
 * boxes that tumble, bounce and lie on the road for a while. A fixed pool of
 * each (the oldest goes when it's full): three draw calls in all.
 */

const VERTEX = /* glsl */ `
attribute float size;
attribute vec4 tint;
varying vec4 vTint;
uniform float scale;
#include <fog_pars_vertex>
void main() {
  vTint = tint;
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  // (Right up against the camera: faded out, not a puff filling the screen.)
  vTint.a *= clamp((-mvPosition.z - 1.5) / 3.0, 0.0, 1.0);
  gl_PointSize = size * scale / max(0.1, -mvPosition.z);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAGMENT = /* glsl */ `
uniform sampler2D map;
varying vec4 vTint;
#include <fog_pars_fragment>
void main() {
  float a = vTint.a * texture2D(map, gl_PointCoord).a;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vTint.rgb, a);
  #include <fog_fragment>
}`;

/** Bits of car closer than this to the camera (m) aren't drawn. */
const NEAR = 2.5;

/** A soft round dot (alpha falls off to the edge). */
function dotTexture(soft: number): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(soft, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  return new CanvasTexture(c);
}

/** One kind of point sprite: a pool of particles with a position, velocity, life, size and colour. */
class Sprites {
  readonly points: Points;
  private readonly n: number;
  private next = 0;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly life: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly alpha0: Float32Array;
  private readonly size: Float32Array;
  private readonly tint: Float32Array;
  private readonly posAttr: BufferAttribute;
  private readonly sizeAttr: BufferAttribute;
  private readonly tintAttr: BufferAttribute;
  private readonly material: ShaderMaterial;
  /** Pulled down (m/s²; sparks fall, smoke doesn't) and slowed by the air (share of speed lost a second). */
  private readonly gravity: number;
  private readonly drag: number;
  private live = 0;

  constructor(n: number, map: Texture, blending: Blending, gravity: number, drag: number) {
    this.n = n;
    this.gravity = gravity;
    this.drag = drag;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.age = new Float32Array(n).fill(Infinity);
    this.life = new Float32Array(n).fill(1);
    this.size0 = new Float32Array(n);
    this.size1 = new Float32Array(n);
    this.alpha0 = new Float32Array(n);
    this.size = new Float32Array(n);
    this.tint = new Float32Array(n * 4);
    const g = new BufferGeometry();
    this.posAttr = new BufferAttribute(this.pos, 3).setUsage(DynamicDrawUsage);
    this.sizeAttr = new BufferAttribute(this.size, 1).setUsage(DynamicDrawUsage);
    this.tintAttr = new BufferAttribute(this.tint, 4).setUsage(DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('size', this.sizeAttr);
    g.setAttribute('tint', this.tintAttr);
    this.material = new ShaderMaterial({
      uniforms: UniformsUtils.merge([UniformsLib.fog, { map: { value: null }, scale: { value: 300 } }]),
      vertexShader: VERTEX,
      fragmentShader: FRAGMENT,
      transparent: true,
      depthWrite: false,
      blending,
      fog: true,
    });
    this.material.uniforms.map.value = map;
    this.points = new Points(g, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 4;
    this.points.visible = false;
  }

  /** A particle at (x, y, z) moving at (vx, vy, vz), living `life` s, growing from `s0` to `s1` m across, fading from `a0`. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, a0: number, c: Color): void {
    const i = this.next;
    this.next = (i + 1) % this.n;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.age[i] = 0;
    this.life[i] = life;
    this.size0[i] = s0;
    this.size1[i] = s1;
    this.alpha0[i] = a0;
    this.tint.set([c.r, c.g, c.b, a0], i * 4);
    this.live = this.n;
  }

  update(dt: number, scale: number): void {
    if (!this.live) return;
    this.material.uniforms.scale.value = scale;
    const keep = Math.exp(-this.drag * dt);
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      const age = (this.age[i] += dt);
      const u = age / this.life[i];
      if (u >= 1) {
        this.size[i] = 0;
        this.tint[i * 4 + 3] = 0;
        continue;
      }
      alive++;
      const k = i * 3;
      this.vel[k] *= keep;
      this.vel[k + 1] = this.vel[k + 1] * keep - this.gravity * dt;
      this.vel[k + 2] *= keep;
      this.pos[k] += this.vel[k] * dt;
      this.pos[k + 1] += this.vel[k + 1] * dt;
      this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] = this.size0[i] + (this.size1[i] - this.size0[i]) * u;
      this.tint[i * 4 + 3] = this.alpha0[i] * (1 - u) * Math.min(1, u * 8 + 0.25);
    }
    // (Nothing left alive: skip the work, and the draw, until something is emitted.)
    if (!alive) this.live = 0;
    this.points.visible = alive > 0;
    this.posAttr.needsUpdate = true;
    this.sizeAttr.needsUpdate = true;
    this.tintAttr.needsUpdate = true;
  }

  clear(): void {
    this.age.fill(Infinity);
    this.size.fill(0);
    this.live = 0;
    this.points.visible = false;
    this.sizeAttr.needsUpdate = true;
  }

  dispose(): void {
    this.points.geometry.dispose();
    this.material.dispose();
  }
}

/** Bits of car: little boxes that fly off, tumble, bounce and lie on the road, then go. */
class Debris {
  readonly mesh: InstancedMesh;
  private readonly n: number;
  private next = 0;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly spin: Float32Array;
  private readonly axis: Float32Array;
  private readonly angle: Float32Array;
  private readonly ground: Float32Array;
  private readonly age: Float32Array;
  private readonly lifeOf: number;
  private live = 0;
  private readonly m = new Matrix4();
  private readonly q = new Quaternion();
  private readonly v = new Vector3();
  private readonly a = new Vector3();
  private readonly s = new Vector3();

  constructor(n: number, life: number) {
    this.n = n;
    this.lifeOf = life;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.spin = new Float32Array(n);
    this.axis = new Float32Array(n * 3);
    this.angle = new Float32Array(n);
    this.ground = new Float32Array(n);
    this.age = new Float32Array(n).fill(Infinity);
    this.mesh = new InstancedMesh(new BoxGeometry(0.34, 0.06, 0.22), new MeshLambertMaterial({ flatShading: true }), n);
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    const c = new Color(0x24262b);
    for (let i = 0; i < n; i++) {
      this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
      this.mesh.setColorAt(i, c);
    }
    this.mesh.visible = false;
  }

  /** A bit flying from (x, y, z) at (vx, vy, vz), coming to rest on the road at height `ground`. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, ground: number, c: Color): void {
    const i = this.next;
    this.next = (i + 1) % this.n;
    this.pos.set([x, y, z], i * 3);
    this.vel.set([vx, vy, vz], i * 3);
    this.v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    this.axis.set([this.v.x, this.v.y, this.v.z], i * 3);
    this.spin[i] = 6 + Math.random() * 10;
    this.angle[i] = 0;
    this.ground[i] = ground + 0.03;
    this.age[i] = 0;
    this.mesh.setColorAt(i, c);
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this.live = this.n;
    this.mesh.visible = true;
  }

  /** Moves the bits on by `dt` s. Any within NEAR m of the camera at `eye` isn't drawn (it would fill the screen). */
  update(dt: number, eye: Vector3): void {
    if (!this.live) return;
    let alive = 0;
    for (let i = 0; i < this.n; i++) {
      const age = (this.age[i] += dt);
      if (age >= this.lifeOf) {
        if (age - dt < this.lifeOf) this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
        continue;
      }
      alive++;
      const k = i * 3;
      const onGround = this.pos[k + 1] <= this.ground[i] && Math.abs(this.vel[k + 1]) < 0.5;
      if (!onGround) {
        this.vel[k + 1] -= 9.81 * dt;
        this.pos[k] += this.vel[k] * dt;
        this.pos[k + 1] += this.vel[k + 1] * dt;
        this.pos[k + 2] += this.vel[k + 2] * dt;
        this.angle[i] += this.spin[i] * dt;
        // A bounce, losing most of its speed; then it slides to a stop.
        if (this.pos[k + 1] < this.ground[i]) {
          this.pos[k + 1] = this.ground[i];
          this.vel[k + 1] = -this.vel[k + 1] * 0.3;
          this.vel[k] *= 0.55;
          this.vel[k + 2] *= 0.55;
          this.spin[i] *= 0.5;
        }
      }
      // Shrinks away over its last second. (Hidden right in front of the camera.)
      const dx = this.pos[k] - eye.x, dy = this.pos[k + 1] - eye.y, dz = this.pos[k + 2] - eye.z;
      const scale = dx * dx + dy * dy + dz * dz < NEAR * NEAR ? 0 : Math.min(1, this.lifeOf - age);
      this.q.setFromAxisAngle(this.a.set(this.axis[k], this.axis[k + 1], this.axis[k + 2]), this.angle[i]);
      this.mesh.setMatrixAt(i, this.m.compose(this.v.set(this.pos[k], this.pos[k + 1], this.pos[k + 2]), this.q, this.s.setScalar(scale)));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (!alive) {
      this.live = 0;
      this.mesh.visible = false;
    }
  }

  clear(): void {
    this.age.fill(Infinity);
    for (let i = 0; i < this.n; i++) this.mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    this.mesh.instanceMatrix.needsUpdate = true;
    this.live = 0;
    this.mesh.visible = false;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshLambertMaterial).dispose();
  }
}

/** The pools, in the scene. */
export class RaceEffects {
  readonly smoke: Sprites;
  readonly sparks: Sprites;
  readonly debris: Debris;
  private readonly scene: Scene;
  private readonly smokeTex = dotTexture(0.45);
  private readonly sparkTex = dotTexture(0.2);

  constructor(scene: Scene) {
    this.scene = scene;
    this.smoke = new Sprites(420, this.smokeTex, NormalBlending, -0.6, 0.9);
    this.sparks = new Sprites(260, this.sparkTex, AdditiveBlending, 9.81, 0.6);
    this.debris = new Debris(72, 14);
    scene.add(this.smoke.points, this.sparks.points, this.debris.mesh);
  }

  /** Moves everything on by `dt` s (`eye`: the camera); `scale` is the screen's height in pixels over 2 × tan(half the field of view) (a 1 m particle 1 m away is this many pixels across). */
  update(dt: number, scale: number, eye: Vector3): void {
    this.smoke.update(dt, scale);
    this.sparks.update(dt, scale);
    this.debris.update(dt, eye);
  }

  clear(): void {
    this.smoke.clear();
    this.sparks.clear();
    this.debris.clear();
  }

  dispose(): void {
    this.scene.remove(this.smoke.points, this.sparks.points, this.debris.mesh);
    this.smoke.dispose();
    this.sparks.dispose();
    this.debris.dispose();
    this.smokeTex.dispose();
    this.sparkTex.dispose();
  }
}
