// Lineweaver's first-person arms (SPEC §3.1, §9): gloved hands with jointed fingers and a slim
// watch-style line launcher on top of each wrist. Lines leave from the launcher's nozzle.

import * as THREE from 'three';
import { toon } from '../render/materials';
import { HERO_GRAPHITE, HERO_ORANGE, HERO_TEAL, LINE_CYAN } from '../world/palette';
import type { Hand, LineState } from './state';

interface Finger {
  joints: THREE.Group[]; // proximal → distal, each curls around its local X axis
  maxCurl: number[]; // radians per joint at full fist
}

interface Arm {
  root: THREE.Group; // elbow pivot; aims the forearm
  wrist: THREE.Group; // wrist pivot; flicks when firing
  fingers: Finger[];
  thumb: THREE.Group[];
  bezel: THREE.Mesh;
  faceMat: THREE.MeshBasicMaterial;
  nozzle: THREE.Object3D;
  restLocal: THREE.Vector3;
  curl: number; // 0 open … 1 fist
  flick: number; // 1 → 0 after firing
  side: number;
}

const DIM = new THREE.Color(0x1e3c3f);
const CYAN = new THREE.Color(LINE_CYAN);
const ORANGE = new THREE.Color(HERO_ORANGE);

/** Capsule segment that starts at the parent pivot and extends along +Z. */
function segment(radius: number, length: number, mat: THREE.Material): THREE.Mesh {
  const geo = new THREE.CapsuleGeometry(radius, Math.max(0.001, length - radius * 2), 4, 8);
  geo.rotateX(Math.PI / 2);
  geo.translate(0, 0, length / 2);
  return new THREE.Mesh(geo, mat);
}

export class Arms {
  private arms: [Arm, Arm];
  private tmpQ = new THREE.Quaternion();
  private tmpV = new THREE.Vector3();
  private rollQ = new THREE.Quaternion();
  private zAxis = new THREE.Vector3(0, 0, 1);
  private bob = 0;
  private mats = {
    sleeve: toon({ color: HERO_TEAL }),
    glove: toon({ color: HERO_GRAPHITE }),
    accent: toon({ color: HERO_ORANGE }),
    device: toon({ color: 0x23272b }),
  };

  constructor(private camera: THREE.PerspectiveCamera) {
    this.arms = [this.build(0), this.build(1)];
  }

