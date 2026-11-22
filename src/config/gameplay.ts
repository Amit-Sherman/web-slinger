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
  airDrag: 0.02, // fraction of velocity lost per second
};

export const LINES = {
  maxRange: 90,
  travelSpeed: 250,
  reelInSpeed: 12,
  letOutSpeed: 10,
  minLength: 2,
  maxLength: 110,
  attachLengthFactor: 1.0, // rope length at attach = current distance to the anchor
  solverIterations: 2,
  driftCorrection: 0.25, // fraction of rope over-stretch corrected per tick
  maxCorrectionSpeed: 6, // cap on drift correction (m/s), avoids velocity spikes
  releaseBoost: 1.5, // m/s added along velocity when the last line is released
  releaseUpBoost: 1.0, // extra m/s upward if moving upward at release
  missFallTime: 0.35,
  retractTime: 0.12,
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
