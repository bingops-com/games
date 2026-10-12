'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { App, useApp, useT } from '@/lib/app';
import { Ic } from './ui';
import { RecoveryForm } from './RecoveryCodes';

// Mon compte : les codes de récupération, le mot de passe et les joueurs bloqués.
export default function Account() {
  const { ready, account } = useApp();
  const t = useT();
  const [busy, setBusy] = useState(false);
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
  const regenerate = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    setBusy(true);
    try {
      await App.regenerateRecoveryCodes(String(new FormData(form).get('password')));
      form.reset();
    } catch (err) {
      App.toast((err as Error).message);
    } finally {
      setBusy(false);
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
        <h2><Ic name="lock" />{t('Codes de récupération', 'Recovery codes')}</h2>
        <p className="notice" role="status">{account.recoveryCodesRemaining > 0
          ? t(`${account.recoveryCodesRemaining} codes disponibles. Ils ne sont pas réaffichés : gardez votre copie en lieu sûr.`, `${account.recoveryCodesRemaining} codes available. They cannot be shown again: keep your copy somewhere safe.`)
          : t('Vous n’avez aucun code de récupération. Créez-en maintenant pour pouvoir retrouver votre compte.', 'You have no recovery codes. Create some now so you can recover your account.')}</p>
        <p className="hint">{t('Créer de nouveaux codes invalide tous les anciens et déconnecte vos autres appareils. Sans mot de passe ni codes, le compte ne peut pas être récupéré.', 'Creating new codes invalidates all previous ones and signs out your other devices. Without your password or codes, the account cannot be recovered.')}</p>
        <form className="stack" onSubmit={regenerate}>
          <label>{t('Mot de passe actuel', 'Current password')}<input name="password" type="password" autoComplete="current-password" required maxLength={128} /></label>
          <button className="btn primary" disabled={busy}>{t('Créer de nouveaux codes', 'Create new codes')}</button>
        </form>
      </section>

      <section>
        <h2><Ic name="key" />{t('Mot de passe', 'Password')}</h2>
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
        <h2><Ic name="block" />{t('Joueurs bloqués', 'Blocked players')}</h2>
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

export function Reset() {
  const t = useT();
  const router = useRouter();
  return (
    <div className="friends account">
      <h1>{t('Récupérer mon compte', 'Recover my account')}</h1>
      <RecoveryForm onSuccess={() => router.push('/')} />
    </div>
  );
}
