// Player movement (SPEC §4): ground, air, swinging, wall-crawl / wall-run / wall-jump,
// superhero landings, swimming. Runs on the fixed simulation tick.

import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { LANDING, PHYSICS, PLAYER, PROPS, WALL, WATER } from '../config/gameplay';
import type { Physics } from '../core/physics';
import type { InputSnapshot } from '../input/input';
import { anyAttached, solveRopes, updateLines } from '../webs/lines';
import { solvePull, updatePull } from '../webs/pull';
import type { Props } from '../world/props';
import type { CityData } from '../world/cityGen';
import type { PlayerState } from './state';

const UP = new THREE.Vector3(0, 1, 0);

export class PlayerController {
  readonly collider: RAPIER.Collider;
  readonly body: RAPIER.RigidBody;
  private cc: RAPIER.KinematicCharacterController;
  props: Props | null = null;
  private wish = new THREE.Vector3();
  private desired = new THREE.Vector3();
  private vPre = new THREE.Vector3();
  private eye = new THREE.Vector3();
  private t1 = new THREE.Vector3();
  private t2 = new THREE.Vector3();

  constructor(private physics: Physics, private city: CityData, readonly state: PlayerState) {
    const R = physics.R;
    // Kinematic body so movable props get pushed properly (SPEC §7.1)
    this.body = physics.world.createRigidBody(
      R.RigidBodyDesc.kinematicPositionBased().setTranslation(state.pos.x, state.pos.y, state.pos.z),
    );
    this.collider = physics.world.createCollider(R.ColliderDesc.capsule(PLAYER.capsuleHalfHeight, PLAYER.capsuleRadius), this.body);
    this.cc = physics.world.createCharacterController(0.03);
    this.cc.setSlideEnabled(true);
    this.cc.setMaxSlopeClimbAngle((50 * Math.PI) / 180);
    this.cc.setMinSlopeSlideAngle((60 * Math.PI) / 180);
    this.cc.enableAutostep(0.5, 0.3, false);
    this.cc.enableSnapToGround(0.4);
    this.cc.setApplyImpulsesToDynamicBodies(true);
    this.cc.setCharacterMass(PROPS.playerMass);
  }

  eyePosition(out: THREE.Vector3, pos = this.state.pos): THREE.Vector3 {
    return out.copy(pos).setY(pos.y + PLAYER.eyeHeight);
  }

  teleport(x: number, y: number, z: number): void {
    const s = this.state;
    s.pos.set(x, y, z);
    s.prevPos.copy(s.pos);
    s.vel.set(0, 0, 0);
    s.mode = 'air';
    for (const l of [...s.lines, s.pull]) {
      l.kind = 'idle';
      l.holding = false;
    }
    this.body.setTranslation({ x, y, z }, true);
    this.body.setNextKinematicTranslation({ x, y, z });
  }

  /** One simulation tick. `aim` is the unit look direction, `yaw` the body heading. */
  tick(input: InputSnapshot, aim: THREE.Vector3, yaw: number, dt: number): void {
    const s = this.state;
    s.prevPos.copy(s.pos);
    s.restickTimer = Math.max(0, s.restickTimer - dt);
    s.staggerTimer = Math.max(0, s.staggerTimer - dt);
    s.slowTimer = Math.max(0, s.slowTimer - dt);

    updateLines(s, input, this.eyePosition(this.eye), aim, this.physics, this.collider, dt);
    if (this.props) updatePull(s, input, this.eye, aim, yaw, this.physics, this.props, this.collider, dt);

    // Wish direction from WASD, relative to body yaw (horizontal plane)
    const fwd = (input.down.forward ? 1 : 0) - (input.down.back ? 1 : 0);
    const side = (input.down.right ? 1 : 0) - (input.down.left ? 1 : 0);
    const sin = Math.sin(yaw), cos = Math.cos(yaw);
    this.wish.set(-sin * fwd + cos * side, 0, -cos * fwd - sin * side);
    if (this.wish.lengthSq() > 1) this.wish.normalize();
    const controlScale = s.staggerTimer > 0 ? 0 : 1;

    // Lines pull you off walls when reeled or when taut away from the wall
    if ((s.mode === 'wall' || s.mode === 'wallrun') && this.ropePullsOffWall()) {
      s.mode = 'air';
      s.restickTimer = WALL.restickCooldown;
    }

    switch (s.mode) {
      case 'ground': this.groundMove(input, controlScale, dt); break;
      case 'air': this.airMove(controlScale, dt); break;
      case 'wall': this.wallCrawl(input, fwd, side, aim); break;
      case 'wallrun': this.wallRun(input, aim, dt); break;
      case 'swim': this.swim(input, dt); break;
    }

    // Terminal velocity
    if (s.vel.length() > PHYSICS.terminalVelocity) s.vel.setLength(PHYSICS.terminalVelocity);

    if (s.mode !== 'wall' && s.mode !== 'wallrun') {
      if (anyAttached(s)) solveRopes(s, this.physics, dt);
      solvePull(s, this.physics, dt);
    }
    this.desired.copy(s.vel).multiplyScalar(dt);
    if (s.mode === 'wall' || s.mode === 'wallrun') {
      this.desired.addScaledVector(s.wallNormal, -0.5 * dt); // keep contact
    }

    this.vPre.copy(this.desired).divideScalar(dt);
    this.move(input, dt);
  }

