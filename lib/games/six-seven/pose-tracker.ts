import type { SixSevenLandmark } from './engine';
import type { PoseWorkerRequest, PoseWorkerResponse } from './pose-model';

export interface SixSevenPoseTracker {
  background: boolean;
  sample: (video: HTMLVideoElement, atMs: number) => Promise<SixSevenLandmark[] | null>;
  close: () => void;
}

function createWorkerTracker(signal: AbortSignal): Promise<SixSevenPoseTracker> {
  return new Promise((resolve, reject) => {
    // MediaPipe loads its WASM runtime with importScripts inside this classic worker.
    const worker = new Worker(new URL('./pose.worker.ts', import.meta.url));
    let isClosed = false;
    let isWarmedUp = false;
    let pendingFrame: {
      resolve: (pose: SixSevenLandmark[] | null) => void;
      reject: (error: Error) => void;
      timeout: number;
    } | null = null;
    const failure = new Error('The pose worker stopped responding.');
    const readyTimeout = window.setTimeout(() => fail(), 12_000);

    function close() {
      if (isClosed) return;
      isClosed = true;
      window.clearTimeout(readyTimeout);
      signal.removeEventListener('abort', fail);
      worker.terminate();
      if (pendingFrame) {
        window.clearTimeout(pendingFrame.timeout);
        pendingFrame.reject(failure);
        pendingFrame = null;
      }
    }

    function fail() {
      close();
      reject(failure);
    }

    async function sample(video: HTMLVideoElement, atMs: number) {
      if (isClosed || pendingFrame) return null;
      const scale = Math.min(1, 640 / Math.max(video.videoWidth, video.videoHeight));
      const frame = await createImageBitmap(video, {
        resizeWidth: Math.max(1, Math.round(video.videoWidth * scale)),
        resizeHeight: Math.max(1, Math.round(video.videoHeight * scale)),
        resizeQuality: 'low',
      });
      if (isClosed) {
        frame.close();
        return null;
      }

      return new Promise<SixSevenLandmark[] | null>((resolveFrame, rejectFrame) => {
        pendingFrame = { resolve: resolveFrame, reject: rejectFrame, timeout: window.setTimeout(fail, isWarmedUp ? 4_000 : 8_000) };
        try {
          worker.postMessage({ type: 'frame', frame, atMs } satisfies PoseWorkerRequest, [frame]);
        } catch {
          frame.close();
          fail();
        }
      });
    }

    worker.onmessage = ({ data }: MessageEvent<PoseWorkerResponse>) => {
      if (data.type === 'ready') {
        window.clearTimeout(readyTimeout);
        resolve({ background: true, sample, close });
      } else if (data.type === 'pose' && pendingFrame) {
        window.clearTimeout(pendingFrame.timeout);
        isWarmedUp = true;
        pendingFrame.resolve(data.pose);
        pendingFrame = null;
      } else if (data.type === 'failed') {
        console.warn('Six Seven camera worker:', data.message);
        fail();
      }
    };
    worker.onerror = (event) => {
      event.preventDefault();
      fail();
    };
    worker.onmessageerror = fail;
    signal.addEventListener('abort', fail, { once: true });
    try {
      worker.postMessage({ type: 'initialize', origin: window.location.origin } satisfies PoseWorkerRequest);
    } catch {
      fail();
    }
  });
}

export async function createSixSevenPoseTracker(signal: AbortSignal, preferWorker = true): Promise<SixSevenPoseTracker> {
  signal.throwIfAborted();
  if (preferWorker && typeof Worker !== 'undefined' && typeof createImageBitmap === 'function') {
    try {
      return await createWorkerTracker(signal);
    } catch {
      signal.throwIfAborted();
    }
  }

  const { createSoloPoseModel, readSixSevenPose } = await import('./pose-model');
  signal.throwIfAborted();
  const model = await createSoloPoseModel(window.location.origin);
  if (signal.aborted) {
    model.close();
    signal.throwIfAborted();
  }
  return {
    background: false,
    sample: async (video, atMs) => readSixSevenPose(model, video, atMs),
    close: () => model.close(),
  };
}
