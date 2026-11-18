'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, Gamepad2, Play, Sparkles, Video } from 'lucide-react';
import { ArcadeEndCard } from '@/components/arcade/ArcadeEndCard';
import { ArcadeGameShell } from '@/components/arcade/ArcadeGameShell';
import { PlayerNameInputs } from '@/components/arcade/PlayerNameInputs';
import { useMediaPipe } from '@/contexts/MediaPipeContext';
import { useArcadeSession } from '@/hooks/useArcadeSession';
import {
  createSixSevenState,
  registerSixSevenPracticeHit,
  resetSixSevenTracking,
  updateSixSevenGesture,
} from '@/lib/games/six-seven/engine';
import type {
  SixSevenHit,
  SixSevenLandmark,
  SixSevenState,
} from '@/lib/games/six-seven/engine';
import {
  drawSixSevenStage,
  drawSixSevenVideo,
  promptForSixSeven,
  type SixSevenStageHit,
} from '@/lib/games/six-seven/stage';
import type { ArcadePhase } from '@/components/arcade/ArcadeGameShell';

const ROUND_SECONDS = 30;
const POSE_DROPOUT_MS = 850;
const INITIAL_TRACKING_MESSAGE = 'Practice is ready. Use A / ← for left, D / → for right.';
type InputMode = 'camera' | 'practice';

interface RoundClock {
  remainingSec: number;
  inputMode: InputMode;
  startedAtMs: number | null;
  totalPausedMs: number;
  pausedAtMs: number | null;
  ended: boolean;
}

function remainingAt(clock: RoundClock, nowMs: number): number {
  if (clock.startedAtMs === null) return ROUND_SECONDS;
  const effectiveNow = clock.pausedAtMs ?? nowMs;
  const activeElapsedMs = Math.max(0, effectiveNow - clock.startedAtMs - clock.totalPausedMs);
  return Math.max(0, ROUND_SECONDS - activeElapsedMs / 1000);
}

function poseHasVisibleBodyAnchors(pose: readonly SixSevenLandmark[] | undefined): boolean {
  if (!pose) return false;
  return [11, 12, 15, 16].every((index) => {
    const landmark = pose[index];
    return Boolean(
      landmark &&
        Number.isFinite(landmark.x) &&
        Number.isFinite(landmark.y) &&
        landmark.x >= 0 && landmark.x <= 1 &&
        landmark.y >= 0 && landmark.y <= 1 &&
        (landmark.visibility === undefined || landmark.visibility >= 0.45)
    );
  });
}

