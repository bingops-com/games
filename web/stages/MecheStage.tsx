'use client';

import { play } from '@/lib/sound';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useT } from '@/lib/app';
import { Avatar } from '@/lib/avatar';
import { Name } from '@/lib/shop';
import type { T } from '@/lib/i18n';
import { avatarAt, fxAt, nameAt, type StageProps, type TableState } from '@/lib/table';
import Guide from './Guide';

interface Last {
  seat: number;
  word: string;
  result: string;
}

interface View {
  lives: number[];
  turn: number;
  syllable: string;
  typing: string;
  last: Last | null;
  words: number;
  winner: number;
}

// Les joueurs en cercle autour de la bombe, vous en bas. `r` rapproche du centre : la
// bombe se tient du côté de celui qui la tient.
function around(i: number, n: number, r = 50) {
  const a = Math.PI / 2 + (2 * Math.PI * i) / n;
  return { left: `${50 + r * Math.cos(a)}%`, top: `${50 + r * Math.sin(a)}%` };
}

const HEART = <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 21C5 16 2 12.5 2 8.5A5 5 0 0 1 12 6a5 5 0 0 1 10 2.5c0 4-3 7.5-10 12.5z" /></svg>;

function lastLine(st: TableState, last: Last, t: T) {
  const who = nameAt(st, last.seat);
  switch (last.result) {
    case 'ok':
      return t(`${who} : « ${last.word} », la bombe passe.`, `${who}: "${last.word}", the bomb moves on.`);
    case 'boom':
      return t(`La bombe a explosé dans les mains de ${who}.`, `The bomb went off in ${who}'s hands.`);
    case 'inconnu':
      return t(`« ${last.word} » n'est pas dans le dictionnaire.`, `"${last.word}" is not in the French dictionary.`);
    case 'déjà joué':
      return t(`« ${last.word} » a déjà été joué.`, `"${last.word}" was already played.`);
    default:
      return t(`« ${last.word} » ne contient pas la syllabe.`, `"${last.word}" does not contain the syllable.`);
  }
}

