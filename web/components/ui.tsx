'use client';

import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react';

// Le kit : les pièces de l'interface qui ont une structure ou un comportement. Leur
// apparence est dans app/ui.css, avec les pièces qui ne sont qu'une classe (.btn, .pill,
// .panel, .member…). La page /uikit/ les montre toutes.

export { Ic, ICON_NAMES, type IconName } from '@/lib/icons';

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
