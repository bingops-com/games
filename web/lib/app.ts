'use client';

import { useCallback, useSyncExternalStore } from 'react';
import { encode, parse, randomLook, wearable } from './avatar';
import { LANG_KEY, initialLang, serverMessage, type Lang, type T } from './i18n';
import { titleOf, type Objective, type Streak } from './objectives';

// L'état de l'interface. Le compte vient du serveur ; le nom d'invité est retenu sur cet
// appareil.
// La dernière table rejointe, pour y revenir depuis l'accueil. Les tables elles-mêmes
// vivent sur le serveur.
export interface Table {
  code: string;
  game: string;
  // Vrai quand le joueur a quitté ce salon lui-même : il peut encore y retourner.
  left?: boolean;
}

export interface Account {
  name: string;
  since: number;
  // Invitations d'amis en attente de réponse.
  received: number;
  // L'avatar choisi, vide tant que le joueur n'a rien choisi.
  avatar: string;
  objectives: Objective[];
  streak: Streak;
  // Les crédits à dépenser au magasin, ce qui y a été acheté, et l'effet porté par le pseudo.
  credits: number;
  items: string[];
  fx: string;
  // Ce que les parties du jour ont rapporté, sur le plafond d'une journée.
  earnedToday: number;
  dailyCap: number;
  // L'adresse par laquelle récupérer un mot de passe perdu, et les joueurs bloqués.
  email: string;
  // L'adresse a été confirmée par le lien qu'on y a envoyé : elle peut servir à récupérer
  // le compte.
  emailChecked: boolean;
  blocked: string[];
}

// Un ami, tel que la bande le montre : en ligne ou non, et le salon où il se trouve.
export interface Pal {
  name: string;
  avatar: string;
  online: boolean;
  room?: string;
  game?: string;
}

// Un ami qui propose de le rejoindre dans son salon.
export interface RoomInvite {
  from: string;
  avatar: string;
  code: string;
  game: string;
}

// Les amis du compte et les invitations en ami qui attendent, dans un sens et dans l'autre.
export interface Friend {
  name: string;
  since: number;
}

export interface FriendList {
  friends: Friend[];
  received: Friend[];
  sent: Friend[];
}

// Les invitations écartées ne reviennent pas tant que la page reste ouverte.
const ignored = new Set<string>();

export type Relation = 'self' | 'none' | 'sent' | 'received' | 'friends';
export type Modal = 'login' | 'register' | 'name' | 'avatar' | 'forgot' | null;

interface Toast {
  id: number;
  msg: string;
}

interface State {
  ready: boolean;
  lang: Lang;
  account: Account | null;
  // Le nom affiché : celui du compte, sinon celui de l'invité.
  name: string;
  guest: string;
  // L'avatar porté : celui du compte, sinon celui de l'invité, qui ne dure que le temps
  // de l'onglet.
  avatar: string;
  guestAvatar: string;
  // Ce qu'il y a à accomplir, et où en est le joueur (rien pour un invité).
  objectives: Objective[];
  // Les amis du compte et les salons où ils l'invitent, relus régulièrement.
  pals: Pal[];
  invites: RoomInvite[];
  // Le registre des amis, relu avec eux : la page Amis se met à jour toute seule.
  friends: FriendList | null;
  // Ceux qui viennent de demander ce compte en ami, à qui l'on n'a pas encore répondu.
  asks: string[];
  // Les joueurs dont on ne veut plus lire les messages, le temps de la page.
  muted: string[];
  table: Table | null;
  modal: Modal;
  // Pleine fenêtre : la partie occupe toute la fenêtre, sans la bande de gauche.
  full: boolean;
  toasts: Toast[];
}

const NAME_KEY = 'games.name';
const AVATAR_KEY = 'games.avatar';
const TABLE_KEY = 'games.table';
const GUEST_KEY = 'games.guest';
export const CODE_LENGTH = 4;
export const NAME_MAX = 16;

const initial: State = { ready: false, lang: 'fr', account: null, name: '', guest: '', avatar: '', guestAvatar: '', objectives: [], pals: [], invites: [], friends: null, asks: [], muted: [], table: null, modal: null, full: false, toasts: [] };
let state = initial;
const listeners = new Set<() => void>();
let toastId = 0;

function set(patch: Partial<State>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

// Le stockage peut être refusé (navigation privée) : l'interface marche quand même,
// elle oublie seulement à la fermeture de l'onglet.
function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* rien à faire */
  }
}

function random(n: number) {
  return crypto.getRandomValues(new Uint32Array(1))[0] % n;
}

