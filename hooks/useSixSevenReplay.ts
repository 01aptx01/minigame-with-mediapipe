'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useCanvasReplayRecorder, createReplayClipId } from '@/hooks/useCanvasReplayRecorder';
import {
  loadSixSevenClips,
  removeSixSevenClip,
  saveSixSevenClip,
  type SixSevenClip,
} from '@/lib/games/six-seven/replay';

/** Six Seven keeps its existing database name and clip format while sharing the recorder lifecycle. */
export function useSixSevenReplay() {
  const [clips, setClips] = useState<SixSevenClip[]>([]);
  const mountedRef = useRef(false);
  const loadGenerationRef = useRef(0);

  const save = useCallback(async (draft: {
    blob: Blob;
    score: number;
    durationSeconds: number;
  }) => {
    const clip: SixSevenClip = {
      id: createReplayClipId('six-seven'),
      createdAt: Date.now(),
      score: draft.score,
      durationSeconds: draft.durationSeconds,
      blob: draft.blob,
    };
    return saveSixSevenClip(clip);
  }, []);

  const recorder = useCanvasReplayRecorder<SixSevenClip>({ save, onClipsSaved: setClips });
  const { setStatus } = recorder;

  useEffect(() => {
    mountedRef.current = true;
    const generation = ++loadGenerationRef.current;
    void loadSixSevenClips().then((result) => {
      if (mountedRef.current && generation === loadGenerationRef.current) {
        setClips(result.clips);
      }
    });

    return () => {
      mountedRef.current = false;
      loadGenerationRef.current += 1;
    };
  }, []);

  const remove = useCallback(async (id: string) => {
    const result = await removeSixSevenClip(id);
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
  }, [setStatus]);

  return { clips, ...recorder, remove };
}
