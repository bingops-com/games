'use client';

import { useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/app';
import { play, type SoundName } from '@/lib/sound';

// A transition is announced once. The game's persistent labels retain the same
// information after this dismissible notice disappears. It never takes focus.
export default function GameAnnouncement({ event, title, detail, sound, initial = false, className = '' }: {
  event: string | null; title: string; detail?: string; sound?: SoundName; initial?: boolean; className?: string;
}) {
  const t = useT();
  const previous = useRef(event);
  const mounted = useRef(false);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const changed = previous.current !== event;
    previous.current = event;
    const first = !mounted.current;
    mounted.current = true;
    if (!event) { setVisible(false); return; }
    const announce = changed || (first && initial);
    if (first && !announce) return;
    if (announce) {
      setVisible(true);
      if (sound) play(sound);
    }
    const timer = setTimeout(() => setVisible(false), 6000);
    return () => clearTimeout(timer);
  }, [event, sound, initial]);
  return visible ? <div className={`game-announcement ${className}`} role="status" aria-live="polite">
    <div><strong>{title}</strong>{detail && <p>{detail}</p>}</div>
    <button type="button" aria-label={t('Masquer l’annonce', 'Dismiss announcement')} onClick={() => setVisible(false)}>×</button>
  </div> : null;
}
