'use client';

import React, { useEffect, useRef } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import {
  Camera,
  Lock,
  Play,
  Swords,
} from 'lucide-react';
import { useMediaPipe } from '@/contexts/MediaPipeContext';
import {
  getPlayerSideForX,
  INDEX_FINGERTIP_LANDMARK,
  projectLandmarkToCanvas,
} from '@/lib/games/neon-slash/engine';

export default function ArcadeHub() {
  const {
    videoRef,
    cameraStatus,
    modelStatus,
    errorMessage,
    requestCamera,
    predict,
  } = useMediaPipe();

  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pointerPosRef = useRef<{ x: number; y: number; active: boolean }>({
    x: 0,
    y: 0,
    active: false,
  });

  // Live 60FPS calibration preview canvas in Hero right column
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let rafId = 0;

    const renderPreview = (now: number) => {
      rafId = requestAnimationFrame(renderPreview);
      const rect = canvas.getBoundingClientRect();
      const width = Math.max(300, Math.floor(rect.width));
      const height = Math.max(200, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);

      if (canvas.width !== Math.floor(width * dpr) || canvas.height !== Math.floor(height * dpr)) {
        canvas.width = Math.floor(width * dpr);
        canvas.height = Math.floor(height * dpr);
      }

      ctx.save();
      ctx.scale(dpr, dpr);

      ctx.fillStyle = '#090D16';
      ctx.fillRect(0, 0, width, height);

      const video = videoRef.current;
      if (video && video.readyState >= 2 && video.videoWidth > 0) {
        ctx.save();
        ctx.globalAlpha = 0.52;
        ctx.translate(width, 0);
        ctx.scale(-1, 1);
        const videoAspect = video.videoWidth / video.videoHeight;
        const canvasAspect = width / height;
        let drawW = width;
        let drawH = height;
        let drawX = 0;
        let drawY = 0;
        if (canvasAspect > videoAspect) {
          drawH = width / videoAspect;
          drawY = (height - drawH) * 0.5;
        } else {
          drawW = height * videoAspect;
          drawX = (width - drawW) * 0.5;
        }
        ctx.drawImage(video, drawX, drawY, drawW, drawH);
        ctx.restore();
      } else {
        // Subtle neon calibration grid when webcam isn't active
        ctx.strokeStyle = 'rgba(148, 163, 184, 0.08)';
        ctx.lineWidth = 1;
        for (let gx = 0; gx <= width; gx += 48) {
          ctx.beginPath();
          ctx.moveTo(gx, 0);
          ctx.lineTo(gx, height);
          ctx.stroke();
        }
        for (let gy = 0; gy <= height; gy += 48) {
          ctx.beginPath();
          ctx.moveTo(0, gy);
          ctx.lineTo(width, gy);
          ctx.stroke();
        }

        // Ambient floating calibration targets
        const t = now * 0.0014;
        const p1x = width * 0.25 + Math.cos(t) * 28;
        const p1y = height * 0.5 + Math.sin(t * 1.4) * 22;
        ctx.save();
        ctx.strokeStyle = '#00E5FF';
        ctx.fillStyle = 'rgba(0, 229, 255, 0.16)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p1x, p1y - 18);
        ctx.lineTo(p1x + 15, p1y);
        ctx.lineTo(p1x, p1y + 18);
        ctx.lineTo(p1x - 15, p1y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();

        const p2x = width * 0.75 + Math.sin(t * 1.1) * 28;
        const p2y = height * 0.5 + Math.cos(t * 1.3) * 22;
        ctx.save();
        ctx.strokeStyle = '#FF2A6D';
        ctx.fillStyle = 'rgba(255, 42, 109, 0.16)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(p2x, p2y - 18);
        ctx.lineTo(p2x + 15, p2y);
        ctx.lineTo(p2x, p2y + 18);
        ctx.lineTo(p2x - 15, p2y);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // Split arena vertical divider
      ctx.save();
      ctx.strokeStyle = 'rgba(226, 232, 240, 0.24)';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(width * 0.5, 0);
      ctx.lineTo(width * 0.5, height);
      ctx.stroke();
      ctx.restore();

      // Zone labels
      ctx.font = '700 11px "JetBrains Mono", monospace';
      ctx.fillStyle = 'rgba(0, 229, 255, 0.85)';
      ctx.textAlign = 'left';
      ctx.fillText('P1 · CYAN HALF', 14, 24);

      ctx.fillStyle = 'rgba(255, 42, 109, 0.85)';
      ctx.textAlign = 'right';
      ctx.fillText('P2 · CRIMSON HALF', width - 14, 24);

      // Draw live MediaPipe fingertips if active
      const result = predict(now);
      if (result && result.landmarks.length > 0) {
        result.landmarks.forEach((hand) => {
          const tip = hand[INDEX_FINGERTIP_LANDMARK];
          if (!tip) return;
          const { x, y } = projectLandmarkToCanvas(tip, width, height, true);
          const side = getPlayerSideForX(x, width);
          const color = side === 'p1' ? '#00E5FF' : '#FF2A6D';

          ctx.save();
          ctx.strokeStyle = color;
          ctx.shadowColor = color;
          ctx.shadowBlur = 14;
          ctx.lineWidth = 2.5;
          ctx.beginPath();
          ctx.arc(x, y, 11, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = '#FFFFFF';
          ctx.beginPath();
          ctx.arc(x, y, 4, 0, Math.PI * 2);
          ctx.fill();
          ctx.restore();
        });
      } else if (pointerPosRef.current.active) {
        const { x, y } = pointerPosRef.current;
        const side = getPlayerSideForX(x, width);
        const color = side === 'p1' ? '#00E5FF' : '#FF2A6D';
        ctx.save();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, 10, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      ctx.restore();
    };

    rafId = requestAnimationFrame(renderPreview);
    return () => cancelAnimationFrame(rafId);
  }, [predict, videoRef]);

  const handlePreviewMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    pointerPosRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      active: true,
    };
  };

  const handlePreviewLeave = () => {
    pointerPosRef.current.active = false;
  };

  const statusText =
    cameraStatus === 'active'
      ? modelStatus === 'ready'
        ? 'Camera Active · 4-Hand Tracking Ready'
        : modelStatus === 'loading'
        ? 'Camera Active · Loading Hand Model...'
        : 'Camera Active'
      : cameraStatus === 'requesting'
      ? 'Requesting Camera Permission...'
      : cameraStatus === 'denied'
      ? 'Camera Blocked · Pointer Mode Ready'
      : 'Pointer Mode Ready · Connect Webcam Anytime';

  return (
    <div className="min-h-screen bg-[#07090F] text-slate-100">
      {/* Minimal Top Bar */}
      <header className="border-b border-slate-800/80 bg-[#07090F]/95">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-6 px-6 py-3.5">
          <Link
            href="/"
            className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap shrink-0"
          >
            Webcam Party Arcade
          </Link>

          <button
            type="button"
            onClick={() => void requestCamera()}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-700 bg-[#0E131E] px-3.5 py-2 text-xs font-semibold text-slate-200 transition-colors hover:border-cyan-400/60 hover:text-white whitespace-nowrap shrink-0"
          >
            <Camera className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
            <span>{cameraStatus === 'active' ? 'Camera Ready' : 'Enable Webcam'}</span>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-6 sm:py-8">
        {/* Hero + Live Shared MediaPipe Preview */}
        <section
          id="calibration"
          className="grid items-center gap-6 lg:grid-cols-12"
        >
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
            className="flex flex-col justify-center lg:col-span-6"
          >
            <h1 className="font-display text-3xl font-extrabold tracking-tight text-white sm:text-5xl text-balance">
              One webcam. Solo runs or 1v1 party duels.
            </h1>
            <p className="mt-3 max-w-lg text-sm leading-relaxed text-slate-300 sm:text-base">
              Pick a game below to play 1P Solo or battle a friend side-by-side—no webcam required to test with mouse or fallback controls.
            </p>

            <div className="mt-5 flex flex-wrap items-center gap-3 text-xs text-slate-400">
              <span className="font-medium text-slate-200">{statusText}</span>
              {errorMessage && cameraStatus !== 'active' && (
                <span className="text-slate-400">· {errorMessage}</span>
              )}
            </div>
          </motion.div>

          {/* Right Column: Live Shared Hand-Tracking Preview */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: 0.05 }}
            className="flex flex-col overflow-hidden rounded-xl border border-slate-800 bg-[#0E131E] lg:col-span-6"
          >
            <div className="flex items-center justify-between border-b border-slate-800 px-4 py-2 text-xs text-slate-300">
              <span className="font-semibold text-white">Live Camera Calibration</span>
              <span className="font-mono text-slate-400">
                {cameraStatus === 'active' ? 'Webcam Feed' : 'Interactive Grid'}
              </span>
            </div>
            <div className="relative min-h-[220px]">
              <canvas
                ref={previewCanvasRef}
                onPointerMove={handlePreviewMove}
                onPointerLeave={handlePreviewLeave}
                data-testid="hub-preview-canvas"
                className="block h-full w-full cursor-crosshair"
              />
            </div>
          </motion.div>
        </section>

        {/* Game Cards Grid */}
        <section id="games" className="mt-9">
          <div className="flex items-baseline justify-between gap-4 border-b border-slate-800/80 pb-4">
            <div>
              <h2 className="font-display text-2xl font-bold text-white">
                Arcade Lineup
              </h2>
              <p className="mt-1 text-sm text-slate-400">
                Select a game mode to enter the arena.
              </p>
            </div>
            <span className="text-xs font-mono text-slate-400">2 Playable · 1 In Development</span>
          </div>

          <div className="mt-6 grid gap-6 md:grid-cols-3">
            {/* Playable Card 1: Neon Slash Duel */}
            <article className="flex flex-col justify-between overflow-hidden rounded-xl border border-cyan-500/40 bg-[#0E131E] transition-colors hover:border-cyan-400">
              <div>
                <div className="relative h-36 w-full overflow-hidden border-b border-slate-800 bg-[#090D16]">
                  <svg
                    viewBox="0 0 360 180"
                    className="h-full w-full"
                    aria-hidden="true"
                  >
                    <line
                      x1="180"
                      y1="0"
                      x2="180"
                      y2="180"
                      stroke="rgba(148,163,184,0.22)"
                      strokeDasharray="6 6"
                    />
                    <path
                      d="M36 140 L144 48"
                      stroke="#00E5FF"
                      strokeWidth="5"
                      strokeLinecap="round"
                    />
                    <path
                      d="M324 140 L216 48"
                      stroke="#FF2A6D"
                      strokeWidth="5"
                      strokeLinecap="round"
                    />
                    <polygon
                      points="90,46 114,70 90,94 66,70"
                      fill="rgba(0,229,255,0.22)"
                      stroke="#00E5FF"
                      strokeWidth="2.5"
                    />
                    <polygon
                      points="270,46 294,70 270,94 246,70"
                      fill="rgba(255,42,109,0.22)"
                      stroke="#FF2A6D"
                      strokeWidth="2.5"
                    />
                    <circle
                      cx="180"
                      cy="90"
                      r="20"
                      fill="rgba(168,85,247,0.28)"
                      stroke="#C084FC"
                      strokeWidth="2.5"
                    />
                  </svg>
                </div>

                <div className="p-5">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="font-semibold text-cyan-300">Playable</span>
                    <span aria-hidden="true">·</span>
                    <span>1–2 Players</span>
                    <span aria-hidden="true">·</span>
                    <span>60s Match</span>
                  </div>
                  <h3 className="mt-2 font-display text-xl font-bold text-white">
                    Neon Slash Duel
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-300">
                    Slice geometric gems with laser blades, dodge Skull Bombs, and race solo or 1v1 with Sabotage Orbs.
                  </p>
                </div>
              </div>

              <div className="px-5 pb-5">
                <Link
                  href="/games/neon-slash-duel"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 px-4 py-2.5 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-300"
                >
                  <Swords className="h-4 w-4" aria-hidden="true" />
                  <span>Play Neon Slash Duel</span>
                </Link>
              </div>
            </article>

            {/* Playable Card 2: Pose Match Battle */}
            <article
              className="flex flex-col justify-between overflow-hidden rounded-xl border border-rose-500/40 bg-[#0E131E] transition-colors hover:border-rose-400"
            >
              <div>
                <div className="relative h-36 w-full overflow-hidden border-b border-slate-800 bg-[#090D16]">
                  <svg
                    viewBox="0 0 360 180"
                    className="h-full w-full"
                    aria-hidden="true"
                  >
                    <line
                      x1="180"
                      y1="0"
                      x2="180"
                      y2="180"
                      stroke="rgba(148,163,184,0.22)"
                      strokeDasharray="6 6"
                    />
                    <circle cx="100" cy="54" r="12" stroke="#00E5FF" strokeWidth="2.5" fill="none" />
                    <path
                      d="M68 72 L100 84 L132 72 M100 84 L100 118 M100 118 L80 144 M100 118 L120 144"
                      stroke="#00E5FF"
                      strokeWidth="3"
                      strokeLinecap="round"
                      fill="none"
                    />
                    <circle cx="260" cy="54" r="12" stroke="#FF2A6D" strokeWidth="2.5" fill="none" />
                    <path
                      d="M232 56 L260 84 L288 56 M260 84 L260 118 M260 118 L242 144 M260 118 L278 144"
                      stroke="#FF2A6D"
                      strokeWidth="3"
                      strokeLinecap="round"
                      fill="none"
                    />
                  </svg>
                </div>

                <div className="p-5">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span className="font-semibold text-rose-300">Playable</span>
                    <span aria-hidden="true">·</span>
                    <span>1–2 Players</span>
                    <span aria-hidden="true">·</span>
                    <span>60s Match</span>
                  </div>
                  <h3 className="mt-2 font-display text-xl font-bold text-white">
                    Pose Match Battle
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-300">
                    Match neon silhouette poses using 8-joint angle scoring. Trigger 3-combo sabotages, dodge red Fake-Outs, and win 2x Overdrive.
                  </p>
                </div>
              </div>

              <div className="px-5 pb-5">
                <Link
                  href="/games/pose-match-battle"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-rose-500 px-4 py-2.5 text-sm font-bold text-white transition-colors hover:bg-rose-400"
                >
                  <Play className="h-4 w-4 fill-current" aria-hidden="true" />
                  <span>Play Pose Match Battle</span>
                </Link>
              </div>
            </article>

            {/* Disabled Card 3: Rhythm Dodge */}
            <article
              className="flex flex-col justify-between overflow-hidden rounded-xl border border-slate-800 bg-[#0B0F19] opacity-80"
            >
              <div>
                <div className="relative h-36 w-full overflow-hidden border-b border-slate-800 bg-[#080B12]">
                  <svg
                    viewBox="0 0 360 180"
                    className="h-full w-full"
                    aria-hidden="true"
                  >
                    <line x1="90" y1="20" x2="90" y2="160" stroke="rgba(148,163,184,0.18)" strokeWidth="2" />
                    <line x1="180" y1="20" x2="180" y2="160" stroke="rgba(148,163,184,0.18)" strokeWidth="2" />
                    <line x1="270" y1="20" x2="270" y2="160" stroke="rgba(148,163,184,0.18)" strokeWidth="2" />
                    <rect x="64" y="48" width="52" height="16" rx="4" fill="rgba(100,116,139,0.4)" />
                    <rect x="154" y="88" width="52" height="16" rx="4" fill="rgba(100,116,139,0.4)" />
                    <rect x="244" y="122" width="52" height="16" rx="4" fill="rgba(100,116,139,0.4)" />
                  </svg>
                  <span className="absolute right-3 top-3 rounded-md border border-slate-700 bg-[#0E131E] px-2.5 py-1 text-xs font-semibold text-slate-300">
                    Coming Soon
                  </span>
                </div>

                <div className="p-5">
                  <div className="flex items-center gap-2 text-xs text-slate-400">
                    <span>1–2 Players</span>
                    <span aria-hidden="true">·</span>
                    <span>Head &amp; Hand Sync</span>
                  </div>
                  <h3 className="mt-2 font-display text-xl font-bold text-slate-200">
                    Rhythm Dodge
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-slate-400">
                    Duck, weave, and punch incoming synthwave barriers locked to the beat using real-time landmark tracking.
                  </p>
                </div>
              </div>

              <div className="px-5 pb-5">
                <button
                  type="button"
                  disabled
                  className="inline-flex w-full cursor-not-allowed items-center justify-center gap-2 rounded-lg border border-slate-800 bg-[#121724] px-4 py-2.5 text-sm font-semibold text-slate-500"
                >
                  <Lock className="h-4 w-4" aria-hidden="true" />
                  <span>Coming Soon</span>
                </button>
              </div>
            </article>
          </div>
        </section>
      </main>
    </div>
  );
}
