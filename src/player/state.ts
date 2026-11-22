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
  | { type: 'stagger'; impact: number }
  | { type: 'jump' }
  | { type: 'splash' };

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
  lines: [LineState, LineState];
  events: GameEvent[];
}

function newLine(): LineState {
  return {
    kind: 'idle', target: new THREE.Vector3(), tipVel: new THREE.Vector3(), flightTime: 0,
    length: 0, tension: 0, reel: 0,
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
    lines: [newLine(), newLine()],
    events: [],
  };
}
