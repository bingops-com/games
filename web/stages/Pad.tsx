'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/lib/app';
import { PALETTE, SHEET, encode, paint, type Stroke } from '@/lib/sketch';

// La feuille de dessin. Sans `act`, elle montre le dessin reçu. Avec, le joueur dessine :
// ses traits s'affichent tout de suite et partent au serveur par petits paquets ; `k`
// change quand une nouvelle feuille commence.
export default function Pad({ strokes, act, k }: { strokes: Stroke[]; act?: (action: object) => void; k: string }) {
  const t = useT();
  const canvas = useRef<HTMLCanvasElement>(null);
  const mine = useRef<Stroke[]>([]);
  const pending = useRef('');
  const last = useRef<[number, number] | null>(null);
  const [color, setColor] = useState(0);
  const [width, setWidth] = useState(1);
  const drawing = !!act;

  const redraw = useCallback((list: Stroke[]) => {
    const ctx = canvas.current?.getContext('2d');
    if (ctx) paint(ctx, list);
  }, []);

  // Une nouvelle feuille : on repart de ce que le serveur a gardé (rien, ou le dessin
  // d'avant un rechargement de la page).
  useEffect(() => {
    mine.current = strokes.map((s) => ({ ...s }));
    pending.current = '';
    redraw(mine.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [k, drawing]);
  useEffect(() => {
    if (!drawing) redraw(strokes);
  }, [drawing, strokes, redraw]);

  const flush = useCallback(() => {
    // Un message porte 500 points au plus.
    while (pending.current && act) {
      act({ t: 'more', p: pending.current.slice(0, 2000) });
      pending.current = pending.current.slice(2000);
    }
  }, [act]);
  useEffect(() => {
    if (!drawing) return;
    const id = setInterval(flush, 110);
    return () => clearInterval(id);
  }, [drawing, flush]);

  const at = (e: React.PointerEvent) => {
    const r = canvas.current!.getBoundingClientRect();
    return [((e.clientX - r.left) / r.width) * 1000, ((e.clientY - r.top) / r.height) * 1000] as [number, number];
  };
  const down = (e: React.PointerEvent) => {
    if (!act || e.button > 0) return;
    e.preventDefault();
    canvas.current!.setPointerCapture(e.pointerId);
    const [x, y] = at(e);
    last.current = [x, y];
    const p = encode(x, y);
    mine.current.push({ c: color, w: width, p });
    act({ t: 'begin', c: color, w: width, p });
    redraw(mine.current);
  };
  const move = (e: React.PointerEvent) => {
    if (!act || !last.current) return;
    const [x, y] = at(e);
    // Un point tous les quelques millièmes de feuille suffit.
    if (Math.hypot(x - last.current[0], y - last.current[1]) < 5) return;
    last.current = [x, y];
    const p = encode(x, y);
    mine.current[mine.current.length - 1].p += p;
    pending.current += p;
    redraw(mine.current);
  };
  const up = () => {
    if (!last.current) return;
    last.current = null;
    flush();
  };
  const undo = () => {
    flush();
    mine.current.pop();
    act?.({ t: 'undo' });
    redraw(mine.current);
  };
  const clear = () => {
    pending.current = '';
    mine.current = [];
    act?.({ t: 'clear' });
    redraw(mine.current);
  };

  return (
    <div className="sketch">
      <div className="pad-fit">
        <canvas
          ref={canvas}
          className={`pad${drawing ? ' live' : ''}`}
          width={SHEET.w}
          height={SHEET.h}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          aria-label={drawing ? t('Feuille de dessin', 'Drawing sheet') : t('Dessin', 'Drawing')}
        />
      </div>
      {drawing && (
        <div className="pad-tools">
          <div className="pad-colors" role="radiogroup" aria-label={t('Couleur', 'Colour')}>
            {PALETTE.map((hex, i) => (
              <button key={hex} role="radio" aria-checked={color === i} aria-label={t(`Couleur ${i + 1}`, `Colour ${i + 1}`)} className={color === i ? 'on' : undefined} style={{ background: hex }} onClick={() => setColor(i)} />
            ))}
          </div>
          <div className="pad-widths" role="radiogroup" aria-label={t('Épaisseur', 'Thickness')}>
            {[t('Fin', 'Fine'), t('Moyen', 'Medium'), t('Épais', 'Thick')].map((label, i) => (
              <button key={i} role="radio" aria-checked={width === i} aria-label={label} className={width === i ? 'on' : undefined} onClick={() => setWidth(i)}>
                <i style={{ width: `${0.35 + i * 0.4}rem`, height: `${0.35 + i * 0.4}rem` }} />
              </button>
            ))}
          </div>
          <button className="btn onsea small" onClick={undo}>{t('Annuler le trait', 'Undo stroke')}</button>
          <button className="btn onsea small" onClick={clear}>{t('Tout effacer', 'Clear all')}</button>
        </div>
      )}
    </div>
  );
}
