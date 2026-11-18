'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  addWebMDurationMetadata,
  loadSixSevenClips,
  removeSixSevenClip,
  saveSixSevenClip,
  SIX_SEVEN_CAPTURE_FPS,
  type SixSevenClip,
} from '@/lib/games/six-seven/replay';

type FinishDetails = {
  score: number;
  durationSeconds: number;
};

type RecordingSession = {
  generation: number;
  recorder: MediaRecorder;
  stream: MediaStream;
  chunks: Blob[];
  finishDetails: FinishDetails | null;
  discarded: boolean;
  completed: boolean;
};

const MIME_TYPE_PREFERENCE = [
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
  'video/webm;codecs=vp8',
  'video/webm;codecs=vp9',
  'video/webm',
];

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
      const recorder = new MediaRecorder(stream, { mimeType });
      recorder.start(1000);
      return recorder;
    } catch {
      // Continue to the next browser-supported container or codec.
    }
  }

  const recorder = new MediaRecorder(stream);
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

function clearRecorderHandlers(recorder: MediaRecorder): void {
  recorder.ondataavailable = null;
  recorder.onstop = null;
  recorder.onerror = null;
}

function makeClipId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `six-seven-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function useSixSevenReplay() {
  const [clips, setClips] = useState<SixSevenClip[]>([]);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState('Clip recording is off.');
  const [supported] = useState(canRecordCanvas);
  const sessionRef = useRef<RecordingSession | null>(null);
  const generationRef = useRef(0);
  const loadGenerationRef = useRef(0);
  const mountedRef = useRef(false);

  const setStatusForGeneration = useCallback((generation: number, nextStatus: string) => {
    if (mountedRef.current && generation === generationRef.current) setStatus(nextStatus);
  }, []);

  const finishSession = useCallback((session: RecordingSession) => {
    if (session.completed) return;
    session.completed = true;
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
      if (mountedRef.current && session.generation === generationRef.current) {
        setStatus('No video data was captured.');
      }
      return;
    }

    setStatusForGeneration(session.generation, 'Preparing clip…');
    void addWebMDurationMetadata(rawBlob, details.durationSeconds)
      .then((blob) => {
        const clip: SixSevenClip = {
          id: makeClipId(),
          createdAt: Date.now(),
          score: details.score,
          durationSeconds: details.durationSeconds,
          blob,
        };
        return saveSixSevenClip(clip);
      })
      .then((result) => {
        if (!mountedRef.current) return;
        setClips(result.clips);
        setStatusForGeneration(
          session.generation,
          result.persistent
            ? 'Clip saved on this device.'
            : 'Clip saved for this session; persistent storage is unavailable.'
        );
      })
      .catch(() => {
        if (mountedRef.current && session.generation === generationRef.current) {
          setStatus('Could not save this clip.');
        }
      });
  }, [setStatusForGeneration]);

  const abandonSession = useCallback((session: RecordingSession) => {
    session.discarded = true;
    session.finishDetails = null;
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
    const loadGeneration = ++loadGenerationRef.current;
    void loadSixSevenClips().then((result) => {
      if (mountedRef.current && loadGeneration === loadGenerationRef.current) {
        setClips(result.clips);
      }
    });

    return () => {
      mountedRef.current = false;
      loadGenerationRef.current += 1;
      generationRef.current += 1;
      const session = sessionRef.current;
      if (session && !session.finishDetails) abandonSession(session);
    };
  }, [abandonSession]);

  const start = useCallback(
    (canvas: HTMLCanvasElement) => {
      const generation = ++generationRef.current;
      const previous = sessionRef.current;
      if (previous?.finishDetails) {
        // Let the stop event finish and persist the completed clip while a new
        // recording starts under its own generation.
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
      let recorder: MediaRecorder | null = null;
      try {
        stream = canvas.captureStream(SIX_SEVEN_CAPTURE_FPS);
        recorder = startRecorder(stream);
        const session: RecordingSession = {
          generation,
          recorder,
          stream,
          chunks: [],
          finishDetails: null,
          discarded: false,
          completed: false,
        };
        sessionRef.current = session;
        recorder.ondataavailable = (event: BlobEvent) => {
          if (session.discarded || event.data.size === 0) return;
          session.chunks.push(event.data);
        };
        recorder.onstop = () => finishSession(session);
        recorder.onerror = () => {
          if (session.completed) return;
          session.discarded = true;
          session.completed = true;
          clearRecorderHandlers(recorder!);
          stopTracks(stream!);
          if (sessionRef.current === session) sessionRef.current = null;
          if (mountedRef.current && generation === generationRef.current) {
            setRecording(false);
            setStatus('Recording stopped because the browser reported an error.');
          }
        };
        setRecording(true);
        setStatus('Recording locally.');
        return true;
      } catch {
        if (recorder && stream) {
          clearRecorderHandlers(recorder);
          if (recorder.state !== 'inactive') {
            try {
              recorder.stop();
            } catch {
              // Ignore errors while releasing a partially-created recorder.
            }
          }
        }
        if (stream) stopTracks(stream);
        sessionRef.current = null;
        setRecording(false);
        setStatus('Could not start video recording.');
        return false;
      }
    },
    [abandonSession, finishSession]
  );

  const pause = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.recorder.state !== 'recording') return;
    try {
      session.recorder.pause();
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
      setStatus('Recording locally.');
    } catch {
      setStatus('Could not resume recording.');
    }
  }, []);

  const finish = useCallback((score: number, durationSeconds: number) => {
    const session = sessionRef.current;
    if (!session || session.finishDetails) return;
    session.finishDetails = {
      score: Number.isFinite(score) ? Math.max(0, Math.round(score)) : 0,
      durationSeconds: Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0,
    };
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
    if (session?.finishDetails) {
      setRecording(false);
      setStatus('Finishing completed clip…');
      return;
    }
    abandonSession(session);
    setRecording(false);
    setStatus('Recording discarded.');
  }, [abandonSession]);

  const remove = useCallback(async (id: string) => {
    const result = await removeSixSevenClip(id);
    if (mountedRef.current) {
      if (result.removed || result.clips.some((clip) => clip.id === id)) {
        setClips(result.clips);
      } else {
        setClips((current) =>
          current.some((clip) => clip.id === id) ? current : result.clips
        );
      }
      setStatus(
        result.removed
          ? result.persistent
            ? 'Clip removed from this device.'
            : 'Clip removed for this session.'
          : 'Could not remove clip from device storage.'
      );
    }
  }, []);

  return { clips, recording, status, supported, start, pause, resume, finish, discard, remove };
}
