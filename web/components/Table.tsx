'use client';

import { play } from '@/lib/sound';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, type ComponentType, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { GAMES, byId, lengthOf, pitchOf, playersOf, rulesOf, type Game } from '@/games/catalog';
import { App, cleanCode, profilePath, useApp, useT } from '@/lib/app';
import { GameCover } from '@/lib/art';
import { Avatar } from '@/lib/avatar';
import { Name } from '@/lib/shop';
import { MemberActions, MemberMenu, ReportDialog, RoomChat, Settings } from './RoomExtras';
import { Bar, Dialog, Ic } from './ui';
import { howOf, nextObjective, titleOf } from '@/lib/objectives';
import type { T } from '@/lib/i18n';
import { useTable, type Member, type StageProps, type TableLink, type TableState } from '@/lib/table';
import GartikStage from '@/stages/GartikStage';
import MecheStage from '@/stages/MecheStage';
import PavillonsStage from '@/stages/PavillonsStage';
import PoudriereStage from '@/stages/PoudriereStage';
import SkribStage from '@/stages/SkribStage';
import TerreStage from '@/stages/TerreStage';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const STAGES: Record<string, ComponentType<StageProps<any>>> = {
  terre: TerreStage,
  pavillons: PavillonsStage,
  meche: MecheStage,
  poudriere: PoudriereStage,
  skrib: SkribStage,
  gartik: GartikStage,
};

const roomLink = (code: string) => `${location.origin}/t/?code=${code}`;

// Le salon s'écrit dans la bande de gauche, à la place de la navigation : son code, ses
// joueurs, et de quoi le quitter.
function InBand({ children }: { children: ReactNode }) {
  const [slot, setSlot] = useState<HTMLElement | null>(null);
  useEffect(() => setSlot(document.getElementById('side-slot')), []);
  return slot ? createPortal(children, slot) : null;
}

// Les parties gagnées par un joueur depuis qu'il est dans le salon : une coupe et un nombre.
function Wins({ n }: { n: number }) {
  const t = useT();
  if (!n) return null;
  return (
    <span className="pill count" title={t(`${n} victoire${n > 1 ? 's' : ''} dans ce salon`, `${n} win${n === 1 ? '' : 's'} in this room`)}>
      <Ic name="cup" />
      {n}
      <span className="sr">{t(`victoire${n > 1 ? 's' : ''} dans ce salon`, `win${n === 1 ? '' : 's'} in this room`)}</span>
    </span>
  );
}

const statusOf = (st: TableState, m: Member, t: T) => [m.id === st.you && t('vous', 'you'), m.id === st.host && t('hôte', 'host'), st.phase !== 'lobby' && m.seat < 0 && t('regarde', 'watching'), !m.on && t('déconnecté', 'disconnected')].filter(Boolean).join(', ');

// Qui est dans le salon, dans la bande : un joueur par ligne, serrée, pour en montrer
// beaucoup ; ceux qui regardent après ceux qui jouent.
function Members({ st, send, report }: { st: TableState; send: TableLink['send']; report: (m: Member) => void }) {
  const t = useT();
  const playing = st.phase !== 'lobby';
  const members = playing ? [...st.members].sort((a, b) => (a.seat < 0 ? 99 : a.seat) - (b.seat < 0 ? 99 : b.seat)) : st.members;
  return (
    <ul className="members tight">
      {members.map((m) => (
        <li key={m.id} className={`member${m.on ? '' : ' off'}${m.id === st.you ? ' me' : ''}`}>
          <Avatar code={m.avatar} name={m.name} />
          {m.account ? <Link href={profilePath(m.name)} target="_blank"><Name name={m.name} fx={m.fx} /></Link> : <b>{m.name}</b>}
          <small>{statusOf(st, m, t)}</small>
          <Wins n={m.wins} />
          <MemberMenu st={st} m={m} send={send} report={report} />
        </li>
      ))}
    </ul>
  );
}

