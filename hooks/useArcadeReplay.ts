'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useCanvasReplayRecorder, createReplayClipId } from '@/hooks/useCanvasReplayRecorder';
import {
  loadReplayClips,
  MAX_REPLAY_CLIPS,
  removeReplayClip,
  saveReplayClip,
} from '@/lib/games/shared/replay-store';
import type { ReplayHudSnapshot } from '@/lib/games/shared/replay-canvas';
import type { ArcadeReplayClip } from '@/lib/games/shared/replay-types';

export interface UseArcadeReplayOptions {
  gameId: string;
  gameName: string;
}

/** Optional, per-game local replay recording and browsing. Recording starts off. */
export function useArcadeReplay({ gameId, gameName }: UseArcadeReplayOptions) {
  const databaseName = `arcade-replay-clips-${gameId}`;
  const [enabled, setEnabledState] = useState(false);
  const [clips, setClips] = useState<ArcadeReplayClip[]>([]);
  const mountedRef = useRef(false);
  const loadGenerationRef = useRef(0);

  const onClipsSaved = useCallback((nextClips: ArcadeReplayClip[]) => {
    if (mountedRef.current) setClips(nextClips);
  }, []);

  const save = useCallback(async (draft: {
    blob: Blob;
    score: number;
    durationSeconds: number;
  }) => {
    const clip: ArcadeReplayClip = {
      id: createReplayClipId(`arcade-${gameId}`),
      gameId,
      gameName,
      createdAt: Date.now(),
      score: draft.score,
      durationSeconds: draft.durationSeconds,
      blob: draft.blob,
    };
    return saveReplayClip<ArcadeReplayClip>(databaseName, clip, MAX_REPLAY_CLIPS);
  }, [databaseName, gameId, gameName]);

  const recorder = useCanvasReplayRecorder<ArcadeReplayClip>({ save, onClipsSaved });
  const {
    discard,
    finish,
    pause,
    recording,
    resume,
    setStatus,
    start: startCapture,
    status: recorderStatus,
    supported,
  } = recorder;

  useEffect(() => {
    mountedRef.current = true;
    const generation = ++loadGenerationRef.current;
    void loadReplayClips<ArcadeReplayClip>(databaseName, MAX_REPLAY_CLIPS).then((result) => {
      if (mountedRef.current && generation === loadGenerationRef.current) setClips(result.clips);
    });

    return () => {
      mountedRef.current = false;
      loadGenerationRef.current += 1;
    };
  }, [databaseName]);

  const setEnabled = useCallback((nextEnabled: boolean) => {
    setEnabledState(nextEnabled);
    if (!nextEnabled) discard();
  }, [discard]);

  const start = useCallback((
    canvas: HTMLCanvasElement | null,
    getHudSnapshot?: () => ReplayHudSnapshot,
  ) => {
    if (!enabled) {
      setStatus('Clip recording is off.');
      return false;
    }
    if (!canvas) {
      setStatus('Could not start video recording.');
      return false;
    }
    return startCapture(canvas, getHudSnapshot);
  }, [enabled, setStatus, startCapture]);

  const remove = useCallback(async (id: string) => {
    const result = await removeReplayClip<ArcadeReplayClip>(databaseName, id, MAX_REPLAY_CLIPS);
    if (mountedRef.current) {
      setClips(result.clips);
      setStatus(
        result.removed
          ? result.persistent
            ? 'Clip removed from this device.'
            : 'Clip removed for this session.'
          : 'Could not remove clip from device storage.',
      );
    }
  }, [databaseName, setStatus]);

  const status = enabled && recorderStatus === 'Clip recording is off.'
    ? 'Ready to save the next round locally.'
    : recorderStatus;

  return {
    enabled,
    setEnabled,
    clips,
    recording,
    status,
    supported,
    start,
    pause,
    resume,
    finish,
    discard,
    remove,
  };
}
