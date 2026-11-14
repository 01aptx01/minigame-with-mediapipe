import React, { Suspense } from 'react';
import SorcerersDuelGame from '@/components/SorcerersDuelGame';

export default function SorcerersDuelPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-screen items-center justify-center bg-[#07090F] text-sm font-medium text-slate-300">
          Loading Sorcerer&apos;s Duel...
        </div>
      }
    >
      <SorcerersDuelGame />
    </Suspense>
  );
}
