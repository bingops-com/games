'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { App, NAME_MAX, profilePath, useApp, useT, type RoomInvite } from '@/lib/app';
import { Avatar } from '@/lib/avatar';
import { Name } from '@/lib/shop';
import AvatarEditor from './AvatarEditor';
import Mascot from './Mascot';
import { Dialog, Ic } from './ui';

const closeModal = () => App.openModal(null);

function NameDialog() {
  const { modal, guest } = useApp();
  const t = useT();
  if (modal !== 'name') return null;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (App.rename(String(new FormData(e.currentTarget).get('name')))) App.toast(t('Nom enregistré', 'Name saved'));
  };
  return (
    <Dialog title={t('Votre nom d’invité', 'Your guest name')} onClose={closeModal} onSubmit={submit}>
      <p>{t('C’est le nom que les autres voient autour de la table tant que vous jouez sans compte. Il est gardé sur cet appareil.', 'This is the name the others see around the table while you play without an account. It is kept on this device.')}</p>
      <label>
        {t('Nom', 'Name')}
        <input name="name" defaultValue={guest} autoComplete="nickname" required maxLength={NAME_MAX} />
      </label>
      <button className="btn primary">{t('Enregistrer le nom', 'Save name')}</button>
      <button type="button" className="btn quiet" onClick={closeModal}>{t('Annuler', 'Cancel')}</button>
    </Dialog>
  );
}

function AuthDialog() {
  const { modal } = useApp();
  const t = useT();
  if (modal !== 'login' && modal !== 'register') return null;
  const register = modal === 'register';
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    try {
      await App.sign(modal, String(f.get('name')), String(f.get('password')), register ? String(f.get('email')).trim() : undefined);
    } catch (err) {
      App.toast((err as Error).message);
    }
  };
  return (
    // La clé remet le curseur dans le premier champ quand on passe de l'un à l'autre.
    <Dialog key={modal} title={register ? t('Créer un compte', 'Create an account') : t('Se connecter', 'Sign in')} onClose={closeModal} onSubmit={submit}>
      <p>
        {register
          ? t('Un pseudo, une adresse e-mail, un mot de passe, et c’est tout. Vous gardez votre avatar, vos stats et vos amis.', 'A username, an email address, a password, and that is it. You keep your avatar, your stats and your friends.')
          : t('Retrouvez votre avatar, vos stats et vos amis.', 'Get back your avatar, your stats and your friends.')}
      </p>
      <label>
        {t('Pseudo', 'Username')}
        <input name="name" autoComplete="username" required minLength={3} maxLength={16} pattern="[A-Za-z0-9_\-]+" aria-describedby={register ? 'name-help' : undefined} />
      </label>
      {register && <small className="help" id="name-help">{t('3 à 16 caractères : lettres, chiffres, tiret et tiret bas. Il est visible de tous.', '3 to 16 characters: letters, digits, hyphen and underscore. Everyone can see it.')}</small>}
      {register && (
        <label>
          {t('Adresse e-mail', 'Email address')}
          <input name="email" type="email" autoComplete="email" required maxLength={254} placeholder={t('vous@exemple.fr', 'you@example.com')} aria-describedby="email-help" />
        </label>
      )}
      {register && <small className="help" id="email-help">{t('Elle ne sert qu’à retrouver un mot de passe perdu, et personne ne la voit.', 'It is only used to recover a lost password, and nobody sees it.')}</small>}
      <label>
        {t('Mot de passe', 'Password')}
        <input name="password" type="password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? 8 : 1} maxLength={128} />
      </label>
      <button className="btn primary">{register ? t('Créer le compte', 'Create account') : t('Se connecter', 'Sign in')}</button>
      <button type="button" className="btn quiet" onClick={() => App.openModal(register ? 'login' : 'register')}>
        {register ? t('J’ai déjà un compte', 'I already have an account') : t('Créer un compte', 'Create an account')}
      </button>
      {!register && <button type="button" className="as-link" onClick={() => App.openModal('forgot')}>{t('Mot de passe oublié ?', 'Forgot your password?')}</button>}
    </Dialog>
  );
}

