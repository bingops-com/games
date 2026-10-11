import type { Metadata } from 'next';
import Shop from '@/components/Shop';

export const metadata: Metadata = { title: 'Magasin, lab.bingo games' };

export default function Page() {
  return <Shop />;
}
