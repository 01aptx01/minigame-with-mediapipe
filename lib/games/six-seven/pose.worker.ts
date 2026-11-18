import type { PoseLandmarker } from '@mediapipe/tasks-vision';
import {
  createSoloPoseModel,
  readSixSevenPose,
  type PoseWorkerRequest,
  type PoseWorkerResponse,
} from './pose-model';

const worker = self as unknown as {
  onmessage: ((event: MessageEvent<PoseWorkerRequest>) => void) | null;
  postMessage: (message: PoseWorkerResponse) => void;
};
let model: PoseLandmarker | undefined;

function reportFailure(error: unknown) {
  worker.postMessage({
    type: 'failed',
    message: error instanceof Error ? error.message : String(error),
  });
}

worker.onmessage = async ({ data }) => {
  if (data.type === 'initialize') {
    try {
      model = await createSoloPoseModel(data.origin);
      worker.postMessage({ type: 'ready' });
    } catch (error) {
      reportFailure(error);
    }
    return;
  }

  try {
    if (!model) throw new Error('Pose model is unavailable.');
    worker.postMessage({ type: 'pose', pose: readSixSevenPose(model, data.frame, data.atMs) });
  } catch (error) {
    reportFailure(error);
  } finally {
    data.frame.close();
  }
};
