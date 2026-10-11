'use client';

import { useEffect, type ReactNode } from 'react';
import { play } from '@/lib/sound';

// Le bandeau en tête de chaque scène : une ligne qui dit ce qui se passe. Quand c'est au
// joueur d'agir (« you ») ou que quelque chose presse (« alert »), une courte phrase dit
// quoi faire ; quand il attend, le titre suffit.
export default function Guide({ tone, title, children }: { tone: 'you' | 'wait' | 'alert'; title: string; children?: ReactNode }) {
  // Une note quand c'est au joueur d'agir.
  useEffect(() => {
    if (tone === 'you') play('turn');
  }, [tone]);
  return (
    <div className={`guide guide-${tone}${tone === 'you' ? ' light' : ''}`} role="status">
      <strong>{title}</strong>
      {children && tone !== 'wait' && <span>{children}</span>}
    </div>
  );
}
