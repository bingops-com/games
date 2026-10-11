import type { Metadata } from 'next';
import Friends from '@/components/Friends';

export const metadata: Metadata = { title: 'Amis, lab.bingo games' };

export default function Page() {
  return <Friends />;
}
