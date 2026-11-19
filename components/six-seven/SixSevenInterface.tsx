'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeft, ArrowRight, Camera, Check, Download, Gamepad2, Play,
  RotateCcw, Sparkles, Video, Volume2, VolumeX, X,
} from 'lucide-react';
import type { SixSevenClip } from '@/lib/games/six-seven/replay';
import styles from './six-seven.module.css';

export type SixSevenInputMode = 'camera' | 'practice';
export type SixSevenInterfacePhase = 'title' | 'playing' | 'paused' | 'gameover';
export type SixSevenTracking = 'off' | 'looking' | 'ready' | 'lost';

function clipFileExtension(mimeType: string): string {
  if (mimeType.toLowerCase().includes('mp4')) return 'mp4';
  if (mimeType.toLowerCase().includes('webm')) return 'webm';
  return '';
}

function SavedClipVideo({ clip, dateLabel }: { clip: SixSevenClip; dateLabel: string }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const downloadRef = useRef<HTMLAnchorElement | null>(null);
  const extension = clipFileExtension(clip.blob.type);

  useEffect(() => {
    const url = URL.createObjectURL(clip.blob);
    const video = videoRef.current;
    const downloadLink = downloadRef.current;
    if (video) video.src = url;
    if (downloadLink) downloadLink.href = url;
    return () => {
      URL.revokeObjectURL(url);
      if (video) {
        video.pause();
        video.removeAttribute('src');
        video.load();
      }
      if (downloadLink) downloadLink.removeAttribute('href');
    };
  }, [clip.blob]);

  return (
    <>
      <video
        ref={videoRef}
        className={styles.clipVideo}
        controls
        playsInline
        preload="metadata"
        aria-label={'Saved Six Seven run, score ' + clip.score}
      />
      <a
        ref={downloadRef}
        className={styles.downloadButton}
        download={'six-seven-' + clip.score + '-' + dateLabel + (extension ? '.' + extension : '')}
      >
        <Download size={14} aria-hidden="true" /> Download clip
      </a>
    </>
  );
}

export interface SixSevenInterfaceProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  score: number;
  remainingSec: number;
  roundSeconds: number;
  tracking: SixSevenTracking;
  trackingMessage: string;
  countdown: number | null;
  phase: SixSevenInterfacePhase;
  inputMode: SixSevenInputMode;
  cameraReady: boolean;
  cameraBusy: boolean;
  cameraError: string | null;
  clipEnabled: boolean;
  clipSupported: boolean;
  recording: boolean;
  clipStatus: string;
  clips: SixSevenClip[];
  bestScore: number;
  playerName: string;
  muted: boolean;
  onInputMode: (mode: SixSevenInputMode) => void;
  onCameraSetup: () => void | Promise<void>;
  onStart: () => void;
  onPause: () => void;
  onRestart: () => void;
  onBackToSetup: () => void;
  onMute: () => void;
  onPractice: (side: 'left' | 'right') => void;
  onClipEnabled: (enabled: boolean) => void;
  onRemoveClip: (id: string) => void;
  onPlayerNameChange: (name: string) => void;
  leaderboard?: React.ReactNode;
}

function formatClock(seconds: number): string {
  const safeSeconds = Math.max(0, Math.ceil(seconds));
  return String(Math.floor(safeSeconds / 60)).padStart(1, '0') + ':' + String(safeSeconds % 60).padStart(2, '0');
}

function formatClipDuration(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  return Math.floor(safeSeconds / 60) + ':' + String(safeSeconds % 60).padStart(2, '0');
}

function formatClipDate(value: string | number | Date): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Saved run';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date);
}

function trackingLabel(tracking: SixSevenTracking, mode: SixSevenInputMode): string {
  if (mode === 'practice') return 'PRACTICE BAY';
  if (tracking === 'ready') return 'WRIST TRACKING READY';
  if (tracking === 'looking') return 'FINDING WRISTS';
  if (tracking === 'lost') return 'WRIST SIGNAL LOST';
  return 'WRIST TRACKING OFF';
}

