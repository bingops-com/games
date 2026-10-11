import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Reset } from '@/components/Account';

export const metadata: Metadata = { title: 'Nouveau mot de passe, lab.bingo games' };

// Le lien reçu par e-mail porte son jeton dans l'adresse (?t=…), lu dans le navigateur.
export default function Page() {
  return (
    <Suspense>
      <Reset />
    </Suspense>
  );
}
