'use client';

import { useEffect, useState } from 'react';
import { useT } from '@/lib/app';
import type { Stroke } from '@/lib/sketch';
import { nameAt, useNow, type StageProps } from '@/lib/table';
import Guide from './Guide';
import Pad from './Pad';

interface Item {
  seat: number;
  text: string;
  strokes: Stroke[];
  draw: boolean;
}

interface View {
  phase: 'write' | 'draw' | 'describe' | 'album' | 'over';
  round: number;
  rounds: number;
  deadline: number;
  done: boolean[];
  out: boolean[];
  prompt: Item | null;
  text: string;
  strokes: Stroke[];
  chain: number;
  chains: number;
  pages: Item[];
  total: number;
  reader: number;
}

export default function GartikStage({ st, skew, act }: StageProps<View>) {
  const t = useT();
  const v = st.view;
  const me = st.seat;
  const now = useNow() + skew;
  const [text, setText] = useState('');
  // Une nouvelle manche : le champ repart de ce que le serveur a gardé.
  useEffect(() => setText(v.text), [v.round, v.phase]); // eslint-disable-line react-hooks/exhaustive-deps
  const left = Math.max(0, Math.ceil((v.deadline - now) / 1000));
  const done = me >= 0 && v.done[me];
  const ready = v.done.filter((d, seat) => d && !v.out[seat]).length;
  const playing = v.done.filter((_, seat) => !v.out[seat]).length;
  const nothing = t('(rien écrit)', '(nothing written)');
  const write = (w: string) => {
    setText(w);
    act({ t: 'text', text: w });
  };

  if (v.phase === 'album' || v.phase === 'over') {
    const page = v.pages[v.pages.length - 1];
    const before = v.pages[v.pages.length - 2];
    const reader = me === v.reader;
    const last = v.pages.length === v.total && v.chain === v.chains - 1;
    const show = (item: Item, small?: boolean) => (
      <figure key={`${v.chain}-${v.pages.indexOf(item)}-${small ? 's' : 'l'}`} className={`gk-page${small ? ' small' : ''}`}>
        <figcaption>{item.draw ? t(`${nameAt(st, item.seat)} a dessiné`, `${nameAt(st, item.seat)} drew`) : v.pages.indexOf(item) === 0 ? t(`${nameAt(st, item.seat)} a écrit`, `${nameAt(st, item.seat)} wrote`) : t(`${nameAt(st, item.seat)} a vu`, `${nameAt(st, item.seat)} saw`)}</figcaption>
        {item.draw ? <Pad strokes={item.strokes} k={`album-${v.chain}-${v.pages.indexOf(item)}`} /> : <blockquote>{item.text || nothing}</blockquote>}
      </figure>
    );
    return (
      <div className="gartik">
        {v.phase === 'over'
          ? <Guide tone="wait" title={t('Tous les albums sont lus', 'Every album has been read')} />
          : reader
            ? <Guide tone="you" title={t(`Album ${v.chain + 1} sur ${v.chains} : tournez les pages`, `Album ${v.chain + 1} of ${v.chains}: turn the pages`)}>{t('Tout le monde voit la même page que vous. Prenez le temps de rire.', 'Everyone sees the same page as you. Take the time to laugh.')}</Guide>
            : <Guide tone="wait" title={t(`Album ${v.chain + 1} sur ${v.chains} : ${nameAt(st, v.reader)} tourne les pages`, `Album ${v.chain + 1} of ${v.chains}: ${nameAt(st, v.reader)} turns the pages`)} />}
        {page && (
          <div className="gk-album">
            {before && show(before, true)}
            {show(page)}
          </div>
        )}
        {v.phase === 'album' && (
          <div className="gk-foot">
            <span>{t(`Page ${v.pages.length} sur ${v.total}`, `Page ${v.pages.length} of ${v.total}`)}</span>
            {reader && <button className="btn white" onClick={() => act({ t: 'next' })}>{last ? t('Refermer le dernier album', 'Close the last album') : v.pages.length === v.total ? t('Album suivant', 'Next album') : t('Page suivante', 'Next page')}</button>}
          </div>
        )}
      </div>
    );
  }

  let guide;
  if (me < 0) guide = <Guide tone="wait" title={t('Vous regardez cette partie', 'You are watching this game')} />;
  else if (done) guide = <Guide tone="wait" title={t(`C’est noté. ${ready} sur ${playing} ont terminé`, `Noted. ${ready} of ${playing} are done`)} />;
  else if (v.phase === 'write') guide = <Guide tone="you" title={t('Écrivez une phrase à faire dessiner', 'Write a sentence for someone to draw')}>{t('Un autre joueur devra la dessiner, sans savoir qui l’a écrite. Soyez précis, ou cruel.', 'Another player will have to draw it, without knowing who wrote it. Be precise, or cruel.')}</Guide>;
  else if (v.phase === 'draw') guide = <Guide tone="you" title={t(`Dessinez : « ${v.prompt?.text || nothing} »`, `Draw: "${v.prompt?.text || nothing}"`)}>{t('Le joueur suivant ne verra que votre dessin, et devra dire ce que c’est.', 'The next player will only see your drawing, and must say what it is.')}</Guide>;
  else guide = <Guide tone="you" title={t('Décrivez ce dessin en une phrase', 'Describe this drawing in one sentence')}>{t('Le joueur suivant dessinera votre phrase, sans voir ce dessin.', 'The next player will draw your sentence, without seeing this drawing.')}</Guide>;

  const field = (label: string) => (
    <label className="gk-field">
      {label}
      <input lang="fr" value={text} onChange={(e) => write(e.target.value)} disabled={done} maxLength={120} autoComplete="off" autoFocus />
    </label>
  );
  return (
    <div className="gartik">
      {guide}
      {me >= 0 && (
        <>
          {v.phase === 'write' && <div className="gk-write">{field(t('Votre phrase', 'Your sentence'))}</div>}
          {v.phase === 'draw' && <Pad strokes={v.strokes} act={done ? undefined : act} k={`draw-${v.round}`} />}
          {v.phase === 'describe' && (
            <>
              <Pad strokes={v.prompt?.strokes ?? []} k={`see-${v.round}`} />
              {field(t('Ce que vous voyez', 'What you see'))}
            </>
          )}
        </>
      )}
      <div className="gk-foot">
        <span>{t(`Manche ${v.round} sur ${v.rounds}, ${left} s`, `Round ${v.round} of ${v.rounds}, ${left} s`)}</span>
        <span>{t(`${ready} sur ${playing} ont terminé`, `${ready} of ${playing} done`)}</span>
        {me >= 0 && (done
          ? <button className="btn onsea" onClick={() => act({ t: 'done', v: false })}>{t('Modifier', 'Change it')}</button>
          : <button className="btn white" onClick={() => act({ t: 'done', v: true })}>{t('Terminé', 'Done')}</button>)}
      </div>
    </div>
  );
}