/**
 * Six Seven's full setup, live round, result and private clips presentation.
 * The canvas stays mounted in one stable viewport so the game loop can keep
 * drawing through phase changes and size itself from the viewport parent.
 */
export function SixSevenInterface({
  canvasRef, score, remainingSec, roundSeconds, tracking, trackingMessage,
  countdown, phase, inputMode, cameraReady, cameraBusy, cameraError, clipEnabled,
  clipSupported, recording, clipStatus, clips, bestScore, playerName, muted,
  onInputMode, onCameraSetup, onStart, onPause, onRestart, onBackToSetup, onMute,
  onPractice, onClipEnabled, onRemoveClip, onPlayerNameChange, leaderboard,
}: SixSevenInterfaceProps) {
  const [clipsOpen, setClipsOpen] = useState(false);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const clipsDialogRef = useRef<HTMLElement | null>(null);
  const previouslyFocusedRef = useRef<HTMLElement | null>(null);
  const orderedClips = useMemo(
    () => [...clips].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()),
    [clips]
  );
  const cameraCanStart = cameraReady && tracking === 'ready' && !cameraBusy;
  const startDisabled = inputMode === 'camera' && !cameraCanStart;
  const needsCameraReconnect = phase === 'paused' && inputMode === 'camera' && !cameraReady;
  const displayClipStatus = clipStatus === 'Clip recording is off.' ? '' : clipStatus;
  const showLiveClipStatus = clipEnabled && !recording && (phase === 'playing' || phase === 'paused') &&
    /^(Could not|Recording stopped|Video recording|No video|The clip)/.test(displayClipStatus);

  useEffect(() => {
    if (!clipsOpen) return;
    const closeButton = clipsDialogRef.current?.querySelector<HTMLButtonElement>('[data-close-clips]');
    closeButton?.focus();
    return () => {
      const trigger = previouslyFocusedRef.current;
      if (trigger?.isConnected) trigger.focus();
      previouslyFocusedRef.current = null;
    };
  }, [clipsOpen]);

  const openClips = (event: React.MouseEvent<HTMLButtonElement>) => {
    previouslyFocusedRef.current = event.currentTarget;
    setClipsOpen(true);
  };
  const closeClips = () => setClipsOpen(false);
  const startLabel = 'Start ' + roundSeconds + 's ' + (inputMode === 'camera' ? 'camera' : 'practice') + ' run';
  const trackingText = trackingMessage || 'Lift a wrist to pop its lane, then lower it before the next pop.';
  const clipLibraryLabel = clips.length > 0 ? 'Clips (' + clips.length + ')' : 'Clips';

  return (
    <main className={styles.interface}>
      <div ref={shellRef} className={styles.shell} inert={clipsOpen}>
        <header className={styles.header}>
          <div className={styles.headerLeft}>
            <Link className={styles.hubLink} href="/" aria-label="Back to Hub">
              <ArrowLeft size={16} aria-hidden="true" /><span>Back to Hub</span>
            </Link>
            <div className={styles.brand}>
              <div className={styles.brandMark} aria-hidden="true"><span>6</span><i>↔</i><span>7</span></div>
              <div>
                <h1 className={styles.brandTitle}>SIX SEVEN <span>ARCADE</span></h1>
              </div>
            </div>
          </div>
          <div className={styles.headerActions}>
            {phase !== 'title' && (
              <button className={styles.secondaryButton + ' ' + styles.setupButton} type="button" onClick={onBackToSetup}>
                <ArrowLeft size={15} aria-hidden="true" /><span>Setup</span>
              </button>
            )}
            {(phase === 'title' || phase === 'gameover') && (
              <button className={styles.secondaryButton} type="button" onClick={openClips}>
                <Video size={16} aria-hidden="true" /><span>{clipLibraryLabel}</span>
              </button>
            )}
            <button className={styles.iconButton} type="button" aria-label={muted ? 'Turn sound on' : 'Mute sound'} onClick={onMute}>
              {muted ? <VolumeX size={17} aria-hidden="true" /> : <Volume2 size={17} aria-hidden="true" />}
            </button>
          </div>
        </header>

        <div className={styles.topRule} />

        <div className={styles.layout} data-phase={phase} data-input-mode={inputMode}>
          <section className={styles.arenaColumn} aria-label="Six Seven game stage">
            <div className={styles.stageHeader}>
              <div className={styles.stageHeading}>
                <span className={styles.liveDot} data-live={phase === 'playing' && countdown === null ? 'true' : 'false'} />
                <span>{phase === 'title' ? 'READY ROOM' : phase === 'gameover' ? 'ROUND REPORT' : phase === 'paused' ? 'ROUND PAUSED' : 'LIVE ROUND'}</span>
              </div>
              <div className={styles.stageTools}>
                <span className={styles.modeBadge + ' ' + (inputMode === 'camera' ? styles.cameraBadge : styles.practiceBadge)}>
                  {inputMode === 'camera' ? <Camera size={12} aria-hidden="true" /> : <Gamepad2 size={12} aria-hidden="true" />}
                  {inputMode === 'camera' ? 'CAMERA' : 'PRACTICE'}
                </span>
                {phase === 'playing' && <button className={styles.pauseButton} type="button" onClick={onPause} aria-label="Pause round">Pause <span>Ⅱ</span></button>}
              </div>
            </div>

            <div className={styles.stageCard}>
              {phase !== 'title' && countdown === null && (
                <div className={styles.mobileHud} role="group" aria-label="Round score and time">
                  <div><small>TIME</small><strong data-low={remainingSec <= 8 && phase === 'playing' ? 'true' : 'false'}>{formatClock(remainingSec)}</strong></div>
                  <span className={styles.mobileHudDivider} />
                  <div><small>HITS</small><strong key={score} className={score > 0 ? styles.popScore : undefined}>{score}</strong></div>
                  <span className={styles.mobileHudLanes} aria-label="6 in the left lane, 7 in the right lane">
                    <span data-lane="left"><small>LEFT</small><strong>6</strong></span>
                    <span data-lane="right"><small>RIGHT</small><strong>7</strong></span>
                  </span>
                </div>
              )}
              <div className={styles.canvasViewport}>
                <canvas ref={canvasRef} className={styles.canvas} data-testid="six-seven-canvas" aria-label="Six Seven live game canvas" />
                <div className={styles.canvasTopLine + (recording ? ' ' + styles.canvasTopLineRecording : '')}>
                  <span className={styles.feedTag} aria-hidden="true"><span className={styles.feedDot} />{inputMode === 'camera' ? (cameraReady ? 'CAMERA FEED' : 'CAMERA IDLE') : 'NO CAMERA NEEDED'}</span>
                  <span className={styles.stageTag} aria-hidden="true">{trackingLabel(tracking, inputMode)}</span>
                  {recording && <span className={styles.recordingTag} role="status"><span className={styles.recordingDot} />SAVING CLIP</span>}
                </div>
                {phase === 'title' && !(inputMode === 'camera' && cameraReady) && (
                  <div className={styles.stageGuide} aria-label="Six Seven movement guide">
                    <div className={styles.guideMove} data-lane="left">
                      <strong>6</strong>
                      <span><small>LEFT WRIST</small><b>↑↓</b></span>
                    </div>
                    <span className={styles.guideSwitch} aria-hidden="true">↔</span>
                    <div className={styles.guideMove} data-lane="right">
                      <strong>7</strong>
                      <span><small>RIGHT WRIST</small><b>↑↓</b></span>
                    </div>
                    <p>{inputMode === 'practice' ? 'Left = 6 · Right = 7 · Tap for +1' : 'Lift a wrist for +1, then lower it to reset.'}</p>
                  </div>
                )}
                {phase === 'playing' && countdown !== null && (
                  <div className={styles.countdownLayer} aria-live="assertive">
                    <span>{countdown === 0 ? 'GO' : countdown}</span><small>GET SET</small>
                  </div>
                )}
                {phase === 'playing' && countdown === null && inputMode === 'camera' && tracking === 'lost' && (
                  <div className={styles.lostSignal} role="status"><span />{trackingText}</div>
                )}
                {showLiveClipStatus && <div className={styles.clipLiveStatus} role="status">{displayClipStatus}</div>}
                {phase === 'paused' && (
                  <div className={styles.phaseOverlay}>
                    <h2>Paused</h2>
                    <p>{needsCameraReconnect ? (cameraError || 'Camera disconnected. Return to setup to reconnect before resuming.') : 'Your run is still here. Pick up where you left off.'}</p>
                    {needsCameraReconnect ? (
                      <button className={styles.primaryButton} type="button" onClick={onBackToSetup}><Camera size={16} aria-hidden="true" /> Setup camera</button>
                    ) : (
                      <button className={styles.primaryButton} type="button" onClick={onPause}><Play size={16} fill="currentColor" aria-hidden="true" /> Resume round</button>
                    )}
                  </div>
                )}
                {phase === 'gameover' && (
                  <div className={styles.phaseOverlay + ' ' + styles.resultOverlay}>
                    <span className={styles.overlayEyebrow}>TIME</span>
                    <h2>{inputMode === 'practice' ? 'Practice complete' : 'Round complete'}</h2>
                    <div className={styles.resultScore}>{score}<small>HITS</small></div>
                    <p>{inputMode === 'practice' ? 'Practice score · local only.' : 'Camera round complete.'}</p>
                    {inputMode === 'camera' && <div className={styles.resultBest}>CAMERA BEST <strong>{bestScore}</strong></div>}
                    <div className={styles.resultActions}>
                      <button className={styles.primaryButton} type="button" onClick={onRestart}><RotateCcw size={15} aria-hidden="true" /> Run it back</button>
                      <button className={styles.ghostButton} type="button" onClick={openClips}><Video size={15} aria-hidden="true" /> Browse clips</button>
                    </div>
                    {displayClipStatus && <p className={styles.resultClipStatus} role="status">{recording && <span className={styles.recordingDot} />}{displayClipStatus}</p>}
                  </div>
                )}
              </div>
              <div className={styles.stageFooter}>
                <span className={styles.stageFooterStatus}><span className={styles.smallStatusDot} data-state={tracking} />{phase === 'playing' ? trackingText : phase === 'paused' ? 'Round paused' : phase === 'gameover' ? (inputMode === 'practice' ? 'Practice score · not submitted' : 'Camera round complete') : inputMode === 'camera' ? (cameraReady ? 'Camera preview is live' : 'Camera preview appears after setup') : 'Practice controls appear after start'}</span>
                <span className={styles.keyHint}>{phase === 'playing' && inputMode === 'practice' ? 'A / ← LEFT · D / → RIGHT' : '6 LEFT · 7 RIGHT'}</span>
              </div>
            </div>

            {phase === 'playing' && inputMode === 'practice' && countdown === null && (
              <div className={styles.practiceControls} role="group" aria-label="Practice arm controls">
                <button type="button" className={styles.practiceButton + ' ' + styles.leftPad} onClick={() => onPractice('left')}>
                  <ArrowLeft size={17} aria-hidden="true" /><span><strong>Tap left · 6</strong><small>A / ←</small></span>
                </button>
                <button type="button" className={styles.practiceButton + ' ' + styles.rightPad} onClick={() => onPractice('right')}>
                  <span><strong>Tap right · 7</strong><small>D / →</small></span><ArrowRight size={17} aria-hidden="true" />
                </button>
              </div>
            )}
          </section>

          {phase === 'title' && (
            <aside className={styles.infoColumn}>
              <section className={styles.setupCard} aria-labelledby="setup-title">
                <div className={styles.cardEyebrow}><Sparkles size={14} aria-hidden="true" /> QUICK SETUP <span>{roundSeconds}s ROUND</span></div>
                <h2 id="setup-title">Pick your lane.</h2>
                <div className={styles.modeSwitch} role="group" aria-label="Choose input method">
                  <button type="button" aria-pressed={inputMode === 'camera'} onClick={() => onInputMode('camera')} className={inputMode === 'camera' ? styles.modeSelected : ''}>
                    <Camera size={16} aria-hidden="true" /><span>Camera</span><small>Hands-free</small>
                  </button>
                  <button type="button" aria-pressed={inputMode === 'practice'} onClick={() => onInputMode('practice')} className={inputMode === 'practice' ? styles.modeSelected : ''}>
                    <Gamepad2 size={16} aria-hidden="true" /><span>Practice</span><small>Keyboard / tap</small>
                  </button>
                </div>

                {inputMode === 'camera' ? (
                  <div className={styles.cameraSetup}>
                    <div className={styles.cameraSetupTitle}>
                      <span className={styles.cameraStatusGlyph} data-ready={cameraCanStart ? 'true' : 'false'}>{cameraCanStart ? <Check size={15} /> : <Camera size={15} />}</span>
                      <div><strong>{cameraCanStart ? 'Wrist tracking is ready' : cameraBusy ? 'Warming up camera' : cameraReady ? 'Find a wrist' : 'Enable your camera'}</strong><small>{cameraCanStart ? 'Left wrist: 6. Right wrist: 7. Lift to score, lower to reset.' : cameraReady ? 'Show at least one wrist to the camera.' : 'Your camera stays local to this device.'}</small></div>
                    </div>
                    {!cameraReady && (
                      <button type="button" className={styles.cameraButton} disabled={cameraBusy} onClick={() => void onCameraSetup()}>
                        <Camera size={15} aria-hidden="true" />{cameraBusy ? 'Connecting…' : 'Enable camera'}
                      </button>
                    )}
                    {cameraReady && tracking !== 'ready' && <div className={styles.trackingTip} role="status">{tracking === 'lost' ? 'Move a wrist back into view.' : 'Show at least one wrist to the camera.'}</div>}
                    {cameraError && <p className={styles.errorText}>{cameraError}</p>}
                  </div>
                ) : (
                  <div className={styles.practiceSetup}>
                    <Gamepad2 size={17} aria-hidden="true" />
                    <p>Left pad or <kbd>A</kbd>/<kbd>←</kbd> pops 6. Right pad or <kbd>D</kbd>/<kbd>→</kbd> pops 7. Every tap is +1.</p>
                  </div>
                )}

                <label className={styles.nameField}>
                  <span>PLAYER TAG</span>
                  <input type="text" maxLength={18} value={playerName} onChange={(event) => onPlayerNameChange(event.target.value)} placeholder="Your name" autoComplete="nickname" />
                </label>

                <div className={styles.clipSetting}>
                  <div className={styles.clipSettingCopy}><Video size={16} aria-hidden="true" /><span><strong>Save replays locally</strong><small>{clipSupported ? (clipEnabled ? 'Private clips stay on this device.' : 'Turn on to keep highlights here.') : 'Video capture is not available here.'}</small></span></div>
                  <button type="button" role="switch" aria-checked={clipEnabled} aria-label="Save replays locally" disabled={!clipSupported} onClick={() => onClipEnabled(!clipEnabled)} className={styles.switch + (clipEnabled ? ' ' + styles.switchOn : '')}><span /></button>
                </div>
                {displayClipStatus && <p className={styles.clipStatus} role="status">{recording && <span className={styles.recordingDot} />}{displayClipStatus}</p>}

                <button type="button" className={styles.startButton} disabled={startDisabled} onClick={onStart}>
                  <Play size={17} fill="currentColor" aria-hidden="true" />{startDisabled ? (cameraBusy ? 'Getting camera ready…' : 'Waiting for tracking…') : startLabel}<span>→</span>
                </button>
                <p className={styles.setupNote}>{inputMode === 'camera' ? 'Moves are processed live; no video is uploaded.' : 'Practice scores stay on this device.'}</p>
              </section>
              {leaderboard && <div className={styles.leaderboard}>{leaderboard}</div>}
            </aside>
          )}
        </div>

        {phase === 'title' && inputMode === 'camera' && (
          <footer className={styles.footer}><span>CAMERA BEST <strong>{bestScore}</strong></span></footer>
        )}
      </div>

      {clipsOpen && (
        <div className={styles.modalBackdrop} onMouseDown={(event) => { if (event.target === event.currentTarget) closeClips(); }}>
          <section ref={clipsDialogRef} className={styles.clipsDialog} role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="clips-title" onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === 'Escape') { closeClips(); return; }
            if (event.key !== 'Tab') return;
            const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), video[controls], [tabindex]:not([tabindex="-1"])'
            )).filter((element) => element.offsetParent !== null);
            if (focusable.length === 0) {
              event.preventDefault();
              event.currentTarget.focus();
              return;
            }
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) {
              event.preventDefault();
              last.focus();
            } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === event.currentTarget)) {
              event.preventDefault();
              first.focus();
            }
          }}>
            <div className={styles.dialogHeader}>
              <div><span className={styles.cardEyebrow}><Video size={14} aria-hidden="true" /> PRIVATE LIBRARY</span><h2 id="clips-title">Your clips <span>{clips.length}</span></h2></div>
              <button className={styles.dialogClose} type="button" data-close-clips aria-label="Close clips" onClick={closeClips}><X size={19} aria-hidden="true" /></button>
            </div>
            <p className={styles.dialogIntro}>Runs saved on this device. Play them back, download a copy, or clear out a take.</p>
            {displayClipStatus && <p className={styles.dialogStatus} role="status">{recording && <span className={styles.recordingDot} />}{displayClipStatus}</p>}
            {orderedClips.length > 0 ? (
              <div className={styles.clipList}>
                {orderedClips.map((clip, index) => {
                  const timestamp = new Date(clip.createdAt);
                  const downloadDay = Number.isNaN(timestamp.getTime()) ? 'run' : timestamp.toISOString().slice(0, 10);
                  return (
                    <article className={styles.clipCard} key={clip.id}>
                      <div className={styles.clipCardTop}>
                        <div><span className={styles.clipOrdinal}>{index === 0 ? 'LATEST RUN' : 'PAST RUN'}</span><strong>{formatClipDate(clip.createdAt)}</strong></div>
                        <button type="button" className={styles.removeClip} aria-label={'Remove clip from ' + formatClipDate(clip.createdAt)} onClick={() => onRemoveClip(clip.id)}><X size={15} aria-hidden="true" /></button>
                      </div>
                      <SavedClipVideo clip={clip} dateLabel={downloadDay} />
                      <div className={styles.clipMetadata}><span><strong>{clip.score}</strong> HITS</span><span>{formatClipDuration(clip.durationSeconds)} ROUND</span><span>SIX SEVEN</span></div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className={styles.emptyClips}>
                <span className={styles.emptyIcon}><Video size={21} aria-hidden="true" /></span>
                <strong>No clips yet</strong>
                <p>{clipSupported ? 'Turn on “Save replays locally” before your next round. Your replay will show up here.' : 'This browser does not support local video clips.'}</p>
              </div>
            )}
            <div className={styles.dialogFooter}><span><span className={styles.privacyDot} /> Clips are private and stored locally</span><button type="button" className={styles.doneButton} onClick={closeClips}>Done</button></div>
          </section>
        </div>
      )}
    </main>
  );
}
