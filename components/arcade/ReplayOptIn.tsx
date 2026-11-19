'use client';

import React from 'react';

interface ReplayOptInProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  supported: boolean;
}

export function ReplayOptIn({ enabled, onChange, supported }: ReplayOptInProps) {
  return (
    <section className="w-full max-w-lg rounded-xl border border-slate-700/80 bg-[#0D121E] px-4 py-3 text-left shadow-lg">
      <label className="flex cursor-pointer items-start gap-3">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => onChange(event.currentTarget.checked)}
          disabled={!supported}
          className="mt-0.5 h-4 w-4 shrink-0 accent-cyan-400 disabled:cursor-not-allowed"
        />
        <span>
          <span className="block text-sm font-semibold text-white">Save replays locally</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-slate-400">
            Optional. Saves completed rounds on this device while this is on. Video only; no audio.
          </span>
          {!supported && (
            <span className="mt-1 block text-xs text-amber-300" role="status">
              Video recording is not supported in this browser.
            </span>
          )}
        </span>
      </label>
    </section>
  );
}
