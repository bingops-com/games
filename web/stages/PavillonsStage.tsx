'use client';

import { play } from '@/lib/sound';
import { useEffect, useState, type FormEvent, type CSSProperties } from 'react';
import { useT } from '@/lib/app';
import { Avatar } from '@/lib/avatar';
import type { T } from '@/lib/i18n';
import { avatarAt, nameAt, type StageProps } from '@/lib/table';
import Guide from './Guide';

interface Clue {
  team: number;
  word: string;
  count: number;
}

interface View {
  phase: 'teams' | 'play' | 'over';
  team: number[];
  guide: boolean[];
  ready: boolean;
  words: string[];
  key: number[];
  revealed: boolean[];
  turn: number;
  clue: Clue | null;
  left: number;
  clues: Clue[];
  remain: [number, number];
  winner: number;
  last: { seat: number; i: number; kind: number } | null;
}

// Bâbord est rouge et tribord vert, comme les feux d'un navire ; chacune a aussi sa forme.
const KIND = ['babord', 'tribord', 'neutre', 'interdit'];
const teamName = (team: number, t: T) => (team === 0 ? t('Bâbord', 'Port') : t('Tribord', 'Starboard'));
const kindName = (k: number, t: T) => [t('Bâbord', 'Port'), t('Tribord', 'Starboard'), t('Neutre', 'Neutral'), t('Interdit', 'Forbidden')][k];

function Mark({ k }: { k: number }) {
  return (
    <svg className="mark" viewBox="0 0 12 12" aria-hidden="true">
      {k === 0 && <circle cx="6" cy="6" r="5" />}
      {k === 1 && <path d="M6 .5l5.5 5.5L6 11.5.5 6z" />}
      {k === 2 && <rect x="2" y="5" width="8" height="2" rx="1" />}
      {k === 3 && <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />}
    </svg>
  );
}

