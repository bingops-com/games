import type { Metadata } from 'next';
import { Reset } from '@/components/Account';

export const metadata: Metadata = { title: 'Récupérer mon compte, lab.bingo games', robots: { index: false, follow: false } };

export default function Page() {
  return <Reset />;
}
