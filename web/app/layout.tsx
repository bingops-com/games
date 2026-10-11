import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import Shell from '@/components/Shell';
import './ui.css';
import './globals.css';
import './stages.css';

export const metadata: Metadata = {
  title: 'lab.bingo games',
  description: 'Des jeux de société à jouer entre amis, chacun sur son écran, autour d’une même table.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = { themeColor: '#1443d6' };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
