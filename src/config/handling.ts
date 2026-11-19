/**
 * Every car-handling tuning constant. Units: metres, seconds, radians.
 * Accelerations are in m/s² (9.81 = 1 g).
 */
export const HANDLING = {
  /** Physics runs at this fixed rate, whatever the display refresh rate. */
  tickRate: 120,

  // ---------------------------------------------------------- engine & brakes
  /**
   * In another car's slipstream (draft 1 = right on its bumper): the air
   * resistance is cut by this share, the engine keeps pulling this much past
   * its usual top end, and the tow adds this push (m/s², fading out at that
   * raised top end), so a car in a tow can go faster than it could alone.
   */
  slipstreamDragCut: 0.75,
  slipstreamTopSpeed: 0.12,
  slipstreamPush: 1.2,
  /** Engine acceleration from standstill; it fades linearly to 0 at `maxSpeed`. */
  engineAccel: 15,
  /** Speed where the engine stops pulling (top speed ends up a bit lower, from drag). */
  maxSpeed: 58,
  brakeDecel: 24,
  reverseAccel: 7,
  reverseMaxSpeed: 11,
  /** Constant rolling resistance. */
  rollingDrag: 0.4,
  /** Aerodynamic drag factor: deceleration = aeroDrag × speed². */
  aeroDrag: 0.0012,
  /** Extra slowing when coasting (no throttle, no brake). */
  engineBraking: 1.6,

  // ------------------------------------------------------------------ gearbox
  /**
   * Six gears. The engine pulls fully through the middle of the revs and less
   * at low revs and near the limiter (none at it). Changing at the right revs
   * gives the pull of `engineAccel` above, so the AI's speed plans still hold.
   * Manual and AI changes are instant; the automatic's changes up cut the
   * drive for a moment, which is what makes it a little slower.
   */
  gearbox: {
    /** Speed (m/s) at the rev limit in each gear, 1st to 6th. */
    top: [13, 20, 27, 35, 45, 58],
    /** Pull (share of full) at idle; full from `fullFrom` to `fullTo` of the rev limit; `limitPull` just under the limit. */
    lowPull: 0.55,
    fullFrom: 0.5,
    fullTo: 0.9,
    limitPull: 0.8,
    /** Revs (share of the limit) to change up and down at, for the AI's box and the automatic gearbox alike. */
    idealUp: 0.9,
    idealDown: 0.5,
    /** The shift light comes on from here (a manual change up from here on loses nothing). */
    shiftLight: 0.88,
    /**
     * Seconds without drive while a gear goes up: none for a manual (or AI)
     * change, a moment for the automatic's (what makes it a little slower).
     */
    shiftTime: 0,
    autoShiftTime: 0.2,
  },

  // ----------------------------------------------------------------- steering
  /** Front-wheel angle at a standstill. */
  maxSteerAngle: 0.6,
  /** Steering lock shrinks with speed: limit = maxSteerAngle / (1 + speed / steerFalloff). */
  steerFalloff: 15,
  /** How fast the wheels turn towards the input, and back to centre. */
  steerRate: 3.0,
  steerReturnRate: 5.0,
  wheelBase: 2.6,
  /** How quickly the car's rotation follows the steering (1/s). */
  yawResponse: 9,

  // --------------------------------------------------------------------- grip
  /** How quickly sideways sliding dies away (1/s). Lower = more drift. */
  gripRate: 8,
  /** The most sideways acceleration the tyres can produce. */
  maxLateralAccel: 18,
  /** The car may rotate this much faster than grip allows, which gives a slight, controllable drift. */
  yawOvershoot: 1.15,

  // ---------------------------------------------------------------- handbrake
  handbrakeGripRate: 1.3,
  handbrakeYawBoost: 1.7,
  handbrakeDecel: 5,

  // -------------------------------------------------------------------- grass
  grass: {
    /** Engine stops pulling at maxSpeed × this. */
    speedFactor: 0.4,
    accelFactor: 0.6,
    /** Extra rolling drag on grass. */
    drag: 3.5,
    /** Grip and lateral acceleration are multiplied by this. */
    gripFactor: 0.45,
    /** How rough it feels (rumble sound and camera shake). */
    rough: 1,
  },
  /** Gravel traps beside the road (TrackOptions.runoff): slower than grass. */
  gravel: { speedFactor: 0.3, accelFactor: 0.45, drag: 6.5, gripFactor: 0.4, rough: 1.4 },
  /** Tarmac run-off: drives like the road, just without the kerbs. */
  tarmac: { speedFactor: 1, accelFactor: 1, drag: 0, gripFactor: 1, rough: 0 },
  /** The road itself. */
  road: { speedFactor: 1, accelFactor: 1, drag: 0, gripFactor: 1, rough: 0 },
  /**
   * What the road is made of (TrackOptions.road): how much of the tyres' grip
   * it gives in corners, how hard the brakes bite, how hard the engine can
   * pull, and how rough it feels. The AI and the medal laps plan with the same.
   */
  roads: {
    tarmac: { grip: 1, brake: 1, accel: 1, rough: 0 },
    dirt: { grip: 0.76, brake: 0.74, accel: 0.86, rough: 0.3 },
    snow: { grip: 0.58, brake: 0.56, accel: 0.68, rough: 0.12 },
  },

  // ------------------------------------------------------- slopes and banking
  /** Share of gravity along a slope that acts on the car (1 = full physics, lower = more arcade). */
  slopeFactor: 0.8,
  /** Share of the bank's help in corners (g·sin(bank) × this). */
  bankGripFactor: 1.2,

  // ------------------------------------------------------------------- walls
  /** Bounce off a barrier (share of the impact speed). */
  wallBounce: 0.25,
  /** Speed lost per m/s of impact, and the least speed kept. */
  wallScrub: 0.04,
  wallMinKeep: 0.55,
  /** Into the barrier faster than this (m/s) is a knock that checks the car's rotation; slower is a scrape, which only checks a turn into it. */
  wallKnock: 2,
  /** Half the car's body width (keeps the body, not the centre, off the barrier). */
  halfWidth: 1.0,

  // ------------------------------------------------------------------- bodies
  /** Collision radius of the car (against tree trunks). */
  carRadius: 1.1,
  /** Half the distance between left and right wheels (for the on-grass test). */
  halfTrack: 0.85,
  wheelRadius: 0.36,
  /** The car can't leave this square around the origin. */
  worldLimit: 900,
} as const;

