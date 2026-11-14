'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArcadeHudHandle, ArcadePhase } from '@/components/arcade/ArcadeGameShell';
import { ArcadeAudioEngine } from '@/lib/games/shared/audio';
import {
  clearScoreboard,
  loadScoreboard,
  normalizePlayerName,
  recordMatchToScoreboard,
  saveScoreboard,
  type GameSlug,
  type ScoreboardEntry,
  type ScoreboardMode,
} from '@/lib/games/shared/scoreboard';

export interface ScoreboardRoundPlayerInput {
  score: number;
  detail: string;
}

export function useArcadeSession(
  gameSlug: GameSlug,
  initialPhase: ArcadePhase,
  initialMode: ScoreboardMode = '1v1'
) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sizeRef = useRef<{ width: number; height: number }>({ width: 1280, height: 720 });
  const hudHandleRef = useRef<ArcadeHudHandle | null>(null);
  const audioRef = useRef<ArcadeAudioEngine | null>(null);
  const namesRef = useRef<{ p1: string; p2: string }>({ p1: '', p2: '' });

  const [phase, setPhase] = useState<ArcadePhase>(initialPhase);
  const [mode, setMode] = useState<ScoreboardMode>(initialMode);
  const [p1Name, setP1Name] = useState<string>('');
  const [p2Name, setP2Name] = useState<string>('');
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [scoreboard, setScoreboard] = useState<ScoreboardEntry[]>([]);
  const [newEntryIds, setNewEntryIds] = useState<string[]>([]);

  useEffect(() => {
    audioRef.current = new ArcadeAudioEngine();
  }, []);

  const handleP1NameChange = useCallback((val: string) => {
    setP1Name(val);
    namesRef.current.p1 = val;
  }, []);

  const handleP2NameChange = useCallback((val: string) => {
    setP2Name(val);
    namesRef.current.p2 = val;
  }, []);

  const toggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      audioRef.current?.setMuted(next);
      return next;
    });
  }, []);

  const recordScoreboardRound = useCallback(
    (
      roundMode: ScoreboardMode,
      p1: ScoreboardRoundPlayerInput,
      p2?: ScoreboardRoundPlayerInput
    ) => {
      const p1Label = normalizePlayerName(
        namesRef.current.p1,
        roundMode === 'solo' ? 'Solo Player' : 'Player 1'
      );
      const p2Label = normalizePlayerName(namesRef.current.p2, 'Player 2');

      const incoming =
        roundMode === 'solo' || !p2
          ? [
              {
                game: gameSlug,
                mode: 'solo' as const,
                name: p1Label,
                score: p1.score,
                detail: p1.detail,
              },
            ]
          : [
              {
                game: gameSlug,
                mode: '1v1' as const,
                name: p1Label,
                score: p1.score,
                detail: p1.detail,
              },
              {
                game: gameSlug,
                mode: '1v1' as const,
                name: p2Label,
                score: p2.score,
                detail: p2.detail,
              },
            ];

      const existing = loadScoreboard(gameSlug);
      const { entries, addedIds } = recordMatchToScoreboard(existing, incoming);
      saveScoreboard(gameSlug, entries);
      setScoreboard(entries);
      setNewEntryIds(addedIds);
    },
    [gameSlug]
  );

  const handleClearScoreboard = useCallback(() => {
    clearScoreboard(gameSlug);
    setScoreboard([]);
    setNewEntryIds([]);
  }, [gameSlug]);

  const resolvedP1Name = normalizePlayerName(
    p1Name,
    mode === 'solo' ? 'Solo Player' : 'Player 1'
  );
  const resolvedP2Name = normalizePlayerName(p2Name, 'Player 2');

  return {
    canvasRef,
    sizeRef,
    hudHandleRef,
    audioRef,
    phase,
    setPhase,
    mode,
    setMode,
    p1Name,
    p2Name,
    resolvedP1Name,
    resolvedP2Name,
    handleP1NameChange,
    handleP2NameChange,
    isMuted,
    toggleMute,
    scoreboard,
    newEntryIds,
    setNewEntryIds,
    recordScoreboardRound,
    handleClearScoreboard,
  };
}