// Mot de passe oublié : un lien part à l'adresse du compte, s'il en a une. La réponse est la
// même dans tous les cas, pour ne pas dire qui joue ici.
function ForgotDialog() {
  const { modal } = useApp();
  const t = useT();
  const [sent, setSent] = useState(false);
  useEffect(() => {
    if (modal !== 'forgot') setSent(false);
  }, [modal]);
  if (modal !== 'forgot') return null;
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    try {
      await App.api('/api/forgot', { name: String(new FormData(e.currentTarget).get('name')) });
      setSent(true);
    } catch (err) {
      App.toast((err as Error).message);
    }
  };
  return (
    <Dialog title={t('Mot de passe oublié', 'Forgotten password')} onClose={closeModal} onSubmit={submit}>
      {sent ? (
        <>
          <p>{t('Si ce compte a une adresse e-mail confirmée, un lien vient d’y partir. Il marche une heure. Pensez à regarder dans les indésirables.', 'If this account has a confirmed email address, a link has just been sent to it. It works for one hour. Check your spam folder too.')}</p>
          <p>{t('Un compte sans adresse confirmée ne peut pas être récupéré.', 'An account with no confirmed address cannot be recovered.')}</p>
          <button type="button" className="btn primary" onClick={closeModal}>{t('Fermer', 'Close')}</button>
        </>
      ) : (
        <>
          <p>{t('Donnez votre pseudo ou l’adresse e-mail du compte : nous y envoyons un lien pour choisir un nouveau mot de passe.', 'Give your username or the account’s email address: we send it a link to choose a new password.')}</p>
          <label>
            {t('Pseudo ou adresse e-mail', 'Username or email address')}
            <input name="name" autoComplete="username" required maxLength={254} />
          </label>
          <button className="btn primary">{t('Envoyer le lien', 'Send the link')}</button>
          <button type="button" className="btn quiet" onClick={() => App.openModal('login')}>{t('Retour', 'Back')}</button>
        </>
      )}
    </Dialog>
  );
}

