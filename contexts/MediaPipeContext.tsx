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
import type { HandLandmarker, HandLandmarkerResult } from '@mediapipe/tasks-vision';

export type CameraStatus = 'idle' | 'requesting' | 'active' | 'denied' | 'unavailable';
export type ModelStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface MediaPipeContextValue {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  cameraStatus: CameraStatus;
  modelStatus: ModelStatus;
  errorMessage: string | null;
  hasStream: boolean;
  requestCamera: () => Promise<boolean>;
  stopCamera: () => void;
  initializeModel: () => Promise<void>;
  predict: (timestampMs?: number) => HandLandmarkerResult | null;
}

const MediaPipeContext = createContext<MediaPipeContextValue | null>(null);

const HAND_LANDMARKER_MODEL_URL =
  'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export function MediaPipeProvider({ children }: { children: React.ReactNode }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const handLandmarkerRef = useRef<HandLandmarker | null>(null);
  const modelInitPromiseRef = useRef<Promise<void> | null>(null);
  const cameraInitPromiseRef = useRef<Promise<boolean> | null>(null);
  const lastVideoTimeRef = useRef<number>(-1);
  const lastDetectTimestampRef = useRef<number>(0);
  const hasAutoInitializedRef = useRef<boolean>(false);

  const [cameraStatus, setCameraStatus] = useState<CameraStatus>('idle');
  const [modelStatus, setModelStatus] = useState<ModelStatus>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [hasStream, setHasStream] = useState<boolean>(false);

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
        const visionModule = await import('@mediapipe/tasks-vision');
        const { FilesetResolver, HandLandmarker: HandLandmarkerClass } = visionModule;

        const vision = await FilesetResolver.forVisionTasks('/mediapipe/wasm');

        let landmarker: HandLandmarker;
        try {
          landmarker = await HandLandmarkerClass.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: HAND_LANDMARKER_MODEL_URL,
              delegate: 'GPU',
            },
            runningMode: 'VIDEO',
            numHands: 4,
            minHandDetectionConfidence: 0.45,
            minHandPresenceConfidence: 0.45,
            minTrackingConfidence: 0.45,
          });
        } catch {
          landmarker = await HandLandmarkerClass.createFromOptions(vision, {
            baseOptions: {
              modelAssetPath: HAND_LANDMARKER_MODEL_URL,
              delegate: 'CPU',
            },
            runningMode: 'VIDEO',
            numHands: 4,
            minHandDetectionConfidence: 0.45,
            minHandPresenceConfidence: 0.45,
            minTrackingConfidence: 0.45,
          });
        }

        handLandmarkerRef.current = landmarker;
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
  }, []);

  const requestCamera = useCallback(async (): Promise<boolean> => {
    if (streamRef.current && streamRef.current.active) {
      setCameraStatus('active');
      setHasStream(true);
      return true;
    }
    if (cameraInitPromiseRef.current) {
      return cameraInitPromiseRef.current;
    }

    const promise = (async () => {
      if (
        typeof navigator === 'undefined' ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== 'function'
      ) {
        setCameraStatus('unavailable');
        setErrorMessage('Camera API unavailable in this browser. Mouse/touch blade mode is active.');
        setHasStream(false);
        return false;
      }

      setCameraStatus('requesting');
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            width: { ideal: 1280 },
            height: { ideal: 720 },
            facingMode: 'user',
          },
          audio: false,
        });

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setCameraStatus('active');
        setErrorMessage(null);
        setHasStream(true);

        // Kick off model load in parallel once camera succeeds
        void initializeModel();
        return true;
      } catch (err) {
        const name = err instanceof DOMException ? err.name : '';
        if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
          setCameraStatus('denied');
          setErrorMessage('Camera permission was denied. Enable camera access or play with Mouse/Touch blades.');
        } else {
          setCameraStatus('unavailable');
          setErrorMessage('No webcam detected. Mouse/Touch laser blade mode is ready.');
        }
        setHasStream(false);
        return false;
      } finally {
        cameraInitPromiseRef.current = null;
      }
    })();

    cameraInitPromiseRef.current = promise;
    return promise;
  }, [initializeModel]);

  const stopCamera = useCallback(() => {
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
    const landmarker = handLandmarkerRef.current;
    const video = videoRef.current;
    if (!landmarker || !video || !streamRef.current) return null;
    if (video.readyState < 2 || video.videoWidth === 0 || video.videoHeight === 0) {
      return null;
    }

    // MediaPipe requires strictly increasing timestamps and a fresh video frame
    if (video.currentTime === lastVideoTimeRef.current) {
      return null;
    }
    lastVideoTimeRef.current = video.currentTime;

    const now = timestampMs ?? performance.now();
    const safeTimestamp =
      now > lastDetectTimestampRef.current ? now : lastDetectTimestampRef.current + 1;
    lastDetectTimestampRef.current = safeTimestamp;

    try {
      return landmarker.detectForVideo(video, safeTimestamp);
    } catch {
      return null;
    }
  }, []);

  // Initialize shared camera + MediaPipe HandLandmarker once at layout mount
  useEffect(() => {
    if (hasAutoInitializedRef.current) return;
    hasAutoInitializedRef.current = true;
    void requestCamera();
    void initializeModel();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      if (handLandmarkerRef.current) {
        handLandmarkerRef.current.close();
        handLandmarkerRef.current = null;
      }
    };
  }, [initializeModel, requestCamera]);

  const value = useMemo<MediaPipeContextValue>(
    () => ({
      videoRef,
      cameraStatus,
      modelStatus,
      errorMessage,
      hasStream,
      requestCamera,
      stopCamera,
      initializeModel,
      predict,
    }),
    [
      cameraStatus,
      errorMessage,
      hasStream,
      initializeModel,
      modelStatus,
      predict,
      requestCamera,
      stopCamera,
    ]
  );

  return (
    <MediaPipeContext.Provider value={value}>
      {/* Single shared hidden video element kept alive across route transitions */}
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
