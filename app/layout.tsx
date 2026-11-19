import type { Metadata } from 'next';
import localFont from 'next/font/local';
import { MediaPipeProvider } from '@/contexts/MediaPipeContext';
import './globals.css';

const outfit = localFont({
  src: [{ path: '../public/fonts/outfit-600.ttf', weight: '600' }, { path: '../public/fonts/outfit-700.ttf', weight: '700' }, { path: '../public/fonts/outfit-800.ttf', weight: '800' }],
  variable: '--font-display',
});

const plusJakarta = localFont({
  src: [{ path: '../public/fonts/plus-jakarta-sans-400.ttf', weight: '400' }, { path: '../public/fonts/plus-jakarta-sans-500.ttf', weight: '500' }, { path: '../public/fonts/plus-jakarta-sans-600.ttf', weight: '600' }, { path: '../public/fonts/plus-jakarta-sans-700.ttf', weight: '700' }],
  variable: '--font-sans',
});

const jetbrainsMono = localFont({
  src: [{ path: '../public/fonts/jetbrains-mono-500.ttf', weight: '500' }, { path: '../public/fonts/jetbrains-mono-700.ttf', weight: '700' }],
  variable: '--font-mono',
});

export const metadata: Metadata = {
  title: 'Webcam Party Arcade',
  description:
    'A local multiplayer webcam mini-game hub powered by MediaPipe hand tracking and 60FPS HTML5 Canvas.',
  openGraph: {
    title: 'Webcam Party Arcade',
    description:
      'A local multiplayer webcam mini-game hub powered by MediaPipe hand tracking and 60FPS HTML5 Canvas.',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Webcam Party Arcade',
    description:
      'A local multiplayer webcam mini-game hub powered by MediaPipe hand tracking and 60FPS HTML5 Canvas.',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      className={`${outfit.variable} ${plusJakarta.variable} ${jetbrainsMono.variable}`}
    >
      <body suppressHydrationWarning className="min-h-screen">
        <MediaPipeProvider>{children}</MediaPipeProvider>
      </body>
    </html>
  );
}
