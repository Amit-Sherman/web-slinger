// All tunable gameplay numbers live here (SPEC §14). Units: metres, seconds, m/s.

export const PHYSICS = {
  tickRate: 60,
  maxStepsPerFrame: 5,
  gravity: 9.81 * 1.6,
  terminalVelocity: 70,
};

export const PLAYER = {
  capsuleHalfHeight: 0.55,
  capsuleRadius: 0.4,
  eyeHeight: 0.7, // above capsule centre
  walkSpeed: 7,
  sprintSpeed: 13,
  groundAccel: 45,
  groundFriction: 10, // decel when moving faster than target speed (keeps landing momentum)
  jumpSpeed: 9,
  sprintJumpSpeed: 11,
  airControl: 9, // m/s² steering force while airborne
  airControlMaxSpeed: 13, // air control can't raise horizontal speed past max(current, this)
  airDrag: 0.02, // fraction of velocity lost per second
};

export const LINES = {
  // Web stream (SPEC §5.1): no range limit, ballistic drop.
  launchSpeed: 150, // m/s along the aim (raised from 110 after playtest)
  webGravity: 9.81, // web strands are light: normal gravity, not the player's heavier 1.6×
  inheritVelocity: 0.5, // fraction of the player's velocity the stream inherits
  predictionTime: 4, // seconds of trajectory the HUD impact marker looks ahead
  maxFlightTime: 30, // stop testing for hits after this (the stream keeps flowing visually)
  reelInSpeed: 13.2,
  letOutSpeed: 11,
  minLength: 2,
  maxLength: 5000, // effectively unlimited (city diagonal is ~2.8 km); webs have no range limit
  attachLengthFactor: 1.0, // rope length at attach = current distance to the anchor
  // Elastic lines: pull (m/s²) per unit of strain. 300 → ~5% stretch hanging still,
  // ~8% mid-swing, ~17% when catching a fall.
  elasticity: 300,
  dampingRatio: 0.3, // 0 = bouncy forever, 1 = no bounce
  maxStretch: 0.5, // hard stop at +50% of rest length
  driftCorrection: 0.25, // fraction of over-limit stretch corrected per tick
  maxCorrectionSpeed: 6, // cap on hard-stop correction (m/s), avoids velocity spikes
  releaseBoost: 1.5, // m/s added along velocity when the last line is released
  releaseUpBoost: 1.0, // extra m/s upward if moving upward at release
  // Released strands linger, fall under gravity, then fade (capped so they never pile up)
  strandLifetime: 2.5,
  strandFade: 0.7,
  maxStrands: 8,
};

export const WALL = {
  stickMaxNormalY: 0.45, // |normal.y| below this counts as a wall
  crawlSpeed: 6,
  crawlSprintSpeed: 10,
  wallRunMinSpeed: 12,
  wallRunDuration: 1.6,
  wallRunGravityScale: 0.25,
  staggerImpactSpeed: 28,
  staggerTime: 0.45,
  jumpNormalSpeed: 11,
  jumpUpSpeed: 9,
  jumpLookSpeed: 4,
  restickCooldown: 0.3,
  attachProbe: 0.6,
};

export const LANDING = {
  heavyImpactSpeed: 16,
  slowdownTime: 0.35,
  slowdownFactor: 0.3,
};

export const WATER = {
  surfaceY: -0.8,
  swimSpeed: 4,
  jumpOutSpeed: 10,
};

export const CAMERA = {
  baseFov: 85,
  maxFovBoost: 15,
  fovSpeedStart: 20,
  fovSpeedFull: 60,
  maxRollDeg: 7,
  near: 0.1, // keeps depth precision for far rooftops; arms start just beyond it
};

export const PROPS = {
  glueSpeed: 0.6, // a sticky prop glues once it moves slower than this (m/s)
  stickySettleTime: 3, // …or after this long, wherever it is
  glueDuration: 20, // seconds a glued prop stays fixed before it's released
  playerMass: 80, // kg, for two-body rope forces and character pushes
};

// Web balls (SPEC §5.2)
export const WEB_BALLS = {
  speed: 90, // m/s along the aim (+ half the player's velocity)
  cooldown: 0.18, // seconds between shots (hands alternate)
  impulse: 120, // N·s knock applied to a movable prop on hit
  maxBalls: 24,
  maxFlightTime: 4,
  splatRadius: 0.9, // visual radius (m)
  anchorRadius: 2.2, // a web stream passing this close to a splat snaps onto it
  splatLifetime: 30,
  splatFade: 4,
  maxSplats: 40,
};

// Pull line (SPEC §5.3), middle mouse
export const PULL = {
  reelSpeed: 30, // m/s the pull line shortens while held
  elasticity: 900, // stiffer than swing lines: a yank, not a swing
  dampingRatio: 0.6,
  minLength: 1.8,
  holdDistance: 2.4, // within this of your hands, a light object is caught and held
  maxHoldMass: 250, // kg; heavier objects (cars) can't be held, they pull you instead
  holdOffset: [0.85, -0.6, -2.6] as [number, number, number], // camera-local hold point (right, down, ahead)
  holdStiffness: 14,
  throwSpeed: 32, // m/s for a ~30 kg object; lighter objects fly faster, heavier slower
  minThrowSpeed: 10,
  maxThrowSpeed: 45,
};
