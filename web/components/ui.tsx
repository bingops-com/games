'use client';

import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react';

// Le kit : les pièces de l'interface qui ont une structure ou un comportement. Leur
// apparence est dans app/ui.css, avec les pièces qui ne sont qu'une classe (.btn, .pill,
// .panel, .member…). La page /uikit/ les montre toutes.

const ICONS = {
  // Envoyer : une flèche qui monte.
  send: <path d="M12 19V5M6 11l6-6 6 6" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  copy: <><rect x="8.5" y="8.5" width="11" height="11" rx="2.5" /><path d="M15.500 5.500v-1a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h1" /></>,
  // Une bulle : la discussion.
  talk: <path d="M4 6.500A2.500 2.500 0 0 1 6.500 4h11A2.500 2.500 0 0 1 20 6.500v7a2.500 2.500 0 0 1-2.500 2.500H11l-4.500 4v-4A2.500 2.500 0 0 1 4 13.500z" />,
  down: <path d="M12 5v14M6 13l6 6 6-6" />,
  // La coupe : une victoire.
  cup: <path d="M7 3.500h10V9a5 5 0 0 1-10 0zM7 5.500H4V7a3 3 0 0 0 3 3M17 5.500h3V7a3 3 0 0 1-3 3M12 14v3.500M8 20.500h8" />,
  leave: <path d="M14 4.500h3.500a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H14M10 8l-4 4 4 4M6 12h9" />,
  check: <path d="M5 12.500l4.500 4.500L19 7.500" />,
  // Une pièce : un crédit du magasin.
  coin: <><circle cx="12" cy="12" r="8.500" /><path d="M12 7.500l1.300 3.200 3.200 1.300-3.200 1.300L12 16.500l-1.300-3.200L7.500 12l3.200-1.300z" /></>,
  sound: <><path d="M4 9.500h3.500L12 5.500v13l-4.500-4H4z" /><path d="M15.500 9a4 4 0 0 1 0 6M18 6.500a7.500 7.500 0 0 1 0 11" /></>,
  mute: <><path d="M4 9.500h3.500L12 5.500v13l-4.500-4H4z" /><path d="M16 9.500l5 5M21 9.500l-5 5" /></>,
  lock: <><rect x="5" y="10.500" width="14" height="9.500" rx="2.500" /><path d="M8.500 10.500V8a3.500 3.500 0 0 1 7 0v2.500" /></>,
};

export type IconName = keyof typeof ICONS;

export function Ic({ name }: { name: IconName }) {
  return <svg className="ic" viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>;
}

// Une fenêtre par-dessus la page : Échap ou un clic à côté la ferme, et son premier champ
// reçoit le curseur. Avec onSubmit, c'est un formulaire.
export function Dialog({ title, onClose, onSubmit, size, className = '', children }: {
  title: ReactNode;
  onClose: () => void;
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  size?: 'medium' | 'wide';
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  const box = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && close.current();
    document.addEventListener('keydown', esc);
    const el = box.current;
    if (el && !el.contains(document.activeElement)) {
      const first = el.querySelector<HTMLElement>('input:not([type=radio], [type=checkbox], [type=range]), textarea, select');
      (first ?? el.querySelector<HTMLElement>('[role=dialog]'))?.focus();
      if (first instanceof HTMLInputElement) first.select();
    }
    return () => document.removeEventListener('keydown', esc);
  }, []);
  const cls = `dialog${size ? ` ${size}` : ''}${className ? ` ${className}` : ''}`;
  const head = <h2 id={id}>{title}</h2>;
  return (
    <div className="modal" ref={box} onClick={(e) => e.target === e.currentTarget && onClose()}>
      {onSubmit ? (
        <form className={cls} onSubmit={onSubmit} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>{head}{children}</form>
      ) : (
        <div className={cls} role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1}>{head}{children}</div>
      )}
    </div>
  );
}

// Un champ : son étiquette au-dessus, et au besoin un mot d'aide dessous.
export function Field({ label, help, children }: { label: ReactNode; help?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}{children}</label>
      {help && <small className="help">{help}</small>}
    </div>
  );
}

// Une jauge : où l'on en est, de 0 à max. Sans nom, elle est décorative.
export function Bar({ value, max, label }: { value: number; max: number; label?: string }) {
  const width = `${Math.max(0, Math.min(100, (100 * value) / max))}%`;
  // À zéro, la jauge est vide : pas de point qui ferait croire à un début.
  const fill = value > 0 && <i style={{ width }} />;
  return label
    ? <span className="bar" role="progressbar" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={label}>{fill}</span>
    : <span className="bar" aria-hidden="true">{fill}</span>;
}
