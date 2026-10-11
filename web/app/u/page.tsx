import type { Metadata } from 'next';
import { Suspense } from 'react';
import Profile from '@/components/Profile';

export const metadata: Metadata = { title: 'Profil, lab.bingo games' };

// Le pseudo est dans l'adresse (?n=Bing) : une seule page statique sert tous les profils.
// L'adresse partagée, /u/Bing, y est renvoyée par le serveur.
export default function Page() {
  return (
    <Suspense>
      <Profile />
    </Suspense>
  );
}
