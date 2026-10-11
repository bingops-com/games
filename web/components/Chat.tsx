'use client';

import { play } from '@/lib/sound';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useApp, useT } from '@/lib/app';
import { Avatar } from '@/lib/avatar';
import type { ChatLine, Member } from '@/lib/table';
import { Ic } from './ui';

const MAX = 200;
// Deux messages du même joueur à moins de cinq minutes d'écart se suivent sous un seul nom.
const GROUP_MS = 5 * 60 * 1000;

interface Group {
  from: string;
  name: string;
  at: number;
  lines: ChatLine[];
}

function grouped(lines: ChatLine[]) {
  const out: Group[] = [];
  for (const l of lines) {
    const last = out.at(-1);
    if (last && last.from === l.from && l.at - last.lines.at(-1)!.at < GROUP_MS) last.lines.push(l);
    else out.push({ from: l.from, name: l.name, at: l.at, lines: [l] });
  }
  return out;
}

// La discussion d'un salon. Elle ne sait rien du salon lui-même : on lui donne les messages
// à montrer, qui est là (pour les avatars), qui l'on est, et de quoi envoyer.
export default function Chat({ lines, members, you, send }: { lines: ChatLine[]; members: Member[]; you: string; send: (text: string) => void }) {
  const { lang } = useApp();
  const t = useT();
  const [text, setText] = useState('');
  const [unseen, setUnseen] = useState(0);
  const log = useRef<HTMLDivElement>(null);
  // Vrai tant que le joueur lit le bas de la discussion : les nouveaux messages l'y gardent.
  const atEnd = useRef(true);
  const last = lines.at(-1);
  const toEnd = () => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
    atEnd.current = true;
    setUnseen(0);
  };
  // Seule la liste défile jusqu'au dernier message : ni la page, ni la bande autour. Si le
  // joueur relit plus haut, on ne le déplace pas : une pastille dit ce qui est arrivé.
  useEffect(() => {
    if (!last) return;
    if (last.from !== you && Date.now() - last.at < 5000) play('msg');
    if (atEnd.current || last.from === you) toEnd();
    else setUnseen((n) => n + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [last?.id]);
  const scrolled = () => {
    const el = log.current;
    if (!el) return;
    atEnd.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
    if (atEnd.current) setUnseen(0);
  };
  const say = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    send(text);
    setText('');
  };
  const hour = new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'fr-FR', { hour: '2-digit', minute: '2-digit' });
  const avatarOf = (id: string) => members.find((m) => m.id === id)?.avatar;
  return (
    <section className="chat" aria-label={t('Discussion du salon', 'Room chat')}>
      <div className="chat-head">
        <h2>{t('Discussion', 'Chat')}</h2>
      </div>
      <div className="chat-log" ref={log} onScroll={scrolled} role="log" aria-live="polite" tabIndex={0} aria-label={t('Messages', 'Messages')}>
        {lines.length === 0 && (
          <p className="chat-empty"><Ic name="talk" />{t('Personne n’a encore rien écrit. Dites bonjour !', 'Nobody has written anything yet. Say hello!')}</p>
        )}
        {grouped(lines).map((g) => {
          const mine = g.from === you;
          return (
            <div key={g.lines[0].id} className={mine ? 'chat-group mine' : 'chat-group'}>
              {!mine && <Avatar code={avatarOf(g.from)} name={g.name} />}
              <p className="chat-who">
                {mine ? <b className="sr">{t('Vous', 'You')}</b> : <b>{g.name}</b>}
                <time dateTime={new Date(g.at).toISOString()}>{hour.format(g.at)}</time>
              </p>
              <ul>
                {g.lines.map((l) => <li key={l.id}>{l.text}</li>)}
              </ul>
            </div>
          );
        })}
      </div>
      {unseen > 0 && (
        <button className="pill chat-new" onClick={toEnd}>
          <Ic name="down" />{t(`${unseen} nouveau${unseen > 1 ? 'x' : ''} message${unseen > 1 ? 's' : ''}`, `${unseen} new message${unseen === 1 ? '' : 's'}`)}
        </button>
      )}
      <form className="chat-form" onSubmit={say}>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={MAX} placeholder={t('Écrire aux autres…', 'Write to the others…')} aria-label={t('Votre message', 'Your message')} autoComplete="off" enterKeyHint="send" />
        {text.length > MAX - 40 && <span className="chat-count" aria-hidden="true">{MAX - text.length}</span>}
        <button className="btn primary icon" disabled={!text.trim()} aria-label={t('Envoyer', 'Send')}><Ic name="send" /></button>
      </form>
    </section>
  );
}
