'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  FaceLandmarker,
  FaceLandmarkerResult,
  HandLandmarker,
  HandLandmarkerResult,
  PoseLandmarker,
  PoseLandmarkerResult,
} from '@mediapipe/tasks-vision';

import { cameraErrorMessage, createCameraRequestGate, requestWebcam } from '@/lib/camera/access';

export type CameraStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'unavailable';
export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface MediaPipeContextValue {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  cameraStatus: CameraStatus;
  modelStatus: ModelStatus;
  poseModelStatus: ModelStatus;
  faceModelStatus: ModelStatus;
  errorMessage: string | null;
  cameraError: string | null;
  hasStream: boolean;
  requestCamera: () => Promise<boolean>;
  stopCamera: () => void;
  initializeModel: () => Promise<void>;
  initializePoseModel: () => Promise<void>;
  initializeFaceModel: () => Promise<void>;
  predict: (timestampMs?: number) => HandLandmarkerResult | null;
  predictPose: (timestampMs?: number) => PoseLandmarkerResult | null;
  predictFace: (timestampMs?: number) => FaceLandmarkerResult | null;
}

const MediaPipeContext = createContext<MediaPipeContextValue | null>(null);

const HAND_LANDMARKER_MODEL_URL =
  '/mediapipe/models/hand_landmarker.task';

const POSE_LANDMARKER_FULL_MODEL_URL =
  '/mediapipe/models/pose_landmarker_full.task';

const POSE_LANDMARKER_LITE_MODEL_URL =
  '/mediapipe/models/pose_landmarker_lite.task';

const FACE_LANDMARKER_MODEL_URL =
  '/mediapipe/models/face_landmarker.task';

type VisionFileset = Awaited<
  ReturnType<(typeof import('@mediapipe/tasks-vision'))['FilesetResolver']['forVisionTasks']>
>;

interface VideoTrackCursor {
  lastVideoTime: number;
  lastTimestamp: number;
}

async function createWithDelegateFallback<T>(
  createFn: (delegate: 'GPU' | 'CPU') => Promise<T>
): Promise<T> {
  try {
    return await createFn('GPU');
  } catch {
    return await createFn('CPU');
  }
}

function detectVideoFrame<T>(
  landmarker: { detectForVideo: (video: HTMLVideoElement, timestampMs: number) => T } | null,
  video: HTMLVideoElement | null,
  stream: MediaStream | null,
  cursor: VideoTrackCursor,
  timestampMs?: number
): T | null {
  if (!landmarker || !video || !stream) return null;
  if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
    return null;
  }

  if (video.currentTime === cursor.lastVideoTime) {
    return null;
  }
  cursor.lastVideoTime = video.currentTime;

  const now = timestampMs ?? performance.now();
  const safeTimestamp = now > cursor.lastTimestamp ? now : cursor.lastTimestamp + 1;
  cursor.lastTimestamp = safeTimestamp;

  try {
    return landmarker.detectForVideo(video, safeTimestamp);
  } catch {
    return null;
  }
}

