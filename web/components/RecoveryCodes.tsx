'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { App, useApp, useT } from '@/lib/app';
import { Dialog } from './ui';

// Codes stay only in this tab's memory, until the owner confirms saving them.
export function RecoveryCodesDialog() {
  const { recoveryCodes, account } = useApp();
  const t = useT();
  const [saved, setSaved] = useState(false);
  useEffect(() => setSaved(false), [recoveryCodes]);
  if (!recoveryCodes || !account) return null;
  const download = () => {
    const text = `${t('Codes de récupération Games', 'Games recovery codes')} — ${account.name}\n\n${recoveryCodes.join('\n')}\n\n${t('Chaque code fonctionne une seule fois. Gardez ce fichier privé.', 'Each code works once. Keep this file private.')}\n`;
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `games-${account.name}-recovery.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const done = () => {
    if (!saved) return;
    App.dismissRecoveryCodes();
    setSaved(false);
  };
  return (
    <Dialog title={t('Gardez vos codes de récupération', 'Save your recovery codes')} onClose={done} className="recovery-dialog">
      <p>{t('Ils permettent de retrouver votre compte si vous oubliez votre mot de passe. Chaque code fonctionne une seule fois.', 'They let you recover your account if you forget your password. Each code works once.')}</p>
      <p className="notice">{t('Ils ne seront plus affichés après fermeture. Enregistrez-les dans votre gestionnaire de mots de passe ou téléchargez-les.', 'They will not be shown again after closing. Save them in your password manager or download them.')}</p>
      <ul className="recovery-codes" aria-label={t('Codes de récupération', 'Recovery codes')}>
        {recoveryCodes.map((code) => <li key={code}><code>{code}</code></li>)}
      </ul>
      <button type="button" className="btn quiet" onClick={download}>{t('Télécharger les codes', 'Download codes')}</button>
      <p className="hint">{t('Sans votre mot de passe et sans ces codes, votre compte ne pourra pas être récupéré. Ne les partagez jamais.', 'Without your password and these codes, your account cannot be recovered. Never share them.')}</p>
      <label className="recovery-saved"><input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} />{t('J’ai enregistré mes codes en lieu sûr.', 'I saved my codes somewhere safe.')}</label>
      <button type="button" className="btn primary" disabled={!saved} onClick={done}>{t('Continuer', 'Continue')}</button>
    </Dialog>
  );
}

export function RecoveryForm({ onSuccess }: { onSuccess: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const form = e.currentTarget;
    const values = new FormData(form);
    if (values.get('password') !== values.get('confirm')) {
      setError(t('Les mots de passe ne correspondent pas.', 'The passwords do not match.'));
      return;
    }
    setBusy(true);
    setError('');
    try {
      await App.recover(String(values.get('name')).trim(), String(values.get('code')), String(values.get('password')));
      form.reset();
      App.toast(t('Mot de passe changé. Vos autres appareils sont déconnectés.', 'Password changed. Your other devices are signed out.'));
      onSuccess();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="stack" onSubmit={submit}>
      <p>{t('Utilisez un des codes enregistrés à la création du compte ou depuis « Mon compte ».', 'Use one of the codes saved when creating your account or from “My account”.')}</p>
      <label>{t('Pseudo', 'Username')}<input name="name" autoComplete="username" required minLength={3} maxLength={16} /></label>
      <label>{t('Code de récupération', 'Recovery code')}<input name="code" type="password" autoComplete="off" spellCheck={false} required maxLength={128} /></label>
      <label>{t('Nouveau mot de passe', 'New password')}<input name="password" type="password" autoComplete="new-password" required minLength={8} maxLength={128} /></label>
      <label>{t('Confirmer le nouveau mot de passe', 'Confirm new password')}<input name="confirm" type="password" autoComplete="new-password" required minLength={8} maxLength={128} /></label>
      {error && <p className="notice" role="alert">{error}</p>}
      <button className="btn primary" disabled={busy}>{t('Récupérer mon compte', 'Recover my account')}</button>
      <p className="hint">{t('Sans mot de passe ni code de récupération, nous ne pouvons pas vous rendre l’accès au compte.', 'Without your password or a recovery code, we cannot restore access to your account.')}</p>
    </form>
  );
}
