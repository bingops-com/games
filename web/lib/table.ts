'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { App, guestId, useApp } from './app';

// Ce que le serveur envoie à chaque changement : la table, et ce que ce joueur voit du jeu.
export interface Member {
  id: string;
  name: string;
  avatar: string;
  // L'effet que porte son pseudo, s'il en a choisi un.
  fx?: string;
  account: boolean;
  on: boolean;
  seat: number;
  // Parties gagnées dans ce salon.
  wins: number;
}

export interface TableState<V = unknown> {
  now: number;
  code: string;
  game: string;
  // Combien de joueurs prend le jeu choisi.
  min: number;
  max: number;
  phase: 'lobby' | 'playing' | 'over';
  host: string;
  you: string;
  seat: number;
  members: Member[];
  winners: number[] | null;
  // La partie s'est finie sur un abandon : elle ne compte pour personne.
  void: boolean;
  // N'importe qui peut trouver le salon ; le nombre de parties finies ici ; les réglages
  // de l'hôte pour le jeu choisi ; et sa liste de mots (wordsMin : combien il en faut, 0
  // si le jeu n'en tire pas ; list : la liste, que seul l'hôte reçoit).
  public: boolean;
  // Le jeu se choisit au vote (sinon l'hôte choisit, et un vote est un souhait) ; les voix de
  // chaque jeu ; et le jeu pour lequel ce joueur a voté.
  byVote: boolean;
  votes: Record<string, number>;
  vote: string;
  // Combien de joueurs l'hôte veut au plus dans le salon ; 0 : autant que le jeu en prend.
  limit: number;
  played: number;
  options: Setting[];
  wordsMin: number;
  words: number;
  list?: string[];
  view: V;
}

// Un réglage de l'hôte. Valeur 0 : le jeu décide.
export interface Setting {
  key: string;
  min: number;
  max: number;
  step: number;
  value: number;
}

// Ce qu'un joueur a écrit dans le salon.
export interface ChatLine {
  id: number;
  from: string;
  name: string;
  text: string;
  at: number;
}

// missing : aucune table à ce code. full : plus de place. left : le joueur est parti.
// kicked : l'hôte l'a retiré du salon.
export type Link = 'connecting' | 'open' | 'lost' | 'missing' | 'full' | 'left' | 'kicked';

export interface TableLink {
  link: Link;
  st: TableState | null;
  chat: ChatLine[];
  // Décalage entre l'horloge du serveur et celle de l'appareil, pour les comptes à rebours.
  skew: number;
  send: (msg: object) => void;
  act: (action: object) => void;
}

export function useTable(code: string): TableLink {
  const { ready, account, guest, avatar } = useApp();
  const [link, setLink] = useState<Link>('connecting');
  const [st, setSt] = useState<TableState | null>(null);
  const [skew, setSkew] = useState(0);
  const [chat, setChat] = useState<ChatLine[]>([]);
  const socket = useRef<WebSocket | null>(null);
  const who = account?.name;

  useEffect(() => {
    if (!ready || !code) return;
    let closed = false;
    let retry: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const connect = async () => {
      // La poignée de main d'un WebSocket ne dit pas pourquoi elle échoue : on demande d'abord.
      const known = await fetch(`/api/tables/${code}`).then((r) => r.status, () => 0);
      if (closed) return;
      if (known === 404) return setLink('missing');
      const q = new URLSearchParams({ code });
      if (!who) {
        q.set('guest', guestId());
        q.set('name', guest);
        q.set('avatar', avatar);
      }
      const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/ws?${q}`);
      socket.current = ws;
      ws.onopen = () => {
        attempt = 0;
      };
      ws.onmessage = (e) => {
        const msg = JSON.parse(e.data as string);
        if (msg.t === 'state') {
          setSt(msg);
          setSkew(msg.now - Date.now());
          setLink('open');
          App.remember({ code: msg.code, game: msg.game });
        } else if (msg.t === 'chats') {
          setChat(msg.list);
        } else if (msg.t === 'chat') {
          setChat((old) => [...old.filter((l) => l.id !== msg.m.id), msg.m].slice(-60));
        } else if (msg.t === 'error') {
          App.serverToast(msg.msg);
        } else if (msg.t === 'left' || msg.t === 'kicked') {
          closed = true;
          setLink(msg.t);
        }
      };
      ws.onclose = (e) => {
        if (closed) return;
        if (e.code === 1008) {
          closed = true;
          // Le serveur dit pourquoi il refuse : retiré par l'hôte, ou salon complet.
          return setLink(e.reason.includes('retiré') ? 'kicked' : 'full');
        }
        setLink('lost');
        retry = setTimeout(connect, Math.min(8000, 500 * 2 ** attempt++));
      };
    };
    setLink('connecting');
    void connect();
    return () => {
      closed = true;
      clearTimeout(retry);
      socket.current?.close();
      socket.current = null;
    };
  }, [ready, code, who, guest, avatar]);

  const send = useCallback((msg: object) => {
    if (socket.current?.readyState === WebSocket.OPEN) socket.current.send(JSON.stringify(msg));
  }, []);
  const act = useCallback((a: object) => send({ t: 'act', a }), [send]);
  return { link, st, chat, skew, send, act };
}

// L'heure, rafraîchie assez souvent pour un compte à rebours.
export function useNow(every = 250) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(id);
  }, [every]);
  return now;
}

// Ce dont une scène de jeu a besoin.
export interface StageProps<V> {
  st: TableState<V>;
  skew: number;
  act: (action: object) => void;
}

// Le joueur assis à une place de la partie.
export const atSeat = (st: TableState, seat: number) => st.members.find((m) => m.seat === seat);
export const nameAt = (st: TableState, seat: number) => atSeat(st, seat)?.name ?? '?';
// L'avatar du joueur assis là : ce qu'il a choisi, ou vide (la tête que son nom lui donne).
// L'effet du pseudo du joueur assis là.
export const fxAt = (st: TableState, seat: number) => atSeat(st, seat)?.fx;
export const avatarAt = (st: TableState, seat: number) => atSeat(st, seat)?.avatar ?? '';
export const initial = (name: string) => name.charAt(0).toUpperCase();