export function MediaPipeProvider({ children }: { children: React.ReactNode }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const poseLandmarkerRef = useRef<PoseLandmarker | null>(null);
  const faceLandmarkerRef = useRef<FaceLandmarker | null>(null);

  const visionFilesetPromiseRef = useRef<Promise<VisionFileset> | null>(null);
  const modelInitPromiseRef = useRef<Promise<void> | null>(null);
  const poseInitPromiseRef = useRef<Promise<void> | null>(null);
  const faceInitPromiseRef = useRef<Promise<void> | null>(null);
  const cameraRequestGate = useRef(createCameraRequestGate());
  const cameraGenerationRef = useRef(0);

  const handCursorRef = useRef<VideoTrackCursor>({ lastVideoTime: -1, lastTimestamp: 0 });
  const poseCursorRef = useRef<VideoTrackCursor>({ lastVideoTime: -1, lastTimestamp: 0 });
  const faceCursorRef = useRef<VideoTrackCursor>({ lastVideoTime: -1, lastTimestamp: 0 });


  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const [modelStatus, setModelStatus] = useState<ModelStatus>('idle');
  const [poseModelStatus, setPoseModelStatus] = useState<ModelStatus>('idle');
  const [faceModelStatus, setFaceModelStatus] = useState<ModelStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [hasStream, setHasStream] = useState<boolean>(false);

  const getVisionModuleAndFileset = useCallback(async () => {
    const visionModule = await import('@mediapipe/tasks-vision');
    if (!visionFilesetPromiseRef.current) {
      visionFilesetPromiseRef.current =
        visionModule.FilesetResolver.forVisionTasks('/mediapipe/wasm').catch((error) => {
          visionFilesetPromiseRef.current = null;
          throw error;
        });
    }
    const vision = await visionFilesetPromiseRef.current;
    return { visionModule, vision };
  }, []);

  const initializeModel = useCallback(async () => {
    if (handLandmarkerRef.current) {
      setModelStatus('ready');
      return;
    }
    if (modelInitPromiseRef.current) {
      return modelInitPromiseRef.current;
    }

    const promise = (async () => {
      try {
        setModelStatus('loading');
        const { visionModule, vision } = await getVisionModuleAndFileset();
        const { HandLandmarker: HandLandmarkerClass } = visionModule;

        handLandmarkerRef.current = await createWithDelegateFallback((delegate) =>
          HandLandmarkerClass.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: HAND_LANDMARKER_MODEL_URL,
              delegate,
            },
            runningMode: 'VIDEO',
            numHands: 4,
            minHandDetectionConfidence: 0.45,
            minHandPresenceConfidence: 0.45,
            minTrackingConfidence: 0.45,
          })
        );
        setModelStatus('ready');
      } catch (err) {
        setModelStatus('error');
        const msg =
          err instanceof Error
            ? err.message
            : 'Unable to load MediaPipe HandLandmarker model.';
        setErrorMessage((prev) => prev ?? msg);
      } finally {
        modelInitPromiseRef.current = null;
      }
    })();

    modelInitPromiseRef.current = promise;
    return promise;
  }, [getVisionModuleAndFileset]);

  const initializePoseModel = useCallback(async () => {
    if (poseLandmarkerRef.current) {
      setPoseModelStatus('ready');
      return;
    }
    if (poseInitPromiseRef.current) {
      return poseInitPromiseRef.current;
    }

    const promise = (async () => {
      try {
        setPoseModelStatus('loading');
        const { visionModule, vision } = await getVisionModuleAndFileset();
        const { PoseLandmarker: PoseLandmarkerClass } = visionModule;

        const createPose = (modelUrl: string) =>
          createWithDelegateFallback((delegate) =>
            PoseLandmarkerClass.createFromOptions(vision, {
              baseOptions: {
                modelAssetPath: modelUrl,
                delegate,
              },
              runningMode: 'VIDEO',
              numPoses: 2,
              minPoseDetectionConfidence: 0.5,
              minPosePresenceConfidence: 0.5,
              minTrackingConfidence: 0.5,
            })
          );

        try {
          poseLandmarkerRef.current = await createPose(POSE_LANDMARKER_FULL_MODEL_URL);
        } catch {
          poseLandmarkerRef.current = await createPose(POSE_LANDMARKER_LITE_MODEL_URL);
        }
        setPoseModelStatus('ready');
      } catch (err) {
        setPoseModelStatus('error');
        const msg =
          err instanceof Error
            ? err.message
            : 'Unable to load MediaPipe PoseLandmarker model.';
        setErrorMessage((prev) => prev ?? msg);
      } finally {
        poseInitPromiseRef.current = null;
      }
    })();

    poseInitPromiseRef.current = promise;
    return promise;
  }, [getVisionModuleAndFileset]);

  const initializeFaceModel = useCallback(async () => {
    if (faceLandmarkerRef.current) {
      setFaceModelStatus('ready');
      return;
    }
    if (faceInitPromiseRef.current) {
      return faceInitPromiseRef.current;
    }

    const promise = (async () => {
      try {
        setFaceModelStatus('loading');
        const { visionModule, vision } = await getVisionModuleAndFileset();
        const { FaceLandmarker: FaceLandmarkerClass } = visionModule;

        faceLandmarkerRef.current = await createWithDelegateFallback((delegate) =>
          FaceLandmarkerClass.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: FACE_LANDMARKER_MODEL_URL,
              delegate,
            },
            runningMode: 'VIDEO',
            numFaces: 2,
            minFaceDetectionConfidence: 0.45,
            minFacePresenceConfidence: 0.45,
            minTrackingConfidence: 0.45,
          })
        );
        setFaceModelStatus('ready');
      } catch (err) {
        setFaceModelStatus('error');
        const msg =
          err instanceof Error
            ? err.message
            : 'Unable to load MediaPipe FaceLandmarker model.';
        setErrorMessage((prev) => prev ?? msg);
      } finally {
        faceInitPromiseRef.current = null;
      }
    })();

    faceInitPromiseRef.current = promise;
    return promise;
  }, [getVisionModuleAndFileset]);

  const requestCamera = useCallback((): Promise<boolean> => cameraRequestGate.current(async () => {
    if (streamRef.current?.active) {
      setCameraStatus('active');
      setHasStream(true);
      return true;
    }

    const generation = ++cameraGenerationRef.current;
    const embedded = window.self !== window.top;
    const policy = (document as Document & {
      permissionsPolicy?: { allowsFeature: (name: string) => boolean };
      featurePolicy?: { allowsFeature: (name: string) => boolean };
    }).permissionsPolicy ?? (document as Document & {
      featurePolicy?: { allowsFeature: (name: string) => boolean };
    }).featurePolicy;

    const fail = (status: CameraStatus, message: string) => {
      setCameraStatus(status);
      setCameraError(message);
      setHasStream(false);
      return false;
    };
    if (!window.isSecureContext) {
      return fail('unavailable', 'Camera access needs HTTPS. Open the secure full-page site.');
    }
    if (policy && !policy.allowsFeature('camera')) {
      return fail('denied', embedded
        ? 'Camera access is blocked inside this preview. Open the full page to enable your webcam.'
        : 'This page’s security policy blocks the camera. Camera access cannot be enabled here.');
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      return fail('unavailable', 'Camera access is unavailable here. Open the full page in Chrome or Safari.');
    }

    setCameraStatus('requesting');
    setCameraError(null);
    let acquiredStream: MediaStream | null = null;
    try {
      const stream = await requestWebcam(navigator.mediaDevices);
      acquiredStream = stream;
      if (generation !== cameraGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      streamRef.current = stream;
      if (!videoRef.current) throw new Error('Camera preview is unavailable.');
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      if (generation !== cameraGenerationRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return false;
      }
      for (const cursor of [handCursorRef, poseCursorRef, faceCursorRef]) {
        cursor.current.lastVideoTime = -1;
      }
      for (const track of stream.getVideoTracks()) {
        track.addEventListener('ended', () => {
          if (streamRef.current !== stream) return;
          streamRef.current = null;
          fail('unavailable', 'The camera disconnected. Reconnect it and enable the webcam again.');
        }, { once: true });
      }
      setCameraStatus('active');
      setCameraError(null);
      setHasStream(true);
      return true;
    } catch (error) {
      acquiredStream?.getTracks().forEach((track) => track.stop());
      if (generation !== cameraGenerationRef.current) return false;
      streamRef.current = null;
      if (videoRef.current) videoRef.current.srcObject = null;
      const denied = error instanceof Error && ['NotAllowedError', 'PermissionDeniedError', 'SecurityError'].includes(error.name);
      return fail(denied ? 'denied' : 'unavailable', cameraErrorMessage(error, embedded));
    }
  }), []);

  const stopCamera = useCallback(() => {
    cameraGenerationRef.current++;
    setCameraError(null);
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setHasStream(false);
    setCameraStatus('idle');
  }, []);

  const predict = useCallback((timestampMs?: number): HandLandmarkerResult | null => {
    return detectVideoFrame(
      handLandmarkerRef.current,
      videoRef.current,
      streamRef.current,
      handCursorRef.current,
      timestampMs
    );
  }, []);

  const predictPose = useCallback((timestampMs?: number): PoseLandmarkerResult | null => {
    return detectVideoFrame(
      poseLandmarkerRef.current,
      videoRef.current,
      streamRef.current,
      poseCursorRef.current,
      timestampMs
    );
  }, []);

  const predictFace = useCallback((timestampMs?: number): FaceLandmarkerResult | null => {
    return detectVideoFrame(
      faceLandmarkerRef.current,
      videoRef.current,
      streamRef.current,
      faceCursorRef.current,
      timestampMs
    );
  }, []);

  useEffect(() => {
    // Request permission only from an explicit Enable Webcam click.
    return () => {
      cameraGenerationRef.current++;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (handLandmarkerRef.current) {
        handLandmarkerRef.current.close();
        handLandmarkerRef.current = null;
      }
      if (poseLandmarkerRef.current) {
        poseLandmarkerRef.current.close();
        poseLandmarkerRef.current = null;
      }
      if (faceLandmarkerRef.current) {
        faceLandmarkerRef.current.close();
        faceLandmarkerRef.current = null;
      }
    };
  }, []);

  const value = useMemo<MediaPipeContextValue>(
    () => ({
      videoRef,
      cameraStatus,
      modelStatus,
      poseModelStatus,
      faceModelStatus,
      errorMessage: cameraError ?? errorMessage,
      cameraError,
      hasStream,
      requestCamera,
      stopCamera,
      initializeModel,
      initializePoseModel,
      initializeFaceModel,
      predict,
      predictPose,
      predictFace,
    }),
    [
      cameraStatus,
      cameraError,
      errorMessage,
      faceModelStatus,
      hasStream,
      initializeFaceModel,
      initializeModel,
      initializePoseModel,
      modelStatus,
      poseModelStatus,
      predict,
      predictFace,
      predictPose,
      requestCamera,
      stopCamera,
    ]
  );

  return (
    <MediaPipeContext.Provider value={value}>
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        aria-hidden="true"
        className="sr-only pointer-events-none fixed -left-[9999px] top-0 h-px w-px opacity-0"
      />
      {children}
    </MediaPipeContext.Provider>
  );
}

export function useMediaPipe(): MediaPipeContextValue {
  const ctx = useContext(MediaPipeContext);
  if (!ctx) {
    throw new Error('useMediaPipe must be used inside a <MediaPipeProvider>');
  }
  return ctx;
}
