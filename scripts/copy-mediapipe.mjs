// Copies MediaPipe's WASM runtime into public/ so the game serves it itself (works offline, SPEC §1).
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const dst = join(root, 'public/mediapipe/wasm');
mkdirSync(dst, { recursive: true });
for (const f of ['vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm']) copyFileSync(join(src, f), join(dst, f));
console.log('mediapipe wasm copied to public/mediapipe/wasm');
