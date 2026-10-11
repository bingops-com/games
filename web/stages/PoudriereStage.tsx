'use client';

import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useT } from '@/lib/app';
import { Avatar } from '@/lib/avatar';
import type { T } from '@/lib/i18n';
import { avatarAt, nameAt, useNow, type StageProps } from '@/lib/table';
import Guide from './Guide';

interface PlayerView {
  x: number;
  y: number;
  alive: boolean;
  bombs: number;
  reach: number;
  speed: number;
  face: 'u' | 'd' | 'l' | 'r';
  moving?: boolean;
  kick?: boolean;
  pierce?: boolean;
  vest?: boolean;
  spared?: boolean;
  cursed?: boolean;
}

interface View {
  w: number;
  h: number;
  grid: string;
  ups: { c: number; k: string }[];
  bombs: { id: number; c: number; at: number; pierce?: boolean }[];
  blasts: { id: number; c: number; cells: number[] }[];
  players: PlayerView[];
  startAt: number;
  shrinkAt: number;
  closed: number;
  over: boolean;
  winner: number;
}

const KEYS: Record<string, string> = {
  ArrowUp: 'u', ArrowDown: 'd', ArrowLeft: 'l', ArrowRight: 'r',
  z: 'u', s: 'd', q: 'l', d: 'r', w: 'u', a: 'l',
};

// Les bonus, comme dans Bomberman : ce que chacun donne, et le mot qui s'envole quand on
// le ramasse.
const upName = (k: string, t: T) => ({
  b: t('Une bombe de plus', 'One more bomb'),
  r: t('Explosion plus longue', 'Longer blast'),
  s: t('Patins : pas plus rapide', 'Skates: quicker step'),
  k: t('Coup de pied : pousse les bombes', 'Kick: pushes bombs'),
  p: t('Bombes perçantes : l’explosion traverse les caisses', 'Piercing bombs: the blast goes through crates'),
  v: t('Gilet : encaisse une explosion', 'Vest: takes one blast'),
  f: t('Plein feu : l’explosion la plus longue', 'Full fire: the longest blast'),
  x: t('Tête de mort : ralentit un moment', 'Skull: slows you for a while'),
} as Record<string, string>)[k] ?? '';
const upWord = (k: string, t: T) => ({
  b: t('+1 bombe', '+1 bomb'), r: t('+1 feu', '+1 fire'), s: t('Plus vite', 'Faster'), k: t('Coup de pied', 'Kick'),
  p: t('Perçantes', 'Piercing'), v: t('Gilet', 'Vest'), f: t('Plein feu', 'Full fire'), x: t('Ralenti !', 'Slowed!'),
} as Record<string, string>)[k] ?? '';

// Les murs et les caisses ne changent que lorsqu'une caisse saute : ils ne sont pas
// redessinés vingt fois par seconde avec le reste. Chacun se pose à son arrivée, y compris
// les murs qui referment la grille.
const Walls = memo(function Walls({ grid, w, h }: { grid: string; w: number; h: number }) {
  return (
    <>
      {Array.from(grid, (c, i) =>
        c === '.' ? null : (
          <span key={`${i}${c}`} className={c === '#' ? 'pd-pillar' : 'pd-crate'} style={{ left: `${((i % w) / w) * 100}%`, top: `${(Math.floor(i / w) / h) * 100}%`, animationDelay: `${((i % w) + Math.floor(i / w)) * 14}ms` }} />
        ),
      )}
    </>
  );
});

const FLAME = 'M12 2.500c.8 3.700 5.700 5.500 5.700 11.200a5.700 5.700 0 0 1-11.400 0c0-2.700 1.700-3.700 2-6.500 1.800.900 3 1.600 3.700-4.700z';