/**
 * The car as a real one (car/physics.ts), above walking pace: two axles, each
 * with its own grip, load and slip angle, so it understeers, oversteers, spins,
 * locks its brakes and spins its wheels as a race car does.
 *
 * - Load: `frontWeight` of the weight on the front wheels at rest. Braking moves
 *   load forward and accelerating moves it back (the centre of gravity is
 *   `cgHeight` m up), up to `transferMax` of the car's weight.
 * - Downforce: every tyre's grip grows by `downforce` × (speed /
 *   SETUP.downforceSpeed)², on top of the wing's own share: half as much
 *   again at top speed as in a hairpin.
 * - Grip: the tyres hold `grip` × the corner speeds the racing line plans for
 *   (HANDLING.maxLateralAccel and the rest), which leaves the AI something in
 *   hand. A tyre's sideways force rises with its slip angle up to a peak at
 *   `peakSlip` rad, then falls away as it slides (Pacejka's curve, shape
 *   `shape`). Past the peak it holds only `slide` of its grip. It counts as
 *   sliding (CarState.slip: smoke, squeal) from `slideFrom` of the peak.
 * - Front and rear grip: the rear has `rearGrip` times the front's (wider
 *   tyres), so at the limit the car understeers gently, unless the rear's grip
 *   is used up by the throttle or the brakes. A tyre's grip per unit of load
 *   falls by `loadSensitivity` × its load over its load at rest.
 * - Longitudinal grip: each tyre grips `longGrip` times harder along its length
 *   than across it (as the brakes bite: the rain, the road, the compound; not
 *   the car's own cornering grip, damage or wear). Driving, they grip only
 *   `driveGrip` times as hard as sideways, so the engine can spin them up in
 *   the slow bends and the wet. What it gives to braking or driving it can't give to
 *   cornering (the friction circle).
 * - Brakes: at full pedal they ask `brakePower` × HANDLING.brakeDecel, which
 *   the tyres can take only at speed, with the downforce on them: slower, they
 *   lock (or ABS holds them at the tyres' limit). They lock the front first
 *   with the brake balance forward, the rear first with it back (`brakeBias`: the front's share of the braking
 *   against its share of the load).
 * - `yawInertia`: how hard the car is to turn (m², its yaw inertia / mass).
 *
 * The AI drivers' feel for the pedals and the wheel (your car has none of it:
 * no driver aids, as in a real F1 car):
 * - Braking: right at the point of locking (`absMargin` of it), and easing
 *   off for tyres busy cornering (the front's to no less than `absSteerFloor`,
 *   squared, of their bite), so the car still turns, and doesn't spin, braking
 *   into a bend.
 * - Throttle: `tcMargin` short of wheelspin, leaving the rear tyres the grip
 *   they need for the corner (at least `tcFloor` of their pull, squared).
 * - Wheel: never asking the front tyres for more than `steerHelp` × their
 *   peak slip (so it counter-steers a slide).
 * - Catching the tail: once the rear tyres slip more than the front ones (and
 *   more than `escFrom` of their peak), it turns the car back, `escGain` ×
 *   the excess (rad) × the load (m/s²) in yaw acceleration, at most `escMax`
 *   × the load.
 *
 * At walking pace, below `blendFrom` m/s, the car drives as the simple model
 * does. It blends into the full model by `blendTo` m/s. Each tick is worked out
 * in `substeps` steps.
 */
