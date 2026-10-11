import type { Metadata } from 'next';
import UiKit from '@/components/UiKit';

export const metadata: Metadata = { title: 'Kit d’interface, lab.bingo games', robots: { index: false } };

export default function Page() {
  return <UiKit />;
}
