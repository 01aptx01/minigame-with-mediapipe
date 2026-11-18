import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';
import type { SixSevenLandmark } from './engine';

export type PoseWorkerRequest =
  | { type: 'initialize'; origin: string }
  | { type: 'frame'; frame: ImageBitmap | VideoFrame; atMs: number };

export type PoseWorkerResponse =
  | { type: 'ready' }
  | { type: 'pose'; pose: SixSevenLandmark[] | null }
  | { type: 'retry-bitmap' }
  | { type: 'failed'; message: string };

export async function createSoloPoseModel(origin: string): Promise<PoseLandmarker> {
  const files = await FilesetResolver.forVisionTasks(new URL('/mediapipe/wasm', origin).href);
  const create = (delegate: 'GPU' | 'CPU') => PoseLandmarker.createFromOptions(files, {
    baseOptions: {
      modelAssetPath: new URL('/mediapipe/models/pose_landmarker_lite.task', origin).href,
      delegate,
    },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  try {
    // The Lite model can use CPU inference off the UI thread without waiting for GPU shader setup.
    return await create('CPU');
  } catch {
    return create('GPU');
  }
}

export function readSixSevenPose(
  model: PoseLandmarker,
  source: HTMLVideoElement | ImageBitmap | VideoFrame,
  atMs: number
): SixSevenLandmark[] | null {
  const pose = model.detectForVideo(source, atMs).landmarks[0];
  // Only four landmarks cross the worker boundary. Keep their MediaPipe indices.
  if (!pose) return null;
  const wristsAndShoulders: SixSevenLandmark[] = [];
  for (const index of [11, 12, 15, 16]) {
    const { x, y, visibility } = pose[index];
    wristsAndShoulders[index] = { x, y, visibility };
  }
  return wristsAndShoulders;
}
