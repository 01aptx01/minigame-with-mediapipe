import type { Metadata } from 'next';
import { JetBrains_Mono, Outfit, Plus_Jakarta_Sans } from 'next/font/google';
import { MediaPipeProvider } from '@/contexts/MediaPipeContext';
import './globals.css';

const outfit = Outfit({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-display',
});

const plusJakarta = Plus_Jakarta_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['500', '700'],
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
      <body suppressHydrationWarning className="min-h-screen bg-[#07090F] text-slate-100">
        <MediaPipeProvider>{children}</MediaPipeProvider>
      </body>
    </html>
  );
}
