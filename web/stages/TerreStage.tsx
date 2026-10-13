'use client';

import { play as sound } from '@/lib/sound';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { useT } from '@/lib/app';
import { Avatar } from '@/lib/avatar';
import { Name } from '@/lib/shop';
import type { T } from '@/lib/i18n';
import { avatarAt, fxAt, nameAt, useNow, type StageProps, type TableState } from '@/lib/table';
import Guide from './Guide';

interface Card {
  id: number;
  c: string;
  k: string;
}

interface View {
  top: Card;
  color: string;
  dir: number;
  turn: number;
  deadline: number;
  counts: number[];
  out: boolean[];
  deck: number;
  hand: Card[];
  playable: number[];
  drawn: number;
  said: boolean;
  exposed: number;
  winner: number;
  last: { seat: number; t: string; card?: Card; target: number; n: number } | null;
  turnMs: number;
}

const COLORS = ['corail', 'sable', 'algue', 'lagon'];

// Les mots du jeu dans les deux langues. « Ono ! » se crie « Ono! ».
const colorName = (c: string, t: T) => ({ corail: t('corail', 'coral'), sable: t('sable', 'sand'), algue: t('algue', 'kelp'), lagon: t('lagon', 'lagoon') })[c] ?? c;
const shout = (t: T) => t('« Ono ! »', '"Ono!"');

function cardName(c: Card, t: T) {
  const kind = ({ skip: t('passe ton tour', 'skip'), rev: t('changement de sens', 'reverse'), '+2': t('pioche 2', 'draw 2'), wild: t('joker', 'wild'), '+4': t('joker, pioche 4', 'wild, draw 4') } as Record<string, string>)[c.k] ?? c.k;
  if (!c.c) return kind;
  return t(`${kind} ${colorName(c.c, t)}`, `${colorName(c.c, t)} ${kind}`);
}

// Ce qu'une carte spéciale fait, écrit dessus en petit.
const caption = (k: string, t: T) => ({ skip: t('passe', 'skip'), rev: t('sens', 'reverse'), '+2': t('pioche', 'draw'), wild: t('joker', 'wild'), '+4': t('joker', 'wild') } as Record<string, string>)[k];

// Ce qui peut se poser sur la carte du dessus, en plus de sa couleur.
function figureOf(top: Card, t: T) {
  if (!top.c) return '';
  return ({ skip: t('un « passe ton tour »', 'a skip'), rev: t('un changement de sens', 'a reverse'), '+2': t('un +2', 'a +2') } as Record<string, string>)[top.k] ?? t(`un ${top.k}`, `a ${top.k}`);
}

// Le dernier coup, raconté.
function story(st: TableState, v: View, t: T) {
  const e = v.last;
  if (!e) return t('La partie commence : la carte du milieu donne la couleur.', 'The game begins: the card in the middle sets the colour.');
  const you = e.seat === st.seat;
  const who = nameAt(st, e.seat);
  const toYou = e.target === st.seat;
  const target = e.target >= 0 ? nameAt(st, e.target) : '';
  switch (e.t) {
    case 'play': {
      const card = cardName(e.card!, t);
      let fr = you ? `Vous avez posé ${card}` : `${who} a posé ${card}`;
      let en = you ? `You played ${card}` : `${who} played ${card}`;
      if (!e.card!.c) {
        fr += `, et choisi la couleur ${colorName(v.color, t)}`;
        en += ` and chose ${colorName(v.color, t)}`;
      }
      if (e.n > 0) {
        fr += toYou ? ` : vous piochez ${e.n} cartes et passez votre tour` : ` : ${target} pioche ${e.n} cartes et passe son tour`;
        en += toYou ? `: you draw ${e.n} cards and miss your turn` : `: ${target} draws ${e.n} cards and misses a turn`;
      } else if (e.target >= 0) {
        fr += toYou ? ' : vous passez votre tour' : ` : ${target} passe son tour`;
        en += toYou ? ': you miss your turn' : `: ${target} misses a turn`;
      } else if (e.card!.k === 'rev') {
        fr += ' : le sens du jeu change';
        en += ': the order of play is reversed';
      }
      return t(`${fr}.`, `${en}.`);
    }
    case 'draw':
      return you ? t('Vous avez pioché une carte qui peut être posée.', 'You drew a card that can be played.') : t(`${who} a pioché une carte qui peut être posée.`, `${who} drew a card that can be played.`);
    case 'drawpass':
      return you ? t('Vous avez pioché, sans pouvoir poser : au suivant.', 'You drew and could not play: next player.') : t(`${who} a pioché, sans pouvoir poser : au suivant.`, `${who} drew and could not play: next player.`);
    case 'pass':
      return you ? t('Vous gardez la carte piochée : au suivant.', 'You keep the card you drew: next player.') : t(`${who} garde la carte piochée : au suivant.`, `${who} keeps the card they drew: next player.`);
    case 'timeout':
      return you ? t('Temps écoulé pour vous : une carte piochée, au suivant.', 'You ran out of time: one card drawn, next player.') : t(`Temps écoulé pour ${who} : une carte piochée, au suivant.`, `${who} ran out of time: one card drawn, next player.`);
    case 'terre':
      return you ? t('Vous annoncez « Ono ! » : plus qu’une carte.', 'You call "Ono!": one card left.') : t(`${who} annonce « Ono ! » : plus qu’une carte.`, `${who} calls "Ono!": one card left.`);
    case 'counter': {
      const fr = toYou ? `vous piochez ${e.n} cartes` : `${target} pioche ${e.n} cartes`;
      const en = toYou ? `you draw ${e.n} cards` : `${target} draws ${e.n} cards`;
      return you ? t(`Vous avez signalé l’oubli : ${fr}.`, `You called out the slip: ${en}.`) : t(`${who} a signalé l’oubli : ${fr}.`, `${who} called out the slip: ${en}.`);
    }
  }
  return '';
}

