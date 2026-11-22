// Web balls (SPEC §5.2), key R: sticky projectiles that drop under gravity like the web stream.
// On hit they leave a web splat decal (fades after a while, capped count). Hitting a movable prop
// knocks it and makes it sticky: it glues in place once it settles. Splats are anchors: a web
// stream passing close to one snaps onto it (and follows it if the splat is on a prop).

import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { LINES, WEB_BALLS } from '../config/gameplay';
import type { Physics, RayHit } from '../core/physics';
import type { InputSnapshot } from '../input/input';
import type { GameEvent, Hand } from '../player/state';
import type { Props } from '../world/props';
import { LINE_CYAN } from '../world/palette';
import { stepTip } from './ballistics';

interface Ball {
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  mesh: THREE.Mesh;
}

interface Splat {
  pos: THREE.Vector3;
  normal: THREE.Vector3;
  body: number; // prop handle or -1
  local: THREE.Vector3;
  localNormal: THREE.Vector3;
  age: number;
  spin: number;
  mesh: THREE.Mesh;
}

/** Web-pattern decal texture: radial strands + rings, white with a cyan tint. */
function splatTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.translate(64, 64);
  g.strokeStyle = 'rgba(235,255,255,0.95)';
  g.lineWidth = 3;
  const spokes = 9;
  for (let i = 0; i < spokes; i++) {
    const a = (i / spokes) * Math.PI * 2 + (i % 2) * 0.15;
    g.beginPath();
    g.moveTo(0, 0);
    g.lineTo(Math.cos(a) * 60, Math.sin(a) * 60);
    g.stroke();
  }
  g.lineWidth = 2;
  for (const r of [14, 27, 41, 54]) {
    g.beginPath();
    for (let i = 0; i <= spokes; i++) {
      const a = (i / spokes) * Math.PI * 2 + (i % 2) * 0.15;
      const rr = r * (0.9 + 0.1 * Math.sin(i * 3));
      if (i === 0) g.moveTo(Math.cos(a) * rr, Math.sin(a) * rr);
      else g.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    g.stroke();
  }
  const blob = g.createRadialGradient(0, 0, 0, 0, 0, 16);
  blob.addColorStop(0, 'rgba(255,255,255,1)');
  blob.addColorStop(1, 'rgba(200,255,255,0)');
  g.fillStyle = blob;
  g.beginPath();
  g.arc(0, 0, 16, 0, Math.PI * 2);
  g.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const Z = new THREE.Vector3(0, 0, 1);
const spinQ = new THREE.Quaternion();
const tmp = new THREE.Vector3();
const closest = new THREE.Vector3();
const seg = new THREE.Vector3();

export class WebBalls {
  private balls: Ball[] = [];
  private splats: Splat[] = [];
  private cooldown = 0;
  private nextHand: Hand = 1;
  private ballGeo = new THREE.SphereGeometry(0.16, 10, 8);
  private ballMat = new THREE.MeshBasicMaterial({ color: 0xe8ffff });
  private splatGeo: THREE.CircleGeometry;
  private splatTex = splatTexture();

  constructor(private scene: THREE.Scene, private physics: Physics, private props: Props) {
    this.splatGeo = new THREE.CircleGeometry(WEB_BALLS.splatRadius, 20);
  }

  /** Fire (R), fly, hit. Runs on the fixed tick. */
  tick(
    input: InputSnapshot, eye: THREE.Vector3, aim: THREE.Vector3, playerVel: THREE.Vector3,
    self: RAPIER.Collider, events: GameEvent[], dt: number,
  ): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (input.down.webBall && this.cooldown === 0) {
      this.cooldown = WEB_BALLS.cooldown;
      const hand = this.nextHand;
      this.nextHand = hand === 0 ? 1 : 0;
      if (this.balls.length >= WEB_BALLS.maxBalls) this.removeBall(this.balls[0]);
      const mesh = new THREE.Mesh(this.ballGeo, this.ballMat);
      this.scene.add(mesh);
      this.balls.push({
        pos: eye.clone().addScaledVector(aim, 0.5),
        vel: aim.clone().multiplyScalar(WEB_BALLS.speed).addScaledVector(playerVel, LINES.inheritVelocity),
        age: 0,
        mesh,
      });
      events.push({ type: 'webBall', hand });
    }

    for (const b of [...this.balls]) {
      b.age += dt;
      // Balls fly like the web stream (same gravity) but don't snap to existing splats
      const hit = stepTip(b.pos, b.vel, dt, this.physics, self, false);
      if (hit) {
        this.onHit(hit, b.vel, events);
        this.removeBall(b);
      } else if (b.age > WEB_BALLS.maxFlightTime) {
        this.removeBall(b);
      }
    }

    // Splats on props follow their body
    for (const s of this.splats) {
      if (s.body < 0) continue;
      const body = this.physics.world.getRigidBody(s.body);
      if (!body) {
        s.body = -1;
        continue;
      }
      this.physics.toWorld(body, s.local, s.pos);
      const r = body.rotation();
      s.normal.copy(s.localNormal).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w));
    }
  }

  private onHit(hit: RayHit, vel: THREE.Vector3, events: GameEvent[]): void {
    const body = hit.body;
    if (body && this.props.get(body)) {
      if (body.isDynamic()) {
        tmp.copy(vel).normalize().multiplyScalar(WEB_BALLS.impulse);
        body.applyImpulseAtPoint({ x: tmp.x, y: tmp.y, z: tmp.z }, { x: hit.point.x, y: hit.point.y, z: hit.point.z }, true);
      }
      this.props.makeSticky(body);
    }
    this.addSplat(hit);
    events.push({ type: 'splat', onProp: !!body });
  }

  private addSplat(hit: RayHit): void {
    if (this.splats.length >= WEB_BALLS.maxSplats) this.removeSplat(this.splats[0]);
    const mat = new THREE.MeshBasicMaterial({
      map: this.splatTex, color: new THREE.Color(LINE_CYAN).lerp(new THREE.Color(0xffffff), 0.7),
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
      side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.splatGeo, mat);
    mesh.renderOrder = 2;
    this.scene.add(mesh);
    const s: Splat = {
      pos: hit.point.clone(), normal: hit.normal.clone(), body: -1,
      local: new THREE.Vector3(), localNormal: new THREE.Vector3(), age: 0, spin: Math.random() * Math.PI * 2, mesh,
    };
    if (hit.body) {
      s.body = hit.body.handle;
      this.physics.toLocal(hit.body, hit.point, s.local);
      const r = hit.body.rotation();
      s.localNormal.copy(hit.normal).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w).invert());
    }
    this.splats.push(s);
  }

  /**
   * Anchor magnet: if the segment from→to passes within anchorRadius of a splat, return a hit at
   * the splat (closest along the segment). Plugged into stepTip for web streams and predictions.
   */
  magnet = (from: THREE.Vector3, to: THREE.Vector3): RayHit | null => {
    let best: RayHit | null = null;
    seg.subVectors(to, from);
    const len2 = seg.lengthSq();
    if (len2 < 1e-8) return null;
    for (const s of this.splats) {
      const t = THREE.MathUtils.clamp(tmp.subVectors(s.pos, from).dot(seg) / len2, 0, 1);
      closest.copy(from).addScaledVector(seg, t);
      if (closest.distanceTo(s.pos) > WEB_BALLS.anchorRadius) continue;
      const dist = Math.sqrt(len2) * t;
      if (best && dist >= best.distance) continue;
      best = {
        point: s.pos.clone(), normal: s.normal.clone(), distance: dist,
        body: s.body >= 0 ? this.physics.world.getRigidBody(s.body) : null,
      };
    }
    return best;
  };

  /** Per render frame: move ball meshes, orient + fade splats, expire old splats. */
  render(dt: number): void {
    for (const b of this.balls) b.mesh.position.copy(b.pos);
    for (const s of [...this.splats]) {
      s.age += dt;
      if (s.age > WEB_BALLS.splatLifetime) {
        this.removeSplat(s);
        continue;
      }
      s.mesh.position.copy(s.pos).addScaledVector(s.normal, 0.03);
      s.mesh.quaternion.setFromUnitVectors(Z, s.normal).multiply(spinQ.setFromAxisAngle(Z, s.spin));
      const fadeStart = WEB_BALLS.splatLifetime - WEB_BALLS.splatFade;
      (s.mesh.material as THREE.MeshBasicMaterial).opacity = s.age < fadeStart ? 0.95 : 0.95 * (1 - (s.age - fadeStart) / WEB_BALLS.splatFade);
    }
  }

  private removeBall(b: Ball): void {
    this.scene.remove(b.mesh);
    this.balls.splice(this.balls.indexOf(b), 1);
  }

  private removeSplat(s: Splat): void {
    this.scene.remove(s.mesh);
    (s.mesh.material as THREE.Material).dispose();
    this.splats.splice(this.splats.indexOf(s), 1);
  }
}
