'use client';

import { useState, type ReactNode } from 'react';
import { App, useT } from '@/lib/app';
import { Avatar } from '@/lib/avatar';
import type { ChatLine, Member } from '@/lib/table';
import Chat from './Chat';
import { Bar, Dialog, Field, Ic, ICON_NAMES } from './ui';

// La page du kit : chaque pièce de l'interface, sur le papier et sur la mer, telle que les
// pages l'emploient. Elle sert à choisir une pièce avant d'en écrire une nouvelle, et à
// vérifier d'un coup d'œil les deux thèmes.

const COLORS = ['ground', 'surface', 'tint', 'line', 'field-line', 'ink-soft', 'ink', 'sea', 'sea-deep', 'navy', 'mint', 'danger'];
const ICONS = ICON_NAMES;

const who = (id: string, name: string, extra: Partial<Member> = {}): Member => ({ id, name, account: false, on: true, seat: -1, wins: 0, avatar: '', fx: '', ...extra } as Member);
const CREW = [who('a', 'Mousse-417'), who('b', 'Poulpe-Tenace', { wins: 2 }), who('c', 'Crevette-Sage', { on: false })];

function Piece({ name, use, children }: { name: string; use: string; children: ReactNode }) {
  return (
    <section className="kit-piece">
      <h2>{name}</h2>
      <p className="hint">{use}</p>
      {children}
    </section>
  );
}

