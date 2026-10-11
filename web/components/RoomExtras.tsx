'use client';

import { useState, type FormEvent } from 'react';
import { App, useApp, useT } from '@/lib/app';
import type { T } from '@/lib/i18n';
import type { ChatLine, Member, Setting, TableLink, TableState } from '@/lib/table';
import Chat from './Chat';
import { Dialog } from './ui';

// Ce qui entoure le jeu dans un salon : la discussion, ce qu'on peut faire d'un joueur
// (lui passer la main, le retirer, le masquer, le bloquer, le signaler), et les réglages
// de la partie.

// Les messages d'un joueur bloqué ou masqué ne s'affichent pas.
function hidden(line: ChatLine, muted: string[], blocked: string[]) {
  return muted.includes(line.from) || (line.from.startsWith('u:') && blocked.includes(line.from.slice(2)));
}

// La discussion du salon, sans les messages de ceux que ce joueur a masqués ou bloqués.
export function RoomChat({ link, st }: { link: TableLink; st: TableState }) {
  const { account, muted } = useApp();
  const lines = link.chat.filter((l) => !hidden(l, muted, account?.blocked ?? []));
  return <Chat lines={lines} members={st.members} you={st.you} send={(a) => link.send({ t: 'chat', a })} />;
}

const REASONS: [id: string, fr: string, en: string][] = [
  ['insultes', 'Insultes ou harcèlement', 'Insults or harassment'],
  ['dessin', 'Dessin déplacé', 'Inappropriate drawing'],
  ['pseudo', 'Pseudo déplacé', 'Inappropriate name'],
  ['triche', 'Triche', 'Cheating'],
  ['autre', 'Autre chose', 'Something else'],
];

// Signaler un joueur : le signalement part chez ceux qui tiennent le site, avec ce que le
// joueur a écrit dans le salon. Rien ne se passe tout seul.
export function ReportDialog({ st, member, close }: { st: TableState; member: Member; close: () => void }) {
  const t = useT();
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await App.api('/api/report', { room: st.code, target: member.id, reason: f.get('reason'), text: f.get('text') });
      App.toast(t('Signalement envoyé. Merci.', 'Report sent. Thank you.'));
      close();
    } catch (err) {
      App.toast((err as Error).message);
    }
    setBusy(false);
  };
  return (
    <Dialog title={t(`Signaler ${member.name}`, `Report ${member.name}`)} onClose={close} onSubmit={submit}>
      <p>{t('Le signalement est lu par les personnes qui tiennent le site, avec ses derniers messages dans ce salon. En attendant, vous pouvez masquer ses messages.', 'The report is read by the people who run the site, with their last messages in this room. Meanwhile, you can hide their messages.')}</p>
      <fieldset>
        <legend>{t('Pourquoi ?', 'Why?')}</legend>
        {REASONS.map(([id, fr, en], i) => (
          <label key={id} className="check"><input type="radio" name="reason" value={id} defaultChecked={i === 0} /> {t(fr, en)}</label>
        ))}
      </fieldset>
      <label>
        {t('Un mot de plus (facultatif)', 'Anything to add (optional)')}
        <input name="text" maxLength={300} autoComplete="off" />
      </label>
      <button className="btn primary" disabled={busy}>{t('Envoyer le signalement', 'Send report')}</button>
      <button type="button" className="btn quiet" onClick={close}>{t('Annuler', 'Cancel')}</button>
    </Dialog>
  );
}

// Ce qu'on peut faire d'un joueur : l'hôte peut lui passer la main ou le retirer ; tout le
// monde peut le masquer, le signaler, et le bloquer s'il a un compte.
export function MemberActions({ st, m, send, report, done }: { st: TableState; m: Member; send: TableLink['send']; report: (m: Member) => void; done: () => void }) {
  const { account, muted } = useApp();
  const t = useT();
  const [sure, setSure] = useState(false);
  const host = st.host === st.you;
  const isMuted = muted.includes(m.id);
  const blocked = m.account && !!account?.blocked.includes(m.name);
  return (
    <>
      {host && <button className="pill ghost" onClick={() => { send({ t: 'host', id: m.id }); done(); }}>{t('Nommer hôte', 'Make host')}</button>}
      {host && (sure
        ? <button className="pill" onClick={() => { send({ t: 'kick', id: m.id }); done(); }}>{t('Confirmer le retrait', 'Confirm removal')}</button>
        : <button className="pill ghost" onClick={() => setSure(true)}>{t('Retirer du salon', 'Remove from room')}</button>)}
      <button className="pill ghost" onClick={() => { App.toggleMute(m.id); done(); }}>{isMuted ? t('Réafficher ses messages', 'Show their messages') : t('Masquer ses messages', 'Hide their messages')}</button>
      {account && m.account && (
        <button className="pill ghost" onClick={() => { App.block(blocked ? 'remove' : 'add', m.name).then(() => App.toast(blocked ? t(`${m.name} débloqué`, `${m.name} unblocked`) : t(`${m.name} bloqué`, `${m.name} blocked`)), (err: Error) => App.toast(err.message)); done(); }}>
          {blocked ? t('Débloquer', 'Unblock') : t('Bloquer', 'Block')}
        </button>
      )}
      <button className="pill ghost" onClick={() => { report(m); done(); }}>{t('Signaler', 'Report')}</button>
    </>
  );
}