  private build(hand: Hand): Arm {
    const side = hand === 0 ? -1 : 1; // -1 = left
    const inward = -side; // direction towards the body's centre line
    const m = this.mats;

    const root = new THREE.Group();
    root.position.set(side * 0.2, -0.235, -0.02);
    this.camera.add(root);

    // Forearm: tapered sleeve from elbow (z=0) to wrist (z=0.27)
    const forearmGeo = new THREE.CylinderGeometry(0.034, 0.047, 0.27, 14);
    forearmGeo.rotateX(Math.PI / 2);
    forearmGeo.translate(0, 0, 0.135);
    const forearm = new THREE.Mesh(forearmGeo, m.sleeve);
    forearm.scale.set(1, 0.85, 1); // slightly flattened, like a real forearm
    root.add(forearm);
    // Graphite panel along the outer forearm + orange cuff seam
    const panel = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.05, 0.2), m.glove);
    panel.position.set(-inward * 0.036, 0, 0.13);
    root.add(panel);
    const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.035, 0.004, 6, 20), m.accent);
    cuff.scale.set(1, 0.85, 1);
    cuff.position.z = 0.25;
    root.add(cuff);

    // Wrist pivot
    const wrist = new THREE.Group();
    wrist.position.z = 0.27;
    root.add(wrist);

    // Watch-style launcher: band around the wrist + slim body on top
    const band = new THREE.Mesh(new THREE.TorusGeometry(0.034, 0.006, 6, 20), m.device);
    band.scale.set(1, 0.82, 1);
    band.position.z = -0.025;
    wrist.add(band);
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.028, 0.01, 0.036), m.device);
    body.position.set(0, 0.032, -0.025);
    wrist.add(body);
    const bezel = new THREE.Mesh(new THREE.TorusGeometry(0.0105, 0.0022, 6, 18), m.accent);
    bezel.rotation.x = Math.PI / 2;
    bezel.position.set(0, 0.038, -0.027);
    wrist.add(bezel);
    // Notch on the bezel so you can see it spin while reeling
    const notch = new THREE.Mesh(new THREE.BoxGeometry(0.004, 0.004, 0.006), m.glove);
    notch.position.set(0.0105, 0, 0);
    bezel.add(notch);
    const faceMat = new THREE.MeshBasicMaterial({ color: DIM.clone() });
    const face = new THREE.Mesh(new THREE.CylinderGeometry(0.0082, 0.0082, 0.002, 16), faceMat);
    face.position.set(0, 0.038, -0.027);
    wrist.add(face);
    const nozzleMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.005, 0.016, 8), m.accent);
    nozzleMesh.rotation.x = Math.PI / 2;
    nozzleMesh.position.set(0, 0.032, 0.0);
    wrist.add(nozzleMesh);
    const nozzle = new THREE.Object3D();
    nozzle.position.set(0, 0.032, 0.01);
    wrist.add(nozzle);

    // Palm (back of hand up, palm facing down)
    const palmGeo = new THREE.CapsuleGeometry(0.036, 0.02, 6, 12);
    palmGeo.rotateZ(Math.PI / 2); // long axis across the hand
    palmGeo.scale(0.98, 0.36, 1.25);
    palmGeo.translate(0, 0, 0.046);
    const palm = new THREE.Mesh(palmGeo, m.glove);
    wrist.add(palm);
    // Teal accent stripe across the back of the hand
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.004, 0.012), m.sleeve);
    stripe.position.set(0, 0.013, 0.05);
    wrist.add(stripe);

    // Four fingers: index nearest the thumb (inward side)
    const fingerSpecs = [
      { x: inward * 0.028, lens: [0.042, 0.026, 0.02], r: 0.0095 }, // index
      { x: inward * 0.009, lens: [0.046, 0.029, 0.021], r: 0.0098 }, // middle
      { x: -inward * 0.01, lens: [0.043, 0.027, 0.02], r: 0.0094 }, // ring
      { x: -inward * 0.028, lens: [0.034, 0.021, 0.018], r: 0.0085 }, // pinky
    ];
    const fingers: Finger[] = fingerSpecs.map((f) => {
      const joints: THREE.Group[] = [];
      let parent: THREE.Object3D = wrist;
      f.lens.forEach((len, j) => {
        const joint = new THREE.Group();
        if (j === 0) joint.position.set(f.x, -0.002, 0.086);
        else joint.position.z = f.lens[j - 1];
        joint.add(segment(f.r * (1 - j * 0.08), len, m.glove));
        parent.add(joint);
        joints.push(joint);
        parent = joint;
      });
      return { joints, maxCurl: [1.45, 1.6, 1.1] };
    });

    // Thumb: two segments from the inner side of the palm, angled forward and inward
    const t0 = new THREE.Group();
    t0.position.set(inward * 0.04, -0.006, 0.022);
    wrist.add(t0);
    t0.add(segment(0.011, 0.038, m.glove));
    const t1 = new THREE.Group();
    t1.position.z = 0.038;
    t0.add(t1);
    t1.add(segment(0.0098, 0.028, m.glove));

    root.traverse((o) => {
      o.castShadow = false;
    });

    return {
      root, wrist, fingers, thumb: [t0, t1], bezel, faceMat, nozzle,
      restLocal: new THREE.Vector3(side * 0.08, 0.1, -1),
      curl: 0.3, flick: 0, side,
    };
  }

  /** World position of the launcher nozzle (where the line leaves). */
  wristWorld(hand: Hand, out: THREE.Vector3): THREE.Vector3 {
    return this.arms[hand].nozzle.getWorldPosition(out);
  }

  fired(hand: Hand): void {
    this.arms[hand].flick = 1;
  }

  update(lines: [LineState, LineState], speed: number, grounded: boolean, dt: number): void {
    this.bob += dt * (grounded ? Math.min(speed, 13) * 0.9 : 0);
    for (const hand of [0, 1] as Hand[]) {
      const arm = this.arms[hand];
      const l = lines[hand];
      const active = l.kind === 'firing' || l.kind === 'attached';

      // Aim the forearm at the line target, clamped to stay in front of the camera
      const local = this.tmpV;
      if (active) {
        local.copy(l.target);
        this.camera.worldToLocal(local);
        local.normalize();
        if (local.z > -0.35) local.z = -0.35;
        local.normalize();
        local.y -= 0.08;
      } else {
        local.copy(arm.restLocal);
        local.y += Math.sin(this.bob) * 0.025 * (hand === 0 ? 1 : -1);
      }
      local.add(arm.root.position);
      const prev = this.tmpQ.copy(arm.root.quaternion);
      arm.root.lookAt(this.camera.localToWorld(local));
      // Roll the forearm so the thumb comes up when gripping a line (like holding a rope)
      const roll = -arm.side * (active && arm.flick < 0.5 ? 1.15 : 0.35);
      const targetQ = arm.root.quaternion.clone().multiply(this.rollQ.setFromAxisAngle(this.zAxis, roll));
      arm.root.quaternion.copy(prev).slerp(targetQ, Math.min(1, dt * (active ? 16 : 7)));

      // Hand pose: open + wrist flick right after firing, fist while holding a line, relaxed otherwise
      arm.flick = Math.max(0, arm.flick - dt * 5);
      const targetCurl = arm.flick > 0.4 ? 0 : active ? 1 : 0.3;
      arm.curl += (targetCurl - arm.curl) * Math.min(1, dt * (targetCurl > arm.curl ? 14 : 9));
      const flick = Math.sin(arm.flick * Math.PI);
      arm.wrist.rotation.x = -0.55 * flick + (active ? 0.12 : 0.05);
      arm.wrist.rotation.z = arm.side * 0.15 * (1 - arm.curl);
      arm.root.position.z = -0.02 + flick * 0.02;

      for (const f of arm.fingers) {
        f.joints.forEach((j, i) => {
          j.rotation.x = f.maxCurl[i] * arm.curl + 0.08;
        });
      }
      const [t0, t1] = arm.thumb;
      // Thumb angles slightly outward when open and wraps across the fingers in a fist
      t0.rotation.set(0.25 + 0.55 * arm.curl, arm.side * (0.75 * arm.curl - 0.3), 0);
      t1.rotation.x = 0.15 + 0.6 * arm.curl;

      // Bezel spins while reeling / paying out; face light shows line state
      const spin = l.kind === 'firing' ? 40 : l.reel !== 0 ? 18 * l.reel : 0;
      arm.bezel.rotation.z += spin * dt;
      const c = l.kind === 'attached' ? CYAN : l.kind === 'firing' ? ORANGE : DIM;
      arm.faceMat.color.lerp(c, Math.min(1, dt * 20));
    }
  }
}
