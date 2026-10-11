'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { App, useApp, useT } from '@/lib/app';
import { Ic } from './ui';

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
      const out = await App.setEmail(String(f.get('email')).trim(), String(f.get('password')));
      App.toast(out.emailChecked ? t('Adresse enregistrée', 'Address saved') : t('Adresse enregistrée. Un lien y part pour la confirmer.', 'Address saved. A link is on its way to confirm it.'));
      (form.elements.namedItem('password') as HTMLInputElement).value = '';
    } catch (err) {
      App.toast((err as Error).message);
    }
  };
  const resend = () => App.resendCheck().then(() => App.toast(t(`Lien envoyé à ${account.email}`, `Link sent to ${account.email}`)), (err: Error) => App.toast(err.message));
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
        {account.email ? (
          <p className={account.emailChecked ? 'email-state ok' : 'email-state'} role="status">
            <Ic name={account.emailChecked ? 'check' : 'lock'} />
            {account.emailChecked
              ? t('Adresse confirmée : elle peut servir à retrouver votre mot de passe.', 'Address confirmed: it can be used to recover your password.')
              : t('Pas encore confirmée : ouvrez le lien envoyé à cette adresse. Tant qu’elle ne l’est pas, un mot de passe oublié ne se récupère pas.', 'Not confirmed yet: open the link sent to this address. Until then, a forgotten password cannot be recovered.')}
            {!account.emailChecked && <button className="as-link" onClick={resend}>{t('Renvoyer le lien', 'Send the link again')}</button>}
          </p>
        ) : (
          <p className="email-state" role="status"><Ic name="lock" />{t('Ce compte n’a pas d’adresse : un mot de passe oublié le ferait perdre. Donnez-en une.', 'This account has no address: a forgotten password would lose it. Give one.')}</p>
        )}
        <p className="hint">{t('Elle ne sert qu’à ça, et personne ne la voit.', 'It is used for that alone, and nobody sees it.')}</p>
        <form className="stack" onSubmit={saveEmail}>
          <label>
            {t('Adresse e-mail', 'Email address')}
            <input name="email" type="email" defaultValue={account.email} autoComplete="email" required maxLength={254} placeholder={t('vous@exemple.fr', 'you@example.com')} />
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

// La page du lien de confirmation : l'adresse est confirmée dès qu'on l'ouvre, connecté ou non.
export function Confirm() {
  const t = useT();
  const token = useSearchParams().get('t') ?? '';
  const [state, setState] = useState<{ email?: string; error?: string }>({});
  useEffect(() => {
    if (!token) return;
    App.confirmEmail(token).then((email) => setState({ email }), (err: Error) => setState({ error: err.message }));
  }, [token]);
  const home = <Link className="btn primary" href="/">{t('Aller jouer', 'Go and play')}</Link>;
  if (!token) return <p className="notice">{t('Ce lien est incomplet.', 'This link is incomplete.')} <Link href="/">{t('Revenir à l’accueil', 'Back to the home page')}</Link></p>;
  return (
    <div className="friends account">
      <h1>{t('Votre adresse e-mail', 'Your email address')}</h1>
      {state.email && (
        <>
          <p className="pitch">{t(`${state.email} est confirmée. Si vous perdez votre mot de passe, un lien pour en choisir un autre y sera envoyé.`, `${state.email} is confirmed. If you lose your password, a link to choose another one will be sent there.`)}</p>
          {home}
        </>
      )}
      {state.error && (
        <>
          <p className="pitch">{state.error}</p>
          <p className="hint">{t('Un lien de confirmation marche trois jours, une fois. Connectez-vous, puis demandez-en un autre sur la page « Mon compte ».', 'A confirmation link works for three days, once. Sign in, then ask for another one on the "My account" page.')}</p>
          {home}
        </>
      )}
      {!state.email && !state.error && <p className="pitch">{t('Confirmation en cours…', 'Confirming…')}</p>}
    </div>
  );
}