function Bonus({ k }: { k: string }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      {k === 'b' && <><circle cx="10.500" cy="14" r="6.500" /><path d="M14.500 9.500l3-3M17 3.500v3M19 6.500h-3" fill="none" stroke="currentColor" strokeWidth="2.200" strokeLinecap="round" /></>}
      {k === 'r' && <path d={FLAME} />}
      {k === 's' && <><path d="M6 4h5.500v6.500h4a3.500 3.500 0 0 1 3.500 3.500v1.500H6z" /><circle cx="8.500" cy="19" r="2" /><circle cx="16.500" cy="19" r="2" /></>}
      {k === 'k' && <><path d="M4 4.500h5.500v8l6 1.500a3 3 0 0 1 2.300 3v2H4z" /><circle cx="19.500" cy="9" r="2.500" /><path d="M14.500 4.500l2 1.500M13.500 8l2.500.500" fill="none" stroke="currentColor" strokeWidth="1.800" strokeLinecap="round" /></>}
      {k === 'p' && <><circle cx="12" cy="12" r="5.500" /><path d="M12 2.500l1.800 4h-3.600zM12 21.500l1.800-4h-3.600zM2.500 12l4-1.800v3.600zM21.500 12l-4-1.800v3.600zM5.300 5.300l4.100 1.500-2.600 2.600zM18.700 5.300l-1.500 4.100-2.600-2.600zM5.300 18.700l1.500-4.100 2.600 2.600zM18.700 18.700l-4.100-1.500 2.600-2.600z" /></>}
      {k === 'v' && <path d="M12 2.500l7.500 3v5.500c0 5-3.200 8.300-7.500 10.500C7.700 19.300 4.500 16 4.500 11V5.500zM12 6.500v11c2.400-1.400 4-3.500 4-6.700V8.100z" fillRule="evenodd" />}
      {k === 'f' && <><path d={FLAME} transform="translate(-4.500 1) scale(.9)" /><path d={FLAME} transform="translate(6 1) scale(.9)" /></>}
      {k === 'x' && <path d="M12 2.500a8 8 0 0 0-5 14.200V20a1.500 1.500 0 0 0 1.500 1.500h7A1.500 1.500 0 0 0 17 20v-3.300A8 8 0 0 0 12 2.500zM8.700 9a2.200 2.200 0 1 1 0 4.400 2.200 2.200 0 0 1 0-4.400zm6.600 0a2.200 2.200 0 1 1 0 4.400 2.200 2.200 0 0 1 0-4.400zM12 14l1.300 2.500h-2.600z" fillRule="evenodd" />}
    </svg>
  );
}

// La forme qui double la couleur de chaque joueur, sur son plastron et dans la légende.
function Emblem({ seat }: { seat: number }) {
  return (
    <>
      {seat === 0 && <circle cx="24" cy="38.500" r="3.200" />}
      {seat === 1 && <path d="M24 34.800l3.700 6.600h-7.400z" />}
      {seat === 2 && <rect x="21" y="35.500" width="6" height="6" rx="1" />}
      {seat === 3 && <path d="M24 34.500l4 4-4 4-4-4z" />}
    </>
  );
}

// Un poseur de bombes : casque blanc à antenne, combinaison de la couleur du joueur. Il
// regarde où il va (de dos quand il monte), et ses pieds marchent quand il avance.
const Bomber = memo(function Bomber({ seat, face }: { seat: number; face: string }) {
  return (
    <svg className={`pd-bomber face-${face}`} viewBox="0 0 48 56" aria-hidden="true">
      <ellipse className="bm-shadow" cx="24" cy="52" rx="13" ry="3.500" />
      <g className="bm-all">
        <rect className="bm-foot bm-foot-l" x="14.500" y="45" width="8" height="7" rx="3" />
        <rect className="bm-foot bm-foot-r" x="25.500" y="45" width="8" height="7" rx="3" />
        <circle className="bm-suit" cx="11.500" cy="38" r="4" />
        <circle className="bm-suit" cx="36.500" cy="38" r="4" />
        <rect className="bm-suit" x="13" y="29" width="22" height="19" rx="7" />
        <g className="bm-mark"><Emblem seat={seat} /></g>
        <path className="bm-stem" d="M24 6V2.500" />
        <circle className="bm-suit" cx="24" cy="2.800" r="2.800" />
        <circle className="bm-head" cx="24" cy="19" r="14.500" />
        {face !== 'u' && (
          <g className="bm-face">
            <rect className="bm-visor" x="12.500" y="12.500" width="23" height="14" rx="7" />
            <ellipse className="bm-eye" cx="19.500" cy="19.500" rx="2" ry="4" />
            <ellipse className="bm-eye" cx="28.500" cy="19.500" rx="2" ry="4" />
          </g>
        )}
      </g>
    </svg>
  );
});

