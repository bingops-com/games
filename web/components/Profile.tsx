'use client';

import { Bar, Ic } from './ui';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useEffect, useState } from 'react';
import { GAMES } from '@/games/catalog';
import { App, dateOf, profileLink, useApp, useT, type Relation } from '@/lib/app';
import { GameCover } from '@/lib/art';
import { Avatar } from '@/lib/avatar';
import { Name } from '@/lib/shop';

interface Stat {
  game: string;
  played: number;
  won: number;
}

interface ProfileData {
  name: string;
  since: number;
  friends: number;
  stats: Stat[];
  avatar: string;
  fx: string;
  // Objectifs accomplis, sur combien.
  done: number;
  objectives: number;
  relation?: Relation;
}

// Ce qu'un visiteur peut faire d'un profil dépend de ce qui le lie déjà au joueur.
function Actions({ p, reload }: { p: ProfileData; reload: () => void }) {
  const { account } = useApp();
  const t = useT();
  const friends = t(`Vous êtes amis avec ${p.name}`, `You and ${p.name} are friends`);
  const act = async (action: 'invite' | 'accept' | 'remove', done: string) => {
    try {
      const out = await App.friend(action, p.name);
      App.toast(action === 'invite' && out.relation === 'friends' ? friends : done);
      reload();
    } catch (err) {
      App.toast((err as Error).message);
    }
  };
  if (!account) {
    return (
      <div className="actions">
        <button className="btn primary" onClick={() => App.openModal('login')}>{t('Se connecter pour l’inviter', 'Sign in to invite them')}</button>
        <p className="hint">{t(`Il faut un compte pour inviter ${p.name} en ami.`, `You need an account to add ${p.name} as a friend.`)} <button className="as-link" onClick={() => App.openModal('register')}>{t('Créer un compte', 'Create an account')}</button></p>
      </div>
    );
  }
  switch (p.relation) {
    case 'self':
      return (
        <div className="actions">
          <div className="row-actions">
            <button className="btn primary" onClick={() => App.copy(profileLink(p.name), t('Lien copié', 'Link copied'))}><Ic name="link" />{t('Copier le lien du profil', 'Copy profile link')}</button>
            <button className="btn quiet" onClick={() => App.openModal('avatar')}><Ic name="pencil" />{t('Modifier mon avatar', 'Edit my avatar')}</button>
          </div>
          <p className="hint">{t('Votre profil est public : toute personne qui a ce lien voit votre pseudo, vos statistiques et votre nombre d’amis, et peut vous inviter.', 'Your profile is public: anyone with this link sees your username, your statistics and how many friends you have, and can invite you.')}</p>
        </div>
      );
    case 'friends':
      return (
        <div className="actions">
          <p className="state">{t('Vous êtes amis.', 'You are friends.')}</p>
          <button className="btn quiet" onClick={() => act('remove', t(`${p.name} retiré de vos amis`, `${p.name} removed from your friends`))}>{t('Retirer de mes amis', 'Remove from my friends')}</button>
        </div>
      );
    case 'sent':
      return (
        <div className="actions">
          <p className="state">{t('Invitation envoyée, en attente de sa réponse.', 'Invitation sent, waiting for an answer.')}</p>
          <button className="btn quiet" onClick={() => act('remove', t('Invitation annulée', 'Invitation cancelled'))}>{t('Annuler l’invitation', 'Cancel invitation')}</button>
        </div>
      );
    case 'received':
      return (
        <div className="actions">
          <p className="state">{t(`${p.name} vous a invité en ami.`, `${p.name} invited you as a friend.`)}</p>
          <div className="row-actions">
            <button className="btn primary" onClick={() => act('accept', friends)}>{t('Accepter l’invitation', 'Accept invitation')}</button>
            <button className="btn quiet" onClick={() => act('remove', t('Invitation refusée', 'Invitation declined'))}>{t('Refuser', 'Decline')}</button>
          </div>
        </div>
      );
    default:
      return (
        <div className="actions">
          <button className="btn primary" onClick={() => act('invite', t(`Invitation envoyée à ${p.name}`, `Invitation sent to ${p.name}`))}><Ic name="invite" />{t('Inviter en ami', 'Add as a friend')}</button>
        </div>
      );
  }
}