// Le nom d'un invité qui arrive : un habitant de la mer et un trait de caractère, tirés au
// hasard. Les adjectifs s'écrivent pareil au masculin et au féminin.
const WHO = ['Mousse', 'Matelot', 'Corsaire', 'Gabier', 'Vigie', 'Mouette', 'Crabe', 'Poulpe', 'Requin', 'Sardine', 'Otarie', 'Homard', 'Pieuvre', 'Baleine', 'Dauphin', 'Tortue', 'Méduse', 'Goéland', 'Pélican', 'Morue', 'Bigorneau', 'Crevette', 'Phoque', 'Hippocampe'];
const HOW = ['Agile', 'Brave', 'Rapide', 'Habile', 'Fidèle', 'Sage', 'Drôle', 'Tenace', 'Rebelle', 'Solide', 'Farouche', 'Espiègle', 'Intrépide', 'Timide', 'Pirate', 'Sonore', 'Louche', 'Aimable', 'Fantasque', 'Candide'];

export function randomName() {
  for (;;) {
    const name = `${WHO[random(WHO.length)]}-${HOW[random(HOW.length)]}`;
    if (name.length <= NAME_MAX) return name;
  }
}

// L'identité d'un invité auprès des tables : un secret gardé sur cet appareil, pour
// retrouver sa place après un rechargement.
export function guestId() {
  let id = read<string>(GUEST_KEY);
  if (!id) {
    id = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');
    write(GUEST_KEY, id);
  }
  return id;
}

export const cleanCode = (raw: string) => raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, CODE_LENGTH);

export const dateOf = (ms: number, lang: Lang) => new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'fr-FR', { month: 'long', year: 'numeric' }).format(ms);

// Pour les messages écrits hors d'un composant.
const tr: T = (fr, en) => (state.lang === 'en' ? en : fr);

// L'adresse qu'un joueur partage : le serveur la mène à la page de profil.
export const profileLink = (name: string) => `${location.origin}/u/${encodeURIComponent(name)}`;
export const profilePath = (name: string) => `/u/?n=${encodeURIComponent(name)}`;

interface Me {
  user: Account | null;
  // Pour un invité : les objectifs, sans rien d'accompli.
  objectives?: Objective[];
}

// L'avatar d'un invité ne vit que dans l'onglet : fermer la page, c'est le perdre.
function guestAvatar() {
  let code = '';
  try {
    code = sessionStorage.getItem(AVATAR_KEY) ?? '';
  } catch {
    /* le stockage peut être refusé */
  }
  if (!parse(code)) {
    code = encode(randomLook());
    try {
      sessionStorage.setItem(AVATAR_KEY, code);
    } catch {
      /* rien à faire */
    }
  }
  return code;
}

function setAccount(account: Account | null, guestList?: Objective[]) {
  // Sans compte, les objectifs restent affichés, remis à zéro.
  const objectives = account?.objectives ?? guestList ?? state.objectives.map((o) => ({ ...o, have: 0, done: false }));
  set({ account, name: account?.name ?? state.guest, avatar: account?.avatar || state.guestAvatar, objectives });
}

