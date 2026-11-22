// Face landmarker in a Web Worker (SPEC §3.2.1): detection takes ~5–15 ms per frame and would
// otherwise stall the main thread (measured: 3.5 ms/frame average, 50 ms worst-case hitches).
// The main thread transfers webcam frames as ImageBitmaps; we reply with the face transform.

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

type InMsg =
  | { type: 'init'; wasmBase: string; modelUrl: string }
  | { type: 'frame'; bitmap: ImageBitmap; ts: number }
  | { type: 'close' };

let landmarker: FaceLandmarker | null = null;
const post = (msg: unknown): void => (self as unknown as Worker).postMessage(msg);

self.onmessage = async (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === 'init') {
    try {
      // Module build of the WASM runtime: it can be dynamic-imported inside a module worker
      const fileset = await FilesetResolver.forVisionTasks(msg.wasmBase, true);
      const options = (delegate: 'GPU' | 'CPU') => ({
        baseOptions: { modelAssetPath: msg.modelUrl, delegate },
        runningMode: 'VIDEO' as const,
        numFaces: 1,
        outputFacialTransformationMatrixes: true,
        outputFaceBlendshapes: false,
      });
      try {
        landmarker = await FaceLandmarker.createFromOptions(fileset, options('GPU'));
      } catch {
        landmarker = await FaceLandmarker.createFromOptions(fileset, options('CPU'));
      }
      post({ type: 'ready' });
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  } else if (msg.type === 'frame') {
    let data: number[] | null = null;
    try {
      if (landmarker) data = landmarker.detectForVideo(msg.bitmap, msg.ts).facialTransformationMatrixes?.[0]?.data ?? null;
    } catch (err) {
      post({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      msg.bitmap.close();
    }
    post({ type: 'result', data });
  } else if (msg.type === 'close') {
    landmarker?.close();
    landmarker = null;
    self.close();
  }
};
