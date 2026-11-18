'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ArcadePhase } from '@/components/arcade/ArcadeGameShell';
import { LeaderboardPanel } from '@/components/arcade/LeaderboardPanel';
import { SixSevenInterface } from '@/components/six-seven/SixSevenInterface';
import { useMediaPipe } from '@/contexts/MediaPipeContext';
import { useArcadeSession } from '@/hooks/useArcadeSession';
import { useSixSevenReplay } from '@/hooks/useSixSevenReplay';
import {
  createSixSevenState,
  isSixSevenPoseVisible,
  registerSixSevenPracticeHit,
  resetSixSevenTracking,
  updateSixSevenGesture,
  type SixSevenHit,
  type SixSevenLandmark,
  type SixSevenSide,
} from '@/lib/games/six-seven/engine';
import { createSixSevenPoseTracker, type SixSevenPoseTracker } from '@/lib/games/six-seven/pose-tracker';
import { SIX_SEVEN_CAPTURE_FPS } from '@/lib/games/six-seven/replay';
import { drawSixSevenClipHud, drawSixSevenStage, SIX_SEVEN_HIT_MS } from '@/lib/games/six-seven/stage';

const ROUND_SECONDS = 30;
const COUNTDOWN_MS = 3000;
const POSE_LOST_MS = 300;
const CLIP_FRAME_MS = 1000 / SIX_SEVEN_CAPTURE_FPS;
type InputMode = 'camera' | 'practice';
type Tracking = 'off' | 'looking' | 'ready' | 'lost';

interface Round {
  startsAtMs: number;
  pausedAtMs: number | null;
  displayedCountdown: number | null;
  displayedSeconds: number;
  wantsClip: boolean;
  recordingStarted: boolean;
}

const TRACKING_MESSAGES: Record<Tracking, string> = {
  off: 'Enable your camera to see your wrists on the stage.',
  looking: 'Step back until both shoulders and wrists are in the frame.',
  ready: 'Both wrists in view.',
  lost: 'Bring both shoulders and wrists back into view.',
};

function secondsRemaining(round: Round, nowMs: number) {
  const elapsedMs = Math.max(0, (round.pausedAtMs ?? nowMs) - round.startsAtMs);
  return Math.max(0, ROUND_SECONDS - elapsedMs / 1000);
}

