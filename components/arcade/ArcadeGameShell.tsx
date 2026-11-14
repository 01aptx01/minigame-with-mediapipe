'use client';

import React, { useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import { ArrowLeft, Pause, Play, RotateCcw, Volume2, VolumeX } from 'lucide-react';

export type ArcadePhase = 'title' | 'playing' | 'paused' | 'gameover';

export interface ArcadeHudUpdate {
  timeRemaining: number;
  p1Score: number;
  p1Meta: string;
  p2Score?: number;
  p2Meta?: string;
  tugRatio: number;
  tugDividerPercent?: number;
  overdrive?: boolean;
}

export interface ArcadeHudHandle {
  updateHud: (data: ArcadeHudUpdate) => void;
}

interface ArcadeGameShellProps {
  phase: ArcadePhase;
  isMuted: boolean;
  initialDurationSec?: number;
  soloMode?: boolean;
  hideTugBar?: boolean;
  p1Label?: string;
  p2Label?: string;
  canvasTestId: string;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  sizeRef: React.MutableRefObject<{ width: number; height: number }>;
  hudHandleRef: React.MutableRefObject<ArcadeHudHandle | null>;
  onStart: () => void;
  onTogglePause: () => void;
  onToggleMute: () => void;
  onRestart: () => void;
  titleOverlay?: React.ReactNode;
  endOverlay?: React.ReactNode;
  pauseSubtitle?: string;
  bottomControls?: React.ReactNode;
}

export function ArcadeGameShell({
  phase,
  isMuted,
  initialDurationSec = 60,
  soloMode = false,
  hideTugBar = false,
  p1Label,
  p2Label,
  canvasTestId,
  canvasRef,
  sizeRef,
  hudHandleRef,
  onStart,
  onTogglePause,
  onToggleMute,
  onRestart,
  titleOverlay,
  endOverlay,
  pauseSubtitle = 'Take a breather or reset the 60-second clock.',
  bottomControls,
}: ArcadeGameShellProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const timerTextRef = useRef<HTMLSpanElement | null>(null);
  const p1ScoreTextRef = useRef<HTMLSpanElement | null>(null);
  const p2ScoreTextRef = useRef<HTMLSpanElement | null>(null);
  const p1MetaTextRef = useRef<HTMLSpanElement | null>(null);
  const p2MetaTextRef = useRef<HTMLSpanElement | null>(null);
  const tugP1BarRef = useRef<HTMLDivElement | null>(null);
  const tugDividerRef = useRef<HTMLDivElement | null>(null);
  const centerBadgeRef = useRef<HTMLSpanElement | null>(null);

  const lastHudRef = useRef<{
    timer: string;
    p1Score: string;
    p1Meta: string;
    p2Score: string;
    p2Meta: string;
    overdrive: boolean;
    tugPct: string;
    divPct: string;
  }>({
    timer: '',
    p1Score: '',
    p1Meta: '',
    p2Score: '',
    p2Meta: '',
    overdrive: false,
    tugPct: '',
    divPct: '',
  });

  const updateHud = useCallback((data: ArcadeHudUpdate) => {
    const prev = lastHudRef.current;

    const timerText = String(Math.max(0, Math.ceil(data.timeRemaining))).padStart(2, '0');
    if (timerTextRef.current && prev.timer !== timerText) {
      prev.timer = timerText;
      timerTextRef.current.textContent = timerText;
    }

    const p1ScoreText = String(Math.round(data.p1Score));
    if (p1ScoreTextRef.current && prev.p1Score !== p1ScoreText) {
      prev.p1Score = p1ScoreText;
      p1ScoreTextRef.current.textContent = p1ScoreText;
    }

    if (p1MetaTextRef.current && prev.p1Meta !== data.p1Meta) {
      prev.p1Meta = data.p1Meta;
      p1MetaTextRef.current.textContent = data.p1Meta;
    }

    if (p2ScoreTextRef.current && data.p2Score !== undefined) {
      const p2ScoreText = String(Math.round(data.p2Score));
      if (prev.p2Score !== p2ScoreText) {
        prev.p2Score = p2ScoreText;
        p2ScoreTextRef.current.textContent = p2ScoreText;
      }
    }

    if (p2MetaTextRef.current && data.p2Meta !== undefined && prev.p2Meta !== data.p2Meta) {
      prev.p2Meta = data.p2Meta;
      p2MetaTextRef.current.textContent = data.p2Meta;
    }

    const overdriveNow = Boolean(data.overdrive);
    if (centerBadgeRef.current && prev.overdrive !== overdriveNow) {
      prev.overdrive = overdriveNow;
      centerBadgeRef.current.classList.toggle('hidden', !overdriveNow);
    }

    const pct = (Math.max(0, Math.min(1, data.tugRatio)) * 100).toFixed(2);
    if (tugP1BarRef.current && prev.tugPct !== pct) {
      prev.tugPct = pct;
      tugP1BarRef.current.style.width = `${pct}%`;
    }

    const divPct =
      data.tugDividerPercent !== undefined ? data.tugDividerPercent.toFixed(2) : pct;
    if (tugDividerRef.current && prev.divPct !== divPct) {
      prev.divPct = divPct;
      tugDividerRef.current.style.left = `${divPct}%`;
    }
  }, []);

  useEffect(() => {
    hudHandleRef.current = { updateHud };
    return () => {
      hudHandleRef.current = null;
    };
  }, [hudHandleRef, updateHud]);

  // Mirror current game phase to document.body.dataset.state
  useEffect(() => {
    if (typeof document !== 'undefined') {
      document.body.dataset.state = phase;
    }
    return () => {
      if (typeof document !== 'undefined') {
        delete document.body.dataset.state;
      }
    };
  }, [phase]);

  // Shared keyboard shortcuts: Enter/Space start, P/Esc pause, M mute, R restart
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
        if (e.key === 'Enter' && phase === 'title') {
          e.preventDefault();
          onStart();
        }
        return;
      }

      const key = e.key.toLowerCase();

      if ((key === 'enter' || key === ' ') && phase === 'title') {
        e.preventDefault();
        onStart();
        return;
      }
      if ((key === 'p' || key === 'escape') && (phase === 'playing' || phase === 'paused')) {
        e.preventDefault();
        onTogglePause();
        return;
      }
      if (key === 'm') {
        e.preventDefault();
        onToggleMute();
        return;
      }
      if (key === 'r' && phase !== 'title') {
        e.preventDefault();
        onRestart();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onRestart, onStart, onToggleMute, onTogglePause, phase]);

  // Shared ResizeObserver for crisp DPR canvas sizing
  useEffect(() => {
    const stage = stageRef.current;
    const canvas = canvasRef.current;
    if (!stage || !canvas) return;

    const updateSize = () => {
      const rect = stage.getBoundingClientRect();
      const width = Math.max(320, Math.floor(rect.width));
      const height = Math.max(240, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      sizeRef.current = { width, height };
    };

    updateSize();
    const observer = new ResizeObserver(updateSize);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [canvasRef, sizeRef]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-[#07090F] text-slate-100 select-none">
      {/* Isolated Canvas Stage */}
      <div ref={stageRef} className="absolute inset-0">
        <canvas
          ref={canvasRef}
          data-testid={canvasTestId}
          className="block h-full w-full cursor-crosshair touch-none"
        />
      </div>

      {/* Shared Top HUD Overlay (60FPS DOM-ref driven) */}
      <header className="pointer-events-none fixed inset-x-0 top-0 z-20 flex flex-col gap-2 px-4 pt-3 sm:px-6">
        <div className="flex items-center justify-between gap-4">
          {/* Left: Back to Hub + P1 Readout */}
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="pointer-events-auto inline-flex items-center gap-2 rounded-lg border border-slate-700/70 bg-[#0D121D]/90 px-3 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-cyan-400/60 hover:text-white whitespace-nowrap shrink-0"
            >
              <ArrowLeft className="h-4 w-4" aria-hidden="true" />
              <span>Back to Hub</span>
            </Link>

            <div className="flex items-baseline gap-2.5 rounded-lg border border-cyan-500/30 bg-[#0D121D]/90 px-3.5 py-1.5">
              <span className="max-w-28 truncate text-[11px] font-bold tracking-wider text-cyan-400 uppercase">
                {p1Label || (soloMode ? 'SOLO' : 'P1')}
              </span>
              <span
                ref={p1ScoreTextRef}
                data-testid="p1-score"
                className="font-mono text-2xl font-bold text-white tabular-nums"
              >
                0
              </span>
              <span
                ref={p1MetaTextRef}
                className="font-mono text-xs font-semibold text-cyan-300 tabular-nums"
              >
                1x
              </span>
            </div>
          </div>

          {/* Center: Match Countdown Timer + Optional Overdrive Badge */}
          <div className="flex flex-col items-center gap-1">
            <div className="flex items-center gap-2 rounded-lg border border-slate-700/80 bg-[#0D121D]/95 px-4 py-1.5 shadow-lg">
              <span className="text-[11px] font-semibold tracking-wider text-slate-400 uppercase">
                Time
              </span>
              <span
                ref={timerTextRef}
                data-testid="match-timer"
                className="font-mono text-2xl font-bold text-white tabular-nums"
              >
                {initialDurationSec}
              </span>
              <span
                ref={centerBadgeRef}
                className="hidden rounded bg-amber-500/20 px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider text-amber-300 uppercase"
              >
                2X OVERDRIVE
              </span>
            </div>
          </div>

          {/* Right: P2 Readout + Utility Buttons */}
          <div className="flex items-center gap-2.5">
            {!soloMode && (
              <div className="flex items-baseline gap-2.5 rounded-lg border border-rose-500/30 bg-[#0D121D]/90 px-3.5 py-1.5">
                <span
                  ref={p2MetaTextRef}
                  className="font-mono text-xs font-semibold text-rose-300 tabular-nums"
                >
                  1x
                </span>
                <span
                  ref={p2ScoreTextRef}
                  data-testid="p2-score"
                  className="font-mono text-2xl font-bold text-white tabular-nums"
                >
                  0
                </span>
                <span className="max-w-28 truncate text-[11px] font-bold tracking-wider text-rose-400 uppercase">
                  {p2Label || 'P2'}
                </span>
              </div>
            )}

            <div className="pointer-events-auto flex items-center gap-1.5">
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onToggleMute();
                }}
                aria-label={isMuted ? 'Unmute audio (M)' : 'Mute audio (M)'}
                title="Mute / Unmute (M)"
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700/70 bg-[#0D121D]/90 text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
              >
                {isMuted ? (
                  <VolumeX className="h-4 w-4" aria-hidden="true" />
                ) : (
                  <Volume2 className="h-4 w-4" aria-hidden="true" />
                )}
              </button>

              {phase !== 'title' && (
                <>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onTogglePause();
                    }}
                    aria-label={phase === 'paused' ? 'Resume game (P)' : 'Pause game (P)'}
                    title="Pause / Resume (P)"
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700/70 bg-[#0D121D]/90 text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
                  >
                    {phase === 'paused' ? (
                      <Play className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Pause className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.currentTarget.blur();
                      onRestart();
                    }}
                    aria-label="Restart round (R)"
                    title="Restart (R)"
                    className="flex h-9 w-9 items-center justify-center rounded-lg border border-slate-700/70 bg-[#0D121D]/90 text-slate-200 transition-colors hover:border-slate-500 hover:text-white"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden="true" />
                  </button>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Shared Cyber Tug-of-War Bar */}
        {!hideTugBar && (
          <div
            aria-label="Tug-of-war score bar"
            className={`relative mx-auto h-2.5 w-full max-w-2xl overflow-hidden rounded-full border border-slate-700/80 ${
              soloMode ? 'bg-slate-800/90' : 'bg-rose-600/85'
            }`}
          >
            <div
              ref={tugP1BarRef}
              style={{ width: soloMode ? '0%' : '50%' }}
              className="h-full bg-cyan-400 transition-[width] duration-75"
            />
            <div
              ref={tugDividerRef}
              style={{ left: soloMode ? '80%' : '50%' }}
              className="absolute top-0 h-full w-1 -translate-x-1/2 bg-white shadow-[0_0_8px_#fff]"
            />
          </div>
        )}
      </header>

      {/* Optional Bottom Interactive Controls */}
      {bottomControls}

      {/* Title Screen Overlay */}
      {phase === 'title' && titleOverlay && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#07090F]/82 px-4">
          {titleOverlay}
        </div>
      )}

      {/* Shared Pause Modal */}
      {phase === 'paused' && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#07090F]/82 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-700 bg-[#0D121E] p-6 text-center shadow-2xl">
            <h2 className="font-display text-2xl font-bold text-white">Match Paused</h2>
            <p className="mt-1.5 text-sm text-slate-400">{pauseSubtitle}</p>
            <div className="mt-6 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={onTogglePause}
                className="w-full rounded-lg bg-cyan-400 px-5 py-2.5 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-300"
              >
                Resume Match
              </button>
              <button
                type="button"
                onClick={onRestart}
                className="w-full rounded-lg border border-slate-700 bg-[#121929] px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:border-slate-500"
              >
                Restart Match
              </button>
              <Link
                href="/"
                className="w-full rounded-lg border border-slate-800 px-5 py-2.5 text-sm font-medium text-slate-300 transition-colors hover:text-white"
              >
                Back to Hub
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* End Game Overlay */}
      {phase === 'gameover' && endOverlay && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-[#07090F]/86 px-4 py-6 overflow-y-auto">
          {endOverlay}
        </div>
      )}
    </div>
  );
}