export default function SixSevenGame() {
  const {
    videoRef,
    cameraStatus,
    poseModelStatus,
    errorMessage,
    requestCamera,
    initializePoseModel,
    predictPose,
  } = useMediaPipe();

  const {
    canvasRef,
    sizeRef,
    hudHandleRef,
    audioRef,
    phase,
    setPhase,
    p1Name,
    p2Name,
    resolvedP1Name,
    handleP1NameChange,
    handleP2NameChange,
    isMuted,
    toggleMute,
    scoreboard,
    newEntryIds,
    setNewEntryIds,
    recordScoreboardRound,
    handleClearScoreboard,
  } = useArcadeSession('six-seven', 'title', 'solo');

  const gameStateRef = useRef<SixSevenState>(createSixSevenState());
  const phaseRef = useRef<ArcadePhase>(phase);
  const inputModeRef = useRef<InputMode>('practice');
  const roundRef = useRef<RoundClock>({
    remainingSec: ROUND_SECONDS,
    inputMode: 'practice',
    startedAtMs: null,
    totalPausedMs: 0,
    pausedAtMs: null,
    ended: false,
  });
  const floatingHitsRef = useRef<SixSevenStageHit[]>([]);
  const popupIdRef = useRef(0);
  const trackingMessageRef = useRef(INITIAL_TRACKING_MESSAGE);

  const [inputMode, setInputMode] = useState<InputMode>('practice');
  const [activationBusy, setActivationBusy] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const [trackingMessage, setTrackingMessage] = useState(INITIAL_TRACKING_MESSAGE);
  const [nextNumber, setNextNumber] = useState<6 | 7>(6);
  const [endSummary, setEndSummary] = useState<{ score: number; cameraRound: boolean } | null>(null);

  const cameraInputReady = cameraStatus === 'active' && poseModelStatus === 'ready' && !activationBusy;

  const setTrackingStatus = useCallback((message: string) => {
    if (trackingMessageRef.current === message) return;
    trackingMessageRef.current = message;
    setTrackingMessage(message);
  }, []);

  const syncHudDom = useCallback((state: SixSevenState, remainingSec: number) => {
    hudHandleRef.current?.updateHud({
      timeRemaining: remainingSec,
      p1Score: state.score,
      p1Meta: `NEXT · ${state.nextNumber} · ${state.nextNumber === 6 ? 'LEFT' : 'RIGHT'}`,
      tugRatio: 1,
      tugDividerPercent: 100,
    });
  }, [hudHandleRef]);

  const handleHit = useCallback((hit: SixSevenHit) => {
    floatingHitsRef.current.push({ ...hit, id: popupIdRef.current++ });
    if (floatingHitsRef.current.length > 8) floatingHitsRef.current.shift();
    audioRef.current?.playSlice(gameStateRef.current.score);
    const nextNumber = gameStateRef.current.nextNumber;
    setNextNumber(nextNumber);
    setTrackingStatus(
      `${hit.number}! ${promptForSixSeven(nextNumber)}. Keep switching.`
    );
    syncHudDom(gameStateRef.current, roundRef.current.remainingSec);
  }, [audioRef, setTrackingStatus, syncHudDom]);

  const handlePracticeAction = useCallback((side: 'left' | 'right') => {
    if (phaseRef.current !== 'playing' || inputModeRef.current !== 'practice') return;
    const nowMs = performance.now();
    const remaining = remainingAt(roundRef.current, nowMs);
    roundRef.current.remainingSec = remaining;
    if (remaining <= 0 || roundRef.current.ended) return;

    const hit = registerSixSevenPracticeHit(gameStateRef.current, side, nowMs);
    if (hit) {
      handleHit(hit);
      return;
    }
    const expectedSide = gameStateRef.current.nextNumber === 6 ? 'left' : 'right';
    setTrackingStatus(`Try the ${expectedSide} arm next · ${promptForSixSeven(gameStateRef.current.nextNumber)}.`);
  }, [handleHit, setTrackingStatus]);

  const startNewRound = useCallback((selectedMode: InputMode = inputModeRef.current) => {
    if (selectedMode === 'camera' && !cameraInputReady) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();

    const nowMs = performance.now();
    inputModeRef.current = selectedMode;
    setInputMode(selectedMode);
    roundRef.current = {
      remainingSec: ROUND_SECONDS,
      inputMode: selectedMode,
      startedAtMs: nowMs,
      totalPausedMs: 0,
      pausedAtMs: null,
      ended: false,
    };
    gameStateRef.current = createSixSevenState();
    setNextNumber(6);
    resetSixSevenTracking(gameStateRef.current);
    floatingHitsRef.current = [];
    setNewEntryIds([]);
    setEndSummary(null);
    setTrackingStatus(selectedMode === 'camera'
      ? 'Start hands level. Keep both shoulders and wrists visible, then raise the left arm.'
      : 'Practice is live. Raise the left arm first, then alternate with the right.');
    syncHudDom(gameStateRef.current, ROUND_SECONDS);
    audioRef.current?.playCountdownTick();
    phaseRef.current = 'playing';
    setPhase('playing');
  }, [audioRef, cameraInputReady, setNewEntryIds, setPhase, setTrackingStatus, syncHudDom]);

  const togglePause = useCallback(() => {
    if (phaseRef.current === 'playing') {
      const nowMs = performance.now();
      const remaining = remainingAt(roundRef.current, nowMs);
      if (remaining <= 0) return;
      roundRef.current.remainingSec = remaining;
      roundRef.current.pausedAtMs = nowMs;
      resetSixSevenTracking(gameStateRef.current);
      setTrackingStatus('Paused. Resume with both hands level to reset camera tracking.');
      syncHudDom(gameStateRef.current, remaining);
      phaseRef.current = 'paused';
      setPhase('paused');
    } else if (phaseRef.current === 'paused') {
      const nowMs = performance.now();
      if (roundRef.current.pausedAtMs !== null) {
        roundRef.current.totalPausedMs += Math.max(0, nowMs - roundRef.current.pausedAtMs);
        roundRef.current.pausedAtMs = null;
      }
      resetSixSevenTracking(gameStateRef.current);
      const remaining = remainingAt(roundRef.current, nowMs);
      roundRef.current.remainingSec = remaining;
      setTrackingStatus(roundRef.current.inputMode === 'camera'
        ? 'Tracking reset. Start with both hands level, then follow the cue.'
        : 'Timer resumed. Follow the next arm cue.');
      syncHudDom(gameStateRef.current, remaining);
      phaseRef.current = 'playing';
      setPhase('playing');
    }
  }, [setPhase, setTrackingStatus, syncHudDom]);

  const handleCameraSetup = useCallback(async () => {
    setActivationBusy(true);
    setTrackingStatus('Connecting to camera and loading body tracking…');
    try {
      const cameraReady = cameraStatus === 'active' || await requestCamera();
      if (!cameraReady) {
        setTrackingStatus('Camera was not enabled. Retry setup or switch to practice.');
        return;
      }
      await initializePoseModel();
      setTrackingStatus('Setup finished. Check the camera status above before starting.');
    } finally {
      setActivationBusy(false);
    }
  }, [cameraStatus, initializePoseModel, requestCamera, setTrackingStatus]);

  const handleReplay = useCallback(() => {
    const selectedMode = roundRef.current.inputMode;
    if (selectedMode === 'camera' && !cameraInputReady) {
      phaseRef.current = 'title';
      setPhase('title');
      return;
    }
    startNewRound(selectedMode);
  }, [cameraInputReady, setPhase, startNewRound]);

  useEffect(() => {
    syncHudDom(gameStateRef.current, ROUND_SECONDS);
  }, [syncHudDom]);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const handleKeys = (event: KeyboardEvent) => {
      if (phaseRef.current !== 'playing' || inputModeRef.current !== 'practice' || event.repeat) return;
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) return;

      const key = event.key.toLowerCase();
      if (key === 'a' || key === 'arrowleft') {
        event.preventDefault();
        handlePracticeAction('left');
      } else if (key === 'd' || key === 'arrowright') {
        event.preventDefault();
        handlePracticeAction('right');
      }
    };
    window.addEventListener('keydown', handleKeys);
    return () => window.removeEventListener('keydown', handleKeys);
  }, [handlePracticeAction]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;

    let rafId = 0;
    let lastFreshPoseMs = performance.now();
    let trackingWasResetForDropout = false;

    const finishRound = () => {
      if (roundRef.current.ended) return;
      roundRef.current.ended = true;
      roundRef.current.remainingSec = 0;
      resetSixSevenTracking(gameStateRef.current);
      audioRef.current?.playRoundEnd();
      if (roundRef.current.inputMode === 'camera') {
        recordScoreboardRound('solo', {
          score: gameStateRef.current.score,
          detail: '30s camera round',
        });
      }
      setEndSummary({
        score: gameStateRef.current.score,
        cameraRound: roundRef.current.inputMode === 'camera',
      });
      syncHudDom(gameStateRef.current, 0);
      phaseRef.current = 'gameover';
      setPhase('gameover');
    };

    const drawFrame = (nowMs: number) => {
      rafId = requestAnimationFrame(drawFrame);
      const { width, height } = sizeRef.current;
      const dpr = canvas.width / Math.max(1, width);
      const state = gameStateRef.current;
      const isActiveRound = phase === 'playing' && !roundRef.current.ended;

      if (isActiveRound) {
        const remaining = remainingAt(roundRef.current, nowMs);
        roundRef.current.remainingSec = remaining;
        if (remaining <= 0) {
          // Expire before reading another pose so a slow model cannot score beyond 30 seconds.
          finishRound();
        } else if (
          !document.hidden &&
          roundRef.current.inputMode === 'camera' &&
          cameraStatus === 'active' &&
          poseModelStatus === 'ready'
        ) {
          const result = predictPose(nowMs);
          // null here may mean a duplicate video timestamp: only update the engine for fresh results.
          if (result) {
            lastFreshPoseMs = nowMs;
            trackingWasResetForDropout = false;
            const pose = result.landmarks[0] as readonly SixSevenLandmark[] | undefined;
            const hit = updateSixSevenGesture(state, pose ?? null, nowMs);
            if (hit) handleHit(hit);
            if (!poseHasVisibleBodyAnchors(pose)) {
              setTrackingStatus('Face the camera; keep both shoulders and both wrists in frame.');
            } else if (
              trackingMessageRef.current.startsWith('No fresh pose') ||
              trackingMessageRef.current.startsWith('Face the camera')
            ) {
              setTrackingStatus('Pose visible. Start with both hands level, then follow the left/right cue.');
            }
          } else if (nowMs - lastFreshPoseMs > POSE_DROPOUT_MS && !trackingWasResetForDropout) {
            resetSixSevenTracking(state);
            trackingWasResetForDropout = true;
            setTrackingStatus('No fresh pose. Face the camera and bring both wrists back into frame.');
          }
        }
      }

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const selectedMode = phase === 'playing' || phase === 'paused' || phase === 'gameover'
        ? roundRef.current.inputMode
        : inputModeRef.current;
      const showCamera = selectedMode === 'camera' && cameraStatus === 'active';
      const visibleVideo = showCamera ? videoRef.current : null;
      drawSixSevenVideo(ctx, visibleVideo, width, height);
      drawSixSevenStage(
        ctx,
        width,
        height,
        nowMs,
        state.nextNumber,
        reducedMotion,
        visibleVideo,
        floatingHitsRef.current
      );
      ctx.restore();
      syncHudDom(state, roundRef.current.remainingSec);
    };

    rafId = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(rafId);
  }, [audioRef, cameraStatus, canvasRef, handleHit, phase, poseModelStatus, predictPose, recordScoreboardRound, reducedMotion, setPhase, setTrackingStatus, sizeRef, syncHudDom, videoRef]);

  const handleInputMode = (nextMode: InputMode) => {
    inputModeRef.current = nextMode;
    setInputMode(nextMode);
    resetSixSevenTracking(gameStateRef.current);
    setTrackingStatus(nextMode === 'camera'
      ? 'Camera selected. Enable camera and body tracking when ready.'
      : 'Practice ready: A / ← for left, D / → for right.');
  };

  const titleCameraStatus = activationBusy || cameraStatus === 'requesting'
    ? 'Waiting for camera permission and loading body tracking…'
    : cameraStatus !== 'active'
      ? 'Camera permission starts when you press Enable camera.'
      : poseModelStatus === 'loading'
        ? 'Camera is on · loading body tracking…'
        : poseModelStatus === 'ready'
          ? 'Camera and body tracking are ready.'
          : poseModelStatus === 'error'
            ? 'Camera is on · body tracking needs a retry.'
            : 'Camera is on · press Load body tracking to continue.';

  const titleOverlay = (
    <div
      className="w-full max-w-xl rounded-3xl border border-cyan-400/30 bg-[#0B101B]/95 p-5 shadow-[0_0_60px_rgba(0,229,255,0.12)] sm:p-7"
      onKeyDown={(event) => {
        if (
          (event.key === 'Enter' || event.key === ' ') &&
          (event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement)
        ) event.stopPropagation();
      }}
    >
      <div className="text-center">
        <div className="mx-auto mb-3 flex w-fit items-center gap-2 rounded-full border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-[11px] font-bold tracking-[0.22em] text-cyan-200 uppercase">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          One player · 30 seconds
        </div>
        <div className="mb-2 flex items-center justify-center gap-3" aria-hidden="true">
          <span className="font-display text-6xl font-black leading-none text-cyan-300 drop-shadow-[0_0_20px_rgba(0,229,255,0.7)]">6</span>
          <span className="text-2xl font-black text-slate-500">↔</span>
          <span className="font-display text-6xl font-black leading-none text-rose-300 drop-shadow-[0_0_20px_rgba(255,42,109,0.65)]">7</span>
        </div>
        <h1 className="font-display text-3xl font-extrabold tracking-tight text-white">Six Seven</h1>
        <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-300">
          Catch the viral left-right switch: lift your left arm while lowering your right for 6, then swap for 7. Keep the rhythm going.
        </p>
      </div>

      <PlayerNameInputs
        soloMode
        p1Name={p1Name}
        p2Name={p2Name}
        onChangeP1Name={handleP1NameChange}
        onChangeP2Name={handleP2NameChange}
      />

      <div className="mt-4 grid grid-cols-2 gap-2 rounded-xl border border-slate-700/80 bg-[#070B13] p-1.5" role="group" aria-label="Choose input method">
        <button
          type="button"
          aria-pressed={inputMode === 'camera'}
          onClick={() => handleInputMode('camera')}
          className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300 ${inputMode === 'camera' ? 'bg-rose-300 text-slate-950' : 'text-slate-200 hover:bg-slate-800'}`}
        >
          <Video className="h-4 w-4" aria-hidden="true" />
          Camera
        </button>
        <button
          type="button"
          aria-pressed={inputMode === 'practice'}
          onClick={() => handleInputMode('practice')}
          className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 py-2 text-sm font-bold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${inputMode === 'practice' ? 'bg-cyan-300 text-slate-950' : 'text-slate-200 hover:bg-slate-800'}`}
        >
          <Gamepad2 className="h-4 w-4" aria-hidden="true" />
          Practice
        </button>
      </div>

      {inputMode === 'practice' ? (
        <div className="mt-3 rounded-xl border border-cyan-500/25 bg-cyan-500/5 px-3.5 py-3 text-sm text-slate-200">
          <p><strong className="text-cyan-200">Practice mode:</strong> use A / ← for left, D / → for right, or tap the arm buttons. Practice scores stay local and never enter the camera leaderboard.</p>
        </div>
      ) : (
        <div className="mt-3 rounded-xl border border-rose-500/25 bg-rose-500/5 px-3.5 py-3 text-sm text-slate-200">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="leading-5">Face the camera, keep both shoulders and wrists in frame, palms up. Start with hands level, then lift left while lowering right.</p>
            <button
              type="button"
              onClick={() => void handleCameraSetup()}
              disabled={activationBusy || cameraInputReady || cameraStatus === 'requesting' || poseModelStatus === 'loading'}
              className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-lg border border-rose-300/40 bg-rose-300/10 px-3 py-2 text-xs font-bold text-rose-100 transition-colors hover:bg-rose-300/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300 disabled:cursor-wait disabled:opacity-65"
            >
              <Camera className="h-4 w-4" aria-hidden="true" />
              {cameraInputReady ? 'Camera ready' : cameraStatus === 'active' && poseModelStatus === 'error' ? 'Retry body tracking' : cameraStatus === 'active' ? 'Load body tracking' : 'Enable camera'}
            </button>
          </div>
          <p className="mt-2 text-xs text-slate-400" data-testid="six-seven-camera-status" role="status" aria-live="polite">{titleCameraStatus}</p>
          {errorMessage && (cameraStatus !== 'active' || poseModelStatus === 'error') && <p className="mt-1 text-xs text-amber-200">{errorMessage}</p>}
          {poseModelStatus === 'error' && <p className="mt-1 text-xs text-amber-200">Body tracking did not load. Retry setup or switch to practice.</p>}
        </div>
      )}

      <div className="mt-3 rounded-xl border border-slate-700/70 bg-[#070B13] px-3.5 py-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs font-bold tracking-wider text-slate-300 uppercase">Next move</span>
          <span className="rounded-full bg-cyan-300/10 px-2.5 py-1 font-mono text-sm font-black text-cyan-200">LEFT UP · 6</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-800" aria-hidden="true">
          <div className="h-full w-1/2 rounded-full bg-gradient-to-r from-cyan-300 to-rose-300" />
        </div>
        <p className="mt-2 text-xs leading-5 text-slate-400">Then switch: right up / left down. Your 30-second round starts when you press Start.</p>
      </div>

      <button
        type="button"
        data-start="true"
        disabled={inputMode === 'camera' && !cameraInputReady}
        onClick={() => startNewRound(inputMode)}
        className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-cyan-300 px-5 py-3 text-sm font-extrabold text-slate-950 shadow-[0_0_24px_rgba(0,229,255,0.22)] transition-colors hover:bg-cyan-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 disabled:shadow-none"
      >
        <Play className="h-4 w-4 fill-current" aria-hidden="true" />
        Start 30s {inputMode === 'camera' ? 'Camera' : 'Practice'} Round
      </button>
      <p className="mt-3 text-center text-[11px] text-slate-500">Camera-only leaderboard · practice scores are not submitted.</p>
    </div>
  );

  const bottomControls = phase === 'playing' && inputMode === 'practice' ? (
    <div className="pointer-events-auto fixed inset-x-2 bottom-2 z-20 mx-auto max-w-lg rounded-2xl border border-slate-700/80 bg-[#0D121E]/95 p-2.5 shadow-xl backdrop-blur-sm">
      <p className="mb-2 text-center text-[11px] font-semibold text-slate-300" data-testid="six-seven-tracking-status" aria-live="polite">{trackingMessage}</p>
      <div className="grid grid-cols-2 gap-2" role="group" aria-label="Practice arm controls">
        <button
          type="button"
          aria-label="Raise the left arm, lower the right arm. Keyboard shortcut A or left arrow."
          onClick={() => handlePracticeAction('left')}
          className={`min-h-12 rounded-xl border px-3 py-2 text-sm font-extrabold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-300 ${nextNumber === 6 ? 'border-cyan-300/70 bg-cyan-300/20 text-cyan-100' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-cyan-300/50'}`}
        >
          Raise left · A / ←
        </button>
        <button
          type="button"
          aria-label="Raise the right arm, lower the left arm. Keyboard shortcut D or right arrow."
          onClick={() => handlePracticeAction('right')}
          className={`min-h-12 rounded-xl border px-3 py-2 text-sm font-extrabold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-rose-300 ${nextNumber === 7 ? 'border-rose-300/70 bg-rose-300/20 text-rose-100' : 'border-slate-700 bg-slate-900 text-slate-300 hover:border-rose-300/50'}`}
        >
          Raise right · D / →
        </button>
      </div>
      <p className="mt-1.5 text-center text-[10px] font-mono tracking-wide text-slate-500">P pauses · M mutes · R restarts</p>
    </div>
  ) : phase === 'playing' ? (
    <div className="pointer-events-none fixed inset-x-3 bottom-2 z-20 mx-auto max-w-xl rounded-xl border border-slate-700/80 bg-[#0D121E]/90 px-3.5 py-2 text-center shadow-lg backdrop-blur-sm">
      <p className="text-xs font-bold text-white" data-testid="six-seven-tracking-status" role="status" aria-live="polite">{trackingMessage}</p>
      <p className="mt-1 text-[11px] text-slate-300">Both shoulders + wrists in frame · start hands level · follow the cue</p>
    </div>
  ) : null;

  const endOverlay = endSummary ? (
    <ArcadeEndCard
      winnerTitle={endSummary.cameraRound ? `${resolvedP1Name} · Camera Run Complete` : 'Practice Run Complete'}
      mode="solo"
      topSlot={
        <div className={`mt-3 rounded-lg border px-3 py-2 text-xs leading-5 ${endSummary.cameraRound ? 'border-rose-400/30 bg-rose-500/5 text-rose-100' : 'border-cyan-400/30 bg-cyan-500/5 text-cyan-100'}`}>
          {endSummary.cameraRound
            ? 'Webcam score saved to the camera leaderboard. Practice runs do not appear there.'
            : 'Local practice score only. This run was not saved to the camera leaderboard.'}
        </div>
      }
      p1={{ name: resolvedP1Name, score: endSummary.score, metrics: ['30s switch round', endSummary.cameraRound ? 'Camera input' : 'Practice input'] }}
      scoreboard={scoreboard}
      highlightIds={newEntryIds}
      onClearScoreboard={handleClearScoreboard}
      replayLabel="Play another 30s round"
      onReplay={handleReplay}
    />
  ) : null;

  return (
    <ArcadeGameShell
      phase={phase}
      isMuted={isMuted}
      initialDurationSec={ROUND_SECONDS}
      soloMode
      hideTugBar
      p1Label={resolvedP1Name}
      canvasTestId="six-seven-canvas"
      canvasRef={canvasRef}
      sizeRef={sizeRef}
      hudHandleRef={hudHandleRef}
      onStart={() => startNewRound()}
      onTogglePause={togglePause}
      onToggleMute={toggleMute}
      onRestart={() => startNewRound(roundRef.current.inputMode)}
      titleOverlay={titleOverlay}
      endOverlay={endOverlay}
      pauseSubtitle="The 30-second timer is frozen. Reset your hands, then resume when you’re ready."
      bottomControls={bottomControls}
    />
  );
}