// Dans une liste, ces actions se déplient sous la ligne du joueur, d'un bouton à trois points.
export function MemberMenu({ st, m, send, report }: { st: TableState; m: Member; send: TableLink['send']; report: (m: Member) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (m.id === st.you) return null;
  return (
    <>
      <button className="dots" aria-expanded={open} aria-label={t(`Actions pour ${m.name}`, `Actions for ${m.name}`)} onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="2" /><circle cx="12" cy="12" r="2" /><circle cx="19" cy="12" r="2" /></svg>
      </button>
      {open && <div className="member-menu"><MemberActions st={st} m={m} send={send} report={report} done={() => setOpen(false)} /></div>}
    </>
  );
}

// Le nom d'un réglage et son unité, par jeu.
function settingLabel(game: string, key: string, t: T): [label: string, unit: string] {
  const s = t('s', 's');
  switch (`${game}.${key}`) {
    case 'terre.turn': return [t('Temps par tour', 'Time per turn'), s];
    case 'meche.lives': return [t('Vies', 'Lives'), ''];
    case 'poudriere.shrink': return [t('La grille se referme après', 'The grid closes in after'), s];
    case 'skrib.draw': return [t('Temps pour dessiner', 'Time to draw'), s];
    case 'skrib.rounds': return [t('Tours de table', 'Rounds'), ''];
    case 'gartik.write': return [t('Temps pour écrire', 'Time to write'), s];
    case 'gartik.draw': return [t('Temps pour dessiner', 'Time to draw'), s];
  }
  return [key, ''];
}

const shown = (o: Setting, unit: string, t: T) => (o.value === 0 ? t('auto', 'auto') : `${o.value}${unit ? ` ${unit}` : ''}`);

// Les réglages de la partie : l'hôte les change, les autres les lisent.
export function Settings({ st, send }: { st: TableState; send: TableLink['send'] }) {
  const t = useT();
  const [words, setWords] = useState(false);
  const host = st.host === st.you;
  if (st.options.length === 0 && st.wordsMin === 0) return null;
  if (!host) {
    const parts = st.options.map((o) => {
      const [label, unit] = settingLabel(st.game, o.key, t);
      return `${label.toLowerCase()} : ${shown(o, unit, t)}`;
    });
    if (st.words > 0) parts.push(t(`${st.words} mots choisis par l’hôte`, `${st.words} words picked by the host`));
    return parts.length > 0 ? <p className="settings-read">{t('Réglages', 'Settings')} : {parts.join(', ')}.</p> : null;
  }
  return (
    <div className="settings">
      {st.options.map((o) => {
        const [label, unit] = settingLabel(st.game, o.key, t);
        // Un réglage que le jeu sait choisir seul commence sur « auto », un cran sous le minimum.
        const auto = o.value === 0;
        const floor = auto || st.game === 'skrib' && o.key === 'rounds' ? o.min - o.step : o.min;
        return (
          <label key={o.key}>
            <span>{label}</span>
            <input type="range" min={floor} max={o.max} step={o.step} value={auto ? floor : o.value} onChange={(e) => send({ t: 'opt', id: o.key, a: +e.target.value < o.min ? 0 : +e.target.value })} />
            <output>{shown(o, unit, t)}</output>
          </label>
        );
      })}
      {st.wordsMin > 0 && (
        <p className="settings-words">
          {st.words > 0 ? t(`Vos ${st.words} mots sont utilisés.`, `Your ${st.words} words are used.`) : t('Les mots du jeu sont utilisés.', 'The game’s own words are used.')}{' '}
          <button className="as-link" onClick={() => setWords(true)}>{st.words > 0 ? t('Modifier la liste', 'Edit the list') : t('Jouer avec vos mots', 'Play with your own words')}</button>
        </p>
      )}
      {words && <WordsDialog st={st} send={send} close={() => setWords(false)} />}
    </div>
  );
}

function WordsDialog({ st, send, close }: { st: TableState; send: TableLink['send']; close: () => void }) {
  const t = useT();
  const [text, setText] = useState((st.list ?? []).join('\n'));
  const list = [...new Set(text.split(/[\n,;]+/).map((w) => w.trim().toLowerCase()).filter(Boolean))];
  const short = list.length > 0 && list.length < st.wordsMin;
  const save = (words: string[]) => {
    send({ t: 'words', a: words });
    close();
  };
  return (
    <Dialog title={t('Vos propres mots', 'Your own words')} onClose={close} size="medium">
      <p>{t(`Un mot par ligne, ou séparés par des virgules. Il en faut au moins ${st.wordsMin} ; 24 lettres au plus par mot.`, `One word per line, or separated by commas. At least ${st.wordsMin} are needed; 24 letters at most each.`)}</p>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={10} aria-label={t('Liste de mots', 'List of words')} spellCheck={false} />
      <p className={short ? 'words-count short' : 'words-count'} role="status">
        {short ? t(`${list.length} mots : il en manque ${st.wordsMin - list.length}.`, `${list.length} words: ${st.wordsMin - list.length} more needed.`) : t(`${list.length} mot${list.length > 1 ? 's' : ''}`, `${list.length} word${list.length === 1 ? '' : 's'}`)}
      </p>
      <div className="row-actions">
        <button className="btn primary" disabled={short || list.length === 0} onClick={() => save(list)}>{t('Jouer avec ces mots', 'Play with these words')}</button>
        {st.words > 0 && <button className="btn quiet" onClick={() => save([])}>{t('Revenir aux mots du jeu', 'Back to the game’s words')}</button>}
        <button className="btn quiet" onClick={close}>{t('Annuler', 'Cancel')}</button>
      </div>
    </Dialog>
  );
}
