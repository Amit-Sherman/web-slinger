// Plain, serialisable player state (SPEC §11: multiplayer-ready).

import * as THREE from 'three';

export type Hand = 0 | 1; // 0 = left, 1 = right
export type LineKind = 'idle' | 'firing' | 'attached';
export type MoveMode = 'ground' | 'air' | 'wall' | 'wallrun' | 'swim';

export interface LineState {
  kind: LineKind;
  /** Anchor point while attached; the stream's flying tip while firing. */
  target: THREE.Vector3;
  /** Tip velocity while firing (ballistic: gravity acts on it). */
  tipVel: THREE.Vector3;
  /** Seconds the current stream has been flying. */
  flightTime: number;
  /** Rest length while attached. */
  length: number;
  /** Rapier handle of the movable prop the line is stuck to (-1 = static city geometry). */
  anchorBody: number;
  /** Anchor point in that body's local frame (the anchor moves with the prop). */
  anchorLocal: THREE.Vector3;
  /** Pull line only: a light object has been caught and is held in front of you. */
  holding: boolean;
  /** Visual hint: when this line goes idle, don't leave a lingering strand (it became a tether). */
  noStrand?: boolean;
  /** Constraint correction speed last tick (m/s), drives the taut "twang" visual. */
  tension: number;
  /** -1 letting out, 0 none, 1 reeling in. */
  reel: -1 | 0 | 1;
}

export type GameEvent =
  | { type: 'fire'; hand: Hand }
  | { type: 'attach'; hand: Hand }
  | { type: 'release'; hand: Hand }
  | { type: 'land'; impact: number }
  | { type: 'step'; sprint: boolean }
  | { type: 'wallJump' }
  | { type: 'wallStick'; impact: number }
  | { type: 'wallScrape'; speed: number }
  | { type: 'stagger'; impact: number }
  | { type: 'jump' }
  | { type: 'splash' }
  | { type: 'webBall'; hand: Hand }
  | { type: 'splat'; onProp: boolean }
  | { type: 'pullFire' }
  | { type: 'pullAttach' }
  | { type: 'catch' }
  | { type: 'throw' }
  | { type: 'pullRelease' }
  | { type: 'tetherFire' }
  | { type: 'tetherEnd' }
  | { type: 'tetherConnect' }
  | { type: 'tetherCut' };

export interface PlayerState {
  pos: THREE.Vector3;
  prevPos: THREE.Vector3;
  vel: THREE.Vector3;
  mode: MoveMode;
  wallNormal: THREE.Vector3;
  wallRunTime: number;
  restickTimer: number;
  staggerTimer: number;
  slowTimer: number;
  stepDistance: number;
  scrapeTimer: number;
  lines: [LineState, LineState];
  /** Middle-mouse pull line (SPEC §5.3); visually leaves the right launcher. */
  pull: LineState;
  events: GameEvent[];
}

export function newLine(): LineState {
  return {
    kind: 'idle', target: new THREE.Vector3(), tipVel: new THREE.Vector3(), flightTime: 0,
    length: 0, tension: 0, reel: 0, anchorBody: -1, anchorLocal: new THREE.Vector3(), holding: false,
  };
}

export function newPlayerState(x: number, y: number, z: number): PlayerState {
  return {
    pos: new THREE.Vector3(x, y, z),
    prevPos: new THREE.Vector3(x, y, z),
    vel: new THREE.Vector3(),
    mode: 'air',
    wallNormal: new THREE.Vector3(),
    wallRunTime: 0,
    restickTimer: 0,
    staggerTimer: 0,
    slowTimer: 0,
    stepDistance: 0,
    scrapeTimer: 0,
    lines: [newLine(), newLine()],
    pull: newLine(),
    events: [],
  };
}
