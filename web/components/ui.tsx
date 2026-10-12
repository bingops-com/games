'use client';

import { useEffect, useId, useRef, type FormEvent, type ReactNode } from 'react';
import { useT } from '@/lib/app';

// Le kit : les pièces de l'interface qui ont une structure ou un comportement. Leur
// apparence est dans app/ui.css, avec les pièces qui ne sont qu'une classe (.btn, .pill,
// .panel, .member…). La page /uikit/ les montre toutes.

export { Ic, ICON_NAMES, type IconName } from '@/lib/icons';

let openDialogs = 0;
let previousOverflow = '';

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
  const t = useT();
  const box = useRef<HTMLDialogElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const opener = document.activeElement;
    if (openDialogs++ === 0) {
      previousOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    el.showModal();
    const first = el.querySelector<HTMLElement>('[autofocus], input:not([type=radio], [type=checkbox], [type=range]), textarea, select');
    first?.focus();
    if (first instanceof HTMLInputElement) first.select();
    return () => {
      el.close();
      if (--openDialogs === 0) document.body.style.overflow = previousOverflow;
      if (opener instanceof HTMLElement && opener.isConnected && opener.getClientRects().length) opener.focus();
      else {
        const toggle = document.querySelector<HTMLButtonElement>('.menu-toggle');
        if (toggle?.getClientRects().length) toggle.focus();
        else document.querySelector<HTMLElement>('main[tabindex="-1"]')?.focus();
      }
    };
  }, []);
  const cls = `dialog${size ? ` ${size}` : ''}${className ? ` ${className}` : ''}`;
  const head = <div className="dialog-head"><h2 id={id}>{title}</h2><button type="button" className="dialog-close" aria-label={t('Fermer la fenêtre', 'Close dialog')} onClick={onClose}><span aria-hidden="true">×</span></button></div>;
  return (
    <dialog className="modal" ref={box} aria-modal="true" aria-labelledby={id} onCancel={(e) => { e.preventDefault(); close.current(); }} onKeyDown={(e) => {
      if (e.key !== 'Tab') return;
      const items = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')).filter((el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
      const first = items[0], last = items.at(-1);
      if (e.shiftKey && document.activeElement === first && last) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last && first) { e.preventDefault(); first.focus(); }
    }} onClick={(e) => e.target === e.currentTarget && onClose()}>
      {onSubmit ? (
        <form className={cls} onSubmit={onSubmit}>{head}{children}</form>
      ) : (
        <div className={cls}>{head}{children}</div>
      )}
    </dialog>
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