export const App = {
  // Appelle l'API. Une erreur porte le message du serveur, écrit pour être lu.
  async api<T = unknown>(path: string, body?: unknown): Promise<T> {
    let res: Response;
    try {
      res = await fetch(path, body === undefined ? undefined : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    } catch {
      throw new Error(tr('Le serveur ne répond pas. Vérifiez votre connexion et réessayez.', 'The server is not answering. Check your connection and try again.'));
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      if (res.status === 401 && state.account && !path.startsWith('/api/log')) setAccount(null);
      throw new Error(data.error ? serverMessage(data.error, state.lang) : tr(`Le serveur a répondu ${res.status}.`, `The server answered ${res.status}.`));
    }
    return data as T;
  },
  async start() {
    if (state.ready) return;
    const lang = initialLang();
    document.documentElement.lang = lang;
    set({ lang });
    let guest = read<string>(NAME_KEY);
    if (!guest) {
      guest = randomName();
      write(NAME_KEY, guest);
    }
    const me = await App.api<Me>('/api/me').catch(() => null);
    set({ ready: true, guest, guestAvatar: guestAvatar(), table: read<Table>(TABLE_KEY) });
    setAccount(me?.user ?? null, me?.objectives ?? []);
    void App.adopt();
  },
  // Un compte sans avatar garde la tête que l'invité s'était faite : les autres voient
  // ainsi la même que lui.
  async adopt() {
    const look = parse(state.guestAvatar);
    if (state.account && !state.account.avatar && look) await App.setAvatar(encode(wearable(look, state.account.objectives, state.account.items))).catch(() => null);
  },
  // Relit le compte. Un objectif atteint depuis la dernière lecture s'annonce.
  async refresh() {
    const before = new Set(state.objectives.filter((o) => o.done).map((o) => o.id));
    const was = state.account?.name;
    const had = state.account?.credits ?? 0;
    const me = await App.api<Me>('/api/me').catch(() => null);
    if (!me) return;
    setAccount(me.user, me.objectives);
    if (!me.user || me.user.name !== was) return;
    const gain = me.user.credits - had;
    if (gain > 0) App.toast(tr(`+${gain} crédits`, `+${gain} credits`));
    for (const o of me.user.objectives) {
      if (o.done && !before.has(o.id)) App.toast(tr(`Objectif accompli : ${titleOf(o, tr)}. Nouvelle pièce d’avatar débloquée !`, `Objective reached: ${titleOf(o, tr)}. New avatar part unlocked!`));
    }
  },
  // Relit les amis : qui est en ligne, dans quel salon, et qui invite. La demande dit aussi
  // au serveur que ce joueur est là.
  async loadPals() {
    if (!state.account) return set({ pals: [], invites: [], friends: null, asks: [] });
    const me = state.account.name;
    const out = await App.api<{ friends: (Pal & Friend)[]; received: Friend[]; sent: Friend[]; invites: RoomInvite[] }>('/api/friends').catch(() => null);
    // Une réponse arrivée après un changement de compte ne dit plus rien de celui-ci.
    if (!out || state.account?.name !== me) return;
    const before = state.friends;
    const has = (list: Friend[], name: string) => list.some((f) => f.name === name);
    let asks = state.asks.filter((name) => has(out.received, name));
    if (before) {
      // Ce qui a changé depuis la dernière lecture se dit sans attendre qu'on aille voir.
      for (const f of out.friends) {
        if (has(before.sent, f.name) && !has(before.friends, f.name)) App.toast(tr(`${f.name} a accepté votre invitation : vous êtes amis.`, `${f.name} accepted your invitation: you are friends.`));
      }
      asks = [...asks, ...out.received.filter((f) => !has(before.received, f.name) && !asks.includes(f.name)).map((f) => f.name)];
    }
    set({
      pals: out.friends,
      invites: out.invites.filter((i) => !ignored.has(`${i.from}/${i.code}`)),
      friends: { friends: out.friends, received: out.received, sent: out.sent },
      asks,
      account: state.account.received === out.received.length ? state.account : { ...state.account, received: out.received.length },
    });
  },
  // « Plus tard » : la demande reste sur la page Amis, sa fenêtre ne revient pas.
  dismissAsk(name: string) {
    set({ asks: state.asks.filter((n) => n !== name) });
  },
  ignoreInvite(inv: RoomInvite) {
    ignored.add(`${inv.from}/${inv.code}`);
    set({ invites: state.invites.filter((i) => i !== inv) });
  },
  async inviteToRoom(code: string, name: string) {
    await App.api(`/api/tables/${code}/invite`, { name });
    App.toast(tr(`Invitation envoyée à ${name}`, `Invitation sent to ${name}`));
  },
  // Masque ou remontre les messages d'un joueur du salon.
  toggleMute(id: string) {
    set({ muted: state.muted.includes(id) ? state.muted.filter((m) => m !== id) : [...state.muted, id] });
  },
  // Bloque ou débloque un compte : plus d'invitations entre les deux, et ses messages masqués.
  async block(action: 'add' | 'remove', name: string) {
    const out = await App.api<{ blocked: string[] }>(`/api/blocks/${action}`, { name });
    if (state.account) set({ account: { ...state.account, blocked: out.blocked } });
    void App.loadPals();
  },
  async setEmail(email: string, password: string) {
    const out = await App.api<{ email: string; emailChecked: boolean }>('/api/account/email', { email, password });
    if (state.account) set({ account: { ...state.account, email: out.email, emailChecked: out.emailChecked } });
    return out;
  },
  // Renvoie le lien qui confirme l'adresse du compte.
  async resendCheck() {
    await App.api('/api/account/email/check', {});
  },
  // Le lien reçu par e-mail confirme l'adresse, connecté ou non.
  async confirmEmail(token: string) {
    const out = await App.api<{ email: string }>('/api/confirm', { token });
    if (state.account?.email.toLowerCase() === out.email.toLowerCase()) set({ account: { ...state.account, emailChecked: true } });
    return out.email;
  },
  // Un nouveau mot de passe choisi depuis le lien reçu par e-mail : il connecte.
  async reset(token: string, password: string) {
    const { user } = await App.api<{ user: Account }>('/api/reset', { token, password });
    setAccount(user);
  },
  // Achète un article du magasin du jour.
  async buy(item: string) {
    const { user } = await App.api<{ user: Account }>('/api/shop/buy', { item });
    setAccount(user);
  },
  // Choisit l'effet du pseudo parmi ceux achetés, ou aucun.
  async setFx(fx: string) {
    const out = await App.api<{ fx: string }>('/api/fx', { fx });
    if (state.account) set({ account: { ...state.account, fx: out.fx } });
  },
  // Change d'avatar : enregistré sur le compte, sinon gardé le temps de l'onglet.
  async setAvatar(code: string) {
    if (state.account) {
      const out = await App.api<{ avatar: string }>('/api/avatar', { avatar: code });
      set({ account: { ...state.account, avatar: out.avatar }, avatar: out.avatar });
      return;
    }
    try {
      sessionStorage.setItem(AVATAR_KEY, code);
    } catch {
      /* rien à faire */
    }
    set({ guestAvatar: code, avatar: code });
  },
  async sign(kind: 'login' | 'register', name: string, password: string, email?: string) {
    const { user } = await App.api<{ user: Account }>(`/api/${kind}`, kind === 'register' ? { name, password, email } : { name, password });
    setAccount(user);
    set({ modal: null });
    await App.adopt();
    App.toast(kind === 'register' ? tr('Compte créé. Un lien part à votre adresse pour la confirmer.', 'Account created. A link is on its way to your address to confirm it.') : tr('Connecté', 'Signed in'));
  },
  async signOut() {
    await App.api('/api/logout', {}).catch(() => null);
    setAccount(null);
    App.toast(tr('Déconnecté', 'Signed out'));
  },
  // invite, accept ou remove : renvoie ce qui lie désormais les deux joueurs.
  async friend(action: 'invite' | 'accept' | 'remove', name: string) {
    const out = await App.api<{ name: string; relation: Relation }>(`/api/friends/${action}`, { name });
    set({ asks: state.asks.filter((n) => n !== name) });
    void App.refresh();
    await App.loadPals();
    return out;
  },
  setLang(lang: Lang) {
    try {
      localStorage.setItem(LANG_KEY, lang);
    } catch {
      /* rien à faire */
    }
    document.documentElement.lang = lang;
    set({ lang });
  },
  // Un message d'erreur venu d'une table, dans la langue du joueur.
  serverToast(msg: string) {
    App.toast(serverMessage(msg, state.lang));
  },
  setFull(full: boolean) {
    set({ full });
  },
  rename(raw: string) {
    const guest = raw.trim().slice(0, NAME_MAX);
    if (!guest) return false;
    write(NAME_KEY, guest);
    set({ guest, name: state.account?.name ?? guest, modal: null });
    return true;
  },
  openModal(modal: Modal) {
    set({ modal });
  },
  async copy(text: string, done: string) {
    try {
      await navigator.clipboard.writeText(text);
      App.toast(done);
    } catch {
      App.toast(tr(`La copie a été refusée par le navigateur : ${text}`, `The browser refused to copy: ${text}`));
    }
  },
  // Ouvre une table sur le serveur et renvoie son code.
  async openTable(game?: string, open = false) {
    const table = await App.api<Table>('/api/tables', { game: game ?? '', public: open });
    App.remember(table);
    return table;
  },
  remember(table: Table | null) {
    if (state.table?.code === table?.code && !state.table?.left === !table?.left) return;
    write(TABLE_KEY, table);
    set({ table });
  },
  // Le joueur a quitté son salon : on le garde en mémoire, pour qu'il puisse y retourner
  // s'il est parti par mégarde.
  leftRoom(code: string) {
    App.remember({ code, game: state.table?.code === code ? state.table.game : '', left: true });
  },
  toast(msg: string) {
    const id = ++toastId;
    set({ toasts: [...state.toasts, { id, msg }] });
    setTimeout(() => set({ toasts: state.toasts.filter((t) => t.id !== id) }), 4000);
  },
};

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useApp() {
  return useSyncExternalStore(subscribe, () => state, () => initial);
}

// t('Rejoindre', 'Join') : le texte dans la langue du joueur.
export function useT(): T {
  const { lang } = useApp();
  return useCallback((fr: string, en: string) => (lang === 'en' ? en : fr), [lang]);
}
