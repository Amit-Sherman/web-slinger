// Lineweaver's first-person forearms + wrist reels (SPEC §3.1, §9).

import * as THREE from 'three';
import { toon } from '../render/materials';
import { HERO_GRAPHITE, HERO_ORANGE, HERO_TEAL, LINE_CYAN } from '../world/palette';
import type { Hand, LineState } from './state';

interface Arm {
  root: THREE.Group;
  spool: THREE.Mesh;
  light: THREE.Mesh;
  lightMat: THREE.MeshBasicMaterial;
  wrist: THREE.Object3D;
  restLocal: THREE.Vector3;
  recoil: number;
}

const DIM = new THREE.Color(0x24474a);
const CYAN = new THREE.Color(LINE_CYAN);
const ORANGE = new THREE.Color(HERO_ORANGE);

export class Arms {
  private arms: [Arm, Arm];
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private bob = 0;

  constructor(private camera: THREE.PerspectiveCamera) {
    this.arms = [this.build(0), this.build(1)];
  }

  private build(hand: Hand): Arm {
    const side = hand === 0 ? -1 : 1;
    const root = new THREE.Group();
    root.position.set(side * 0.24, -0.29, -0.12);
    root.scale.setScalar(0.65);
    this.camera.add(root);

    const teal = toon({ color: HERO_TEAL });
    const graphite = toon({ color: HERO_GRAPHITE });
    const orange = toon({ color: HERO_ORANGE });

    const forearm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.055, 0.34, 10), teal);
    forearm.rotation.x = Math.PI / 2;
    forearm.position.z = 0.17;
    root.add(forearm);

    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.02, 0.22), graphite);
    panel.position.set(0, -0.045, 0.16);
    root.add(panel);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 16), orange);
    ring.position.z = 0.33;
    root.add(ring);

    const glove = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.06, 0.11), graphite);
    glove.position.z = 0.4;
    root.add(glove);
    const knuckles = new THREE.Mesh(new THREE.BoxGeometry(0.088, 0.035, 0.04), teal);
    knuckles.position.set(0, 0.01, 0.46);
    root.add(knuckles);

    // Wrist reel housing + spinning spool on top of the wrist
    const housing = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.04, 0.1), graphite);
    housing.position.set(0, 0.06, 0.28);
    root.add(housing);
    const spool = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.07, 12), orange);
    spool.rotation.z = Math.PI / 2;
    spool.position.set(0, 0.092, 0.28);
    root.add(spool);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.006, 0.01), graphite);
    stripe.position.y = 0.023;
    spool.add(stripe);

    const lightMat = new THREE.MeshBasicMaterial({ color: DIM.clone() });
    const light = new THREE.Mesh(new THREE.SphereGeometry(0.009, 8, 6), lightMat);
    light.position.set(side * -0.03, 0.093, 0.34);
    root.add(light);

    const wrist = new THREE.Object3D();
    wrist.position.set(0, 0.07, 0.36);
    root.add(wrist);

    for (const o of root.children) {
      o.castShadow = false;
      o.renderOrder = 10;
    }
    return { root, spool, light, lightMat, wrist, restLocal: new THREE.Vector3(side * 0.05, -0.2, -1), recoil: 0 };
  }

  wristWorld(hand: Hand, out: THREE.Vector3): THREE.Vector3 {
    return this.arms[hand].wrist.getWorldPosition(out);
  }

  fired(hand: Hand): void {
    this.arms[hand].recoil = 1;
  }

  update(lines: [LineState, LineState], speed: number, grounded: boolean, dt: number): void {
    this.bob += dt * (grounded ? Math.min(speed, 13) * 0.9 : 0);
    for (const hand of [0, 1] as Hand[]) {
      const arm = this.arms[hand];
      const l = lines[hand];
      const active = l.kind === 'firing' || l.kind === 'attached';
      // Point the arm at the line target, clamped to stay in front of the camera
      const local = this.tmpV;
      if (active) {
        local.copy(l.target);
        this.camera.worldToLocal(local);
        local.normalize();
        if (local.z > -0.35) local.z = -0.35;
        local.normalize();
        local.y -= 0.12;
      } else {
        local.copy(arm.restLocal);
        local.y += Math.sin(this.bob) * 0.03 * (hand === 0 ? 1 : -1);
      }
      local.add(arm.root.position);
      const prev = this.tmpQ.copy(arm.root.quaternion);
      arm.root.lookAt(this.camera.localToWorld(local));
      const targetQ = arm.root.quaternion.clone();
      arm.root.quaternion.copy(prev).slerp(targetQ, Math.min(1, dt * (active ? 18 : 8)));

      // Recoil kick when firing
      arm.recoil = Math.max(0, arm.recoil - dt * 6);
      arm.root.position.z = -0.12 + arm.recoil * 0.05;

      // Spool spins while reeling / line paying out
      const spin = l.kind === 'firing' ? 60 : l.reel !== 0 ? 25 * l.reel : l.kind === 'retracting' ? 40 : 0;
      arm.spool.rotation.x += spin * dt;

      const c = l.kind === 'attached' ? CYAN : l.kind === 'firing' || l.kind === 'missed' ? ORANGE : DIM;
      arm.lightMat.color.lerp(c, Math.min(1, dt * 20));
    }
  }
}
