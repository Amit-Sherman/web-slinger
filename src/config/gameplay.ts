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