  private ropePullsOffWall(): boolean {
    const s = this.state;
    for (const l of [...s.lines, s.pull]) {
      if (l.holding) continue;
      if (l.kind !== 'attached') continue;
      if (l.reel === 1) return true;
      const toAnchor = this.t1.subVectors(l.target, s.pos);
      const d = toAnchor.length();
      if (d > l.length && toAnchor.dot(s.wallNormal) / d > 0.3) return true;
    }
    return false;
  }

  private groundMove(input: InputSnapshot, controlScale: number, dt: number): void {
    const s = this.state;
    const sprint = input.down.sprint;
    let speed = sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
    if (s.slowTimer > 0) speed *= LANDING.slowdownFactor;
    const target = this.t1.copy(this.wish).multiplyScalar(speed * controlScale);
    const horiz = this.t2.set(s.vel.x, 0, s.vel.z);
    const hs = horiz.length();
    if (hs > speed && target.lengthSq() > 0 && horiz.dot(target) > 0) {
      // Faster than run speed (e.g. after a swing): keep momentum but only ever bleed it off.
      // Input may steer the direction, never add speed (running can't exceed run speed).
      const newSpeed = Math.max(speed, hs - PLAYER.groundFriction * dt);
      horiz.addScaledVector(this.wish, PLAYER.groundAccel * 0.25 * dt).setLength(newSpeed);
    } else {
      const diff = target.sub(horiz);
      const maxDelta = PLAYER.groundAccel * dt * (hs > speed ? 0.5 : 1);
      if (diff.length() > maxDelta) diff.setLength(maxDelta);
      horiz.add(diff);
    }
    s.vel.x = horiz.x;
    s.vel.z = horiz.z;
    s.vel.y = -2; // keep snapped to ground

    if (input.pressed.jump && controlScale > 0) {
      s.vel.y = sprint ? PLAYER.sprintJumpSpeed : PLAYER.jumpSpeed;
      s.mode = 'air';
      s.events.push({ type: 'jump' });
    }
  }

  private airMove(controlScale: number, dt: number): void {
    const s = this.state;
    s.vel.y -= PHYSICS.gravity * dt;
    // Air control steers but never creates speed: horizontal speed may not end up above
    // max(speed before, airControlMaxSpeed). Swing momentum is kept; holding W (or air-strafing
    // by turning) can't build speed from nothing.
    if (this.wish.lengthSq() > 0 && controlScale > 0) {
      const before = Math.hypot(s.vel.x, s.vel.z);
      s.vel.x += this.wish.x * PLAYER.airControl * dt;
      s.vel.z += this.wish.z * PLAYER.airControl * dt;
      const after = Math.hypot(s.vel.x, s.vel.z);
      const cap = Math.max(before, PLAYER.airControlMaxSpeed);
      if (after > cap) {
        s.vel.x *= cap / after;
        s.vel.z *= cap / after;
      }
    }
    s.vel.multiplyScalar(1 - PLAYER.airDrag * dt);
  }

  private wallBasis(): [THREE.Vector3, THREE.Vector3] {
    const n = this.state.wallNormal;
    const up = this.t1.copy(UP).addScaledVector(n, -n.y).normalize();
    const right = this.t2.crossVectors(up, n).normalize();
    return [up, right];
  }

