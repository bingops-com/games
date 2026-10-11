'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { App, useApp, useT } from '@/lib/app';

// Mon compte : l'adresse qui permet de récupérer un mot de passe perdu, le mot de passe, et
// les joueurs bloqués. Toucher à l'adresse ou au mot de passe redemande le mot de passe.
export default function Account() {
  const { ready, account } = useApp();
  const t = useT();
  if (!ready) return null;
  if (!account) {
    return (
      <div className="friends">
        <h1>{t('Mon compte', 'My account')}</h1>
        <p className="pitch">{t('Connectez-vous pour régler votre compte.', 'Sign in to manage your account.')}</p>
        <div className="row-actions">
          <button className="btn primary" onClick={() => App.openModal('login')}>{t('Se connecter', 'Sign in')}</button>
        </div>
      </div>
    );
  }
  const saveEmail = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await App.setEmail(String(f.get('email')).trim(), String(f.get('password')));
      App.toast(f.get('email') ? t('Adresse enregistrée', 'Address saved') : t('Adresse retirée', 'Address removed'));
      (form.elements.namedItem('password') as HTMLInputElement).value = '';
    } catch (err) {
      App.toast((err as Error).message);
    }
  };
  const savePassword = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    try {
      await App.api('/api/account/password', { old: f.get('old'), new: f.get('new') });
      App.toast(t('Mot de passe changé. Vos autres appareils sont déconnectés.', 'Password changed. Your other devices are signed out.'));
      form.reset();
    } catch (err) {
      App.toast((err as Error).message);
    }
  };
  return (
    <div className="friends account">
      <h1>{t('Mon compte', 'My account')}</h1>
      <p className="pitch">{account.name}</p>

      <section>
        <h2>{t('Adresse e-mail', 'Email address')}</h2>
        <p className="hint">
          {account.email
            ? t('Si vous perdez votre mot de passe, un lien pour en choisir un autre part à cette adresse. Elle ne sert à rien d’autre et personne ne la voit.', 'If you lose your password, a link to choose another one is sent to this address. It is used for nothing else and nobody sees it.')
            : t('Sans adresse, un mot de passe oublié fait perdre le compte, ses crédits et ses objectifs. Elle ne sert qu’à ça et personne ne la voit.', 'With no address, a forgotten password means losing the account, its credits and its objectives. It is used for that alone and nobody sees it.')}
        </p>
        <form className="stack" onSubmit={saveEmail}>
          <label>
            {t('Adresse e-mail', 'Email address')}
            <input name="email" type="email" defaultValue={account.email} autoComplete="email" maxLength={254} placeholder={t('vous@exemple.fr', 'you@example.com')} />
          </label>
          <label>
            {t('Votre mot de passe, pour confirmer', 'Your password, to confirm')}
            <input name="password" type="password" autoComplete="current-password" required maxLength={128} />
          </label>
          <button className="btn primary">{t('Enregistrer l’adresse', 'Save address')}</button>
        </form>
      </section>

      <section>
        <h2>{t('Mot de passe', 'Password')}</h2>
        <form className="stack" onSubmit={savePassword}>
          <label>
            {t('Mot de passe actuel', 'Current password')}
            <input name="old" type="password" autoComplete="current-password" required maxLength={128} />
          </label>
          <label>
            {t('Nouveau mot de passe', 'New password')}
            <input name="new" type="password" autoComplete="new-password" required minLength={8} maxLength={128} />
          </label>
          <button className="btn primary">{t('Changer le mot de passe', 'Change password')}</button>
        </form>
      </section>

      <section>
        <h2>{t('Joueurs bloqués', 'Blocked players')}</h2>
        {account.blocked.length === 0 ? (
          <p className="hint">{t('Personne. Vous pouvez bloquer un joueur depuis un salon, avec les trois points à côté de son nom.', 'Nobody. You can block a player from a room, with the three dots next to their name.')}</p>
        ) : (
          <ul className="people">
            {account.blocked.map((name) => (
              <li key={name}>
                <b>{name}</b>
                <button className="btn quiet small" onClick={() => App.block('remove', name).catch((err: Error) => App.toast(err.message))}>{t('Débloquer', 'Unblock')}</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

// La page du lien reçu par e-mail : un nouveau mot de passe, et l'on est connecté.
export function Reset() {
  const t = useT();
  const router = useRouter();
  const token = useSearchParams().get('t') ?? '';
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setBusy(true);
    try {
      await App.reset(token, String(new FormData(e.currentTarget).get('password')));
      App.toast(t('Mot de passe changé, vous êtes connecté.', 'Password changed, you are signed in.'));
      router.push('/');
    } catch (err) {
      App.toast((err as Error).message);
      setBusy(false);
    }
  };
  if (!token) return <p className="notice">{t('Ce lien est incomplet.', 'This link is incomplete.')} <Link href="/">{t('Revenir à l’accueil', 'Back to the home page')}</Link></p>;
  return (
    <div className="friends account">
      <h1>{t('Nouveau mot de passe', 'New password')}</h1>
      <p className="pitch">{t('Choisissez-en un nouveau : vos autres appareils seront déconnectés.', 'Choose a new one: your other devices will be signed out.')}</p>
      <form className="stack" onSubmit={submit}>
        <label>
          {t('Nouveau mot de passe', 'New password')}
          <input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} autoFocus />
        </label>
        <button className="btn primary" disabled={busy}>{t('Enregistrer et me connecter', 'Save and sign me in')}</button>
      </form>
    </div>
  );
}
