'use client';

import { Bar, Ic } from './ui';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type CSSProperties, type FormEvent } from 'react';
import { GAMES, pitchOf, playersOf } from '@/games/catalog';
import { App, CODE_LENGTH, NAME_MAX, cleanCode, randomName, useApp, useT } from '@/lib/app';
import { GameCover } from '@/lib/art';
import { Avatar, PartIcon, partName } from '@/lib/avatar';
import { howOf, nextObjective, titleOf } from '@/lib/objectives';
import { Name } from '@/lib/shop';
import Link from 'next/link';
import QuickPlay from './QuickPlay';

// Une raison de jouer, sous la carte : la série à garder, sinon l'objectif le plus proche et
// la pièce d'avatar qu'il débloque.
function Nudge() {
  const { account, objectives } = useApp();
  const t = useT();
  const next = nextObjective(objectives);
  if (!next) return null;
  const streak = account?.streak;
  const keep = streak && streak.days > 0 && !streak.today;
  const left = objectives.filter((o) => !o.done).length;
  return (
    <Link className="nudge" href="/objectifs/">
      <span className="goal-part"><PartIcon slot={next.slot} id={next.item} /></span>
      <span className="nudge-text">
        {!account ? (
          <>
            <b>{t(`${left} pièces d’avatar à gagner`, `${left} avatar parts to win`)}</b>
            <small>{t('Créez un compte : chaque partie compte.', 'Create an account: every game counts.')}</small>
          </>
        ) : keep ? (
          <>
            <b>{t(`Série de ${streak.days} jour${streak.days > 1 ? 's' : ''}`, `${streak.days}-day streak`)}</b>
            <small>{t('Une partie aujourd’hui et elle continue.', 'One game today keeps it going.')}</small>
          </>
        ) : (
          <>
            <b>{t(`Prochain objectif : ${titleOf(next, t)}`, `Next objective: ${titleOf(next, t)}`)}</b>
            <small>{howOf(next, t)}, {next.have}/{next.goal}. {t('À la clé', 'Reward')} : {partName(next.slot, next.item, t).toLowerCase()}.</small>
          </>
        )}
      </span>
      {account && !keep && <Bar value={next.have} max={next.goal} />}
    </Link>
  );
}

