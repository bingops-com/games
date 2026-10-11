'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useT } from '@/lib/app';
import { Avatar } from '@/lib/avatar';
import type { Stroke } from '@/lib/sketch';
import { avatarAt, nameAt, useNow, type StageProps } from '@/lib/table';
import Guide from './Guide';
import Pad from './Pad';

interface Line {
  seat: number;
  text?: string;
  kind: 'guess' | 'found' | 'close';
}

interface View {
  phase: 'choose' | 'draw' | 'reveal' | 'over';
  drawer: number;
  turn: number;
  turns: number;
  scores: number[];
  gained: number[];
  out: boolean[];
  found: boolean[];
  deadline: number;
  drawMs: number;
  choices: string[];
  word: string;
  mask: string;
  strokes: Stroke[];
  log: Line[];
}

export default function SkribStage({ st, skew, act }: StageProps<View>) {
  const t = useT();
  const v = st.view;
  const me = st.seat;
  const now = useNow() + skew;
  const [text, setText] = useState('');
  const log = useRef<HTMLUListElement>(null);
  const drawer = me === v.drawer;
  const artist = nameAt(st, v.drawer);
  const found = me >= 0 && v.found[me];
  const guessing = v.phase === 'draw' && me >= 0 && !drawer && !found;
  const left = Math.max(0, Math.ceil((v.deadline - now) / 1000));
  const share = v.phase === 'draw' ? Math.max(0, Math.min(1, (v.deadline - now) / v.drawMs)) : 0;
  useEffect(() => {
    log.current?.scrollTo(0, log.current.scrollHeight);
  }, [v.log.length]);
  useEffect(() => setText(''), [v.turn]);

  const guess = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    act({ t: 'guess', text });
    setText('');
  };
  const ranking = v.scores.map((score, seat) => ({ seat, score })).sort((a, b) => b.score - a.score);

  let guide;
  if (v.phase === 'over') guide = <Guide tone="wait" title={t('La partie est finie', 'The game is over')} />;
  else if (v.phase === 'reveal') guide = <Guide tone="alert" title={t(`Le mot était « ${v.word} »`, `The word was "${v.word}"`)}>{t('Les points du tour s’ajoutent aux scores.', 'The points of the turn are added to the scores.')}</Guide>;
  else if (v.phase === 'choose' && drawer) guide = <Guide tone="you" title={t('À vous de dessiner : choisissez un mot', 'Your turn to draw: choose a word')}>{t(`Vous avez ${left} secondes, sinon le premier est pris.`, `You have ${left} seconds, or the first one is taken.`)}</Guide>;
  else if (v.phase === 'choose') guide = <Guide tone="wait" title={t(`${artist} choisit un mot à dessiner`, `${artist} is choosing a word to draw`)} />;
  else if (drawer) guide = <Guide tone="you" title={t(`Dessinez « ${v.word} »`, `Draw "${v.word}"`)}>{t('Ni lettres ni chiffres. Chaque joueur qui trouve vous rapporte des points.', 'No letters, no digits. Every player who finds it earns you points.')}</Guide>;
  else if (found) guide = <Guide tone="wait" title={t(`Trouvé : « ${v.word} »`, `Found: "${v.word}"`)} />;
  else if (me < 0) guide = <Guide tone="wait" title={t(`${artist} dessine`, `${artist} is drawing`)} />;
  else guide = <Guide tone="you" title={t(`Devinez ce que ${artist} dessine`, `Guess what ${artist} is drawing`)}>{t('Écrivez vos idées en bas à droite : plus vous trouvez vite, plus vous marquez.', 'Write your ideas at the bottom right: the quicker you find it, the more you score.')}</Guide>;

  return (
    <div className="skrib">
      {guide}
      <div className="sk-top">
        <strong className="sk-word" lang="fr" aria-label={t('Le mot à trouver', 'The word to find')}>{v.phase === 'choose' ? '' : v.word || v.mask}</strong>
        <span>{t(`Tour ${v.turn} sur ${v.turns}`, `Turn ${v.turn} of ${v.turns}`)}</span>
        {v.phase === 'draw' && (
          <span className="timer">
            <span className="timer-bar" aria-hidden="true"><span style={{ width: `${share * 100}%` }} /></span>
            {left} s
          </span>
        )}
      </div>
      <div className="sk-main">
        <div className="sk-draw">
          {v.phase === 'choose' ? (
            <div className="sk-choose" lang="fr">
              {drawer
                ? v.choices.map((w, i) => <button key={w} className="btn white big" onClick={() => act({ t: 'choose', i })}>{w}</button>)
                : <p lang="">{t(`${artist} choisit son mot…`, `${artist} is choosing a word…`)}</p>}
            </div>
          ) : (
            <Pad strokes={v.strokes} act={drawer && v.phase === 'draw' ? act : undefined} k={`${v.turn}`} />
          )}
        </div>
        <aside className="sk-side">
          <ol className="sk-scores" aria-label={t('Scores', 'Scores')}>
            {ranking.map(({ seat, score }) => (
              <li key={seat} className={`${seat === me ? 'me' : ''}${v.out[seat] ? ' out' : ''}`}>
                <Avatar code={avatarAt(st, seat)} name={nameAt(st, seat)} />
                <b>{nameAt(st, seat)}</b>
                <small>{seat === v.drawer && v.phase !== 'over' ? t('dessine', 'drawing') : v.found[seat] ? t('a trouvé', 'found it') : ''}</small>
                <span>{score}{v.phase === 'reveal' && v.gained[seat] > 0 && <i> +{v.gained[seat]}</i>}</span>
              </li>
            ))}
          </ol>
          <ul className="sk-log" ref={log} aria-live="polite">
            {v.log.map((l, i) => (
              <li key={i} className={l.kind}>
                {l.kind === 'found'
                  ? t(`${nameAt(st, l.seat)} a trouvé !`, `${nameAt(st, l.seat)} found it!`)
                  : l.kind === 'close'
                    ? t(`« ${l.text} » : vous y êtes presque`, `"${l.text}": you are close`)
                    : <><b>{nameAt(st, l.seat)}</b> {l.text}</>}
              </li>
            ))}
          </ul>
          {me >= 0 && !drawer && v.phase !== 'over' && (
            <form className="sk-guess" onSubmit={guess}>
              <input lang="fr" value={text} onChange={(e) => setText(e.target.value)} disabled={!guessing} placeholder={guessing ? t('Votre proposition', 'Your guess') : found ? t('Vous avez trouvé', 'You found it') : ''} maxLength={40} autoComplete="off" spellCheck={false} aria-label={t('Votre proposition', 'Your guess')} />
              <button className="btn white" disabled={!guessing}>{t('Envoyer', 'Send')}</button>
            </form>
          )}
        </aside>
      </div>
    </div>
  );
}