// Une bombe : ronde, sa mèche qui crépite. Perçante, elle porte des pointes.
const Bomb = memo(function Bomb({ pierce }: { pierce?: boolean }) {
  return (
    <svg viewBox="0 0 48 48" aria-hidden="true">
      {pierce && <path className="bb-spikes" d="M24 6l3.500 6h-7zM24 46l3.500-6h-7zM4 26l6-3.500v7zM44 26l-6-3.500v7zM9.500 11.500l6.700 1.800-4.900 4.900zM38.500 11.500l-1.800 6.700-4.900-4.900zM9.500 40.500l1.800-6.700 4.900 4.900zM38.500 40.500l-6.700-1.800 4.900-4.900z" />}
      <circle className="bb-body" cx="24" cy="26" r="15" />
      <path className="bb-shine" d="M15 22a10 10 0 0 1 7-6" />
      <path className="bb-fuse" d="M31 14q4-6 9-5" />
      <path className="bb-spark" d="M41 3.500l1.300 3.200 3.200 1.300-3.200 1.300L41 12.500l-1.300-3.200L36.500 8l3.200-1.300z" />
    </svg>
  );
});

interface Fx {
  id: number;
  kind: 'pop' | 'word' | 'dead';
  cell?: number;
  x?: number;
  y?: number;
  seat?: number;
  text?: string;
}

