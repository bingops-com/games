'use client';

import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useT } from '@/lib/app';
import { PALETTE, SHEET, encode, paint, type Stroke } from '@/lib/sketch';

// La feuille de dessin. Sans `act`, elle montre le dessin reçu. Avec, le joueur dessine :
// ses traits s'affichent tout de suite et partent au serveur par petits paquets ; `k`
// change quand une nouvelle feuille commence.
export default function Pad({ strokes, act, k }: { strokes: Stroke[]; act?: (action: object) => void; k: string }) {
  const t = useT();
  const help = useId();
  const canvas = useRef<HTMLCanvasElement>(null);
  const mine = useRef<Stroke[]>([]);
  const pending = useRef('');
  const last = useRef<[number, number] | null>(null);
  const [color, setColor] = useState(0);
  const [width, setWidth] = useState(1);
  const cursor = useRef<[number, number]>([500, 500]);
  const [keyboard, setKeyboard] = useState(false);
  const [position, setPosition] = useState<[number, number]>([500, 500]);
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
    last.current = null;
    cursor.current = [500, 500];
    setPosition([500, 500]);
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
    up();
    setKeyboard(false);
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
    up();
    mine.current.pop();
    act?.({ t: 'undo' });
    redraw(mine.current);
  };
  const clear = () => {
    last.current = null;
    pending.current = '';
    mine.current = [];
    act?.({ t: 'clear' });
    redraw(mine.current);
  };
  const key = (e: React.KeyboardEvent) => {
    if (!act) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      if (e.repeat) return;
      setKeyboard(true);
      if (last.current) up();
      else {
        const [x, y] = cursor.current;
        last.current = [x, y];
        const p = encode(x, y);
        mine.current.push({ c: color, w: width, p });
        act({ t: 'begin', c: color, w: width, p });
        redraw(mine.current);
      }
      return;
    }
    const direction = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (!direction) return;
    e.preventDefault();
    setKeyboard(true);
    const step = e.shiftKey ? 30 : 10;
    const [x, y] = cursor.current.map((n, i) => Math.max(0, Math.min(999, n + direction[i] * step))) as [number, number];
    cursor.current = [x, y];
    setPosition([x, y]);
    if (last.current) {
      last.current = [x, y];
      const p = encode(x, y);
      mine.current[mine.current.length - 1].p += p;
      pending.current += p;
      redraw(mine.current);
    }
  };

  return (
    <div className="sketch">
      <div className="pad-fit">
        <div className="pad-sheet">
        <canvas
          ref={canvas}
          className={`pad${drawing ? ' live' : ''}`}
          width={SHEET.w}
          height={SHEET.h}
          onPointerDown={down}
          onPointerMove={move}
          onPointerUp={up}
          onPointerCancel={up}
          tabIndex={drawing ? 0 : undefined}
          onKeyDown={key}
          onBlur={() => { up(); setKeyboard(false); }}
          aria-describedby={drawing ? help : undefined}
          aria-label={drawing ? t('Feuille de dessin', 'Drawing sheet') : t('Dessin', 'Drawing')}
        />
        {drawing && keyboard && <span className="pad-cursor" aria-hidden="true" style={{ left: `${position[0] / 10}%`, top: `${position[1] / 10}%` }} />}
        </div>
      </div>
      {drawing && (
        <p className="pad-help" id={help}>{t('Clavier : flèches pour déplacer le pinceau, Espace pour commencer ou finir un trait, Maj pour aller plus vite.', 'Keyboard: arrows move the brush, Space starts or ends a stroke, Shift moves faster.')}</p>
      )}
      {drawing && (
        <div className="pad-tools">
          <div className="pad-colors" role="group" aria-label={t('Couleur', 'Colour')}>
            {PALETTE.map((hex, i) => (
              <button key={hex} aria-pressed={color === i} aria-label={t(`Couleur ${i + 1}`, `Colour ${i + 1}`)} className={color === i ? 'on' : undefined} style={{ background: hex }} onClick={() => setColor(i)} />
            ))}
          </div>
          <div className="pad-widths" role="group" aria-label={t('Épaisseur', 'Thickness')}>
            {[t('Fin', 'Fine'), t('Moyen', 'Medium'), t('Épais', 'Thick')].map((label, i) => (
              <button key={i} aria-pressed={width === i} aria-label={label} className={width === i ? 'on' : undefined} onClick={() => setWidth(i)}>
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
