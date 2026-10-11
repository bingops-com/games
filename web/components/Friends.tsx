'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { App, dateOf, profileLink, profilePath, useApp, useT, type Friend } from '@/lib/app';

export default function Friends() {
  // Le registre est relu toutes les quelques secondes avec les amis en ligne : une invitation
  // acceptée de l'autre côté apparaît ici sans recharger la page.
  const { ready, account, lang, friends: list } = useApp();
  const t = useT();
  const [pseudo, setPseudo] = useState('');

  if (!ready) return null;
  if (!account) {
    return (
      <div className="friends">
        <h1>{t('Amis', 'Friends')}</h1>
        <p className="pitch">{t('Connectez-vous pour inviter des joueurs en ami et retrouver leurs profils.', 'Sign in to add players as friends and find their profiles.')}</p>
        <div className="row-actions">
          <button className="btn primary" onClick={() => App.openModal('login')}>{t('Se connecter', 'Sign in')}</button>
          <button className="btn quiet" onClick={() => App.openModal('register')}>{t('Créer un compte', 'Create an account')}</button>
        </div>
      </div>
    );
  }

  // `done` reçoit le pseudo tel que le serveur l'écrit.
  const act = async (action: 'invite' | 'accept' | 'remove', name: string, done: (name: string) => string) => {
    try {
      const out = await App.friend(action, name);
      App.toast(action === 'invite' && out.relation === 'friends' ? nowFriends(out.name) : done(out.name));
      return true;
    } catch (err) {
      App.toast((err as Error).message);
      return false;
    }
  };
  const nowFriends = (name: string) => t(`Vous êtes amis avec ${name}`, `You and ${name} are friends`);
  const invite = async (e: FormEvent) => {
    e.preventDefault();
    const name = pseudo.trim();
    if (name && (await act('invite', name, (n) => t(`Invitation envoyée à ${n}`, `Invitation sent to ${n}`)))) setPseudo('');
  };
  const who = (f: Friend) => <Link href={profilePath(f.name)}>{f.name}</Link>;

  return (
    <div className="friends">
      <h1>{t('Amis', 'Friends')}</h1>
      <form className="invite" onSubmit={invite}>
        <label htmlFor="pseudo">{t('Inviter un joueur', 'Invite a player')}</label>
        <div className="join-row">
          <input id="pseudo" value={pseudo} onChange={(e) => setPseudo(e.target.value)} placeholder={t('Son pseudo', 'Their username')} autoComplete="off" spellCheck={false} maxLength={16} />
          <button className="btn primary">{t('Envoyer l’invitation', 'Send invitation')}</button>
        </div>
        <p className="hint">
          {t('Il ne connaît pas encore votre pseudo ? Envoyez-lui votre profil, il pourra vous inviter depuis la page.', 'They do not know your username yet? Send them your profile: they can invite you from the page.')}{' '}
          <button type="button" className="as-link" onClick={() => App.copy(profileLink(account.name), t('Lien copié', 'Link copied'))}>{t('Copier le lien de mon profil', 'Copy my profile link')}</button>
        </p>
      </form>

      {list && list.received.length > 0 && (
        <section>
          <h2>{t('Invitations reçues', 'Invitations received')}</h2>
          <ul className="people">
            {list.received.map((f) => (
              <li key={f.name}>
                {who(f)}
                <div className="row-actions">
                  <button className="btn primary small" onClick={() => act('accept', f.name, nowFriends)}>{t('Accepter', 'Accept')}</button>
                  <button className="btn quiet small" onClick={() => act('remove', f.name, () => t('Invitation refusée', 'Invitation declined'))}>{t('Refuser', 'Decline')}</button>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {list && list.sent.length > 0 && (
        <section>
          <h2>{t('Invitations envoyées', 'Invitations sent')}</h2>
          <ul className="people">
            {list.sent.map((f) => (
              <li key={f.name}>
                {who(f)}
                <span className="when">{t('En attente de sa réponse', 'Waiting for an answer')}</span>
                <button className="btn quiet small" onClick={() => act('remove', f.name, () => t('Invitation annulée', 'Invitation cancelled'))}>{t('Annuler l’invitation', 'Cancel invitation')}</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {list && (
        <section>
          <h2>{t('Vos amis', 'Your friends')}</h2>
          {list.friends.length === 0 ? (
            <p className="hint">{t('Pas encore d’ami. Invitez un joueur par son pseudo, ou envoyez-lui le lien de votre profil.', 'No friends yet. Invite a player by their username, or send them your profile link.')}</p>
          ) : (
            <ul className="people">
              {list.friends.map((f) => (
                <li key={f.name}>
                  {who(f)}
                  <span className="when">{t(`Amis depuis ${dateOf(f.since, lang)}`, `Friends since ${dateOf(f.since, lang)}`)}</span>
                  <button className="btn quiet small" onClick={() => act('remove', f.name, (n) => t(`${n} retiré de vos amis`, `${n} removed from your friends`))}>{t('Retirer', 'Remove')}</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}