export default function PoudriereStage({ st, skew, act }: StageProps<View>) {
  const t = useT();
  const v = st.view;
  const me = st.seat;
  const playing = st.phase === 'playing' && me >= 0 && v.players[me]?.alive;
  const now = useNow(200) + skew;
  const held = useRef<string[]>([]);

  // Le clavier : la dernière direction enfoncée l'emporte, et la relâcher rend la main à
  // la précédente si elle est encore tenue.
  useEffect(() => {
    if (!playing) return;
    const sendDir = () => act({ t: 'dir', d: held.current[held.current.length - 1] ?? '' });
    const typing = (e: KeyboardEvent) => e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement;
    const down = (e: KeyboardEvent) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        if (!e.repeat) act({ t: 'bomb' });
        return;
      }
      const d = KEYS[e.key] ?? KEYS[e.key.toLowerCase()];
      if (!d) return;
      e.preventDefault();
      if (e.repeat || held.current.includes(d)) return;
      held.current.push(d);
      sendDir();
    };
    const up = (e: KeyboardEvent) => {
      const d = KEYS[e.key] ?? KEYS[e.key.toLowerCase()];
      if (!d || !held.current.includes(d)) return;
      held.current = held.current.filter((x) => x !== d);
      sendDir();
    };
    const blur = () => {
      held.current = [];
      sendDir();
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      held.current = [];
    };
  }, [playing, act]);

  const at = (c: number) => ({ left: `${((c % v.w) / v.w) * 100}%`, top: `${(Math.floor(c / v.w) / v.h) * 100}%` });
  // Une bombe glisse quand on la pousse : elle se place par un déplacement, pas par un saut.
  const slid = (c: number) => ({ transform: `translate(${(c % v.w) * 100}%, ${Math.floor(c / v.w) * 100}%)` });

  // Ce qui vient de se passer se montre un instant sur la grille : une caisse qui vole en
  // éclats, le nom du bonus ramassé, un joueur qui s'envole. On le lit dans ce qui a changé
  // depuis l'image d'avant.
  const [fx, setFx] = useState<Fx[]>([]);
  const fxId = useRef(0);
  const prev = useRef<View | null>(null);
  const upsKey = v.ups.map((u) => `${u.c}${u.k}`).join(',');
  const aliveKey = v.players.map((p) => (p.alive ? 1 : 0)).join('');
  useEffect(() => {
    const was = prev.current;
    prev.current = v;
    if (!was || was.grid.length !== v.grid.length) return;
    const add: Fx[] = [];
    for (let c = 0; c < v.grid.length; c++) {
      if (was.grid[c] === 'x' && v.grid[c] === '.') add.push({ id: ++fxId.current, kind: 'pop', cell: c });
    }
    for (const u of was.ups) {
      if (v.ups.some((n) => n.c === u.c)) continue;
      // Ramassé si un joueur s'y tient ; sinon il a brûlé.
      const seat = v.players.findIndex((p) => p.alive && Math.round(p.x) + Math.round(p.y) * v.w === u.c);
      if (seat >= 0) add.push({ id: ++fxId.current, kind: 'word', cell: u.c, seat, text: upWord(u.k, t) });
    }
    was.players.forEach((p, seat) => {
      if (p.alive && !v.players[seat]?.alive) add.push({ id: ++fxId.current, kind: 'dead', x: p.x, y: p.y, seat });
    });
    if (add.length === 0) return;
    setFx((old) => [...old, ...add]);
    const ids = new Set(add.map((f) => f.id));
    setTimeout(() => setFx((old) => old.filter((f) => !ids.has(f.id))), 1100);
    // Seul ce qui change compte : la grille, les bonus, qui est debout.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.grid, upsKey, aliveKey]);
  const pad = (d: string) => ({
    onPointerDown: (e: React.PointerEvent) => { e.preventDefault(); act({ t: 'dir', d }); },
    onPointerUp: () => act({ t: 'dir', d: '' }),
    onPointerLeave: () => act({ t: 'dir', d: '' }),
    onPointerCancel: () => act({ t: 'dir', d: '' }),
  });
  const wait = Math.ceil((v.shrinkAt - now) / 1000);
  const mine = me >= 0 ? v.players[me] : null;
  const ready = Math.ceil((v.startAt - now) / 1000);
  const corner = me < 0 ? '' : [t('en haut à gauche', 'top left'), t('en bas à droite', 'bottom right'), t('en haut à droite', 'top right'), t('en bas à gauche', 'bottom left')][me];
  const alive = v.players.filter((p) => p.alive).length;
  const watching = t('Vous regardez cette partie.', 'You are watching this game.');
  const clock = `${Math.floor(wait / 60)}:${String(wait % 60).padStart(2, '0')}`;
  let guide;
  if (v.over) {
    guide = (
      <Guide tone="wait" title={t('La partie est finie', 'The game is over')}>
        {v.winner < 0
          ? t('Personne n’est resté debout.', 'Nobody was left standing.')
          : v.winner === me
            ? t('Vous êtes le dernier debout.', 'You are the last one standing.')
            : t(`${nameAt(st, v.winner)} est le dernier debout.`, `${nameAt(st, v.winner)} is the last one standing.`)}
      </Guide>
    );
  } else if (ready > 0 && mine) {
    guide = <Guide tone="alert" title={t(`Départ dans ${ready}`, `Starting in ${ready}`)}>{t(`Vous êtes le poseur de bombes cerclé de menthe, ${corner}. Flèches ou ZQSD pour bouger, Espace pour poser une bombe.`, `You are the piece ringed in mint, ${corner}. Arrow keys or WASD to move, Space to lay a bomb.`)}</Guide>;
  } else if (ready > 0) {
    guide = <Guide tone="wait" title={t(`Départ dans ${ready}`, `Starting in ${ready}`)}>{watching}</Guide>;
  } else if (mine && !mine.alive) {
    guide = <Guide tone="wait" title={t('Vous êtes éliminé', 'You are out')}>{t(`Encore ${alive} joueurs debout. Vous jouerez la prochaine partie.`, `${alive} players still standing. You will play the next game.`)}</Guide>;
  } else if (wait <= 0) {
    guide = <Guide tone="alert" title={t('La grille se referme', 'The grid is closing in')}>{t('Les bords se murent case après case, en spirale : gagnez le centre.', 'The edges wall up cell by cell, in a spiral: head for the centre.')}</Guide>;
  } else if (mine) {
    guide = <Guide tone="you" title={t('Faites sauter les caisses, piégez les autres', 'Blow up the crates, trap the others')}>{t('Posez une bombe puis écartez-vous de sa ligne : elle explose en croix après deux secondes et demie. Les caisses cachent des bonus : survolez-en un pour savoir ce qu’il donne.', 'Lay a bomb, then step out of its line: it blows in a cross after two and a half seconds. Crates hide bonuses: hover one to see what it gives.')}</Guide>;
  } else {
    guide = <Guide tone="wait" title={t(`${alive} joueurs debout`, `${alive} players standing`)}>{watching}</Guide>;
  }

  return (
    <div className="pd">
      {guide}
      <div className="pd-hud">
        {mine?.alive && (
          <ul className="pd-stats" aria-label={t('Vos bonus', 'Your bonuses')}>
            <li title={t(`${mine.bombs} bombe${mine.bombs > 1 ? 's' : ''} à la fois`, `${mine.bombs} bomb${mine.bombs === 1 ? '' : 's'} at a time`)}><span className="pd-chip"><Bonus k="b" /></span><b key={mine.bombs}>{mine.bombs}</b><span className="sr">{t('bombes à la fois', 'bombs at a time')}</span></li>
            <li title={t(`Explosion de ${mine.reach} cases`, `Blast of ${mine.reach} cells`)}><span className="pd-chip"><Bonus k="r" /></span><b key={mine.reach}>{mine.reach}</b><span className="sr">{t('cases d’explosion', 'cells of blast')}</span></li>
            <li title={t(`Vitesse ${mine.speed}`, `Speed ${mine.speed}`)}><span className="pd-chip"><Bonus k="s" /></span><b key={mine.speed}>{mine.speed}</b><span className="sr">{t('de vitesse', 'speed')}</span></li>
            {mine.kick && <li title={upName('k', t)}><span className="pd-chip"><Bonus k="k" /></span><span className="sr">{upName('k', t)}</span></li>}
            {mine.pierce && <li title={upName('p', t)}><span className="pd-chip"><Bonus k="p" /></span><span className="sr">{upName('p', t)}</span></li>}
            {mine.vest && <li title={upName('v', t)}><span className="pd-chip"><Bonus k="v" /></span><span className="sr">{upName('v', t)}</span></li>}
            {mine.cursed && <li className="pd-cursed"><span className="pd-chip skull"><Bonus k="x" /></span>{t('Ralenti', 'Slowed')}</li>}
          </ul>
        )}
        {!v.over && ready <= 0 && <span className="pd-clock">{wait > 0 ? t(`La grille se referme dans ${clock}`, `The grid closes in ${clock}`) : t('La grille se referme', 'The grid is closing in')}</span>}
      </div>
      <div className="pd-fit">
      <div className={`pd-grid${v.blasts.length > 0 ? ' shake' : ''}`} style={{ aspectRatio: `${v.w} / ${v.h}`, ['--cw' as string]: `${100 / v.w}%`, ['--ch' as string]: `${100 / v.h}%` }}>
        <Walls grid={v.grid} w={v.w} h={v.h} />
        {v.ups.map((u) => <span key={`u${u.c}${u.k}`} className={u.k === 'x' ? 'pd-up skull' : 'pd-up'} style={at(u.c)} title={upName(u.k, t)}><Bonus k={u.k} /></span>)}
        {v.bombs.map((b) => (
          <span key={`b${b.id}`} className={`pd-bomb${b.at - now < 800 ? ' hot' : ''}`} style={slid(b.c)}><Bomb pierce={b.pierce} /></span>
        ))}
        {/* Une explosion : le cœur, les bras, et leurs bouts arrondis. */}
        {v.blasts.flatMap((b) => {
          const cells = new Set(b.cells);
          return b.cells.map((c, i) => {
            if (c === b.c && i === 0) return <span key={`f${b.id}-c`} className="pd-fire fire-c" style={at(c)} />;
            const row = Math.floor(c / v.w) === Math.floor(b.c / v.w);
            const d = row ? (c > b.c ? 'r' : 'l') : c > b.c ? 'd' : 'u';
            const step = { r: 1, l: -1, d: v.w, u: -v.w }[d];
            return <span key={`f${b.id}-${c}`} className={`pd-fire fire-${row ? 'h' : 'v'}${cells.has(c + step) ? '' : ` tip-${d}`}`} style={at(c)} />;
          });
        })}
        {fx.map((f) => {
          if (f.kind === 'pop') return <span key={f.id} className="pd-pop" style={at(f.cell!)}><i /><i /><i /><i /></span>;
          if (f.kind === 'word') return <b key={f.id} className={`pd-word seat-${f.seat}`} style={at(f.cell!)}>{f.text}</b>;
          return <span key={f.id} className={`pd-player pd-dead seat-${f.seat}`} style={{ transform: `translate(${f.x! * 100}%, ${f.y! * 100}%)` }}><Bomber seat={f.seat!} face="d" /></span>;
        })}
        {v.players.map((p, seat) => p.alive && (
          <span key={seat} className={`pd-player seat-${seat}${seat === me ? ' me' : ''}${p.moving ? ' walk' : ''}${p.vest ? ' vest' : ''}${p.spared ? ' spared' : ''}${p.cursed ? ' cursed' : ''}`} style={{ transform: `translate(${p.x * 100}%, ${p.y * 100}%)`, zIndex: 2 + Math.round(p.y) } as CSSProperties} aria-label={nameAt(st, seat)}>
            <Bomber seat={seat} face={p.face} />
            <span className="pd-tag">{seat === me ? t('Vous', 'You') : nameAt(st, seat)}</span>
            {p.cursed && <span className="pd-skull"><Bonus k="x" /></span>}
          </span>
        ))}
        {ready > 0 && !v.over && <strong className="pd-count" aria-hidden="true" key={ready}>{ready}</strong>}
      </div>
      </div>
      <ul className="pd-legend">
        {v.players.map((p, seat) => (
          <li key={seat} className={`seat-${seat}${p.alive ? '' : ' out'}`}>
            <Avatar code={avatarAt(st, seat)} name={nameAt(st, seat)} />
            <svg className="swatch" viewBox="18 32 12 12" aria-hidden="true"><Emblem seat={seat} /></svg>
            {nameAt(st, seat)}{seat === me && t(' (vous)', ' (you)')}{!p.alive && t(', éliminé', ', out')}
          </li>
        ))}
      </ul>
      {playing && (
        <div className="pd-pad">
          <div className="pd-cross">
            <button className="pd-u" aria-label={t('Haut', 'Up')} {...pad('u')}>▲</button>
            <button className="pd-l" aria-label={t('Gauche', 'Left')} {...pad('l')}>◀</button>
            <button className="pd-r" aria-label={t('Droite', 'Right')} {...pad('r')}>▶</button>
            <button className="pd-d" aria-label={t('Bas', 'Down')} {...pad('d')}>▼</button>
          </div>
          <button className="btn white pd-drop" onPointerDown={(e) => { e.preventDefault(); act({ t: 'bomb' }); }}>{t('Poser une bombe', 'Lay a bomb')}</button>
        </div>
      )}
    </div>
  );
}