export default function Profile() {
  const { ready, account, lang, avatar } = useApp();
  const t = useT();
  const name = useSearchParams().get('n') ?? '';
  const [found, setFound] = useState<{ for: string; p?: ProfileData; error?: string } | null>(null);
  const [version, setVersion] = useState(0);
  const viewer = account?.name;
  useEffect(() => {
    if (!ready || !name) return;
    let stale = false;
    App.api<ProfileData>(`/api/profile/${encodeURIComponent(name)}`)
      .then((p) => !stale && setFound({ for: name, p }))
      .catch((err: Error) => !stale && setFound({ for: name, error: err.message }));
    return () => {
      stale = true;
    };
  }, [ready, name, viewer, version, lang, avatar]);

  const home = <Link href="/">{t('Revenir aux jeux', 'Back to the games')}</Link>;
  if (!name) return <p className="notice">{t('Cette adresse ne désigne aucun joueur.', 'This address names no player.')} {home}</p>;
  if (!found || found.for !== name) return null;
  if (!found.p) return <p className="notice">{found.error}. {home}</p>;

  const p = found.p;
  const by = new Map(p.stats.map((s) => [s.game, s]));
  const played = p.stats.reduce((n, s) => n + s.played, 0);
  const won = p.stats.reduce((n, s) => n + s.won, 0);
  // Le jeu auquel il a le plus joué.
  const most = [...p.stats].sort((a, b) => b.played - a.played)[0];
  const best = most && most.played > 0 ? GAMES.find((g) => g.id === most.game) : undefined;
  const games = (n: number) => t(`${n} partie${n > 1 ? 's' : ''}`, `${n} game${n === 1 ? '' : 's'}`);
  const wins = (n: number) => t(`${n} victoire${n > 1 ? 's' : ''}`, `${n} win${n === 1 ? '' : 's'}`);
  const friends = p.friends ? t(`${p.friends} ami${p.friends > 1 ? 's' : ''}`, `${p.friends} friend${p.friends === 1 ? '' : 's'}`) : t('pas encore d’ami', 'no friends yet');
  return (
    <div className="profile">
      <section className="paper">
        <h1><Name name={p.name} fx={p.fx} /></h1>
        <p className="pitch">{t(`Joueur depuis ${dateOf(p.since, lang)}, ${friends}.`, `Playing since ${dateOf(p.since, lang)}, ${friends}.`)}</p>
        <dl className="facts">
          <div><dt>{t('Jeu préféré', 'Favourite game')}</dt><dd>{best ? best.name : t('Pas encore', 'Not yet')}</dd></div>
          <div><dt>{t('Victoires', 'Wins')}</dt><dd>{played > 0 ? `${Math.round((100 * won) / played)} %` : '0 %'}</dd></div>
          <div><dt>{t('Objectifs', 'Objectives')}</dt><dd>{p.done}/{p.objectives}</dd></div>
        </dl>
        <Bar value={p.done} max={p.objectives} label={t('Objectifs accomplis', 'Objectives reached')} />
        <Actions p={p} reload={() => setVersion((v) => v + 1)} />
      </section>
      <section className="sea sheet" aria-label={t(`Statistiques de ${p.name}`, `${p.name}'s statistics`)}>
        <div className="sheet-head">
          <Avatar code={p.avatar} name={p.name} className="big" />
          <dl className="totals">
            <div><dd>{played}</dd><dt>{t(played > 1 ? 'parties jouées' : 'partie jouée', played === 1 ? 'game played' : 'games played')}</dt></div>
            <div><dd>{won}</dd><dt>{t(won > 1 ? 'victoires' : 'victoire', won === 1 ? 'win' : 'wins')}</dt></div>
          </dl>
        </div>
        <ul className="sheet-games">
          {GAMES.map((g) => {
            const s = by.get(g.id);
            return (
              <li key={g.id}>
                <GameCover id={g.id} />
                <b>{g.name}</b>
                <span>{s ? `${games(s.played)}, ${wins(s.won)}` : t('Aucune partie', 'No games yet')}</span>
              </li>
            );
          })}
        </ul>
        {played === 0 && <p className="sheet-note">{t('Aucune partie pour l’instant. Une partie compte dès qu’elle est jouée jusqu’au bout avec un compte.', 'No games so far. A game counts once it is played to the end with an account.')}</p>}
      </section>
    </div>
  );
}
