import React, { Suspense } from 'react';
import NeonMuncherGame from '@/components/NeonMuncherGame';

export default function NeonMuncherPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#07090F] text-sm text-slate-400">
          Loading Neon Muncher...
        </div>
      }
    >
      <NeonMuncherGame />
    </Suspense>
  );
}