// Chaque couleur a aussi sa forme, pour qui distingue mal les couleurs.
function Suit({ c }: { c: string }) {
  return (
    <svg className="suit" viewBox="0 0 12 12" aria-hidden="true">
      {c === 'corail' && <circle cx="6" cy="6" r="5" />}
      {c === 'sable' && <path d="M6 1l5.5 10h-11z" />}
      {c === 'algue' && <rect x="1.5" y="1.5" width="9" height="9" rx="1.5" />}
      {c === 'lagon' && <path d="M6 .5l5.5 5.5L6 11.5.5 6z" />}
    </svg>
  );
}

function Figure({ k }: { k: string }) {
  if (k === 'skip') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" strokeWidth="3" /><path d="M6.5 17.5l11-11" stroke="currentColor" strokeWidth="3" strokeLinecap="round" /></svg>;
  if (k === 'rev') return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 9h12l-3.5-3.5M19 15H7l3.5 3.5" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  if (k === 'wild') return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="8" r="4" fill="var(--corail)" /><circle cx="16" cy="8" r="4" fill="var(--sable)" /><circle cx="8" cy="16" r="4" fill="var(--algue)" /><circle cx="16" cy="16" r="4" fill="var(--lagon)" /></svg>;
  return <>{k}</>;
}

function Face({ card, as }: { card: Card; as?: string }) {
  const t = useT();
  const color = card.c || as || '';
  const label = caption(card.k, t);
  return (
    <span className={`card ${color ? `card-${color}` : 'card-wild'}`}>
      {color && <Suit c={color} />}
      <span className="figure"><Figure k={card.k} /></span>
      {label && <span className="caption">{label}</span>}
    </span>
  );
}

