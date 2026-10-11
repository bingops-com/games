import type { Metadata } from 'next';
import Account from '@/components/Account';

export const metadata: Metadata = { title: 'Mon compte, lab.bingo games' };

export default function Page() {
  return <Account />;
}