  private wallCrawl(input: InputSnapshot, fwd: number, side: number, aim: THREE.Vector3): void {
    const s = this.state;
    if (input.pressed.jump) return this.wallJump(aim);
    if (input.pressed.crouch) {
      s.vel.copy(s.wallNormal).multiplyScalar(2);
      s.mode = 'air';
      s.restickTimer = 0.5;
      return;
    }
    const [up, right] = this.wallBasis();
    const speed = input.down.sprint ? WALL.crawlSprintSpeed : WALL.crawlSpeed;
    s.vel.set(0, 0, 0).addScaledVector(up, fwd * speed).addScaledVector(right, side * speed);
  }

  private wallRun(input: InputSnapshot, aim: THREE.Vector3, dt: number): void {
    const s = this.state;
    if (input.pressed.jump) return this.wallJump(aim);
    s.wallRunTime += dt;
    const n = s.wallNormal;
    s.vel.addScaledVector(n, -s.vel.dot(n)); // stay in the wall plane
    s.vel.y -= PHYSICS.gravity * WALL.wallRunGravityScale * dt;
    if (s.wallRunTime > WALL.wallRunDuration || s.vel.length() < WALL.wallRunMinSpeed * 0.5 || !input.down.sprint) {
      s.mode = 'wall';
    }
  }

  private wallJump(aim: THREE.Vector3): void {
    const s = this.state;
    const look = this.t1.set(aim.x, 0, aim.z);
    if (look.dot(s.wallNormal) < 0) look.addScaledVector(s.wallNormal, -look.dot(s.wallNormal)); // don't jump into the wall
    if (look.lengthSq() > 1e-4) look.normalize();
    s.vel.copy(s.wallNormal).multiplyScalar(WALL.jumpNormalSpeed)
      .addScaledVector(UP, WALL.jumpUpSpeed)
      .addScaledVector(look, WALL.jumpLookSpeed);
    s.mode = 'air';
    s.restickTimer = WALL.restickCooldown;
    s.events.push({ type: 'wallJump' });
  }

  private swim(input: InputSnapshot, dt: number): void {
    const s = this.state;
    const target = this.t1.copy(this.wish).multiplyScalar(WATER.swimSpeed);
    s.vel.x += (target.x - s.vel.x) * Math.min(1, 4 * dt);
    s.vel.z += (target.z - s.vel.z) * Math.min(1, 4 * dt);
    s.vel.y += ((WATER.surfaceY - 0.3 - s.pos.y) * 4 - s.vel.y) * Math.min(1, 5 * dt);
    if (input.pressed.jump) {
      s.vel.y = WATER.jumpOutSpeed;
      s.mode = 'air';
    }
  }

  private inRiver(): boolean {
    const { z0, z1 } = this.city.river;
    return this.state.pos.z > z0 && this.state.pos.z < z1;
  }

  /** Move the capsule with collision, then resolve mode transitions. */
  private move(input: InputSnapshot, dt: number): void {
    const s = this.state;
    this.cc.computeColliderMovement(this.collider, this.desired);
    const mv = this.cc.computedMovement();
    const grounded = this.cc.computedGrounded();
    s.pos.x += mv.x; s.pos.y += mv.y; s.pos.z += mv.z;
    this.body.setNextKinematicTranslation({ x: s.pos.x, y: s.pos.y, z: s.pos.z });

    // Velocity follows the (rope-corrected) motion; remove components pushed into obstacles
    s.vel.copy(this.vPre);
    let wallN: THREE.Vector3 | null = null;
    for (let i = 0; i < this.cc.numComputedCollisions(); i++) {
      const c = this.cc.computedCollision(i);
      if (!c) continue;
      const n = new THREE.Vector3(c.normal1.x, c.normal1.y, c.normal1.z);
      const into = s.vel.dot(n);
      if (into < 0) s.vel.addScaledVector(n, -into);
      if (Math.abs(n.y) < WALL.stickMaxNormalY) wallN = n;
    }

    const moved = this.t1.set(mv.x, 0, mv.z).length();

    // Water
    if (s.mode !== 'swim' && this.inRiver() && s.pos.y < WATER.surfaceY) {
      s.mode = 'swim';
      s.events.push({ type: 'splash' });
      s.vel.multiplyScalar(0.3);
      return;
    }

    switch (s.mode) {
      case 'air':
      case 'swim': {
        if (wallN) {
          if (this.shouldGrab(wallN, input)) return this.enterWall(wallN, input);
          this.scrape(wallN, dt);
        }
        if (grounded && this.vPre.y <= 0.5) this.land();
        if (s.mode === 'swim' && s.pos.y > WATER.surfaceY + 0.6) s.mode = 'air';
        break;
      }
      case 'ground': {
        if (wallN && s.restickTimer <= 0 && input.down.forward && this.wish.dot(wallN) < -0.5) {
          return this.enterWall(wallN, input);
        }
        if (!grounded) {
          s.mode = 'air';
        } else {
          s.stepDistance += moved;
          const stride = input.down.sprint ? 2.6 : 1.9;
          if (s.stepDistance > stride) {
            s.stepDistance = 0;
            s.events.push({ type: 'step', sprint: input.down.sprint });
          }
        }
        break;
      }
      case 'wall':
      case 'wallrun':
        this.maintainWall(input, grounded);
        break;
    }
  }