// Dans la salle d'attente : l'équipage en vignettes, quatre par rangée, pour tenir à douze.
// Une vignette se touche pour ouvrir, dessous, ce qu'on peut faire du joueur. Les places
// qu'il reste à remplir pour lancer le jeu suivent, en creux.
function Crew({ st, send, report, free }: { st: TableState; send: TableLink['send']; report: (m: Member) => void; free: number }) {
  const t = useT();
  const [picked, setPicked] = useState<string | null>(null);
  const chosen = st.members.find((m) => m.id === picked && m.id !== st.you);
  return (
    <div className="crew">
      <ul className="crew-grid">
        {st.members.map((m) => {
          const inside = (
            <>
              <Avatar code={m.avatar} name={m.name} />
              <b><Name name={m.name} fx={m.fx} /></b>
              <small>{statusOf(st, m, t)}</small>
              {m.wins > 0 && <Wins n={m.wins} />}
            </>
          );
          const cls = `crew-chip${m.on ? '' : ' off'}${m.id === st.you ? ' me' : ''}${chosen?.id === m.id ? ' on' : ''}`;
          return (
            <li key={m.id}>
              {m.id === st.you
                ? <div className={cls}>{inside}</div>
                : <button className={cls} aria-expanded={chosen?.id === m.id} title={t(`Actions pour ${m.name}`, `Actions for ${m.name}`)} onClick={() => setPicked(chosen?.id === m.id ? null : m.id)}>{inside}</button>}
            </li>
          );
        })}
        {Array.from({ length: free }, (_, i) => (
          <li key={`free-${i}`}><div className="crew-chip free"><span className="disc" aria-hidden="true" /><b>{t('Place libre', 'Free seat')}</b></div></li>
        ))}
      </ul>
      {chosen && (
        <div className="member-menu crew-actions">
          <b>{chosen.name}</b>
          {chosen.account && <Link className="pill ghost" href={profilePath(chosen.name)} target="_blank">{t('Voir son profil', 'See their profile')}</Link>}
          <MemberActions st={st} m={chosen} send={send} report={report} done={() => setPicked(null)} />
        </div>
      )}
    </div>
  );
}

function Band({ st, link, report }: { st: TableState; link: TableLink; report: (m: Member) => void }) {
  const send = link.send;
  const t = useT();
  const [open, setOpen] = useState(false);
  const playing = st.phase !== 'lobby';
  const n = st.members.length;
  return (
    <div className={`room${open ? ' open' : ''}${playing ? '' : ' waiting'}`}>
      <button className="room-code" onClick={() => App.copy(roomLink(st.code), t('Lien d’invitation copié', 'Invitation link copied'))} aria-label={t(`Salon ${st.code}, copier le lien d'invitation`, `Room ${st.code}, copy the invitation link`)}>
        <small>{t('Salon', 'Room')}</small>
        <strong>{st.code}</strong>
        <span><Ic name="copy" />{t('Copier le lien d’invitation', 'Copy invitation link')}</span>
      </button>
      <button className="btn onsea small room-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {t(`${n} joueur${n > 1 ? 's' : ''}`, `${n} player${n === 1 ? '' : 's'}`)}
      </button>
      <div className="room-body">
        <h2>{t(`${n} joueur${n > 1 ? 's' : ''}`, `${n} player${n === 1 ? '' : 's'}`)}</h2>
        <Members st={st} send={send} report={report} />
        {/* Pendant la partie, la discussion est ici ; avant, elle est dans la salle d'attente. */}
        {playing && <RoomChat link={link} st={st} />}
        <button className="btn onsea small room-leave" onClick={() => send({ t: 'leave' })}><Ic name="leave" />{t('Quitter le salon', 'Leave the room')}</button>
      </div>
    </div>
  );
}

// Les règles du jeu choisi, dans une fenêtre par-dessus la scène.
function Rules({ game, close }: { game: Game; close: () => void }) {
  const { lang } = useApp();
  const t = useT();
  return (
    <Dialog title={game.name} onClose={close} size="medium">
      <p>{pitchOf(game, lang)}</p>
      <ul className="rules rows">
        {rulesOf(game, lang).map((r) => <li key={r}>{r}</li>)}
      </ul>
      <button className="btn primary" autoFocus onClick={close}>{t('Compris', 'Got it')}</button>
    </Dialog>
  );
}