export const SIM = {
  frontWeight: 0.45,
  cgHeight: 0.18,
  transferMax: 0.4,
  downforce: 0.25,
  grip: 1.15,
  peakSlip: 0.1,
  shape: 1.45,
  slide: 0.75,
  slideFrom: 0.9,
  rearGrip: 1.2,
  loadSensitivity: 0.1,
  longGrip: 1.55,
  driveGrip: 0.85,
  brakePower: 1.5,
  brakeBias: { front: 0.08, balanced: 0.04, rear: -0.02 },
  yawInertia: 1.5,
  absMargin: 0.97,
  tcMargin: 0.97,
  tcFloor: 0.2,
  absSteerFloor: 0.2,
  steerHelp: 1.15,
  escFrom: 0.8,
  escGain: 3,
  escMax: 0.6,
  blendFrom: 3,
  blendTo: 6,
  substeps: 2,
} as const;

export const INPUT = {
  /** Gamepad stick dead zone (the rest of the range is rescaled to 0..1). */
  stickDeadZone: 0.15,
  triggerDeadZone: 0.05,
  /** A key (or touch pad) presses its pedal all the way down over this long (s): no car has an on/off throttle. */
  keyThrottleRise: 0.3,
  keyBrakeRise: 0.12,
} as const;

export const CAMERA = {
  chase: {
    distance: 7.2,
    /** Extra distance per m/s of speed. */
    distancePerSpeed: 0.035,
    height: 3.0,
    lookAhead: 3.5,
    lookHeight: 1.1,
    /** How fast the camera swings round behind the car (1/s). */
    yawFollow: 5.5,
    fov: 62,
    fovPerSpeed: 0.22,
    fovMax: 74,
  },
  bonnet: {
    forward: 1.0,
    height: 1.18,
    fov: 72,
  },
} as const;

/**
 * Automatic resolution while racing (render/resolution.ts). Frames are
 * measured over `window` s. A window whose frames take longer than
 * `slowFrame` s on average (under 45 fps), while the game's own work is
 * under `cpuShare` of that time (so the graphics card is what's slow), counts
 * as slow; `downAfter` slow windows in a row step the resolution down. Frames
 * quicker than `easyFrame` (57 fps and up) for `upAfter` windows step it back
 * up. At most one change per `minGap` s (each one reallocates the drawing
 * buffer). The steps are shares of the graphics setting's pixel ratio, never
 * below `minPixelRatio` real pixels per CSS pixel. A frame longer than `stall`
 * s (a tab switch, an ad) doesn't count.
 */
export const RESOLUTION = {
  window: 0.5,
  slowFrame: 1 / 45,
  easyFrame: 1 / 57,
  cpuShare: 0.6,
  downAfter: 3,
  upAfter: 16,
  minGap: 3,
  steps: [1, 0.85, 0.72, 0.6, 0.5],
  minPixelRatio: 0.75,
  stall: 0.25,
} as const;

/**
 * The look of the 3D world (render/view3d.ts, car/model.ts). Neutral tone
 * mapping at `exposure`. Surfaces are physically based: `roughness` 0 is a
 * mirror, 1 fully matt (a wet road goes from `road` to `wetRoad`, and so
 * reflects the sky). The sky lights the scene too (`envIntensity`, with the
 * sun in it `envSun` times as bright as its light), so the hemisphere light
 * fills in only `hemiShare` of what it used to, and the sun shines `sunBoost`
 * times as bright. The sun casts shadows over a box `half` m either side of
 * a point `ahead` m in front of the camera (a `mapSize` texel map), from
 * `distance` m away. `sunGlow`: the sun's size in the sky (m at 1.8 km).
 * Cars: paint `paintRoughness` under a clear coat, `trimRoughness` for the
 * dark trim and glass, `tyreRoughness` for the tyres.
 */
export const GRAPHICS3D = {
  exposure: 1,
  roughness: { road: 0.92, wetRoad: 0.16, kerb: 0.62, wall: 0.85, prop: 0.82 },
  envIntensity: 0.4,
  /** A wet road mirrors the sky: its reflections this many times stronger when soaked. */
  wetReflect: 3,
  envSun: 2.5,
  hemiShare: 0.45,
  sunBoost: 1.3,
  shadow: { mapSize: 2048, half: 55, ahead: 22, distance: 170, bias: -0.0008, normalBias: 0.12 },
  sunGlow: 420,
  paintRoughness: 0.38,
  trimRoughness: 0.45,
  tyreRoughness: 0.9,
  /** The soft dark patch right under each car (the sun's shadow does the rest). */
  contactShadow: 0.45,
  /** The formula car sits much lower, its floor almost on the road: a darker shadow right under it. */
  contactShadowFormula: 0.8,
} as const;