// Les amis en ligne, dépliés depuis la bande : depuis un salon on les invite, sinon on
// rejoint celui où ils jouent.
function Pals() {
  const here = usePathname();
  const { account, pals, table } = useApp();
  const t = useT();
  if (!account) return null;
  const online = pals.filter((p) => p.online);
  const inRoom = here === '/t/' && table ? table.code : '';
  const invite = (name: string) => App.inviteToRoom(inRoom, name).catch((err: Error) => App.toast(err.message));
  return (
    <details className="pals">
      <summary>
        <span>{t('Amis en ligne', 'Friends online')}</span>
        <b className="pill count">{online.length}</b>
      </summary>
      {online.length === 0 ? (
        <p>{pals.length === 0 ? t('Pas encore d’amis ici.', 'No friends here yet.') : t('Personne pour l’instant.', 'Nobody right now.')} <Link href="/amis/">{pals.length === 0 ? t('En ajouter', 'Add some') : t('Voir mes amis', 'See my friends')}</Link></p>
      ) : (
        <ul>
          {online.map((p) => (
            <li key={p.name} className="member">
              <Avatar code={p.avatar} name={p.name} />
              <Link href={profilePath(p.name)}>{p.name}</Link>
              <small>{p.room ? (p.room === inRoom ? t('dans ce salon', 'in this room') : t('dans un salon', 'in a room')) : t('en ligne', 'online')}</small>
              {inRoom
                ? p.room !== inRoom && <button className="pill" onClick={() => invite(p.name)}>{t('Inviter', 'Invite')}</button>
                : p.room && <Link className="pill" href={`/t/?code=${p.room}`}>{t('Rejoindre', 'Join')}</Link>}
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

// Un ami propose de le rejoindre : une carte en bas de l'écran, jusqu'à ce qu'on réponde.
function Invites() {
  const here = usePathname();
  const router = useRouter();
  const { invites, asks, table } = useApp();
  const t = useT();
  const shown = invites.filter((i) => !(here === '/t/' && table?.code === i.code));
  const join = (inv: RoomInvite) => {
    App.ignoreInvite(inv);
    router.push(`/t/?code=${inv.code}`);
  };
  const accept = (name: string) => App.friend('accept', name).then((out) => App.toast(t(`Vous êtes amis avec ${out.name}`, `You and ${out.name} are friends`)), (err: Error) => App.toast(err.message));
  // Hors d'un salon, une invitation s'ouvre en fenêtre, au milieu de l'écran : on ne peut pas
  // la manquer. Dans un salon elle ne doit pas couper la partie : elle reste une carte.
  if (here !== '/t/') {
    const inv = shown[0];
    if (inv) {
      return (
        <Dialog key={`${inv.from}/${inv.code}`} title={t(`${inv.from} vous invite`, `${inv.from} invites you`)} onClose={() => App.ignoreInvite(inv)} className="ask-dialog">
          <Avatar code={inv.avatar} name={inv.from} className="chip-sea" />
          <p>{t(`${inv.from} joue dans le salon ${inv.code} et vous propose de le rejoindre.`, `${inv.from} is playing in room ${inv.code} and asks you to join.`)}</p>
          <button className="btn primary" autoFocus onClick={() => join(inv)}><Ic name="anchor" />{t('Rejoindre le salon', 'Join the room')}</button>
          <button className="btn quiet" onClick={() => App.ignoreInvite(inv)}>{t('Plus tard', 'Later')}</button>
        </Dialog>
      );
    }
    const name = asks[0];
    if (name) {
      return (
        <Dialog key={name} title={t(`${name} vous invite en ami`, `${name} wants to be friends`)} onClose={() => App.dismissAsk(name)} className="ask-dialog">
          <Avatar name={name} className="chip-sea" />
          <p>{t('Entre amis, on se voit en ligne et on s’invite dans un salon en un clic.', 'Friends see each other online and invite each other to a room in one click.')} <Link href={profilePath(name)} onClick={() => App.dismissAsk(name)}>{t('Voir son profil', 'See their profile')}</Link></p>
          <button className="btn primary" autoFocus onClick={() => accept(name)}><Ic name="check" />{t('Accepter', 'Accept')}</button>
          <button className="btn quiet" onClick={() => App.dismissAsk(name)}>{t('Plus tard', 'Later')}</button>
        </Dialog>
      );
    }
    return null;
  }
  if (shown.length === 0 && asks.length === 0) return null;
  return (
    <div className="invites" role="status">
      {shown.map((inv) => (
        <div key={`${inv.from}/${inv.code}`} className="invite-card">
          <Avatar code={inv.avatar} name={inv.from} className="chip-sea" />
          <p><b>{inv.from}</b> {t('vous invite dans son salon.', 'invites you to their room.')}</p>
          <div className="row-actions">
            <button className="btn primary small" onClick={() => join(inv)}>{t('Rejoindre', 'Join')}</button>
            <button className="btn quiet small" onClick={() => App.ignoreInvite(inv)}>{t('Plus tard', 'Later')}</button>
          </div>
        </div>
      ))}
      {asks.map((name) => (
        <div key={name} className="invite-card">
          <Avatar name={name} className="chip-sea" />
          <p><b>{name}</b> {t('vous invite en ami.', 'wants to be friends.')}</p>
          <div className="row-actions">
            <button className="btn primary small" onClick={() => accept(name)}>{t('Accepter', 'Accept')}</button>
            <button className="btn quiet small" onClick={() => App.dismissAsk(name)}>{t('Plus tard', 'Later')}</button>
          </div>
        </div>
      ))}
    </div>
  );
}

// Le salon qu'on vient de quitter, ou dont on s'est éloigné : un bouton pour y retourner,
// sur toutes les pages, tant qu'il existe.
function Resume() {
  const here = usePathname();
  const { table } = useApp();
  const t = useT();
  const code = table?.code;
  const away = !!code && here !== '/t/';
  // Un salon fermé entre-temps n'est plus proposé.
  useEffect(() => {
    if (!away) return;
    let stale = false;
    App.api(`/api/tables/${code}`).catch(() => !stale && App.remember(null));
    return () => {
      stale = true;
    };
  }, [away, code]);
  if (!table || !away) return null;
  return (
    <div className="resume">
      <p>
        <small>{table.left ? t('Salon quitté', 'Room you left') : t('Votre salon', 'Your room')}</small>
        <strong>{table.code}</strong>
      </p>
      <button className="dots" onClick={() => App.remember(null)} aria-label={t(`Ne plus proposer le salon ${table.code}`, `Stop offering room ${table.code}`)} title={t('Ne plus le proposer', 'Stop offering it')}><Ic name="close" /></button>
      <Link className="btn white small" href={`/t/?code=${table.code}`} aria-label={t(`Retourner au salon ${table.code}`, `Back to room ${table.code}`)}><Ic name="anchor" />{t('Y retourner', 'Go back')}</Link>
    </div>
  );
}

function Nav() {
  const here = usePathname();
  const { account, objectives } = useApp();
  const t = useT();
  const done = objectives.filter((o) => o.done).length;
  const cur = (href: string) => (here === href ? 'page' : undefined);
  const n = account?.received ?? 0;
  return (
    <nav id="nav" aria-label={t('Navigation', 'Navigation')}>
      <Link href="/" aria-current={cur('/')} title={t('Jouer', 'Play')}><Ic name="home" className="nav-ic" /><span>{t('Jouer', 'Play')}</span></Link>
      <Link href="/amis/" aria-current={cur('/amis/')} title={t('Amis', 'Friends')}>
        <Ic name="friends" className="nav-ic" />
        <span>{t('Amis', 'Friends')}</span>
        {n > 0 && <b className="pill count" aria-label={t(`${n} invitation${n > 1 ? 's' : ''} en attente`, `${n} pending invitation${n > 1 ? 's' : ''}`)}>{n}</b>}
      </Link>
      <Link href="/objectifs/" aria-current={cur('/objectifs/')} title={t('Objectifs', 'Objectives')}>
        <Ic name="cup" className="nav-ic" />
        <span>{t('Objectifs', 'Objectives')}</span>
        {account && objectives.length > 0 && <small className="nav-count">{done}/{objectives.length}</small>}
      </Link>
      <Link href="/magasin/" aria-current={cur('/magasin/')} title={t('Magasin', 'Shop')}>
        <Ic name="shop" className="nav-ic" />
        <span>{t('Magasin', 'Shop')}</span>
        {account && <small className="nav-count">{account.credits}</small>}
      </Link>
      {account && <Link href={profilePath(account.name)} title={t('Mon profil', 'My profile')}><Ic name="me" className="nav-ic" /><span>{t('Mon profil', 'My profile')}</span></Link>}
      <Pals />
    </nav>
  );
}

// Qui joue, au pied de la bande : le compte ou l'invité, et la langue.
function Who() {
  const { ready, account, lang, avatar, sound } = useApp();
  const t = useT();
  const other = lang === 'fr' ? 'en' : 'fr';
  return (
    <div className="who">
      {ready && (account ? (
        <>
          <Link className="who-name" href={profilePath(account.name)}>
            <Avatar code={avatar} name={account.name} />
            <b><Name name={account.name} fx={account.fx} /></b>
          </Link>
          <div className="who-links">
            <Link className="btn onsea small" href="/compte/"><Ic name="sliders" />{t('Compte', 'Account')}</Link>
            <button className="btn onsea small" onClick={() => App.signOut()} title={t('Se déconnecter', 'Sign out')}><Ic name="leave" />{t('Sortir', 'Sign out')}</button>
          </div>
        </>
      ) : (
        <div className="who-links">
          <button className="btn white small" onClick={() => App.openModal('register')}><Ic name="invite" />{t('Créer un compte', 'Create an account')}</button>
          <button className="btn onsea small" onClick={() => App.openModal('login')}><Ic name="key" />{t('Se connecter', 'Sign in')}</button>
        </div>
      ))}
      <div className="who-foot">
        {/* Le bouton porte le nom de l'autre langue, écrit dans cette langue. */}
        <button className="lang" lang={other} onClick={() => App.setLang(other)} aria-label={other === 'en' ? 'Read this site in English' : 'Lire ce site en français'}>
          <Ic name="globe" />{other === 'en' ? 'English' : 'Français'}
        </button>
        <button className="lang sound" aria-pressed={sound} onClick={() => App.setSound(!sound)}>
          <Ic name={sound ? 'sound' : 'mute'} />{sound ? t('Son', 'Sound') : t('Son coupé', 'Sound off')}
        </button>
      </div>
    </div>
  );
}

export default function Shell({ children }: { children: ReactNode }) {
  const { toasts, full, lang } = useApp();
  const t = useT();
  useEffect(() => {
    void App.start();
  }, []);
  // Tant qu'un compte est connecté, la page relit ses amis : c'est aussi ce qui le dit en ligne.
  const signedIn = useApp().account?.name;
  useEffect(() => {
    void App.loadPals();
    if (!signedIn) return;
    // Toutes les cinq secondes : une invitation ou une réponse se voit presque aussitôt. Un
    // onglet caché ne demande rien, et relit dès qu'on y revient.
    const id = setInterval(() => document.hidden || void App.loadPals(), 5000);
    const back = () => document.hidden || void App.loadPals();
    document.addEventListener('visibilitychange', back);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', back);
    };
  }, [signedIn]);
  // Les titres d'onglet sont écrits en français dans les pages ; en anglais, ceux qui
  // ne sont pas un nom de jeu sont remplacés ici.
  const path = usePathname();
  useEffect(() => {
    const en = ({ '/amis/': 'Friends', '/objectifs/': 'Objectives', '/magasin/': 'Shop', '/compte/': 'Account', '/reinitialiser/': 'New password', '/confirmer/': 'Email address', '/u/': 'Profile', '/t/': 'Room' } as Record<string, string>)[path];
    if (lang === 'en' && en) document.title = `${en}, lab.bingo games`;
    // La pleine fenêtre ne survit pas à un changement de page.
    App.setFull(false);
  }, [lang, path]);
  return (
    <>
      <div id="app" className={full ? 'full' : undefined}>
        <aside className={path === '/t/' ? 'side sea in-room' : 'side sea'}>
          <Link className="lockup" href="/">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="logo" src="/brand/logo.webp" alt="" width={40} height={40} />
            <span>lab.bingo <span className="lockup-kind">games</span></span>
          </Link>
          <Nav />
          <Resume />
          {/* Dans un salon, la table y écrit son code et ses joueurs, sous la navigation. */}
          <div id="side-slot" />
          {/* Le chat laisse l'accueil au grand titre et aux jeux. */}
          {path !== '/' && <Mascot />}
          <Who />
        </aside>
        <div className="main">
          <main id="view">{children}</main>
          <footer className="foot">{t('On joue sans compte. Avec un compte, on garde son avatar et ses stats.', 'No account needed. With one, you keep your avatar and your stats.')}</footer>
        </div>
      </div>
      <NameDialog />
      <AuthDialog />
      <ForgotDialog />
      <AvatarEditor />
      <Invites />
      <div id="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => <div key={toast.id} className="toast">{toast.msg}</div>)}
      </div>
    </>
  );
}
