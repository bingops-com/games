'use client';

import { useEffect, useState } from 'react';
import { GAMES, playersOf } from '@/games/catalog';
import { App, useT } from '@/lib/app';
import { GameCover } from '@/lib/art';
import { Avatar } from '@/lib/avatar';
import { Bar, Dialog, Ic } from './ui';

// Un salon public qui attend des joueurs, tel que le serveur le liste.
interface PublicRoom {
  code: string;
  game: string;
  host: string;
  avatar: string;
  players: number;
  // Ce qu'il faut pour lancer le jeu, et combien le salon en prend : la limite de l'hôte,
  // ou ce que le jeu permet.
  min: number;
  max: number;
}

// Partie publique : les salons publics, rangés par jeu. Pour chaque jeu, combien de joueurs
// attendent ; pour chaque salon, combien y sont sur combien de places. On en rejoint un, ou
// l'on en ouvre un sur le jeu de son choix en attendant que d'autres arrivent. La liste se
// relit toute seule.
export default function QuickPlay({ busy, join, open, close }: { busy: boolean; join: (code: string) => void; open: (game: string) => void; close: () => void }) {
  const t = useT();
  const [rooms, setRooms] = useState<PublicRoom[] | null>(null);
  useEffect(() => {
    let stale = false;
    const load = () => App.api<{ rooms: PublicRoom[] }>('/api/rooms').then((out) => stale || setRooms(out.rooms), () => stale || setRooms((old) => old ?? []));
    void load();
    const id = setInterval(load, 3000);
    return () => {
      stale = true;
      clearInterval(id);
    };
  }, []);
  const of = (game: string) => (rooms ?? []).filter((r) => r.game === game);
  const waiting = (list: PublicRoom[]) => list.reduce((n, r) => n + r.players, 0);
  // Les jeux où l'on attend du monde d'abord, les plus remplis en tête.
  const games = [...GAMES].sort((a, b) => waiting(of(b.id)) - waiting(of(a.id)));
  const total = waiting(rooms ?? []);
  return (
    <Dialog title={t('Partie publique', 'Public game')} onClose={close} size="wide" className="quick">
      <p role="status">
        {rooms === null
          ? t('Recherche des salons publics…', 'Looking for public rooms…')
          : total === 0
            ? t('Personne n’attend pour l’instant. Ouvrez un salon public sur le jeu de votre choix : les autres vous y rejoindront.', 'Nobody is waiting right now. Open a public room on the game of your choice: the others will join you there.')
            : t(`${total} joueur${total > 1 ? 's' : ''} en attente dans ${rooms.length} salon${rooms.length > 1 ? 's' : ''} public${rooms.length > 1 ? 's' : ''}. Rejoignez-en un, ou ouvrez le vôtre.`, `${total} player${total === 1 ? '' : 's'} waiting in ${rooms.length} public room${rooms.length === 1 ? '' : 's'}. Join one, or open your own.`)}
      </p>
      <ul className="quick-games">
        {games.map((g) => {
          const list = of(g.id);
          const n = waiting(list);
          return (
            <li key={g.id} className={n > 0 ? 'quick-game live' : 'quick-game'}>
              <div className="quick-head">
                <span className="quick-art chip-sea"><GameCover id={g.id} /></span>
                <h3>{g.name}</h3>
                <small>{playersOf(g, t)}</small>
                <b className="pill">{n > 0 ? t(`${n} en attente`, `${n} waiting`) : t('Personne', 'Nobody')}</b>
                <button className="btn quiet small" disabled={busy} onClick={() => open(g.id)}><Ic name="plus" />{t('Ouvrir un salon', 'Open a room')}</button>
              </div>
              {list.length > 0 && (
                <ul className="quick-rooms rows">
                  {list.map((r) => {
                    const missing = Math.max(0, r.min - r.players);
                    return (
                      <li key={r.code}>
                        <Avatar code={r.avatar} name={r.host} className="chip-sea" />
                        <p>
                          <b>{t(`Salon de ${r.host}`, `${r.host}’s room`)}</b>
                          <small>{missing > 0 ? t(`Il manque ${missing} joueur${missing > 1 ? 's' : ''} pour lancer`, `${missing} more player${missing === 1 ? '' : 's'} needed to start`) : t('Prêt à être lancé', 'Ready to start')}</small>
                        </p>
                        <span className="quick-seats">
                          <b>{r.players}/{r.max}</b>
                          <Bar value={r.players} max={r.max} label={t(`${r.players} joueurs sur ${r.max} places`, `${r.players} players out of ${r.max} seats`)} />
                        </span>
                        <button className="btn primary small" disabled={busy} onClick={() => join(r.code)}><Ic name="enter" />{t('Rejoindre', 'Join')}</button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </Dialog>
  );
}