export default function MecheStage({ st, act }: StageProps<View>) {
  const t = useT();
  const v = st.view;
  const me = st.seat;
  const n = v.lives.length;
  const over = st.phase === 'over';
  const mine = !over && v.turn === me;
  const [text, setText] = useState('');
  const field = useRef<HTMLInputElement>(null);
  // La bombe arrive : le champ se vide et prend le curseur.
  useEffect(() => {
    setText('');
    if (mine) field.current?.focus();
  }, [mine, v.syllable]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (text.trim()) act({ t: 'word', w: text });
  };
  const write = (w: string) => {
    setText(w);
    act({ t: 'type', w });
  };
  const order = Array.from({ length: n }, (_, i) => (Math.max(me, 0) + i) % n);
  const boom = v.last?.result === 'boom';

  // La mèche raccourcit : plus la bombe reste chez quelqu'un, plus elle s'agite. Personne
  // ne sait quand elle saute, et ceci ne le dit pas : les paliers sont les mêmes à chaque tour.
  const [tension, setTension] = useState(0);
  useEffect(() => {
    setTension(0);
    if (over) return;
    const a = setTimeout(() => setTension(1), 5000);
    const b = setTimeout(() => setTension(2), 11000);
    return () => {
      clearTimeout(a);
      clearTimeout(b);
    };
  }, [v.turn, v.syllable, v.words, over]);

  // Ce qui vient de se passer, montré là où ça s'est passé : le mot accepté s'envole de son
  // joueur, l'explosion éclate sur celui qui tenait la bombe.
  const sig = `${JSON.stringify(v.last)}|${v.words}|${v.lives.join('')}`;
  const [fx, setFx] = useState<{ id: number; seat: number; word: string; boom: boolean } | null>(null);
  const seen = useRef('');
  useEffect(() => {
    const first = seen.current === '';
    seen.current = sig;
    if (first || !v.last || (v.last.result !== 'ok' && v.last.result !== 'boom')) return;
    play(v.last.result === 'boom' ? 'boom' : 'card');
    setFx((old) => ({ id: (old?.id ?? 0) + 1, seat: v.last!.seat, word: v.last!.word, boom: v.last!.result === 'boom' }));
    const done = setTimeout(() => setFx(null), 1500);
    return () => clearTimeout(done);
    // Seule la signature du coup compte.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sig]);
  const seatAt = (seat: number, r?: number) => around(order.indexOf(seat), n, r);
  const refused = mine && v.last?.seat === me && !['ok', 'boom'].includes(v.last.result);
  const nextSeat = (() => {
    for (let i = 1; i <= n; i++) if (v.lives[(v.turn + i) % n] > 0) return (v.turn + i) % n;
    return v.turn;
  })();
  const holder = nameAt(st, v.turn);
  const syllable = v.syllable.toUpperCase();
  const livesOf = (k: number) => t(`${k} vie${k > 1 ? 's' : ''}`, `${k} ${k === 1 ? 'life' : 'lives'}`);

  let guide;
  if (over) {
    guide = <Guide tone="wait" title={t('La partie est finie', 'The game is over')}>{t(`${v.words} mot${v.words > 1 ? 's' : ''} trouvé${v.words > 1 ? 's' : ''} pendant la partie.`, `${v.words} word${v.words === 1 ? '' : 's'} found during the game.`)}</Guide>;
  } else if (mine) {
    guide = <Guide tone="you" title={t(`Vous tenez la bombe : un mot avec « ${syllable} »`, `You hold the bomb: a word with "${syllable}"`)}>{t('Écrivez un mot français qui contient ces lettres à la suite, puis Entrée. Accents et majuscules ne comptent pas ; un mot déjà joué est refusé. Personne ne sait quand elle explose.', 'Write a French word that contains these letters in a row, then press Enter. Accents and capitals do not matter; a word already played is refused. Nobody knows when it goes off.')}</Guide>;
  } else if (me >= 0 && v.lives[me] === 0) {
    guide = <Guide tone="wait" title={t('Vous êtes éliminé', 'You are out')}>{t('Vous n’avez plus de vie. La partie continue jusqu’au dernier joueur.', 'You have no lives left. The game goes on until one player remains.')}</Guide>;
  } else if (nextSeat === me) {
    guide = <Guide tone="alert" title={t(`${holder} tient la bombe, vous êtes le suivant`, `${holder} holds the bomb, you are next`)}>{t('Elle arrive chez vous avec une nouvelle syllabe : soyez prêt à écrire.', 'It comes to you with a new syllable: be ready to write.')}</Guide>;
  } else {
    guide = <Guide tone="wait" title={t(`${holder} tient la bombe`, `${holder} holds the bomb`)}>{t(`Si elle explose dans ses mains, il perd une vie. Ensuite : ${nameAt(st, nextSeat)}.`, `If it goes off in their hands, they lose a life. Then: ${nameAt(st, nextSeat)}.`)}</Guide>;
  }

  return (
    <div className="meche">
      {guide}
      <div className="ring-fit">
      <div className={`ring${fx?.boom ? ' shake' : ''}`} key={fx?.boom ? `shake-${fx.id}` : 'ring'}>
        <ul>
          {order.map((seat, i) => {
            const dead = v.lives[seat] === 0;
            const holds = !over && v.turn === seat;
            const hit = fx?.boom && fx.seat === seat;
            return (
              <li key={seat} className={`bomber${holds ? ' turn' : ''}${dead ? ' out' : ''}${hit ? ' hit' : ''}`} style={around(i, n)}>
                <Avatar code={avatarAt(st, seat)} name={nameAt(st, seat)} />
                <span className="bomber-name"><Name name={nameAt(st, seat)} fx={fxAt(st, seat)} />{seat === me && t(' (vous)', ' (you)')}</span>
                <span className="bomber-lives" aria-label={dead ? t('éliminé', 'out') : livesOf(v.lives[seat])}>
                  {dead ? t('éliminé', 'out') : <span className="pips" key={v.lives[seat]}>{Array.from({ length: v.lives[seat] }, (_, k) => <i key={k}>{HEART}</i>)}</span>}
                </span>
                {holds && seat !== me && <span className="bomber-typing">{v.typing || '…'}</span>}
              </li>
            );
          })}
        </ul>
        {/* La bombe se tient du côté de celui qui la tient, et glisse chez le suivant. */}
        <div className={`bomb tense-${over ? 0 : tension}`} style={over ? undefined : seatAt(v.turn, 9)}>
          <span className="bomb-body" key={`${v.turn}-${v.words}`}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/games/boom-bomb.webp" alt="" width={640} height={640} />
            {!over && <strong className="syllable" key={v.syllable} aria-label={t(`Syllabe : ${v.syllable}`, `Syllable: ${v.syllable}`)}>{v.syllable}</strong>}
          </span>
        </div>
        {/* Les effets du dernier coup. Purement visuels : la ligne sous l'anneau dit la même chose. */}
        {fx && (
          <div className="meche-fx" aria-hidden="true" key={fx.id}>
            {fx.boom ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img className="blast" src="/games/boom-blast.webp" alt="" style={seatAt(fx.seat, 42)} />
                <b className="meche-badge lost" style={seatAt(fx.seat)}>{t('−1 vie', '−1 life')}</b>
              </>
            ) : (
              <b className="meche-badge" style={seatAt(fx.seat)}>{fx.word}</b>
            )}
          </div>
        )}
      </div>
      </div>

      <p className={`meche-last${refused ? ' refused' : ''}`} role="status">{v.last ? lastLine(st, v.last, t) : t('Écrivez un mot qui contient la syllabe avant que la bombe explose.', 'Write a word that contains the syllable before the bomb goes off.')}</p>

      {me >= 0 && !over && (
        <form className="meche-form" onSubmit={submit}>
          <label htmlFor="word">
            {mine
              ? t(`Un mot français avec « ${syllable} »`, `A French word with "${syllable}"`)
              : v.lives[me] > 0
                ? t(`${holder} tient la bombe`, `${holder} holds the bomb`)
                : t('Vous êtes éliminé', 'You are out')}
          </label>
          <div className="join-row">
            <input id="word" ref={field} lang="fr" value={text} onChange={(e) => write(e.target.value)} disabled={!mine} autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={40} />
            <button className="btn white" disabled={!mine}>{t('Valider', 'Submit')}</button>
          </div>
        </form>
      )}
    </div>
  );
}