export default function TerreStage({ st, skew, act }: StageProps<View>) {
  const t = useT();
  const v = st.view;
  const me = st.seat;
  const now = useNow() + skew;
  const [picking, setPicking] = useState<number | null>(null);
  const mine = v.turn === me && v.winner < 0;
  useEffect(() => {
    if (!mine) setPicking(null);
  }, [mine]);

  const left = Math.max(0, Math.ceil((v.deadline - now) / 1000));
  const share = Math.max(0, Math.min(1, (v.deadline - now) / v.turnMs));
  const n = v.counts.length;
  // Les autres joueurs, dans l'ordre où ils jouent après vous.
  const others = Array.from({ length: n }, (_, i) => (Math.max(me, 0) + (me < 0 ? i : i + 1)) % n).slice(0, me < 0 ? n : n - 1);
  // Autour de la table : vous en bas, les autres sur l'arc du haut, de gauche à droite dans
  // l'ordre où ils jouent après vous quand le jeu tourne dans le sens des aiguilles. Les
  // positions sont en pourcentage de la table.
  const span = others.length === 1 ? 0 : Math.min(210, 90 + 24 * others.length);
  const place = (seat: number) => {
    const i = others.indexOf(seat);
    if (i < 0) return { x: 50, y: 97 };
    const a = ((90 + span / 2 - (others.length === 1 ? 0 : (i * span) / (others.length - 1))) * Math.PI) / 180;
    return { x: 50 + 43 * Math.cos(a), y: 50 - 36 * Math.sin(a) };
  };
  const at = (seat: number, more?: Record<string, string | number>) => {
    const { x, y } = place(seat);
    return { '--x': `${x}%`, '--y': `${y}%`, ...more } as CSSProperties;
  };

  // Ce qui vient de se passer, montré sur la table : les cartes piochées qui partent de la
  // pioche vers leur joueur, et un mot sur le siège concerné (« +2 », « Passe », « Ono ! »).
  // Chaque coup a sa signature ; ses effets durent le temps de leur animation.
  const sig = `${JSON.stringify(v.last)}|${v.deck}|${v.counts.join(',')}`;
  const [fx, setFx] = useState<{ id: number; flights: { seat: number; n: number }[]; badges: { seat: number; text: string }[]; call: string }>({ id: 0, flights: [], badges: [], call: '' });
  const seen = useRef('');
  useEffect(() => {
    // Rien à rejouer à l'arrivée sur la table, ni au rechargement de la page.
    const first = seen.current === '';
    seen.current = sig;
    const e = v.last;
    if (first || !e) return;
    const flights: { seat: number; n: number }[] = [];
    const badges: { seat: number; text: string }[] = [];
    // Une carte spéciale s'annonce en grand au milieu de la table.
    const call = e.t === 'play' && e.card && ['+2', '+4', 'skip', 'rev', 'wild'].includes(e.card.k) ? e.card.k : '';
    if (e.t === 'play') {
      if (e.n > 0) {
        flights.push({ seat: e.target, n: e.n });
        badges.push({ seat: e.target, text: `+${e.n}` });
      } else if (e.target >= 0) badges.push({ seat: e.target, text: t('Passe', 'Skip') });
    } else if (e.t === 'draw' || e.t === 'drawpass' || e.t === 'timeout') {
      flights.push({ seat: e.seat, n: 1 });
    } else if (e.t === 'terre') {
      badges.push({ seat: e.seat, text: t('Ono !', 'Ono!') });
    } else if (e.t === 'counter') {
      flights.push({ seat: e.target, n: e.n });
      badges.push({ seat: e.target, text: `+${e.n}` });
    }
    sound(e.t === 'play' ? (e.n > 0 || e.target >= 0 ? 'hit' : 'card') : e.t === 'terre' ? 'call' : e.t === 'counter' ? 'hit' : 'draw');
    setFx((old) => ({ id: old.id + 1, flights, badges, call }));
    const done = setTimeout(() => setFx((old) => ({ ...old, flights: [], badges: [], call: '' })), 1700);
    return () => clearTimeout(done);
    // Seule la signature du coup compte : le reste est lu au moment où elle change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  // La carte posée arrive du siège de celui qui l'a jouée. Le tas est un cadre plus petit
  // que la table : l'écart se compte dans ses unités à lui.
  const from = v.last?.t === 'play' ? place(v.last.seat) : null;
  const landing = from ? ({ '--fx': `${(from.x - 50) / 0.6}cqw`, '--fy': `${(from.y - 52) / 0.46}cqh` } as CSSProperties) : undefined;
  // Le tas garde les dernières cartes posées, chacune un peu de travers comme on les jette.
  // Un joker se souvient de la couleur qu'on lui a donnée.
  const [stack, setStack] = useState<{ card: Card; color: string }[]>([{ card: v.top, color: v.color }]);
  useEffect(() => {
    setStack((old) => [...old.filter((s) => s.card.id !== v.top.id), { card: v.top, color: v.color }].slice(-5));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v.top.id, v.color]);
  const tilt = (id: number) => ({ '--rot': `${((id * 37) % 23) - 11}deg`, '--dx': `${((id * 17) % 13) - 6}%`, '--dy': `${((id * 29) % 9) - 4}%` }) as CSSProperties;
  // Au début de la partie, les cartes se distribuent : une par joueur, sept tours de table,
  // de la pioche vers chaque place. La main et les éventails se remplissent au même rythme,
  // et la première carte du tas se retourne à la fin. Rien de tel si l'on arrive en cours.
  const DEALT = 7;
  const gap = Math.min(70, 1900 / (DEALT * n));
  const dealTime = DEALT * n * gap;
  const [dealing, setDealing] = useState(v.last === null && v.winner < 0);
  useEffect(() => {
    if (!dealing) return;
    const tick = setInterval(() => sound('draw'), 130);
    const done = setTimeout(() => setDealing(false), dealTime + 700);
    const quiet = setTimeout(() => clearInterval(tick), dealTime);
    return () => {
      clearInterval(tick);
      clearTimeout(done);
      clearTimeout(quiet);
    };
    // Une seule fois, à l'arrivée sur la table.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const dealAt = (seat: number, k: number) => `${Math.round((k * n + seat) * gap)}ms`;

  // « À vous ! » : annoncé en grand, un instant, chaque fois que le tour vous revient.
  const [yours, setYours] = useState(0);
  useEffect(() => {
    if (!mine || dealing) return;
    setYours((k) => k + 1);
    const done = setTimeout(() => setYours(0), 1300);
    return () => clearTimeout(done);
  }, [mine, dealing]);

  // Qui vient de recevoir des cartes : sa place tressaute le temps de l'effet.
  const hit = (seat: number) => (fx.badges.some((b) => b.seat === seat && b.text.startsWith('+')) ? ' hit' : '');
  const mustDraw = mine && v.drawn < 0 && v.playable.length === 0;

  const play = (c: Card) => {
    if (!v.playable.includes(c.id)) return;
    if (c.c) return act({ t: 'play', id: c.id });
    setPicking(picking === c.id ? null : c.id);
  };
  const canSay = !v.said && (v.exposed === me || (mine && v.hand.length <= 2));
  const turnName = nameAt(st, v.turn);
  const color = colorName(v.color, t);
  const figure = figureOf(v.top, t);
  const wanted = figure ? t(`une carte ${color}, ${figure} ou un joker`, `a ${color} card, ${figure} or a wild`) : t(`une carte ${color} ou un joker`, `a ${color} card or a wild`);
  const nextSeat = (() => {
    for (let i = 1; i <= n; i++) {
      const seat = (((v.turn + v.dir * i) % n) + n) % n;
      if (!v.out[seat]) return seat;
    }
    return v.turn;
  })();

  let guide;
  if (v.winner >= 0) {
    guide = <Guide tone="wait" title={t('La manche est finie', 'The round is over')}>{v.winner === me ? t('Vous avez posé votre dernière carte.', 'You played your last card.') : t(`${nameAt(st, v.winner)} a posé sa dernière carte.`, `${nameAt(st, v.winner)} played their last card.`)}</Guide>;
  } else if (v.exposed >= 0 && v.exposed !== me && me >= 0) {
    guide = <Guide tone="alert" title={t(`${nameAt(st, v.exposed)} n’a plus qu’une carte et ne l’a pas annoncé`, `${nameAt(st, v.exposed)} has one card left and did not say so`)}>{t('Signalez-le avant le prochain coup : il piochera deux cartes.', 'Call it out before the next move: they will draw two cards.')}</Guide>;
  } else if (v.exposed === me) {
    guide = <Guide tone="alert" title={t('Vous n’avez plus qu’une carte : annoncez « Ono ! »', 'You have one card left: call "Ono!"')}>{t('Vite, avant qu’un autre joueur ne le remarque : sinon vous piochez deux cartes.', 'Quick, before another player notices: otherwise you draw two cards.')}</Guide>;
  } else if (picking !== null) {
    guide = <Guide tone="you" title={t('Choisissez la couleur du joker', 'Choose the colour of the wild card')}>{t('La couleur choisie s’impose au joueur suivant.', 'The next player must follow the colour you choose.')}</Guide>;
  } else if (mine && v.drawn >= 0) {
    guide = <Guide tone="you" title={t('La carte piochée peut être posée', 'The card you drew can be played')}>{t('Posez-la (elle est relevée dans votre main), ou gardez-la et passez.', 'Play it (it is raised in your hand), or keep it and pass.')}</Guide>;
  } else if (mine && v.playable.length === 0) {
    guide = <Guide tone="you" title={t('À vous : aucune carte ne va, piochez', 'Your turn: no card fits, draw one')}>{t(`Il faut ${wanted}. Cliquez sur la pioche.`, `You need ${wanted}. Click the deck.`)}</Guide>;
  } else if (mine) {
    guide = (
      <Guide tone="you" title={t('À vous de jouer', 'Your turn')}>
        {t(`Posez ${wanted} : les cartes relevées conviennent. Sinon, piochez.`, `Play ${wanted}: the raised cards fit. Otherwise, draw.`)}
        {!v.said && v.hand.length === 2 && t(' Il vous restera une carte : annoncez « Ono ! » d’abord.', ' You will have one card left: call "Ono!" first.')}
      </Guide>
    );
  } else if (me < 0) {
    guide = <Guide tone="wait" title={t(`Au tour de ${turnName}`, `${turnName}'s turn`)}>{t('Vous regardez cette partie.', 'You are watching this game.')}</Guide>;
  } else {
    guide = <Guide tone="wait" title={t(`Au tour de ${turnName}`, `${turnName}'s turn`)}>{nextSeat === me ? t('Vous jouez juste après : préparez votre carte.', 'You play right after: get your card ready.') : t(`Ensuite : ${nameAt(st, nextSeat)}.`, `Then: ${nameAt(st, nextSeat)}.`)}</Guide>;
  }

  return (
    <div className="terre">
      {guide}
      <div className={`ono-table${dealing ? ' dealing' : ''}${v.winner < 0 && !dealing ? ' has-turn' : ''}`} style={{ '--deal-end': `${Math.round(dealTime)}ms` } as CSSProperties}>
      <div className={`ono-top glow-${v.color}`} aria-hidden="true" />
      <ul className="rivals">
        {others.map((seat) => {
          const shown = Math.min(v.counts[seat], 7);
          const turn = v.turn === seat && v.winner < 0 && !dealing;
          return (
            <li key={seat} className={`rival${turn ? ' turn' : ''}${v.out[seat] ? ' out' : ''}${hit(seat)}`} style={at(seat, turn ? { '--share': share } : undefined)}>
              <span className="rival-who">
                <Avatar code={avatarAt(st, seat)} name={nameAt(st, seat)} />
                {/* Sa main, dos des cartes : jusqu'à sept montrées, le compte est écrit dessous. */}
                {!v.out[seat] && <span className="rival-fan" aria-hidden="true">{Array.from({ length: shown }, (_, k) => <i key={k} style={{ '--k': k - (shown - 1) / 2, animationDelay: dealing ? dealAt(seat, k) : undefined } as CSSProperties} />)}</span>}
              </span>
              <span className="rival-name"><Name name={nameAt(st, seat)} fx={fxAt(st, seat)} /></span>
              <span className="rival-count" key={v.counts[seat]}>{v.out[seat] ? t('parti', 'left') : t(`${v.counts[seat]} carte${v.counts[seat] > 1 ? 's' : ''}`, `${v.counts[seat]} card${v.counts[seat] === 1 ? '' : 's'}`)}</span>
              {turn && <span className="seat-timer" aria-hidden="true"><i style={{ width: `${share * 100}%` }} /></span>}
              {v.exposed === seat && me >= 0 && <button className="btn white small" onClick={() => act({ t: 'counter' })}>{t('Il n’a pas dit « Ono ! »', 'They did not call "Ono!"')}</button>}
            </li>
          );
        })}
        {/* Votre place, au bord de la table, juste au-dessus de votre main. */}
        {me >= 0 && (
          <li className={`rival me${mine && !dealing ? ' turn' : ''}${hit(me)}`} style={at(me, mine ? { '--share': share } : undefined)}>
            <span className="rival-who"><Avatar code={avatarAt(st, me)} name={nameAt(st, me)} /></span>
            <span className="rival-name"><Name name={nameAt(st, me)} fx={fxAt(st, me)} /></span>
            {mine && <span className="seat-timer" aria-hidden="true"><i style={{ width: `${share * 100}%` }} /></span>}
          </li>
        )}
      </ul>

      <div className="pile">
        <button className={mustDraw ? 'deck must' : 'deck'} aria-label={t('Piocher une carte', 'Draw a card')} disabled={!mine || v.drawn >= 0} onClick={() => act({ t: 'draw' })}>
          <span className="card card-back" aria-hidden="true" />
          <span>{t('Piocher', 'Draw')}</span>
          <small>{t(`${v.deck} carte${v.deck > 1 ? 's' : ''}`, `${v.deck} card${v.deck === 1 ? '' : 's'}`)}</small>
        </button>
        <div className="top">
          {/* Seule la carte du dessus arrive en volant ; celles du dessous restent où elles sont tombées. */}
          {stack.map((s, i) => {
            const last = i === stack.length - 1;
            return (
              <span key={s.card.id} className={last ? 'top-card' : 'top-card under'} aria-hidden={!last} style={{ ...tilt(s.card.id), ...(last ? landing : undefined) }}>
                <Face card={s.card} as={s.color} />
              </span>
            );
          })}
        </div>
        <p className="turn-info">
          <span className={`now-color card-${v.color}`} key={v.color}><Suit c={v.color} /> {t(`Couleur ${color}`, `Colour: ${color}`)}</span>
          {n > 2 && (
            <span className="ono-dir">
              <svg className={v.dir < 0 ? 'back' : undefined} viewBox="0 0 24 24" aria-hidden="true"><path d="M5 13a7 7 0 1 0 2.5-5.4M4 4.5V9h4.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              {v.dir > 0 ? t('Sens des aiguilles', 'Clockwise') : t('Sens inverse', 'Anticlockwise')}
            </span>
          )}
          {v.winner < 0 && (
            <span className="timer">
              <span className="timer-bar" aria-hidden="true"><span style={{ width: `${share * 100}%` }} /></span>
              {t(`${left} s pour jouer`, `${left} s to play`)}
            </span>
          )}
        </p>
      </div>

      {/* Les effets du dernier coup. Purement visuels : le récit sous la table dit la même chose. */}
      <div className="ono-fx" aria-hidden="true" key={fx.id}>
        {/* Notre carte entre déjà dans notre main : les dos en vol sont réservés aux autres places. */}
        {fx.flights.filter((f) => f.seat !== me).flatMap((f) => Array.from({ length: Math.min(f.n, 4) }, (_, k) => <span key={`${f.seat}-${k}`} className="ono-fly card card-back" style={at(f.seat, { '--d': `${k * 110}ms` })} />))}
        {fx.badges.map((b) => <b key={`${b.seat}-${b.text}`} className="ono-badge" style={at(b.seat)}>{b.text}</b>)}
        {fx.call && <span className={`ono-burst glow-${v.color}`} />}
        {yours > 0 && <b className="ono-yours" key={`yours-${yours}`}>{t('À vous !', 'Your turn!')}</b>}
        {fx.call && fx.call !== 'wild' && <b className={`ono-call call-${fx.call === 'rev' && v.dir < 0 ? 'rev back' : fx.call.replace('+', 'plus')}`}><Figure k={fx.call} /></b>}
      </div>
      {/* La distribution : une carte par joueur, sept tours de table. */}
      {dealing && (
        <div className="ono-fx" aria-hidden="true">
          {Array.from({ length: DEALT }, (_, k) => Array.from({ length: n }, (_, seat) => (
            <span key={`${k}-${seat}`} className="ono-fly card card-back" style={at(seat, { '--d': dealAt(seat, k) })} />
          )))}
        </div>
      )}
      </div>
      <p className="story" role="status">{story(st, v, t)}</p>

      {me >= 0 && (
        <div className="mine">
          <div className="row-actions">
            {mine && v.drawn >= 0 && <button className="btn onsea small" onClick={() => act({ t: 'pass' })}>{t('Garder la carte et passer', 'Keep the card and pass')}</button>}
            {canSay && <button className="btn white small say" onClick={() => act({ t: 'terre' })}>{t('Ono !', 'Ono!')}</button>}
            {v.said && v.hand.length <= 2 && <span className="said">{t('« Ono ! » annoncé', '"Ono!" called')}</span>}
          </div>
          {picking !== null && (
            <div className="pick" role="group" aria-label={t('Couleur du joker', 'Colour of the wild card')}>
              <span>{t('Quelle couleur ?', 'Which colour?')}</span>
              {COLORS.map((c) => (
                <button key={c} className={`btn small pick-color card-${c}`} onClick={() => { act({ t: 'play', id: picking, color: c }); setPicking(null); }}>
                  <Suit c={c} /> {colorName(c, t)}
                </button>
              ))}
            </div>
          )}
          <h2 className="hand-title sr">{t(`Votre main, ${v.hand.length} carte${v.hand.length > 1 ? 's' : ''}`, `Your hand, ${v.hand.length} card${v.hand.length === 1 ? '' : 's'}`)}</h2>
          <ul className={`hand${mine && !dealing ? ' choosing' : ''}`} style={{ '--spread': `${Math.min(4.5, 30 / Math.max(1, v.hand.length))}deg` } as CSSProperties}>
            {v.hand.map((c, i) => {
              const ok = v.playable.includes(c.id);
              return (
                <li key={c.id} style={{ '--i': Math.min(i, 10), '--k': i - (v.hand.length - 1) / 2, animationDelay: dealing ? dealAt(Math.max(me, 0), i) : undefined } as CSSProperties}>
                  <button className={`card-btn${ok ? ' ok' : ''}${picking === c.id ? ' picked' : ''}`} disabled={!ok} aria-label={cardName(c, t)} onClick={() => play(c)}>
                    <Face card={c} />
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