function Teams({ st, act }: StageProps<View>) {
  const t = useT();
  const v = st.view;
  const me = st.seat;
  return (
    <div className="pav-teams">
      <Guide tone={v.ready ? 'you' : 'alert'} title={t('Formez les deux équipes', 'Make the two teams')}>
        {t('Dans chaque équipe, un seul joueur connaît la grille et donne les indices ; les autres devinent. Changez de place avec les boutons, puis commencez.', 'In each team, a single player knows the grid and gives the clues; the others guess. Move with the buttons, then begin.')}
      </Guide>
      <div className="pav-sides">
        {[0, 1].map((team) => {
          const seats = v.team.map((x, seat) => (x === team ? seat : -1)).filter((s) => s >= 0);
          const mine = me >= 0 && v.team[me] === team;
          return (
            <section key={team} className={`pav-side side-${KIND[team]}`}>
              <h2><Mark k={team} /> {teamName(team, t)}</h2>
              <ul>
                {seats.map((seat) => (
                  <li key={seat} className="pav-who">
                    <Avatar code={avatarAt(st, seat)} name={nameAt(st, seat)} />
                    <b>{nameAt(st, seat)}{seat === me && t(' (vous)', ' (you)')}</b>
                    <span>{v.guide[seat] ? t('donne les indices', 'gives the clues') : t('devine', 'guesses')}</span>
                  </li>
                ))}
                {seats.length === 0 && <li><span>{t('Personne', 'Nobody')}</span></li>}
              </ul>
              {me >= 0 && (
                <div className="row-actions">
                  {!(mine && !v.guide[me]) && <button className="btn onsea small" onClick={() => act({ t: 'team', team, guide: false })}>{t('Deviner ici', 'Guess here')}</button>}
                  {!(mine && v.guide[me]) && <button className="btn onsea small" onClick={() => act({ t: 'team', team, guide: true })}>{t('Donner les indices ici', 'Give the clues here')}</button>}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {me >= 0 && (
        <div className="pav-begin">
          <button className="btn white" disabled={!v.ready} onClick={() => act({ t: 'begin' })}>{t('Commencer la partie', 'Begin the game')}</button>
          {!v.ready && <span>{t('Il faut dans chaque équipe un seul joueur qui donne les indices, et au moins un qui devine.', 'Each team needs a single player who gives the clues, and at least one who guesses.')}</span>}
        </div>
      )}
    </div>
  );
}

export default function PavillonsStage(props: StageProps<View>) {
  const { st, act } = props;
  const t = useT();
  const v = st.view;
  const me = st.seat;
  const [word, setWord] = useState('');
  const [count, setCount] = useState(1);
  // Un mot retourné s'entend.
  const turned = v.last ? `${v.last.i}` : '';
  useEffect(() => {
    if (turned) play('flip');
  }, [turned]);
  if (v.phase === 'teams') return <Teams {...props} />;

  const myTeam = me >= 0 ? v.team[me] : -1;
  const guide = me >= 0 && v.guide[me];
  const myTurn = v.phase === 'play' && myTeam === v.turn;
  const canGuess = myTurn && !guide && v.clue !== null;
  const giveClue = (e: FormEvent) => {
    e.preventDefault();
    if (!word.trim()) return;
    act({ t: 'clue', word: word.trim(), n: count });
    setWord('');
  };
  const guideOf = (team: number) => nameAt(st, v.team.findIndex((x, seat) => x === team && v.guide[seat]));
  const turnTeam = teamName(v.turn, t);
  // Le rôle du joueur s'écrit sur la pastille de son équipe.
  const mine = guide ? t(' (vous donnez les indices)', ' (you give the clues)') : t(' (vous devinez)', ' (you guess)');

  let banner;
  if (v.phase === 'over') {
    banner = <Guide tone="wait" title={t(`${teamName(v.winner, t)} gagne`, `${teamName(v.winner, t)} wins`)}>{t('La grille est dévoilée : chaque mot montre à qui il était.', 'The grid is revealed: each word shows whose it was.')}</Guide>;
  } else if (myTurn && guide && !v.clue) {
    banner = (
      <Guide tone="you" title={t('À vous : donnez un indice', 'Your turn: give a clue')}>
        {myTeam === 0
          ? t('Un seul mot qui relie plusieurs mots de votre équipe (liseré rouge, rond), et le nombre de mots visés. Évitez tout ce qui évoque le mot interdit, en pointillés.', 'One word that links several of your team’s words (red border, disc), and how many words it points at. Avoid anything that suggests the forbidden word, in dashes.')
          : t('Un seul mot qui relie plusieurs mots de votre équipe (liseré vert, losange), et le nombre de mots visés. Évitez tout ce qui évoque le mot interdit, en pointillés.', 'One word that links several of your team’s words (green border, diamond), and how many words it points at. Avoid anything that suggests the forbidden word, in dashes.')}
      </Guide>
    );
  } else if (myTurn && guide) {
    banner = <Guide tone="wait" title={t('Vos coéquipiers cherchent', 'Your teammates are guessing')}>{t('Ne dites plus rien et ne réagissez pas : l’indice doit suffire.', 'Say nothing more and do not react: the clue must be enough.')}</Guide>;
  } else if (canGuess) {
    const c = v.clue!;
    const title = c.count === 1
      ? t(`À vous : trouvez le mot que vise « ${c.word} »`, `Your turn: find the word "${c.word}" points at`)
      : c.count === 0
        ? t(`À vous : trouvez les mots que vise « ${c.word} »`, `Your turn: find the words "${c.word}" points at`)
        : t(`À vous : trouvez les ${c.count} mots que vise « ${c.word} »`, `Your turn: find the ${c.count} words "${c.word}" points at`);
    banner = <Guide tone="you" title={title}>{t('Cliquez sur un mot pour le retourner. Un mot de votre équipe : vous continuez. Un autre : le tour passe. Le mot interdit : vous perdez. Vous pouvez vous arrêter avec « Passer le tour ».', 'Click a word to turn it over. One of your team’s: you go on. Any other: the turn passes. The forbidden word: you lose. You can stop with "End the turn".')}</Guide>;
  } else if (myTurn) {
    banner = <Guide tone="wait" title={t(`${guideOf(v.turn)} cherche un indice pour vous`, `${guideOf(v.turn)} is thinking of a clue for you`)}>{t('Regardez la grille en attendant : vous devrez retrouver vos mots.', 'Look at the grid meanwhile: you will have to find your words.')}</Guide>;
  } else {
    banner = (
      <Guide tone="wait" title={t(`C’est à ${turnTeam} de jouer`, `${turnTeam} is playing`)}>
        {v.clue
          ? t(`Leur indice : « ${v.clue.word} » ${v.clue.count}. S’ils retournent un de vos mots, il compte pour vous.`, `Their clue: "${v.clue.word}" ${v.clue.count}. If they turn over one of your words, it counts for you.`)
          : t(`${guideOf(v.turn)} cherche un indice.`, `${guideOf(v.turn)} is thinking of a clue.`)}
      </Guide>
    );
  }
  const kinds = [t('un mot de Bâbord', 'a Port word'), t('un mot de Tribord', 'a Starboard word'), t('un mot neutre', 'a neutral word'), t('le mot interdit', 'the forbidden word')];
  const told = v.last && t(`${nameAt(st, v.last.seat)} a retourné « ${v.words[v.last.i]} » : ${kinds[v.last.kind]}.`, `${nameAt(st, v.last.seat)} turned over "${v.words[v.last.i]}": ${kinds[v.last.kind]}.`);

  return (
    <div className="pav">
      {banner}
      <div className="pav-score">
        {[0, 1].map((team) => (
          <div key={team} className={`pav-team side-${KIND[team]}${v.phase === 'play' && v.turn === team ? ' turn' : ''}`}>
            <b><Mark k={team} /> {teamName(team, t)}{myTeam === team && <small>{mine}</small>}</b>
            <span>{t(`${v.remain[team]} mot${v.remain[team] > 1 ? 's' : ''} à trouver`, `${v.remain[team]} word${v.remain[team] === 1 ? '' : 's'} to find`)}</span>
          </div>
        ))}
      </div>

      <div className="pav-now" role="status">
        {v.phase === 'play' && !v.clue && (guide && myTurn ? (
          <form className="pav-clue" onSubmit={giveClue}>
            <label>{t('Votre indice, en un mot', 'Your clue, in one word')}<input value={word} onChange={(e) => setWord(e.target.value)} maxLength={24} autoComplete="off" spellCheck={false} /></label>
            <label>{t('Nombre de mots', 'Number of words')}<select value={count} onChange={(e) => setCount(Number(e.target.value))}>{Array.from({ length: 10 }, (_, i) => <option key={i} value={i}>{i}</option>)}</select></label>
            <button className="btn white">{t('Donner l’indice', 'Give the clue')}</button>
          </form>
        ) : (
          <p>{t(`${turnTeam} : ${guideOf(v.turn)} cherche un indice.`, `${turnTeam}: ${guideOf(v.turn)} is thinking of a clue.`)}</p>
        ))}
        {told && v.phase === 'play' && !v.clue && <p className="pav-told">{told}</p>}
        {v.phase === 'play' && v.clue && (
          <p>
            {t(`Indice de ${turnTeam} :`, `${turnTeam}'s clue:`)} <strong className="clue-word" key={`${v.clue.word}-${v.clues.length}`}>{v.clue.word} <b>{v.clue.count}</b></strong>
            <span>{v.clue.count === 0 ? t('Autant de mots que vous voulez.', 'As many words as you like.') : t(`Encore ${v.left} mot${v.left > 1 ? 's' : ''} au plus.`, `${v.left} more word${v.left === 1 ? '' : 's'} at most.`)}</span>
            {canGuess && <button className="btn onsea small" onClick={() => act({ t: 'end' })}>{t('Passer le tour', 'End the turn')}</button>}
          </p>
        )}
        {v.phase === 'over' && <p>{told}</p>}
      </div>

      <ul className={`pav-grid${guide || v.phase === 'over' ? ' known' : ''}`} lang="fr">
        {v.words.map((w, i) => {
          const k = v.key[i];
          const shown = v.revealed[i];
          return (
            <li key={w} style={{ '--i': i } as CSSProperties}>
              <button
                className={`word${k >= 0 ? ` is-${KIND[k]}` : ''}${shown ? ' shown' : ''}`}
                disabled={!canGuess || shown}
                onClick={() => act({ t: 'guess', i })}
                aria-label={k >= 0 ? `${w}, ${kindName(k, t)}` : w}
              >
                {k >= 0 && <Mark k={k} />}
                <span>{w}</span>
                {shown && <small>{kindName(k, t)}</small>}
              </button>
            </li>
          );
        })}
      </ul>

      {v.clues.length > 0 && (
        <p className="pav-log">
          {t('Indices donnés :', 'Clues given:')} {v.clues.map((c, i) => <span key={i} className={`side-${KIND[c.team]}`}><Mark k={c.team} /> {c.word} {c.count}</span>)}
        </p>
      )}
    </div>
  );
}