  /** Is this wall contact deliberate? (SPEC §4.3: grab vs. slide) */
  private shouldGrab(n: THREE.Vector3, input: InputSnapshot): boolean {
    const s = this.state;
    if (s.restickTimer > 0) return false;
    // Mid-swing (or mid-pull) you never grab: you scrape along and keep swinging
    if (anyAttached(s) || (s.pull.kind === 'attached' && !s.pull.holding)) return false;
    const speed = this.vPre.length();
    if (speed < 0.5) return true;
    if (input.down.sprint && speed >= WALL.wallRunMinSpeed) return true; // deliberate wall-run
    const headOn = -this.vPre.dot(n) / speed;
    if (headOn >= WALL.grabApproachCos) return true;
    return input.down.forward && this.wish.dot(n) < -0.5; // pushing into the wall = grab
  }

  /** Glancing / mid-swing contact: keep the along-wall motion with a little friction. */
  private scrape(n: THREE.Vector3, dt: number): void {
    const s = this.state;
    const vn = s.vel.dot(n);
    const tangent = this.t2.copy(s.vel).addScaledVector(n, -vn);
    tangent.multiplyScalar(Math.max(0, 1 - WALL.slideFriction * dt));
    s.vel.copy(tangent).addScaledVector(n, Math.max(0, vn));
    s.scrapeTimer -= dt;
    const speed = tangent.length();
    if (speed > 4 && s.scrapeTimer <= 0) {
      s.scrapeTimer = WALL.scrapeSoundInterval;
      s.events.push({ type: 'wallScrape', speed });
    }
  }

  private enterWall(n: THREE.Vector3, input: InputSnapshot): void {
    const s = this.state;
    const impact = -this.vPre.dot(n);
    s.wallNormal.copy(n);
    const tangent = this.t2.copy(this.vPre).addScaledVector(n, impact); // remove into-wall component
    if (input.down.sprint && this.vPre.length() >= WALL.wallRunMinSpeed && s.staggerTimer <= 0) {
      s.mode = 'wallrun';
      s.wallRunTime = 0;
      s.vel.copy(tangent).addScaledVector(UP, Math.max(0, impact) * 0.8);
      s.events.push({ type: 'wallStick', impact });
      return;
    }
    s.mode = 'wall';
    s.vel.set(0, 0, 0);
    if (impact > WALL.staggerImpactSpeed) {
      s.staggerTimer = WALL.staggerTime;
      s.events.push({ type: 'stagger', impact });
    } else {
      s.events.push({ type: 'wallStick', impact });
    }
  }

  private maintainWall(input: InputSnapshot, grounded: boolean): void {
    const s = this.state;
    const probe = this.t1.copy(s.wallNormal).negate();
    const hit = this.physics.raycast(s.pos, probe, PLAYER.capsuleRadius + WALL.attachProbe, this.collider);
    if (hit && Math.abs(hit.normal.y) < WALL.stickMaxNormalY) {
      s.wallNormal.copy(hit.normal);
      if (grounded && input.down.back) {
        s.mode = 'ground';
        s.restickTimer = WALL.restickCooldown;
      }
      return;
    }
    // Lost the wall. Top edge while climbing → mantle onto the roof.
    const climbing = s.mode === 'wallrun' ? s.vel.y > 0 : input.down.forward;
    s.mode = 'air';
    s.restickTimer = 0.25;
    if (climbing) {
      s.vel.copy(UP).multiplyScalar(7).addScaledVector(s.wallNormal, -5);
    } else {
      s.vel.copy(s.wallNormal).multiplyScalar(1);
    }
  }

  private land(): void {
    const s = this.state;
    const impact = -this.vPre.y;
    s.mode = 'ground';
    s.vel.y = 0;
    if (impact > LANDING.heavyImpactSpeed) s.slowTimer = LANDING.slowdownTime;
    s.events.push({ type: 'land', impact });
  }
}
