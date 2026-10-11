import type { Metadata } from 'next';
import Objectives from '@/components/Objectives';

export const metadata: Metadata = { title: 'Objectifs, lab.bingo games' };

export default function Page() {
  return <Objectives />;
}
