import React, { Suspense } from 'react';
import NeonSlashGame from '@/components/NeonSlashGame';

export default function NeonSlashDuelPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-screen items-center justify-center bg-[#07090F] text-sm font-medium text-slate-300">
          Loading Neon Slash Duel...
        </div>
      }
    >
      <NeonSlashGame />
    </Suspense>
  );
}
