'use client';

import Link from 'next/link';
import { useT } from '@/lib/app';

export default function NotFound() {
  const t = useT();
  return (
    <div><h1>{t('Page introuvable', 'Page not found')}</h1><p className="notice">
      {t('Cette page n’existe pas.', 'This page does not exist.')} <Link href="/">{t('Revenir aux jeux', 'Back to the games')}</Link>
    </p></div>
  );
}