export default function UiKit() {
  const t = useT();
  const [dialog, setDialog] = useState(false);
  const [lines, setLines] = useState<ChatLine[]>(() => {
    const at = Date.now() - 4 * 60 * 1000;
    return [
      { id: 1, from: 'b', name: 'Poulpe-Tenace', text: t('Salut ! On joue à quoi ?', 'Hi! What are we playing?'), at },
      { id: 2, from: 'a', name: 'Mousse-417', text: t('Un Ono pour commencer.', 'An Ono to start with.'), at: at + 20000 },
      { id: 3, from: 'b', name: 'Poulpe-Tenace', text: t('Ça marche.', 'Works for me.'), at: at + 40000 },
      { id: 4, from: 'b', name: 'Poulpe-Tenace', text: t('J’invite Crevette, elle arrive dans deux minutes.', 'I am inviting Crevette, she will be here in two minutes.'), at: at + 50000 },
    ];
  });
  const say = (text: string) => setLines((old) => [...old, { id: old.length + 1, from: 'a', name: 'Mousse-417', text: text.trim(), at: Date.now() }]);
  const buttons = (main: string, other: string) => (
    <>
      <div className="row-actions">
        <button className={`btn ${main} big`}>{t('Créer un salon', 'Create a room')}</button>
        <button className={`btn ${main}`}>{t('Rejoindre', 'Join')}</button>
        <button className={`btn ${other}`}>{t('Annuler', 'Cancel')}</button>
        <button className={`btn ${main}`} disabled>{t('Indisponible', 'Unavailable')}</button>
      </div>
      <div className="row-actions">
        <button className={`btn ${main} small`}><Ic name="copy" />{t('Copier', 'Copy')}</button>
        <button className={`btn ${other} small`}>{t('Plus tard', 'Later')}</button>
        <button className={`btn ${other} small icon`} aria-label={t('Fermer', 'Close')}><Ic name="close" /></button>
        <button className="as-link">{t('Un lien dans une phrase', 'A link in a sentence')}</button>
      </div>
    </>
  );
  const fields = (other: string) => (
    <div className="stack kit-form">
      <Field label={t('Pseudo', 'Username')} help={t('3 à 16 caractères. Il est visible de tous.', '3 to 16 characters. Everyone can see it.')}>
        <input placeholder="Mousse-417" autoComplete="off" />
      </Field>
      <div>
        <label htmlFor="kit-code">{t('Rejoindre avec un code', 'Join with a code')}</label>
        <div className="join-row">
          <input id="kit-code" className="code-field" placeholder="ABCD" autoComplete="off" />
          <button className={`btn ${other}`}>{t('Rejoindre', 'Join')}</button>
        </div>
      </div>
      <label className="check"><input type="checkbox" defaultChecked /> {t('Salon public : n’importe qui peut le rejoindre.', 'Public room: anyone can join it.')}</label>
    </div>
  );
  const pills = (
    <div className="row-actions">
      <span className="pill count">3</span>
      <span className="pill count"><Ic name="cup" />2</span>
      <span className="pill"><Ic name="check" />{t('Acheté', 'Bought')}</span>
      <button className="pill ghost">{t('Masquer ses messages', 'Hide their messages')}</button>
    </div>
  );
  return (
    <div className="kit">
      <header>
        <h1>{t('Kit d’interface', 'Interface kit')}</h1>
        <p className="pitch">{t('Les pièces dont toutes les pages sont faites. Leur apparence est dans app/ui.css, leur comportement dans components/ui.tsx.', 'The pieces every page is made of. Their look lives in app/ui.css, their behaviour in components/ui.tsx.')}</p>
      </header>

      <Piece name={t('Couleurs et formes', 'Colours and shapes')} use={t('Les jetons de :root. Une valeur qui manque se dérive avec color-mix et devient un jeton.', 'The :root tokens. A missing value is derived with color-mix and becomes a token.')}>
        <ul className="kit-swatches">
          {COLORS.map((c) => <li key={c}><i style={{ background: `var(--${c})` }} /><code>--{c}</code></li>)}
        </ul>
        <div className="kit-icons">
          {ICONS.map((i) => <span key={i}><Ic name={i} /><code>{i}</code></span>)}
        </div>
      </Piece>

      <Piece name={t('Boutons', 'Buttons')} use={t('.btn avec .primary sur le papier ou .white sur la mer pour l’action principale, .quiet ou .onsea pour les autres ; .small, .big et .icon pour la taille.', '.btn with .primary on paper or .white on the sea for the main action, .quiet or .onsea for the others; .small, .big and .icon for size.')}>
        <div className="kit-pair">
          <div className="panel kit-demo">{buttons('primary', 'quiet')}</div>
          <div className="sea kit-demo">{buttons('white', 'onsea')}</div>
        </div>
      </Piece>

      <Piece name={t('Champs', 'Fields')} use={t('Une étiquette au-dessus du champ, un mot d’aide dessous (<Field>). Sur la mer, un champ reste du papier blanc.', 'A label above the field, a word of help under it (<Field>). On the sea, a field stays white paper.')}>
        <div className="kit-pair">
          <div className="panel kit-demo">{fields('quiet')}</div>
          <div className="sea kit-demo">{fields('onsea')}</div>
        </div>
      </Piece>

      <Piece name={t('Pastilles et jauges', 'Pills and gauges')} use={t('.pill pour un nombre, un état ou une petite action ; <Bar> pour dire où l’on en est.', '.pill for a number, a state or a small action; <Bar> to tell how far along.')}>
        <div className="kit-pair">
          <div className="panel kit-demo">{pills}<Bar value={3} max={5} label={t('Objectif', 'Objective')} /></div>
          <div className="sea kit-demo">{pills}<Bar value={3} max={5} label={t('Objectif', 'Objective')} /></div>
        </div>
      </Piece>

      <Piece name={t('Joueurs', 'Players')} use={t('.member : l’avatar, le nom, un mot dessous, puis une pastille ou les trois points.', '.member: the avatar, the name, a word under it, then a pill or the three dots.')}>
        <div className="sea kit-demo">
          <ul>
            {CREW.map((m, i) => (
              <li key={m.id} className={`member${m.on ? '' : ' off'}${i === 0 ? ' me' : ''}`}>
                <Avatar code={m.avatar} name={m.name} />
                <b>{m.name}</b>
                <small>{i === 0 ? t('vous, hôte', 'you, host') : m.on ? '' : t('déconnecté', 'disconnected')}</small>
                {m.wins > 0 && <span className="pill count"><Ic name="cup" />{m.wins}</span>}
              </li>
            ))}
            <li className="member free"><span className="disc" aria-hidden="true" /><b>{t('Place libre', 'Free seat')}</b></li>
          </ul>
        </div>
      </Piece>

      <Piece name={t('Discussion', 'Chat')} use={t('<Chat> : les messages des autres sur un voile, les vôtres en blanc à droite ; le champ et son bouton ne font qu’un.', '<Chat>: the others’ messages on a veil, yours in white on the right; the field and its button are one.')}>
        <div className="sea kit-demo kit-chat">
          <Chat lines={lines} members={CREW} you="a" send={say} />
        </div>
      </Piece>

      <Piece name={t('Dialogue et messages', 'Dialog and messages')} use={t('<Dialog> : Échap ou un clic à côté le ferme, son premier champ reçoit le curseur. App.toast pour dire qu’une action a réussi.', '<Dialog>: Escape or a click outside closes it, its first field gets the cursor. App.toast to say an action worked.')}>
        <div className="row-actions">
          <button className="btn primary" onClick={() => setDialog(true)}>{t('Ouvrir un dialogue', 'Open a dialog')}</button>
          <button className="btn quiet" onClick={() => App.toast(t('Lien d’invitation copié', 'Invitation link copied'))}>{t('Afficher un message', 'Show a message')}</button>
        </div>
        {dialog && (
          <Dialog title={t('Votre nom d’invité', 'Your guest name')} onClose={() => setDialog(false)} onSubmit={(e) => { e.preventDefault(); setDialog(false); }}>
            <p>{t('C’est le nom que les autres voient autour de la table.', 'This is the name the others see around the table.')}</p>
            <label>{t('Nom', 'Name')}<input defaultValue="Mousse-417" /></label>
            <button className="btn primary">{t('Enregistrer le nom', 'Save name')}</button>
            <button type="button" className="btn quiet" onClick={() => setDialog(false)}>{t('Annuler', 'Cancel')}</button>
          </Dialog>
        )}
      </Piece>
    </div>
  );
}
