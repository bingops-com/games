import type { Metadata } from 'next';
import { Suspense } from 'react';
import Table from '@/components/Table';

export const metadata: Metadata = { title: 'Table, lab.bingo games' };

// Le code de la table est dans l'adresse (?code=ABCD) : il n'est lu que dans le navigateur.
export default function Page() {
  return (
    <Suspense>
      <Table />
    </Suspense>
  );
}
