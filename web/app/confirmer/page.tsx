import type { Metadata } from 'next';
import { Suspense } from 'react';
import { Confirm } from '@/components/Account';

export const metadata: Metadata = { title: 'Adresse e-mail, lab.bingo games' };

export default function Page() {
  return <Suspense><Confirm /></Suspense>;
}
