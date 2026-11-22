// Webcam head-tracking (SPEC §3.2). MediaPipe Face Landmarker runs on the webcam (served locally:
// WASM in /mediapipe/wasm, model in /mediapipe/face_landmarker.task). It gives the face's
// transformation matrix; we turn it into a head pose relative to a calibrated neutral pose,
// smooth it with One-Euro filters, and expose look offsets (yaw/pitch/roll) and a lean offset.
//
// Sign conventions (camera space: x = image right = the player's LEFT, y up, z towards the camera):
//   face forward f = R·(0,0,1): turning your head left → f.x > 0 → positive yaw (look left).
//   f.y > 0 → looking up → positive pitch. Moving left → t.x grows → camera moves left.

import * as THREE from 'three';
import { OneEuroFilter } from './oneEuro';

export type TrackerStatus = 'off' | 'starting' | 'tracking' | 'no-face' | 'error';

export interface HeadPose {
  yaw: number; // radians, + = left
  pitch: number; // radians, + = up
  roll: number; // radians, + = head tilted to the left
  x: number; // metres, + = player moved right
  y: number; // metres, + = up
  z: number; // metres, + = leaned back (away from the screen)
}

const ZERO: HeadPose = { yaw: 0, pitch: 0, roll: 0, x: 0, y: 0, z: 0 };
const KEYS = ['yaw', 'pitch', 'roll', 'x', 'y', 'z'] as const;
const DETECT_INTERVAL_MS = 1000 / 30;
const CALIBRATION_FRAMES = 10;

// Minimal shape of the MediaPipe landmarker we use (the module is loaded lazily)
interface Landmarker {
  detectForVideo(video: HTMLVideoElement, ts: number): { facialTransformationMatrixes?: { data: number[] }[] };
  close(): void;
}

export class HeadTracker {
  status: TrackerStatus = 'off';
  error = '';
  /** Smoothed pose relative to neutral. Eases back to zero when the face is lost. */
  readonly pose: HeadPose = { ...ZERO };

  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private landmarker: Landmarker | null = null;
  private neutral: HeadPose | null = null;
  private calib: HeadPose[] = [];
  private filters = KEYS.map(() => new OneEuroFilter(1.2, 0.08));
  private lastDetect = 0;
  private lastVideoTime = -1;
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private v = new THREE.Vector3();
  private u = new THREE.Vector3();
  private t = new THREE.Vector3();
  private s = new THREE.Vector3();
  private generation = 0;

  async start(): Promise<void> {
    if (this.status === 'starting' || this.status === 'tracking' || this.status === 'no-face') return;
    const gen = ++this.generation;
    this.status = 'starting';
    this.error = '';
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera API unavailable (needs https or localhost)');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
      if (gen !== this.generation) return stream.getTracks().forEach((t) => t.stop());
      this.stream = stream;
      const video = document.createElement('video');
      video.playsInline = true;
      video.muted = true;
      video.srcObject = stream;
      await video.play();
      this.video = video;

      const vision = await import('@mediapipe/tasks-vision');
      const fileset = await vision.FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`);
      const options = (delegate: 'GPU' | 'CPU') => ({
        baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}mediapipe/face_landmarker.task`, delegate },
        runningMode: 'VIDEO' as const,
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
        outputFaceBlendshapes: false,
      });
      let lm: Landmarker;
      try {
        lm = await vision.FaceLandmarker.createFromOptions(fileset, options('GPU'));
      } catch {
        lm = await vision.FaceLandmarker.createFromOptions(fileset, options('CPU'));
      }
      if (gen !== this.generation) return lm.close();
      this.landmarker = lm;
      this.recenter();
      this.status = 'no-face';
    } catch (e) {
      if (gen !== this.generation) return;
      this.stop();
      this.status = 'error';
      this.error = e instanceof Error ? e.message : String(e);
    }
  }

  stop(): void {
    this.generation++;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video = null;
    this.landmarker?.close();
    this.landmarker = null;
    this.status = 'off';
    Object.assign(this.pose, ZERO);
  }

  /** Make the current head pose the new neutral (key H). */
  recenter(): void {
    this.neutral = null;
    this.calib = [];
    this.filters.forEach((f) => f.reset());
  }

  /** Call every render frame; detection itself runs at ~30 Hz. */
  update(nowMs: number, dt: number): void {
    if (!this.landmarker || !this.video) return;
    if (nowMs - this.lastDetect >= DETECT_INTERVAL_MS && this.video.readyState >= 2 && this.video.currentTime !== this.lastVideoTime) {
      this.lastDetect = nowMs;
      this.lastVideoTime = this.video.currentTime;
      let raw: HeadPose | null = null;
      try {
        const res = this.landmarker.detectForVideo(this.video, nowMs);
        const mat = res.facialTransformationMatrixes?.[0];
        if (mat) raw = this.poseFromMatrix(mat.data);
      } catch (e) {
        this.status = 'error';
        this.error = e instanceof Error ? e.message : String(e);
        return;
      }
      if (raw) {
        this.status = 'tracking';
        this.applyRaw(raw, nowMs / 1000);
        return;
      }
      this.status = 'no-face';
    }
    if (this.status === 'no-face') {
      // Ease back to looking straight ahead while the face is lost
      const k = Math.min(1, dt * 3);
      for (const key of KEYS) this.pose[key] -= this.pose[key] * k;
    }
  }

  private applyRaw(raw: HeadPose, t: number): void {
    if (!this.neutral) {
      this.calib.push(raw);
      if (this.calib.length < CALIBRATION_FRAMES) return;
      const n = { ...ZERO };
      for (const c of this.calib) for (const key of KEYS) n[key] += c[key] / this.calib.length;
      this.neutral = n;
    }
    KEYS.forEach((key, i) => {
      let d = raw[key] - this.neutral![key];
      if (key === 'yaw' || key === 'roll') d = Math.atan2(Math.sin(d), Math.cos(d));
      this.pose[key] = this.filters[i].filter(d, t);
    });
  }

  /** Face transformation matrix (canonical face → camera space, cm) → raw head pose. */
  private poseFromMatrix(data: number[]): HeadPose {
    // MediaPipe's flattened matrix: detect column- vs row-major by where the (large, negative)
    // z translation lives.
    const columnMajor = Math.abs(data[14]) >= Math.abs(data[11]);
    if (columnMajor) this.m.fromArray(data);
    else this.m.fromArray(data).transpose();
    this.m.decompose(this.t, this.q, this.s);
    const f = this.v.set(0, 0, 1).applyQuaternion(this.q);
    const up = this.u.set(0, 1, 0).applyQuaternion(this.q);
    return {
      yaw: Math.atan2(f.x, f.z),
      pitch: Math.atan2(f.y, Math.hypot(f.x, f.z)),
      roll: Math.atan2(up.x, up.y),
      x: -this.t.x / 100,
      y: this.t.y / 100,
      z: -this.t.z / 100,
    };
  }
}