export default function SixSevenGame() {
  const { videoRef, cameraStatus, cameraError, requestCamera } = useMediaPipe();
  const {
    canvasRef, sizeRef, audioRef, phase, setPhase, p1Name, handleP1NameChange,
    isMuted, toggleMute, scoreboard, newEntryIds, setNewEntryIds,
    recordScoreboardRound, handleClearScoreboard,
  } = useArcadeSession('six-seven', 'title', 'solo');
  const {
    clips, recording, status: clipStatus, supported: clipSupported,
    start: startClip, pause: pauseClip, resume: resumeClip, finish: finishClip, discard: discardClip, remove: removeClip,
  } = useSixSevenReplay();

  const [inputMode, setInputMode] = useState<InputMode>('camera');
  const [tracking, setTracking] = useState<Tracking>('off');
  const [modelStatus, setModelStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [clipEnabled, setClipEnabled] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [remainingSec, setRemainingSec] = useState(ROUND_SECONDS);
  const [hitDisplay, setHitDisplay] = useState<{ score: number; nextNumber: 6 | 7 }>({ score: 0, nextNumber: 6 });
  const [wrongPracticeSide, setWrongPracticeSide] = useState(false);

  const trackerRef = useRef<SixSevenPoseTracker | null>(null);
  const mountedRef = useRef(false);
  const modelSetupRef = useRef<AbortController | null>(null);
  const phaseRef = useRef<ArcadePhase>('title');
  const modeRef = useRef<InputMode>('camera');
  const roundRef = useRef<Round | null>(null);
  const gameRef = useRef(createSixSevenState());
  const trackingRef = useRef<Tracking>('off');
  const poseRef = useRef<readonly SixSevenLandmark[] | null>(null);
  const freshPoseAtRef = useRef(0);
  const poseEpochRef = useRef(0);
  const reducedMotionRef = useRef(false);
  const hitsRef = useRef<SixSevenHit[]>([]);
  const captureContextRef = useRef<CanvasRenderingContext2D | null>(null);

  const cameraReady = cameraStatus === 'active' && modelStatus === 'ready';
  const cameraBusy = cameraStatus === 'requesting' || cameraStatus === 'starting' || modelStatus === 'loading';

  const changePhase = useCallback((next: ArcadePhase) => {
    phaseRef.current = next;
    setPhase(next);
  }, [setPhase]);

  const changeTracking = useCallback((next: Tracking) => {
    if (trackingRef.current === next) return;
    trackingRef.current = next;
    setTracking(next);
  }, []);

  const resetPose = useCallback((clearPreview = false) => {
    poseEpochRef.current++;
    resetSixSevenTracking(gameRef.current);
    if (clearPreview) {
      poseRef.current = null;
      freshPoseAtRef.current = 0;
    }
  }, []);

  const initializePose = useCallback(async (preferWorker: boolean) => {
    if (!mountedRef.current || modelSetupRef.current) return;
    const scope = new AbortController();
    modelSetupRef.current = scope;
    setModelStatus('loading');
    try {
      const tracker = await createSixSevenPoseTracker(scope.signal, preferWorker);
      if (scope.signal.aborted) {
        tracker.close();
        return;
      }
      trackerRef.current = tracker;
      setModelStatus('ready');
    } catch {
      if (!scope.signal.aborted) setModelStatus('error');
    } finally {
      if (modelSetupRef.current === scope) modelSetupRef.current = null;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      modelSetupRef.current?.abort();
      modelSetupRef.current = null;
      trackerRef.current?.close();
      trackerRef.current = null;
    };
  }, []);

  const handleCameraSetup = useCallback(async () => {
    if (!(cameraStatus === 'active' || await requestCamera())) return;
    if (!trackerRef.current) await initializePose(true);
  }, [cameraStatus, initializePose, requestCamera]);

  const handleInputMode = useCallback((mode: InputMode) => {
    if (modeRef.current === mode) return;
    modeRef.current = mode;
    setInputMode(mode);
    resetPose(true);
    changeTracking(mode === 'camera' && cameraReady ? 'looking' : 'off');
  }, [cameraReady, changeTracking, resetPose]);

  const handleHit = useCallback((hit: SixSevenHit) => {
    hitsRef.current.push(hit);
    setHitDisplay({ score: gameRef.current.score, nextNumber: gameRef.current.nextNumber });
    setWrongPracticeSide(false);
    audioRef.current?.playSlice(gameRef.current.score);
  }, [audioRef]);

  const handlePractice = useCallback((side: SixSevenSide) => {
    const round = roundRef.current;
    const nowMs = performance.now();
    if (phaseRef.current !== 'playing' || modeRef.current !== 'practice' ||
        !round || nowMs < round.startsAtMs || secondsRemaining(round, nowMs) <= 0) return;
    const hit = registerSixSevenPracticeHit(gameRef.current, side, nowMs);
    if (hit) handleHit(hit);
    else setWrongPracticeSide(true);
  }, [handleHit]);

  const startRound = useCallback(() => {
    if (modeRef.current === 'camera' && (!cameraReady || trackingRef.current !== 'ready')) return;
    discardClip();
    captureContextRef.current = null;
    gameRef.current = createSixSevenState();
    resetPose();
    hitsRef.current = [];
    roundRef.current = {
      startsAtMs: performance.now() + COUNTDOWN_MS,
      pausedAtMs: null,
      displayedCountdown: COUNTDOWN_MS / 1000,
      displayedSeconds: ROUND_SECONDS,
      wantsClip: modeRef.current === 'camera' && clipEnabled && clipSupported,
      recordingStarted: false,
    };
    audioRef.current?.playCountdownTick();
    setHitDisplay({ score: 0, nextNumber: 6 });
    setRemainingSec(ROUND_SECONDS);
    setCountdown(COUNTDOWN_MS / 1000);
    setWrongPracticeSide(false);
    setNewEntryIds([]);
    changePhase('playing');
  }, [audioRef, cameraReady, changePhase, clipEnabled, clipSupported, discardClip, resetPose, setNewEntryIds]);

  const togglePause = useCallback(() => {
    const round = roundRef.current;
    if (!round) return;
    const nowMs = performance.now();
    if (phaseRef.current === 'playing' && secondsRemaining(round, nowMs) > 0) {
      round.pausedAtMs = nowMs;
      pauseClip();
      changePhase('paused');
      resetPose(true);
    } else if (phaseRef.current === 'paused' && round.pausedAtMs !== null) {
      if (modeRef.current === 'camera' && !cameraReady) return;
      round.startsAtMs += nowMs - round.pausedAtMs;
      round.pausedAtMs = null;
      if (modeRef.current === 'camera') changeTracking(cameraReady ? 'looking' : 'off');
      resetPose(true);
      resumeClip();
      changePhase('playing');
    }
  }, [cameraReady, changePhase, changeTracking, pauseClip, resetPose, resumeClip]);

  const backToSetup = useCallback(() => {
    discardClip();
    captureContextRef.current = null;
    roundRef.current = null;
    hitsRef.current = [];
    setCountdown(null);
    setRemainingSec(ROUND_SECONDS);
    setHitDisplay({ score: 0, nextNumber: 6 });
    setWrongPracticeSide(false);
    resetPose();
    changePhase('title');
  }, [changePhase, discardClip, resetPose]);

  const restartRound = useCallback(() => {
    if (modeRef.current === 'camera' && (!cameraReady || trackingRef.current !== 'ready')) backToSetup();
    else startRound();
  }, [backToSetup, cameraReady, startRound]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.hidden && phaseRef.current === 'playing') togglePause();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [togglePause]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.repeat || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
      if (document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')) return;
      const target = event.target;
      if (target instanceof HTMLElement &&
          (target.isContentEditable || target.closest('input, textarea, select, video'))) return;

      const key = event.key.toLowerCase();
      if ((key === 'enter' || key === ' ') && target instanceof HTMLElement &&
          target.closest('button, a, summary')) return;
      const currentPhase = phaseRef.current;
      if (key === 'm') toggleMute();
      else if ((key === 'p' || key === 'escape') && (currentPhase === 'playing' || currentPhase === 'paused')) togglePause();
      else if (key === 'r' && currentPhase !== 'title') restartRound();
      else if ((key === 'enter' || key === ' ') && currentPhase === 'title') startRound();
      else if ((key === 'a' || key === 'arrowleft') && currentPhase === 'playing' && modeRef.current === 'practice') handlePractice('left');
      else if ((key === 'd' || key === 'arrowright') && currentPhase === 'playing' && modeRef.current === 'practice') handlePractice('right');
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handlePractice, restartRound, startRound, toggleMute, togglePause]);

  useEffect(() => {
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => { reducedMotionRef.current = reducedMotion.matches; };
    update();
    reducedMotion.addEventListener('change', update);
    return () => reducedMotion.removeEventListener('change', update);
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    const tracker = trackerRef.current;
    if (!video || !tracker || !cameraReady || inputMode !== 'camera') return;

    let cancelled = false;
    let inFlight = false;
    let frameId = 0;
    let lastVideoTime = -1;
    const useVideoFrames = typeof video.requestVideoFrameCallback === 'function';
    const schedule = () => {
      frameId = useVideoFrames
        ? video.requestVideoFrameCallback(sampleFrame)
        : requestAnimationFrame(sampleFrame);
    };

    const sampleFrame = (nowMs: number) => {
      schedule();
      const currentPhase = phaseRef.current;
      if (cancelled || document.hidden || (currentPhase !== 'title' && currentPhase !== 'playing') ||
          inFlight || video.readyState < 2 || (!useVideoFrames && video.currentTime === lastVideoTime)) return;

      lastVideoTime = video.currentTime;
      inFlight = true;
      const epoch = poseEpochRef.current;
      void tracker.sample(video, nowMs).then((pose) => {
        if (cancelled || epoch !== poseEpochRef.current || document.hidden) return;
        if (!pose || !isSixSevenPoseVisible(pose)) {
          poseRef.current = null;
          if (performance.now() - freshPoseAtRef.current > POSE_LOST_MS && trackingRef.current === 'ready') {
            changeTracking('lost');
          }
          if (phaseRef.current === 'playing') updateSixSevenGesture(gameRef.current, null, nowMs);
          return;
        }

        poseRef.current = pose;
        freshPoseAtRef.current = nowMs;
        changeTracking('ready');
        const round = roundRef.current;
        const receivedAtMs = performance.now();
        if (phaseRef.current !== 'playing' || !round || receivedAtMs - nowMs > POSE_LOST_MS ||
            secondsRemaining(round, receivedAtMs) <= 0) return;
        const hit = updateSixSevenGesture(gameRef.current, pose, nowMs, nowMs >= round.startsAtMs);
        if (hit) handleHit({ ...hit, atMs: receivedAtMs });
      }).catch(() => {
        if (cancelled || trackerRef.current !== tracker) return;
        tracker.close();
        trackerRef.current = null;
        resetPose(true);
        changeTracking('lost');
        if (tracker.background) void initializePose(false);
        else setModelStatus('error');
      }).finally(() => { inFlight = false; });
    };

    changeTracking('looking');
    schedule();
    return () => {
      cancelled = true;
      if (useVideoFrames) video.cancelVideoFrameCallback(frameId);
      else cancelAnimationFrame(frameId);
    };
  }, [cameraReady, changeTracking, handleHit, initializePose, inputMode, resetPose, videoRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { alpha: false });
    if (!canvas || !ctx) return;

    const resize = () => {
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      sizeRef.current = { width, height };
      needsDraw = true;
    };

    let needsDraw = true;
    let frameId = 0;
    let lastVideoTime = -1;
    let lastPose: readonly SixSevenLandmark[] | null = null;
    let previousHadHits = false;
    let lastClipFrameMs = 0;
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();

    const draw = (nowMs: number) => {
      frameId = requestAnimationFrame(draw);
      const { width, height } = sizeRef.current;
      const round = roundRef.current;
      const game = gameRef.current;
      if (phaseRef.current === 'playing' && modeRef.current === 'camera' && cameraStatus !== 'active') {
        togglePause();
      }
      const active = phaseRef.current === 'playing' && round;
      const showingCamera = modeRef.current === 'camera' && cameraStatus === 'active';
      const video = showingCamera ? videoRef.current : null;
      if (showingCamera && trackingRef.current === 'ready' &&
          (phaseRef.current === 'title' || active) && nowMs - freshPoseAtRef.current > POSE_LOST_MS) {
        resetPose(true);
        changeTracking('lost');
      } else if (!showingCamera && modeRef.current === 'camera' && trackingRef.current !== 'off') {
        resetPose(true);
        changeTracking('off');
      }

      const pose = showingCamera ? poseRef.current : null;
      const frame = { video, pose, hits: hitsRef.current, nowMs, nextNumber: game.nextNumber, reducedMotion: reducedMotionRef.current };
      while (frame.hits[0] && nowMs - frame.hits[0].atMs >= SIX_SEVEN_HIT_MS) frame.hits.shift();

      if (active) {
        const left = secondsRemaining(round, nowMs);
        const displaySeconds = Math.ceil(left);
        const count = nowMs < round.startsAtMs ? Math.ceil((round.startsAtMs - nowMs) / 1000) : null;
        if (round.displayedCountdown !== count) {
          round.displayedCountdown = count;
          setCountdown(count);
          audioRef.current?.playCountdownTick();
        }
        if (round.displayedSeconds !== displaySeconds) {
          round.displayedSeconds = displaySeconds;
          setRemainingSec(displaySeconds);
        }

        if (count === null && round.wantsClip && !round.recordingStarted && video) {
          round.recordingStarted = true;
          const capture = document.createElement('canvas');
          capture.width = 640;
          capture.height = 412;
          captureContextRef.current = capture.getContext('2d', { alpha: false });
          lastClipFrameMs = -Infinity;
        }

        const captureCtx = captureContextRef.current;
        if (captureCtx && (nowMs - lastClipFrameMs >= CLIP_FRAME_MS || left === 0)) {
          const { width: clipWidth, height: clipHeight } = captureCtx.canvas;
          captureCtx.save();
          captureCtx.translate(0, 52);
          drawSixSevenStage(captureCtx, clipWidth, clipHeight - 52, frame);
          captureCtx.restore();
          drawSixSevenClipHud(captureCtx, clipWidth, clipHeight, game.score, left, ROUND_SECONDS);
          if (lastClipFrameMs === -Infinity) {
            if (!startClip(captureCtx.canvas)) captureContextRef.current = null;
            lastClipFrameMs = nowMs;
          } else {
            lastClipFrameMs = nowMs - (nowMs - lastClipFrameMs) % CLIP_FRAME_MS;
          }
        }

        if (left === 0) {
          captureContextRef.current = null;
          if (round.recordingStarted) finishClip(game.score, ROUND_SECONDS);
          if (modeRef.current === 'camera') {
            recordScoreboardRound('solo', { score: game.score, detail: '30s camera round' });
          }
          changePhase('gameover');
          audioRef.current?.playRoundEnd();
        }
      }

      const videoTime = video?.currentTime ?? -1;
      if (needsDraw || videoTime !== lastVideoTime || pose !== lastPose || frame.hits.length || previousHadHits) {
        const dpr = canvas.width / width;
        ctx.setTransform(dpr, 0, 0, canvas.height / height, 0, 0);
        drawSixSevenStage(ctx, width, height, frame);
        needsDraw = false;
        lastVideoTime = videoTime;
        lastPose = pose;
        previousHadHits = frame.hits.length > 0;
      }
    };
    frameId = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [audioRef, cameraStatus, canvasRef, changePhase, changeTracking, finishClip, recordScoreboardRound, resetPose, sizeRef, startClip, togglePause, videoRef]);

  const trackingMessage = inputMode === 'practice'
    ? wrongPracticeSide ? 'Follow the highlighted side.' : 'Alternate left and right.'
    : TRACKING_MESSAGES[tracking];

  return (
    <SixSevenInterface
      canvasRef={canvasRef}
      roundSeconds={ROUND_SECONDS}
      phase={phase}
      inputMode={inputMode}
      cameraReady={cameraReady}
      cameraBusy={cameraBusy}
      cameraError={cameraError ?? (modelStatus === 'error' ? 'Body tracking could not load. Try the camera again.' : null)}
      tracking={tracking}
      trackingMessage={trackingMessage}
      countdown={countdown}
      score={hitDisplay.score}
      nextNumber={hitDisplay.nextNumber}
      remainingSec={remainingSec}
      bestScore={scoreboard[0]?.score ?? 0}
      playerName={p1Name}
      muted={isMuted}
      clipEnabled={clipEnabled}
      clipSupported={clipSupported}
      clipStatus={phase === 'gameover' && (inputMode === 'practice' || !clipEnabled) ? '' : clipStatus}
      clips={clips}
      recording={recording}
      onInputMode={handleInputMode}
      onCameraSetup={handleCameraSetup}
      onStart={startRound}
      onPause={togglePause}
      onRestart={restartRound}
      onBackToSetup={backToSetup}
      onMute={toggleMute}
      onPractice={handlePractice}
      onClipEnabled={setClipEnabled}
      onRemoveClip={removeClip}
      onPlayerNameChange={handleP1NameChange}
      leaderboard={<LeaderboardPanel entries={scoreboard} highlightIds={newEntryIds} onClear={handleClearScoreboard} />}
    />
  );
}
