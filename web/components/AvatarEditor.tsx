'use client';

import { Dialog, Ic } from './ui';
import { useEffect, useState } from 'react';
import { App, useApp, useT } from '@/lib/app';
import { Avatar, PARTS, PartIcon, SLOTS, encode, fromShop, lockOf, parse, partName, randomLook, slotName, type Look, type Slot } from '@/lib/avatar';
import { howOf, type Objective } from '@/lib/objectives';

// Le cadenas d'une pièce pas encore débloquée.
const LOCK = (
  <svg className="look-lock" viewBox="0 0 24 24" aria-hidden="true">
    <path d="M7 10V8a5 5 0 0 1 10 0v2h1.5a1.5 1.5 0 0 1 1.5 1.5v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19.5v-8A1.5 1.5 0 0 1 5.5 10zm2.5 0h5V8a2.5 2.5 0 0 0-5 0z" />
  </svg>
);

// L'atelier : le joueur compose son avatar pièce par pièce. Une pièce sous clé dit ce
// qu'il faut accomplir pour l'obtenir.
export default function AvatarEditor() {
  const { modal, avatar, name, account, objectives } = useApp();
  const t = useT();
  const open = modal === 'avatar';
  const [look, setLook] = useState<Look | null>(null);
  const [locked, setLocked] = useState<{ slot: Slot; id: string; o?: Objective } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setLook(parse(avatar) ?? randomLook());
    setLocked(null);
    // L'avatar n'est relu qu'à l'ouverture : il ne doit pas écraser ce qui se compose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  if (!open || !look) return null;

  const isLocked = (slot: Slot, id: string) => {
    if (PARTS[slot].find((p) => p.id === id)?.free) return false;
    if (!account) return true;
    return fromShop(slot, id) ? !account.items.includes(`${slot}:${id}`) : !!lockOf(slot, id, objectives);
  };
  const choose = (slot: Slot, id: string) => {
    // Sans compte, rien ne se débloque : toute pièce à gagner reste sous clé.
    if (isLocked(slot, id)) return setLocked({ slot, id, o: objectives.find((x) => x.slot === slot && x.item === id) });
    setLocked(null);
    setLook({ ...look, [slot]: id });
  };
  const save = async () => {
    setBusy(true);
    try {
      await App.setAvatar(encode(look));
      App.openModal(null);
      App.toast(account ? t('Avatar enregistré', 'Avatar saved') : t('Avatar changé pour cette session', 'Avatar changed for this session'));
    } catch (err) {
      App.toast((err as Error).message);
    }
    setBusy(false);
  };

  return (
    <Dialog title={t('Votre avatar', 'Your avatar')} className="look-dialog" onClose={() => App.openModal(null)}>
        <div className="look-side">
          <div className="look-stage sea"><Avatar code={encode(look)} /></div>
          <b className="look-name">{name}</b>
          <button className="btn quiet" onClick={() => { setLocked(null); setLook(randomLook()); }}><Ic name="dice" />{t('Au hasard', 'Random')}</button>
          <p className="hint">
            {account
              ? t('Enregistré sur votre compte, visible sur votre profil.', 'Saved to your account, shown on your profile.')
              : t('Sans compte, il disparaît quand vous fermez l’onglet.', 'Without an account, it is gone when you close the tab.')}
          </p>
        </div>
        <div className="look-parts">
          {SLOTS.map((slot) => (
            <fieldset key={slot} className={slot === 'color' || slot === 'glasses' || slot === 'hat' ? 'wide' : undefined}>
              <legend>{slotName(slot, t)}</legend>
              <div className="look-row">
                {PARTS[slot].map((p) => {
                  const lock = isLocked(slot, p.id);
                  return (
                    <button
                      key={p.id}
                      type="button"
                      className={`look-pick${look[slot] === p.id ? ' on' : ''}${lock ? ' locked' : ''}`}
                      aria-pressed={look[slot] === p.id}
                      aria-label={lock ? t(`${p.fr}, à débloquer`, `${p.en}, locked`) : t(p.fr, p.en)}
                      title={t(p.fr, p.en)}
                      onClick={() => choose(slot, p.id)}
                    >
                      <PartIcon slot={slot} id={p.id} />
                      {lock && LOCK}
                    </button>
                  );
                })}
              </div>
            </fieldset>
          ))}
          <p className="look-hint" role="status">
            {locked ? (
              <>
                <b>{partName(locked.slot, locked.id, t)}</b>{' : '}
                {locked.o ? `${howOf(locked.o, t).toLowerCase()} (${account ? locked.o.have : 0}/${locked.o.goal}).` : t('en vente au magasin certains jours.', 'on sale in the shop on some days.')}{' '}
                {!account && <button className="as-link" onClick={() => App.openModal('register')}>{t('Créez un compte pour la débloquer', 'Create an account to unlock it')}</button>}
              </>
            ) : (
              t('Les pièces sous clé se gagnent en jouant, ou s’achètent au magasin.', 'Locked parts are earned by playing, or bought in the shop.')
            )}
          </p>
          <div className="row-actions">
            <button className="btn primary" disabled={busy} onClick={save}><Ic name="check" />{t('Enregistrer l’avatar', 'Save avatar')}</button>
            <button className="btn quiet" onClick={() => App.openModal(null)}>{t('Annuler', 'Cancel')}</button>
          </div>
        </div>
    </Dialog>
  );
}
