import { cpSync, mkdirSync } from 'node:fs';
// Keep the browser runtime and WASM files on the same installed version.
mkdirSync('public/mediapipe/wasm', { recursive: true });
cpSync('node_modules/@mediapipe/tasks-vision/wasm', 'public/mediapipe/wasm', { recursive: true });
