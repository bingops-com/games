'use client';

import { Bar, Ic } from './ui';
import { App, useApp, useT } from '@/lib/app';
import { Avatar, PartIcon, partName, slotName } from '@/lib/avatar';
import { GROUPS, howOf, titleOf } from '@/lib/objectives';

// Ce qu'il y a à accomplir sur la plateforme, et la pièce d'avatar que chaque objectif
// débloque. Seules les parties jouées avec un compte comptent.
export default function Objectives() {
  const { ready, account, avatar, name, objectives } = useApp();
  const t = useT();
  if (!ready) return null;
  const done = objectives.filter((o) => o.done).length;
  const streak = account?.streak;
  // Par groupe, dans l'ordre du serveur ; un objectif que la page ne connaît pas va au bout.
  const known = new Set(GROUPS.flatMap((g) => g.ids));
  const groups = [
    ...GROUPS.map((g) => ({ title: t(g.fr, g.en), list: g.ids.flatMap((id) => objectives.filter((o) => o.id === id)) })),
    { title: t('Autres', 'Others'), list: objectives.filter((o) => !known.has(o.id)) },
  ].filter((g) => g.list.length > 0);
  const days = (n: number) => t(`${n} jour${n > 1 ? 's' : ''}`, `${n} day${n === 1 ? '' : 's'}`);
  return (
    <div className="profile goals">
      <section className="paper">
        <h1>{t('Objectifs', 'Objectives')}</h1>
        <p className="pitch">{t('Chaque objectif débloque une pièce d’avatar. Seules comptent les parties jouées jusqu’au bout avec un compte : pas celles que l’hôte arrête, ni celles qu’un joueur quitte en route.', 'Each objective unlocks an avatar part. Only games played to the end with an account count: not the ones the host stops, nor the ones a player walks out of.')}</p>
        <div className="goals-me">
          <Avatar code={avatar} name={name} className="chip-sea" />
          <div>
            <b>{name}</b>
            <span>{account ? t(`${done} objectif${done > 1 ? 's' : ''} sur ${objectives.length}`, `${done} of ${objectives.length} objectives`) : t('Invité : vos parties ne sont pas comptées', 'Guest: your games are not counted')}</span>
          </div>
        </div>
        {streak && (
          <dl className="facts">
            <div><dt>{t('Série en cours', 'Current streak')}</dt><dd>{days(streak.days)}</dd></div>
            <div><dt>{t('Meilleure série', 'Best streak')}</dt><dd>{days(streak.best)}</dd></div>
          </dl>
        )}
        {streak && (
          <p className="hint">
            {streak.today
              ? t('C’est bon pour aujourd’hui. À demain pour la suite ?', 'Done for today. Back tomorrow to keep it going?')
              : streak.days > 0
                ? t('Une partie aujourd’hui et la série continue.', 'One game today and the streak goes on.')
                : t('Jouez plusieurs jours de suite pour lancer une série.', 'Play several days in a row to start a streak.')}
          </p>
        )}
        <div className="actions">
          <button className="btn primary" onClick={() => App.openModal('avatar')}><Ic name="pencil" />{t('Modifier mon avatar', 'Edit my avatar')}</button>
          {!account && (
            <p className="hint">
              {t('Sans compte, vos parties ne débloquent rien.', 'Without an account, your games unlock nothing.')}{' '}
              <button className="as-link" onClick={() => App.openModal('register')}>{t('Créer un compte', 'Create an account')}</button>
            </p>
          )}
        </div>
      </section>
      <section className="sea sheet" aria-label={t('Liste des objectifs', 'List of objectives')}>
        {groups.map((g) => (
          <div key={g.title} className="goals-group">
            <h2>{g.title} <small>{g.list.filter((o) => o.done).length}/{g.list.length}</small></h2>
            <ul className="goals-list">
              {g.list.map((o) => (
                <li key={o.id} className={o.done ? 'done' : undefined}>
                  <span className="goal-part"><PartIcon slot={o.slot} id={o.item} /></span>
                  <div className="goal-text">
                    <b>{titleOf(o, t)}</b>
                    <span>{howOf(o, t)}</span>
                    <small>{slotName(o.slot, t)} : {partName(o.slot, o.item, t)}</small>
                  </div>
                  <div className="goal-state">
                    {o.done ? (
                      <strong>{t('Accompli', 'Reached')}</strong>
                    ) : (
                      <>
                        <Bar value={o.have} max={o.goal} label={titleOf(o, t)} />
                        <strong>{o.have}/{o.goal}</strong>
                      </>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </section>
    </div>
  );
}