// Avant la partie, le salon est une salle d'attente : le jeu choisi en grand, qui est là et
// comment inviter, puis de quoi changer de jeu. L'hôte choisit, tout le monde le voit changer.
function Lobby({ st, game, link, rules, report }: { st: TableState; game: Game; link: TableLink; rules: () => void; report: (m: Member) => void }) {
  const send = link.send;
  const { lang } = useApp();
  const t = useT();
  const host = st.host === st.you;
  const hostName = st.members.find((m) => m.id === st.host)?.name ?? '';
  const n = st.members.length;
  const missing = Math.max(0, st.min - n);
  const extra = n - st.max;
  const blocked = missing > 0
    ? t(`Il manque ${missing} joueur${missing > 1 ? 's' : ''} pour ${game.name}.`, `${missing} more player${missing === 1 ? '' : 's'} needed for ${game.name}.`)
    : extra > 0
      ? t(`${game.name} se joue à ${st.max} au plus : vous êtes ${n}.`, `${game.name} takes ${st.max} players at most: you are ${n}.`)
      : '';
  const url = roomLink(st.code);
  // La limite de l'hôte : au moins ce qu'il faut pour jouer et ceux qui sont là, au plus ce
  // que le jeu permet.
  const seatsMin = Math.max(st.min, n);
  const seatsMax = Math.min(st.max, 12);
  const seats = st.limit > 0 ? Math.min(st.limit, seatsMax) : seatsMax;
  return (
    <div className="lobby">
      <section className="lobby-game light" aria-labelledby="lobby-game-name">
        {/* La clé rejoue l'entrée quand l'hôte change de jeu : tout le monde voit que ça a changé. */}
        <div className="lobby-art" key={`art-${game.id}`}><GameCover id={game.id} big /></div>
        <div className="lobby-what" key={game.id}>
          <p className="lobby-kicker">{host ? t('Jeu choisi', 'Chosen game') : t(`Le choix de ${hostName}`, `${hostName}’s pick`)}</p>
          <h1 id="lobby-game-name">{game.name}</h1>
          <p className="lobby-pitch">{pitchOf(game, lang)}</p>
          <p className="lobby-facts">{playersOf(game, t)}, {lengthOf(game, t)}. <button className="as-link lobby-rules" onClick={rules}>{t('Lire les règles', 'Read the rules')}</button></p>
          <Settings st={st} send={send} />
          <ul className="rules rows lobby-rules-list">
            {rulesOf(game, lang).map((r) => <li key={r}>{r}</li>)}
          </ul>
        </div>
        <div className="lobby-go">
          <p className={blocked ? 'lobby-hint' : 'lobby-hint ok'}>
            {blocked || (host ? t('Tout le monde est là ? Lancez !', 'Everyone here? Start!') : t(`On attend que ${hostName} lance la partie.`, `Waiting for ${hostName} to start.`))}
          </p>
          {host && <button className="btn primary big" disabled={!!blocked} onClick={() => send({ t: 'start' })}>{t('Lancer la partie', 'Start the game')}</button>}
        </div>
      </section>

      <section className="lobby-crew veil" aria-labelledby="lobby-crew-title">
        <h2 id="lobby-crew-title">
          {n === 1 ? t('Personne d’autre pour l’instant', 'Nobody else yet') : t(`${n} joueurs dans le salon`, `${n} players in the room`)}
          <small>{t(`${seats} places`, `${seats} seats`)}</small>
        </h2>
        <Crew st={st} send={send} report={report} free={missing} />
        <div className="lobby-invite">
          <div className="invite-row">
            <span className="invite-link">{url.replace(/^https?:\/\//, '')}</span>
            <button className="btn white small" onClick={() => App.copy(url, t('Lien d’invitation copié', 'Invitation link copied'))}><Ic name="copy" />{t('Copier', 'Copy')}</button>
          </div>
          {host ? (
            <div className="lobby-host">
              <label className="check" title={t('N’importe qui peut rejoindre un salon public depuis « Partie publique », sur l’accueil.', 'Anyone can join a public room from "Public game", on the home page.')}>
                <input type="checkbox" checked={st.public} onChange={(e) => send({ t: 'public', a: e.target.checked })} />
                <span>{t('Salon public', 'Public room')}</span>
              </label>
              <div className="lobby-limit" role="group" aria-label={t('Places dans le salon', 'Seats in the room')} title={t(`De ${seatsMin} à ${seatsMax} places pour ce jeu`, `From ${seatsMin} to ${seatsMax} seats for this game`)}>
                <span>{t('Places', 'Seats')}</span>
                <button className="btn onsea small icon" disabled={seats <= seatsMin} onClick={() => send({ t: 'limit', a: seats - 1 })} aria-label={t('Une place de moins', 'One seat fewer')}>−</button>
                <b aria-live="polite">{seats}</b>
                <button className="btn onsea small icon" disabled={seats >= seatsMax} onClick={() => send({ t: 'limit', a: seats + 1 })} aria-label={t('Une place de plus', 'One more seat')}>+</button>
              </div>
            </div>
          ) : (
            <p className="lobby-host">{st.public ? t('Salon public', 'Public room') : t('Salon privé : on y entre avec le lien', 'Private room: you get in with the link')}{st.played > 0 && t(`, ${st.played} partie${st.played > 1 ? 's' : ''} jouée${st.played > 1 ? 's' : ''}`, `, ${st.played} game${st.played === 1 ? '' : 's'} played`)}</p>
          )}
        </div>
        <RoomChat link={link} st={st} />
      </section>

      <section className="lobby-switch" aria-labelledby="lobby-switch-title">
        <h2 id="lobby-switch-title">{host ? t('Changer de jeu', 'Change game') : t('Les autres jeux', 'The other games')}</h2>
        <ul className="picker" role={host ? 'radiogroup' : undefined} aria-labelledby="lobby-switch-title">
          {GAMES.map((g) => {
            const on = g.id === game.id;
            // Le jeu ne convient pas au groupe présent : la tuile dit pourquoi. Seul, tous les
            // jeux attendent du monde, et la carte du jeu choisi le dit déjà.
            const fit = n > 1 && n < g.players[0]
              ? t(`Dès ${g.players[0]} joueurs`, `From ${g.players[0]} players`)
              : n > g.players[1]
                ? t(`${g.players[1]} joueurs au plus`, `${g.players[1]} players at most`)
                : '';
            return (
              <li key={g.id}>
                <button className={`pick-game${on ? ' on' : ''}`} role={host ? 'radio' : undefined} aria-checked={host ? on : undefined} disabled={!host} onClick={() => send({ t: 'game', id: g.id })}>
                  <GameCover id={g.id} />
                  <b>{g.name}</b>
                  <small className={fit ? 'no' : undefined}>{fit || playersOf(g, t)}</small>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

// À la fin d'une partie, de quoi donner envie de la suivante : l'objectif le plus proche,
// ou, pour un invité qui vient de jouer, ce qu'un compte lui aurait compté.
function After({ played, voided }: { played: boolean; voided: boolean }) {
  const { account, objectives } = useApp();
  const t = useT();
  if (voided) return <p className="after">{t('Quelqu’un est parti avant la fin : la partie ne compte pas.', 'Someone left before the end: the game does not count.')}</p>;
  if (!account) {
    if (!played) return null;
    return (
      <p className="after">
        {t('Avec un compte, cette partie aurait compté.', 'With an account, this game would have counted.')}{' '}
        <button className="as-link" onClick={() => App.openModal('register')}>{t('Créer un compte', 'Create an account')}</button>
      </p>
    );
  }
  const next = nextObjective(objectives);
  if (!next) return null;
  return (
    <p className="after">
      <span>{t(`Prochain objectif : ${titleOf(next, t)}`, `Next objective: ${titleOf(next, t)}`)}</span>
      <Bar value={next.have} max={next.goal} />
      <small>{howOf(next, t)}, {next.have}/{next.goal}</small>
    </p>
  );
}

function result(st: TableState, game: Game, t: T) {
  // Un jeu sans gagnant : on a joué pour rire.
  if (game.noWinner) return t('C’est fini !', 'That’s all!');
  const winners = st.members.filter((m) => m.seat >= 0 && st.winners?.includes(m.seat));
  if (winners.length === 0) return t('Personne ne gagne', 'Nobody wins');
  if (winners.some((m) => m.id === st.you)) return winners.length > 1 ? t('Votre équipe gagne !', 'Your team wins!') : t('Vous gagnez !', 'You win!');
  const names = winners.map((m) => m.name).join(', ');
  return winners.length > 1 ? t(`${names} gagnent`, `${names} win`) : t(`${names} gagne`, `${names} wins`);
}

function Room({ link, game }: { link: TableLink; game: Game }) {
  const t = useT();
  const { full } = useApp();
  const [rules, setRules] = useState(false);
  const [reported, setReported] = useState<Member | null>(null);
  const st = link.st!;
  const Stage = STAGES[game.id];
  const host = st.host === st.you;
  const hostName = st.members.find((m) => m.id === st.host)?.name ?? '';
  const playing = st.phase !== 'lobby';
  // Une partie finie change ce que le joueur a accompli : on relit son compte, le temps que
  // le serveur l'ait compté.
  const over = st.phase === 'over';
  useEffect(() => {
    if (!over) return;
    const id = setTimeout(() => void App.refresh(), 1200);
    return () => clearTimeout(id);
  }, [over]);
  // La fin de la partie et l'arrivée d'un joueur s'entendent.
  const won = over && (game.noWinner || st.members.some((m) => m.id === st.you && m.seat >= 0 && st.winners?.includes(m.seat)));
  useEffect(() => {
    if (over) play(won ? 'win' : 'lose');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [over]);
  const crowd = st.members.length;
  const before = useRef(crowd);
  useEffect(() => {
    if (crowd > before.current) play('join');
    before.current = crowd;
  }, [crowd]);
  // Échap quitte la pleine fenêtre.
  useEffect(() => {
    if (!full) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && App.setFull(false);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [full]);
  return (
    <div className="play">
      <InBand><Band st={st} link={link} report={setReported} /></InBand>
      <section className={`sea board board-${playing ? game.id : 'lobby'}`} aria-label={playing ? game.name : t('Salon', 'Room')}>
        <div className="board-bar">
          {playing ? <b>{game.name}</b> : <b>{t(`Salon ${st.code}`, `Room ${st.code}`)}</b>}
          {st.seat < 0 && playing && <span>{t('Vous regardez : vous jouerez la prochaine partie.', 'You are watching: you will play the next game.')}</span>}
          <span className="board-tools">
            {playing && <button className="btn onsea small" onClick={() => setRules(true)}>{t('Règles', 'Rules')}</button>}
            {playing && host && st.phase === 'playing' && <button className="btn onsea small" onClick={() => link.send({ t: 'lobby' })}>{t('Arrêter la partie', 'Stop the game')}</button>}
            <button className="btn onsea small" aria-pressed={full} onClick={() => App.setFull(!full)}>{full ? t('Quitter la pleine fenêtre', 'Exit full window') : t('Pleine fenêtre', 'Full window')}</button>
          </span>
        </div>
        {playing ? <Stage st={st} skew={link.skew} act={link.act} /> : <Lobby st={st} game={game} link={link} rules={() => setRules(true)} report={setReported} />}
        {st.phase === 'over' && (
          <div className="outcome" role="status">
            <div className="outcome-card light">
              <GameCover id={game.id} />
              <strong>{result(st, game, t)}</strong>
              <After played={st.seat >= 0} voided={st.void} />
              {host ? (
                <div className="row-actions">
                  <button className="btn primary big" onClick={() => link.send({ t: 'start' })}>{t('Rejouer', 'Play again')}</button>
                  <button className="btn quiet" onClick={() => link.send({ t: 'lobby' })}>{t('Changer de jeu', 'Change game')}</button>
                </div>
              ) : (
                <p>{t(`${hostName} relance une partie ou change de jeu.`, `${hostName} starts another game or changes game.`)}</p>
              )}
            </div>
          </div>
        )}
      </section>
      {rules && <Rules game={game} close={() => setRules(false)} />}
      {reported && <ReportDialog st={st} member={reported} close={() => setReported(null)} />}
    </div>
  );
}

export default function Table() {
  const router = useRouter();
  const t = useT();
  const code = cleanCode(useSearchParams().get('code') ?? '');
  const link = useTable(code);
  // Un salon fermé n'est plus proposé. Un salon quitté le reste, dans la bande, pour y
  // retourner si c'était par mégarde.
  const gone = link.link === 'missing' || link.link === 'kicked';
  useEffect(() => {
    if (gone) App.remember(null);
    if (link.link === 'left') {
      App.leftRoom(code);
      App.toast(t(`Vous avez quitté le salon ${code}. Vous pouvez encore y retourner.`, `You left room ${code}. You can still go back.`));
      router.push('/');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gone, link.link, router]);
  const notice = (text: string) => <p className="notice">{text} <Link href="/">{t('Revenir à l’accueil', 'Back to the home page')}</Link></p>;
  if (!code) return notice(t('Cette adresse ne mène à aucun salon.', 'This address leads to no room.'));
  if (link.link === 'missing') return notice(t(`Aucun salon ${code} : il a été fermé, ou le code est mal recopié.`, `No room ${code}: it was closed, or the code was mistyped.`));
  if (link.link === 'kicked') return notice(t(`L’hôte vous a retiré du salon ${code}.`, `The host removed you from room ${code}.`));
  if (link.link === 'full') return notice(t(`Le salon ${code} est complet.`, `Room ${code} is full.`));
  if (link.link === 'left') return null;
  const game = link.st && byId(link.st.game);
  if (!link.st || !game) return <p className="notice">{t(`Connexion au salon ${code}…`, `Connecting to room ${code}…`)}</p>;
  return (
    <>
      {link.link === 'lost' && <p className="notice lost" role="status">{t('Connexion perdue, nouvelle tentative en cours. Votre place est gardée.', 'Connection lost, trying again. Your seat is kept.')}</p>}
      <Room link={link} game={game} />
    </>
  );
}
