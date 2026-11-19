'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createReplayCanvas, type ReplayHudSnapshot } from '@/lib/games/shared/replay-canvas';
import { addWebMDurationMetadata } from '@/lib/games/shared/replay-media';
import type { LocalReplayClip, ReplayStoreResult } from '@/lib/games/shared/replay-store';

export const REPLAY_CAPTURE_FPS = 24;
const MAX_CAPTURE_BYTES = 50_000_000;
const VIDEO_BITRATE = 1_200_000;

const MIME_TYPE_PREFERENCE = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp8',
  'video/webm;codecs=vp9',
  'video/webm',
];

export type ReplayDraft = {
  blob: Blob;
  score: number;
  durationSeconds: number;
};

type RecordingSession = {
  generation: number;
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  capturedBytes: number;
  startedAtMs: number;
  pausedAtMs: number | null;
  pausedTotalMs: number;
  finishDetails: Omit<ReplayDraft, 'blob'> | null;
  captureCanvas: ReturnType<typeof createReplayCanvas> | null;
  discarded: boolean;
  completed: boolean;
};

type UseCanvasReplayRecorderOptions<TClip extends LocalReplayClip> = {
  save: (draft: ReplayDraft) => Promise<ReplayStoreResult<TClip>>;
  onClipsSaved?: (clips: TClip[]) => void;
};

function canRecordCanvas(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof MediaRecorder !== 'undefined' &&
    typeof HTMLCanvasElement !== 'undefined' &&
    typeof HTMLCanvasElement.prototype.captureStream === 'function'
  );
}

function startRecorder(stream: MediaStream): MediaRecorder {
  const supportedTypes = MIME_TYPE_PREFERENCE.filter((mimeType) => {
    try {
      return typeof MediaRecorder.isTypeSupported !== 'function' ||
        MediaRecorder.isTypeSupported(mimeType);
    } catch {
      return false;
    }
  });

  for (const mimeType of supportedTypes) {
    try {
      const recorder = new MediaRecorder(stream, {
        mimeType,
        videoBitsPerSecond: VIDEO_BITRATE,
      });
      recorder.start(1000);
      return recorder;
    } catch {
      // Continue to the next browser-supported container or codec.
    }
  }

  const recorder = new MediaRecorder(stream, { videoBitsPerSecond: VIDEO_BITRATE });
  recorder.start(1000);
  return recorder;
}

function stopTracks(stream: MediaStream): void {
  for (const track of stream.getTracks()) {
    try {
      track.stop();
    } catch {
      // Track cleanup is best effort if the browser already ended it.
    }
  }
}

function removeAudioTracks(stream: MediaStream): boolean {
  for (const track of stream.getAudioTracks()) {
    try {
      stream.removeTrack(track);
      track.stop();
    } catch {
      // The recorder still receives only the remaining video tracks.
    }
  }
  return stream.getVideoTracks().length > 0;
}

function clearRecorderHandlers(recorder: MediaRecorder): void {
  recorder.ondataavailable = null;
  recorder.onstop = null;
  recorder.onerror = null;
}

/**
 * Shared canvas-only recording lifecycle used by every game, including Six Seven.
 * It never requests the camera or audio; callers pass an already-rendered canvas
 * and a save function for the game's own local replay namespace.
 */
