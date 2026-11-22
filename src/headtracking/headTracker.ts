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

type WorkerMsg = { type: 'ready' } | { type: 'error'; message: string } | { type: 'result'; data: number[] | null };

export class HeadTracker {
  status: TrackerStatus = 'off';
  error = '';
  /** Smoothed pose relative to neutral. Eases back to zero when the face is lost. */
  readonly pose: HeadPose = { ...ZERO };

  private video: HTMLVideoElement | null = null;
  private videoEl: HTMLVideoElement | null = null; // in the DOM while running
  private stream: MediaStream | null = null;
  private worker: Worker | null = null;
  private workerReady = false;
  private busy = false; // a frame is being processed in the worker
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
      this.video = await this.startVideo(stream, gen);
      if (gen !== this.generation) return;

      // Face detection runs in a worker so it never stalls rendering (SPEC §3.2.1)
      const worker = new Worker(new URL('./faceWorker.ts', import.meta.url), { type: 'module' });
      this.worker = worker;
      const base = new URL(import.meta.env.BASE_URL, location.href);
      await new Promise<void>((resolve, reject) => {
        worker.onmessage = (e: MessageEvent<WorkerMsg>) => {
          if (e.data.type === 'ready') resolve();
          else if (e.data.type === 'error') reject(new Error(e.data.message));
        };
        worker.onerror = (e) => reject(new Error(e.message || 'head-tracking worker failed to start'));
        worker.postMessage({
          type: 'init',
          wasmBase: new URL('mediapipe/wasm', base).href,
          modelUrl: new URL('mediapipe/face_landmarker.task', base).href,
        });
      });
      if (gen !== this.generation) return;
      worker.onmessage = (e: MessageEvent<WorkerMsg>) => this.onWorker(e.data, gen);
      this.workerReady = true;
      this.recenter();
      this.status = 'no-face';
    } catch (e) {
      if (gen !== this.generation) return;
      this.stop();
      this.status = 'error';
      this.error = describeError(e);
    }
  }

  /**
   * Play the webcam stream in a tiny invisible <video> that lives in the page. Firefox aborts
   * playback of detached video elements ("The fetching process for the media resource was
   * aborted…"), and play() can be interrupted, so we don't trust play(): we wait until frames
   * actually arrive, and retry play() if they don't.
   */
  private async startVideo(stream: MediaStream, gen: number): Promise<HTMLVideoElement> {
    const video = document.createElement('video');
    video.playsInline = true;
    video.muted = true;
    video.autoplay = true;
    video.setAttribute('aria-hidden', 'true');
    Object.assign(video.style, {
      position: 'fixed', left: '0', bottom: '0', width: '2px', height: '2px',
      opacity: '0.01', pointerEvents: 'none', zIndex: '-1',
    });
    document.body.appendChild(video);
    this.videoEl = video;
    video.srcObject = stream;
    for (let attempt = 0; attempt < 5; attempt++) {
      video.play().catch(() => { /* aborted/interrupted: we check for frames below and retry */ });
      const ready = await new Promise<boolean>((resolve) => {
        if (video.readyState >= 2) return resolve(true);
        const done = (ok: boolean): void => {
          video.removeEventListener('loadeddata', onData);
          clearTimeout(timer);
          resolve(ok);
        };
        const onData = (): void => done(true);
        const timer = setTimeout(() => done(video.readyState >= 2), 2500);
        video.addEventListener('loadeddata', onData);
      });
      if (gen !== this.generation) return video;
      if (ready) return video;
    }
    throw new Error('The camera started but sent no video. Close other apps using the camera and try again.');
  }

  stop(): void {
    this.generation++;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video = null;
    if (this.videoEl) {
      this.videoEl.srcObject = null;
      this.videoEl.remove();
      this.videoEl = null;
    }
    this.worker?.postMessage({ type: 'close' });
    this.worker = null;
    this.workerReady = false;
    this.busy = false;
    this.status = 'off';
    Object.assign(this.pose, ZERO);
  }

  /** Make the current head pose the new neutral (key H). */
  recenter(): void {
    this.neutral = null;
    this.calib = [];
    this.filters.forEach((f) => f.reset());
  }

  /** Call every render frame: hands a new webcam frame to the worker (~30 Hz) when it's free. */
  update(nowMs: number, dt: number): void {
    const video = this.video, worker = this.worker;
    if (!this.workerReady || !video || !worker) return;
    if (!this.busy && nowMs - this.lastDetect >= DETECT_INTERVAL_MS && video.readyState >= 2 && video.currentTime !== this.lastVideoTime) {
      this.lastDetect = nowMs;
      this.lastVideoTime = video.currentTime;
      this.busy = true;
      const gen = this.generation;
      createImageBitmap(video).then((bitmap) => {
        if (gen !== this.generation || !this.worker) {
          bitmap.close();
          return;
        }
        this.worker.postMessage({ type: 'frame', bitmap, ts: nowMs }, [bitmap]);
      }).catch(() => {
        this.busy = false;
      });
    }
    if (this.status === 'no-face') {
      // Ease back to looking straight ahead while the face is lost
      const k = Math.min(1, dt * 3);
      for (const key of KEYS) this.pose[key] -= this.pose[key] * k;
    }
  }

  private onWorker(msg: WorkerMsg, gen: number): void {
    if (gen !== this.generation) return;
    if (msg.type === 'error') {
      this.status = 'error';
      this.error = msg.message;
      return;
    }
    if (msg.type !== 'result') return;
    this.busy = false;
    if (msg.data) {
      this.status = 'tracking';
      this.applyRaw(this.poseFromMatrix(msg.data), performance.now() / 1000);
    } else {
      this.status = 'no-face';
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

/** Friendly messages for the common camera failures. */
function describeError(e: unknown): string {
  const name = e instanceof DOMException || e instanceof Error ? e.name : '';
  const msg = e instanceof Error ? e.message : String(e);
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'camera permission was denied. Allow the camera for this site (icon in the address bar) and toggle head-tracking again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'no camera found.';
    case 'NotReadableError':
    case 'AbortError':
      return 'the camera is busy or was stopped. Close other apps/tabs using the camera, then toggle head-tracking again.';
    default:
      return msg;
  }
}
