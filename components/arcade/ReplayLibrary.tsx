'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Download, Trash2, X } from 'lucide-react';
import type { ArcadeReplayClip } from '@/lib/games/shared/replay-types';

interface ReplayLibraryProps {
  gameName: string;
  clips: ArcadeReplayClip[];
  status: string;
  recording: boolean;
  onRemove: (id: string) => void | Promise<void>;
}

function clipExtension(mimeType: string): string {
  if (mimeType.toLowerCase().includes('mp4')) return 'mp4';
  if (mimeType.toLowerCase().includes('webm')) return 'webm';
  return '';
}

function clipDate(value: number): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Saved replay';
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
}

function safeFilePart(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'arcade';
}

function ReplayClipCard({
  clip,
  gameName,
  onRemove,
}: {
  clip: ArcadeReplayClip;
  gameName: string;
  onRemove: (id: string) => void | Promise<void>;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const downloadRef = useRef<HTMLAnchorElement | null>(null);
  const extension = clipExtension(clip.blob.type);
  const createdAt = new Date(clip.createdAt);
  const stamp = Number.isNaN(createdAt.getTime())
    ? 'saved'
    : createdAt.toISOString().replace(/[:.]/g, '-').slice(0, 16);
  const fileName = `replay-${safeFilePart(gameName)}-${stamp}-${clip.score}${extension ? `.${extension}` : ''}`;

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
    <article className="rounded-xl border border-slate-700 bg-[#090D16] p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex min-w-0 items-center gap-2">
          <span className="truncate font-semibold text-white">{clipDate(clip.createdAt)}</span>
          <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-cyan-300">
            Score {clip.score}
          </span>
          <span className="font-mono text-slate-400">
            {Math.max(0, Math.floor(clip.durationSeconds))}s
          </span>
        </div>
        <button
          type="button"
          onClick={() => void onRemove(clip.id)}
          aria-label={`Delete ${gameName} replay from ${clipDate(clip.createdAt)}`}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-rose-300 transition-colors hover:bg-rose-500/10 hover:text-rose-200"
        >
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          Delete
        </button>
      </div>
      <video
        ref={videoRef}
        className="aspect-video w-full rounded-lg bg-black object-contain"
        controls
        playsInline
        preload="metadata"
        aria-label={`${gameName} replay, score ${clip.score}`}
      />
      <a
        ref={downloadRef}
        download={fileName}
        className="mt-2 inline-flex items-center gap-2 rounded-lg border border-cyan-500/40 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-200 transition-colors hover:bg-cyan-500/20"
      >
        <Download className="h-3.5 w-3.5" aria-hidden="true" />
        Download replay
      </a>
    </article>
  );
}

/** Device-local clip browser with native modal focus and background blocking. */
export function ReplayLibrary({ gameName, clips, status, recording, onRemove }: ReplayLibraryProps) {
  const [open, setOpen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const orderedClips = [...clips].sort((a, b) => b.createdAt - a.createdAt);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      closeButtonRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
    return () => {
      if (dialog.open) dialog.close();
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-600 bg-[#121929] px-4 py-2 text-xs font-semibold text-slate-100 transition-colors hover:border-cyan-400/70 hover:text-white"
      >
        Clips{clips.length > 0 ? ` (${clips.length})` : ''}
      </button>

      <dialog
        ref={dialogRef}
        aria-labelledby="arcade-replay-dialog-title"
        onCancel={(event) => {
          event.preventDefault();
          setOpen(false);
        }}
        onClose={() => setOpen(false)}
        onKeyDown={(event) => event.stopPropagation()}
        className="m-auto max-h-[85vh] w-[calc(100%-2rem)] max-w-2xl overflow-hidden rounded-2xl border border-slate-700 bg-[#0D121E] p-0 text-white shadow-2xl backdrop:bg-black/75"
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-800 px-5 py-4">
          <div>
            <h2 id="arcade-replay-dialog-title" className="font-display text-xl font-bold text-white">
              Local replays · {gameName}
            </h2>
            <p className="mt-1 text-xs text-slate-400">
              Saved on this device. Video only; no audio. Up to five clips are kept for each game.
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close replay library"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-700 text-slate-300 transition-colors hover:border-slate-500 hover:text-white"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>

        <div className="max-h-[calc(85vh-5rem)] space-y-3 overflow-y-auto px-5 py-4">
          {recording && (
            <p className="flex items-center gap-2 text-xs font-semibold text-rose-300" role="status">
              <span className="h-2 w-2 animate-pulse rounded-full bg-rose-400" />
              Recording this round locally.
            </p>
          )}
          {status && (
            <p className="text-xs text-slate-400" role="status">{status}</p>
          )}
          {orderedClips.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-700 px-4 py-8 text-center">
              <p className="text-sm font-semibold text-slate-200">No saved clips yet.</p>
              <p className="mt-1 text-xs text-slate-400">
                Turn on local replay recording before a round to save one here.
              </p>
            </div>
          ) : (
            orderedClips.map((clip) => (
              <ReplayClipCard key={clip.id} clip={clip} gameName={gameName} onRemove={onRemove} />
            ))
          )}
        </div>
      </dialog>
    </>
  );
}
