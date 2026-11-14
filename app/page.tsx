import React, { Suspense } from 'react';
import ArcadeApp from '@/components/ArcadeApp';

export default function HomePage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-[#07090F] text-sm text-slate-400">
          Loading Webcam Party Arcade...
        </div>
      }
    >
      <ArcadeApp />
    </Suspense>
  );
}