// L'accueil tient en un geste : un nom, puis créer un salon ou en rejoindre un. Le premier
// jeu se choisit à côté ; c'est le bouton qui crée le salon, jamais un clic sur un jeu.
export default function Home() {
  const { ready, account, guest, lang, avatar, name: shown, objectives } = useApp();
  const t = useT();
  const router = useRouter();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  // Le premier jeu du salon : choisi ici, lancé plus tard dans le salon.
  const [pick, setPick] = useState(GAMES[0].id);
  const picked = GAMES.find((g) => g.id === pick) ?? GAMES[0];
  useEffect(() => setName(guest), [guest]);

  const enter = async (path: () => Promise<string>) => {
    if (busy) return;
    if (!account && !App.rename(name)) return App.toast(t('Choisissez d’abord un nom.', 'Pick a name first.'));
    setBusy(true);
    try {
      router.push(`/t/?code=${await path()}`);
    } catch (err) {
      App.toast((err as Error).message);
      setBusy(false);
    }
  };
  const create = () => enter(async () => (await App.openTable(pick)).code);
  // Partie publique : la liste des salons publics, par jeu, s'ouvre par-dessus l'accueil.
  const [quick, setQuick] = useState(false);
  const joinPublic = (room: string) => enter(async () => {
    await App.api(`/api/tables/${room}`);
    return room;
  });
  const openPublic = (game: string) => enter(async () => (await App.openTable(game, true)).code);
  const join = (e: FormEvent) => {
    e.preventDefault();
    if (code.length < CODE_LENGTH) return App.toast(t(`Un code de salon fait ${CODE_LENGTH} lettres.`, `A room code has ${CODE_LENGTH} letters.`));
    void enter(async () => {
      await App.api(`/api/tables/${code}`);
      return code;
    });
  };

  return (
    <div className="home">
      <section className="start">
        <h1>{t('On joue ?', 'Shall we play?')}</h1>
        <p className="start-lead">{t('Six jeux pour jouer entre amis, même à distance. Créez un salon, partagez le lien, et c’est parti.', 'Six games to play with friends, even far apart. Create a room, share the link, and off you go.')}</p>

        <div className="start-card panel">
          <div className="start-who">
            <button className="start-avatar" disabled={!ready} onClick={() => App.openModal('avatar')} aria-label={t('Modifier mon avatar', 'Edit my avatar')}>
              {ready && <Avatar code={avatar} name={shown} />}
              <span><Ic name="pencil" />{t('Modifier', 'Edit')}</span>
            </button>
            {account ? (
              <p className="start-name">
                <b><Name name={account.name} fx={account.fx} /></b>
                <small>{t('Vos parties sont comptées.', 'Your games are counted.')}</small>
              </p>
            ) : (
              <div className="start-field">
                <div className="field-head">
                  <label htmlFor="name">{t('Votre nom', 'Your name')}</label>
                  <button type="button" className="as-link" disabled={!ready} onClick={() => App.rename(randomName())}><Ic name="dice" />{t('Un autre nom', 'Another name')}</button>
                </div>
                <input id="name" value={name} onChange={(e) => setName(e.target.value)} onBlur={() => name.trim() && App.rename(name)} maxLength={NAME_MAX} autoComplete="nickname" disabled={!ready} />
              </div>
            )}
          </div>
          <div className="start-go">
            <button className="btn primary big" disabled={!ready || busy} onClick={create}><Ic name="wheel" />{t('Créer un salon', 'Create a room')}</button>
            <button className="btn quiet big" disabled={!ready || busy} onClick={() => setQuick(true)} title={t('Les salons publics qui attendent des joueurs, par jeu', 'The public rooms waiting for players, by game')}><Ic name="compass" />{t('Partie publique', 'Public game')}</button>
          </div>
          <p className="start-pick">{t('Premier jeu', 'First game')} : <b>{picked.name}</b></p>
          <p className="start-or"><span>{t('ou', 'or')}</span></p>
          <form className="start-join" onSubmit={join}>
            <label htmlFor="code">{t('Rejoindre avec un code', 'Join with a code')}</label>
            <div className="join-row">
              <input id="code" className="code-field" value={code} onChange={(e) => setCode(cleanCode(e.target.value))} placeholder="ABCD" autoComplete="off" autoCapitalize="characters" spellCheck={false} />
              <button className="btn quiet" disabled={!ready || busy}><Ic name="anchor" />{t('Rejoindre', 'Join')}</button>
            </div>
          </form>
        </div>
        {ready && <Nudge />}
        {quick && <QuickPlay busy={busy} join={joinPublic} open={openPublic} close={() => setQuick(false)} />}
      </section>

      <section className="sea games">
        <h2 id="games-title">{t('On commence par quoi ?', 'What do we start with?')}</h2>
        <p className="games-lead">{t('Vous pourrez changer de jeu dans le salon.', 'You can switch games once in the room.')}</p>
        <ul role="radiogroup" aria-labelledby="games-title">
          {GAMES.map((g, i) => (
            <li key={g.id} style={{ '--i': i } as CSSProperties}>
              <button className={`game-tile${g.id === pick ? ' on' : ''}`} role="radio" aria-checked={g.id === pick} disabled={!ready || busy} onClick={() => setPick(g.id)}>
                <GameCover id={g.id} big />
                <b>{g.name}</b>
                <small>{playersOf(g, t)}<span className="tile-min">, {g.minutes} min</span></small>
                <span className="tile-pitch">{pitchOf(g, lang)}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