export function useCanvasReplayRecorder<TClip extends LocalReplayClip>({
  save,
  onClipsSaved,
}: UseCanvasReplayRecorderOptions<TClip>) {
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState('Clip recording is off.');
  const [supported] = useState(canRecordCanvas);
  const sessionRef = useRef<RecordingSession | null>(null);
  const generationRef = useRef(0);
  const mountedRef = useRef(false);
  const callbacksRef = useRef({ save, onClipsSaved });

  useEffect(() => {
    callbacksRef.current = { save, onClipsSaved };
  }, [save, onClipsSaved]);

  const setStatusForGeneration = useCallback((generation: number, nextStatus: string) => {
    if (mountedRef.current && generation === generationRef.current) setStatus(nextStatus);
  }, []);

  const finishSession = useCallback((session: RecordingSession) => {
    if (session.completed) return;
    session.completed = true;
    session.captureCanvas?.setActive(false);
    clearRecorderHandlers(session.recorder);
    stopTracks(session.stream);
    if (sessionRef.current === session) sessionRef.current = null;
    if (mountedRef.current && session.generation === generationRef.current) {
      setRecording(false);
    }

    const details = session.finishDetails;
    if (session.discarded || !details) return;

    const type =
      session.recorder.mimeType ||
      session.chunks.find((chunk) => chunk.type)?.type ||
      'video/webm';
    const rawBlob = new Blob(session.chunks, { type });
    if (rawBlob.size === 0) {
      setStatusForGeneration(session.generation, 'No video data was captured.');
      return;
    }

    setStatusForGeneration(session.generation, 'Preparing clip…');
    void addWebMDurationMetadata(rawBlob, details.durationSeconds)
      .then((blob) => callbacksRef.current.save({ ...details, blob }))
      .then((result) => {
        if (!mountedRef.current) return;
        callbacksRef.current.onClipsSaved?.(result.clips);
        setStatusForGeneration(
          session.generation,
          result.persistent
            ? 'Clip saved on this device.'
            : 'Clip saved for this session; persistent storage is unavailable.',
        );
      })
      .catch(() => {
        setStatusForGeneration(session.generation, 'Could not save this clip.');
      });
  }, [setStatusForGeneration]);

  const abandonSession = useCallback((session: RecordingSession) => {
    session.discarded = true;
    session.finishDetails = null;
    session.captureCanvas?.setActive(false);
    clearRecorderHandlers(session.recorder);
    if (session.recorder.state !== 'inactive') {
      try {
        session.recorder.stop();
      } catch {
        // The recorder can become inactive between the state check and stop().
      }
    }
    stopTracks(session.stream);
    if (sessionRef.current === session) sessionRef.current = null;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      const session = sessionRef.current;
      if (session && !session.finishDetails) abandonSession(session);
    };
  }, [abandonSession]);

  const start = useCallback((canvas: HTMLCanvasElement, getHudSnapshot?: () => ReplayHudSnapshot) => {
    const generation = ++generationRef.current;
    const previous = sessionRef.current;
    if (previous?.finishDetails) {
      // A completed round can finish writing while its next round is recorded.
      sessionRef.current = null;
    } else if (previous) {
      abandonSession(previous);
    }

    if (!canRecordCanvas() || typeof canvas.captureStream !== 'function') {
      setRecording(false);
      setStatus('Video recording is not supported in this browser.');
      return false;
    }

    let stream: MediaStream | null = null;
    let captureCanvas: ReturnType<typeof createReplayCanvas> | null = null;
    try {
      const captureSource = getHudSnapshot
        ? (captureCanvas = createReplayCanvas(canvas, getHudSnapshot, REPLAY_CAPTURE_FPS)).canvas
        : canvas;
      if (typeof captureSource.captureStream !== 'function') {
        throw new Error('Canvas recording is unavailable.');
      }

      stream = captureSource.captureStream(REPLAY_CAPTURE_FPS);
      if (!removeAudioTracks(stream)) throw new Error('No video track was captured.');
      const recorder = startRecorder(stream);
      const session: RecordingSession = {
        generation,
        recorder,
        stream,
        chunks: [],
        capturedBytes: 0,
        startedAtMs: performance.now(),
        pausedAtMs: null,
        pausedTotalMs: 0,
        finishDetails: null,
        captureCanvas,
        discarded: false,
        completed: false,
      };
      sessionRef.current = session;
      recorder.ondataavailable = (event: BlobEvent) => {
        if (session.discarded || event.data.size === 0) return;
        session.capturedBytes += event.data.size;
        if (session.capturedBytes > MAX_CAPTURE_BYTES) {
          abandonSession(session);
          if (mountedRef.current && generation === generationRef.current) {
            setRecording(false);
            setStatus('The clip exceeded the local size limit and was discarded.');
          }
          return;
        }
        session.chunks.push(event.data);
      };
      recorder.onstop = () => finishSession(session);
      recorder.onerror = () => {
        if (session.completed) return;
        session.discarded = true;
        session.completed = true;
        session.captureCanvas?.setActive(false);
        clearRecorderHandlers(recorder);
        stopTracks(stream!);
        if (sessionRef.current === session) sessionRef.current = null;
        if (mountedRef.current && generation === generationRef.current) {
          setRecording(false);
          setStatus('Recording stopped because the browser reported an error.');
        }
      };
      captureCanvas?.setActive(true);
      setRecording(true);
      setStatus('Recording locally. Video only; no audio.');
      return true;
    } catch {
      captureCanvas?.setActive(false);
      if (stream) stopTracks(stream);
      sessionRef.current = null;
      setRecording(false);
      setStatus('Could not start video recording.');
      return false;
    }
  }, [abandonSession, finishSession]);

  const pause = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.recorder.state !== 'recording') return;
    try {
      session.recorder.pause();
      session.pausedAtMs = performance.now();
      session.captureCanvas?.setActive(false);
      setStatus('Recording paused.');
    } catch {
      setStatus('Could not pause recording.');
    }
  }, []);

  const resume = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.recorder.state !== 'paused') return;
    try {
      session.recorder.resume();
      if (session.pausedAtMs !== null) {
        session.pausedTotalMs += performance.now() - session.pausedAtMs;
        session.pausedAtMs = null;
      }
      session.captureCanvas?.setActive(true);
      setStatus('Recording locally. Video only; no audio.');
    } catch {
      setStatus('Could not resume recording.');
    }
  }, []);

  const finish = useCallback((score: number, durationSeconds: number) => {
    const session = sessionRef.current;
    if (!session || session.finishDetails) return;
    // MediaRecorder follows real elapsed time even when simulation frames slow down.
    const elapsed = ((session.pausedAtMs ?? performance.now()) - session.startedAtMs - session.pausedTotalMs) / 1000;
    session.finishDetails = {
      score: Number.isFinite(score) ? Math.max(0, Math.round(score)) : 0,
      durationSeconds: elapsed > 0 ? elapsed : Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0,
    };
    session.captureCanvas?.draw();
    session.captureCanvas?.setActive(false);
    setRecording(false);
    setStatus('Finishing clip…');
    try {
      if (session.recorder.state !== 'inactive') session.recorder.stop();
    } catch {
      session.finishDetails = null;
      abandonSession(session);
      setRecording(false);
      setStatus('Could not finish recording.');
    }
  }, [abandonSession]);

  const discard = useCallback(() => {
    const session = sessionRef.current;
    if (!session) return;
    if (session.finishDetails) {
      setRecording(false);
      setStatus('Finishing completed clip…');
      return;
    }
    abandonSession(session);
    setRecording(false);
    setStatus('Recording discarded.');
  }, [abandonSession]);

  return { recording, status, supported, start, pause, resume, finish, discard, setStatus };
}

export function createReplayClipId(prefix = 'replay'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}
