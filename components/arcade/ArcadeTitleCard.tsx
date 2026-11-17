'use client';

import React from 'react';
import { CameraHelp } from '@/components/arcade/CameraHelp';
import { Camera, Play, User, Users } from 'lucide-react';
import { PlayerNameInputs } from '@/components/arcade/PlayerNameInputs';
import type { CameraStatus } from '@/contexts/MediaPipeContext';
import type { ScoreboardMode } from '@/lib/games/shared/scoreboard';

export interface RuleBadge {
  text: string;
  colorClass: string;
}

interface ArcadeTitleCardProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  mode: ScoreboardMode;
  duelLabel: string;
  soloLabel: string;
  onModeChange: (mode: ScoreboardMode) => void;
  p1Name: string;
  p2Name: string;
  onChangeP1Name: (val: string) => void;
  onChangeP2Name: (val: string) => void;
  rules: RuleBadge[];
  cameraStatus: CameraStatus;
  cameraStatusLabel: string;
  errorMessage: string | null;
  onRequestCamera: () => void;
  startLabel: string;
  onStart: () => void;
}

export function ArcadeTitleCard({
  icon,
  title,
  subtitle,
  mode,
  duelLabel,
  soloLabel,
  onModeChange,
  p1Name,
  p2Name,
  onChangeP1Name,
  onChangeP2Name,
  rules,
  cameraStatus,
  cameraStatusLabel,
  onRequestCamera,
  startLabel,
  onStart,
}: ArcadeTitleCardProps) {
  return (
    <div className="w-full max-w-lg rounded-2xl border border-slate-700/80 bg-[#0D121E] p-6 shadow-2xl">
      <div className="flex flex-col items-center text-center">
        {icon}

        <h1 className="font-display text-3xl font-extrabold tracking-tight text-white">
          {title}
        </h1>
        <p className="mt-1.5 text-xs text-slate-300 sm:text-sm">{subtitle}</p>

        {/* Mode Toggle */}
        <div
          role="group"
          aria-label="Game mode"
          className="mt-4 inline-flex rounded-lg border border-slate-700 bg-[#080C15] p-1"
        >
          <button
            type="button"
            onClick={() => onModeChange('1v1')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-bold transition-colors ${
              mode === '1v1'
                ? 'bg-cyan-400 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{duelLabel}</span>
          </button>
          <button
            type="button"
            onClick={() => onModeChange('solo')}
            className={`inline-flex items-center gap-1.5 rounded-md px-3.5 py-1.5 text-xs font-bold transition-colors ${
              mode === 'solo'
                ? 'bg-cyan-400 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            <User className="h-3.5 w-3.5" aria-hidden="true" />
            <span>{soloLabel}</span>
          </button>
        </div>

        {/* Optional Player Name Inputs */}
        <PlayerNameInputs
          soloMode={mode === 'solo'}
          p1Name={p1Name}
          p2Name={p2Name}
          onChangeP1Name={onChangeP1Name}
          onChangeP2Name={onChangeP2Name}
        />

        {/* Compact Single-Line Scoring Rules */}
        <div className="mt-4 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 font-mono text-[11px] text-slate-300">
          {rules.map((rule) => (
            <span key={rule.text} className={rule.colorClass}>
              {rule.text}
            </span>
          ))}
        </div>

        <div className="mt-4 flex w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-800 bg-[#090D16] px-3.5 py-2 text-xs text-slate-300">
          <span>{cameraStatusLabel}</span>
          {cameraStatus !== 'active' && (
            <button
              type="button"
              onClick={onRequestCamera}
              disabled={cameraStatus === 'requesting'}
              aria-busy={cameraStatus === 'requesting'}
              className="inline-flex items-center gap-1.5 rounded-md border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 font-semibold text-cyan-300 transition-colors hover:bg-cyan-500/20 whitespace-nowrap shrink-0"
            >
              <Camera className="h-3.5 w-3.5" aria-hidden="true" />
              <span>{cameraStatus === 'requesting' ? 'Waiting for permission…' : 'Enable Webcam'}</span>
            </button>
          )}
        </div>
        <CameraHelp />

        <div className="mt-5 flex w-full justify-center">
          <button
            type="button"
            data-start="true"
            onClick={onStart}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-cyan-400 px-6 py-2.5 text-sm font-bold text-slate-950 transition-colors hover:bg-cyan-300 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-400 sm:w-auto whitespace-nowrap"
          >
            <Play className="h-4 w-4 fill-current" aria-hidden="true" />
            <span>{startLabel}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
