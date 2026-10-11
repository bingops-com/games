import { useId, type ReactNode } from 'react';
import type { T } from './i18n';
import type { Objective } from './objectives';

// L'avatar d'un joueur : sept pièces, écrites
// « couleur.corps.yeux.bouche.barbe.lunettes.coiffe ». Le serveur dit lesquelles existent
// et lesquelles se débloquent (internal/server/objectives.go) ; ici, leur nom et leur
// dessin, de la même main cartoon que les illustrations des jeux : contour navy épais,
// aplats, liseré blanc d'autocollant.
export type Slot = 'color' | 'body' | 'eyes' | 'mouth' | 'beard' | 'glasses' | 'hat';
export const SLOTS: Slot[] = ['color', 'body', 'eyes', 'mouth', 'beard', 'glasses', 'hat'];
export type Look = Record<Slot, string>;

interface Part {
  id: string;
  fr: string;
  en: string;
  // Une pièce libre se porte sans rien débloquer.
  free?: boolean;
  // Une pièce du magasin s'achète avec des crédits, les jours où elle est en vente.
  shop?: boolean;
}

export const PARTS: Record<Slot, Part[]> = {
  color: [
    { id: 'corail', fr: 'Corail', en: 'Coral', free: true },
    { id: 'sable', fr: 'Sable', en: 'Sand', free: true },
    { id: 'algue', fr: 'Algue', en: 'Seaweed', free: true },
    { id: 'lagon', fr: 'Lagon', en: 'Lagoon', free: true },
    { id: 'menthe', fr: 'Menthe', en: 'Mint', free: true },
    { id: 'lilas', fr: 'Lilas', en: 'Lilac', free: true },
    { id: 'rose', fr: 'Rose', en: 'Pink', free: true },
    { id: 'blanc', fr: 'Blanc', en: 'White', free: true },
    { id: 'arcenciel', fr: 'Arc-en-ciel', en: 'Rainbow' },
    { id: 'or', fr: 'Or', en: 'Gold' },
    { id: 'nuit', fr: 'Nuit étoilée', en: 'Starry night' },
    { id: 'lave', fr: 'Lave', en: 'Lava', shop: true },
  ],
  body: [
    { id: 'mariniere', fr: 'Marinière', en: 'Striped jersey', free: true },
    { id: 'pull', fr: 'Pull de pont', en: 'Deck jumper', free: true },
    { id: 'cire', fr: 'Ciré jaune', en: 'Yellow oilskin', free: true },
    { id: 'veste', fr: 'Veste de capitaine', en: 'Captain’s jacket' },
    { id: 'royal', fr: 'Cape royale', en: 'Royal cape' },
  ],
  eyes: [
    { id: 'rond', fr: 'Yeux ronds', en: 'Round eyes', free: true },
    { id: 'content', fr: 'Yeux rieurs', en: 'Laughing eyes', free: true },
    { id: 'malin', fr: 'Regard malin', en: 'Sly look', free: true },
    { id: 'surpris', fr: 'Yeux surpris', en: 'Surprised eyes', free: true },
    { id: 'etoiles', fr: 'Des étoiles dans les yeux', en: 'Starry eyes' },
  ],
  mouth: [
    { id: 'sourire', fr: 'Sourire', en: 'Smile', free: true },
    { id: 'dents', fr: 'Toutes ses dents', en: 'Toothy grin', free: true },
    { id: 'langue', fr: 'Langue tirée', en: 'Tongue out', free: true },
    { id: 'o', fr: 'Bouche bée', en: 'Open mouth', free: true },
  ],
  beard: [
    { id: 'aucune', fr: 'Sans barbe', en: 'No beard', free: true },
    { id: 'moustache', fr: 'Moustache', en: 'Moustache', free: true },
    { id: 'barbiche', fr: 'Barbiche', en: 'Goatee', free: true },
    { id: 'barbe', fr: 'Grande barbe', en: 'Full beard' },
  ],
  glasses: [
    { id: 'aucune', fr: 'Sans lunettes', en: 'No glasses', free: true },
    { id: 'rondes', fr: 'Lunettes rondes', en: 'Round glasses', free: true },
    { id: 'carrees', fr: 'Lunettes carrées', en: 'Square glasses', free: true },
    { id: 'cacheoeil', fr: 'Cache-œil', en: 'Eye patch' },
    { id: 'soleil', fr: 'Lunettes de soleil', en: 'Sunglasses' },
    { id: 'monocle', fr: 'Monocle', en: 'Monocle' },
    { id: 'coeurs', fr: 'Lunettes cœurs', en: 'Heart glasses', shop: true },
  ],
  hat: [
    { id: 'aucun', fr: 'Tête nue', en: 'No hat', free: true },
    { id: 'bonnet', fr: 'Bonnet de mousse', en: 'Deckhand beanie', free: true },
    { id: 'bandana', fr: 'Bandana', en: 'Bandana', free: true },
    { id: 'perroquet', fr: 'Perroquet', en: 'Parrot' },
    { id: 'tricorne', fr: 'Tricorne', en: 'Tricorn' },
    { id: 'capitaine', fr: 'Casquette de capitaine', en: 'Captain’s cap' },
    { id: 'meche', fr: 'Mèche allumée', en: 'Lit fuse' },
    { id: 'crayon', fr: 'Crayon sur l’oreille', en: 'Pencil behind the ear' },
    { id: 'couronne', fr: 'Couronne', en: 'Crown' },
    { id: 'hautdeforme', fr: 'Haut-de-forme', en: 'Top hat', shop: true },
  ],
};

export const slotName = (slot: Slot, t: T) =>
  ({ color: t('Couleur', 'Colour'), body: t('Corps', 'Body'), eyes: t('Yeux', 'Eyes'), mouth: t('Bouche', 'Mouth'), beard: t('Barbe', 'Beard'), glasses: t('Lunettes', 'Glasses'), hat: t('Coiffe', 'Hat') })[slot];
export const partName = (slot: Slot, id: string, t: T) => {
  const p = PARTS[slot].find((x) => x.id === id);
  return p ? t(p.fr, p.en) : id;
};

export function parse(code: string | undefined | null): Look | null {
  const ids = (code ?? '').split('.');
  if (ids.length !== SLOTS.length) return null;
  const look = {} as Look;
  for (let i = 0; i < SLOTS.length; i++) {
    if (!PARTS[SLOTS[i]].some((p) => p.id === ids[i])) return null;
    look[SLOTS[i]] = ids[i];
  }
  return look;
}

export const encode = (look: Look) => SLOTS.map((s) => look[s]).join('.');

const free = (slot: Slot) => PARTS[slot].filter((p) => p.free);

// Un avatar au hasard parmi les pièces libres : celui d'un invité qui arrive.
export function randomLook(): Look {
  const look = {} as Look;
  for (const slot of SLOTS) {
    const list = free(slot);
    look[slot] = list[crypto.getRandomValues(new Uint32Array(1))[0] % list.length].id;
  }
  return look;
}

// Un joueur qui n'a rien choisi garde toujours la même tête : elle vient de son nom.
function fromName(name: string): Look {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 16777619) >>> 0;
  const look = {} as Look;
  SLOTS.forEach((slot, i) => {
    const list = free(slot);
    look[slot] = list[(h >>> (i * 4)) % list.length].id;
  });
  return look;
}

// Une pièce que seul le magasin donne.
export const fromShop = (slot: Slot, id: string) => !!PARTS[slot].find((p) => p.id === id)?.shop;

// L'objectif qui garde encore une pièce sous clé, s'il y en a un.
export function lockOf(slot: Slot, id: string, objectives: Objective[]) {
  if (PARTS[slot].find((p) => p.id === id)?.free) return undefined;
  const o = objectives.find((x) => x.slot === slot && x.item === id);
  return o && !o.done ? o : undefined;
}

// Retire d'un avatar ce que le joueur ne peut pas (ou plus) porter.
export function wearable(look: Look, objectives: Objective[], items: string[] = []): Look {
  const out = { ...look };
  for (const slot of SLOTS) {
    const part = PARTS[slot].find((p) => p.id === look[slot]);
    const reached = objectives.some((o) => o.slot === slot && o.item === look[slot] && o.done) || items.includes(`${slot}:${look[slot]}`);
    if (!part?.free && !reached) out[slot] = free(slot)[0].id;
  }
  return out;
}

const INK = '#0b2a94';
const CORAIL = '#ff6b5e';
const SABLE = '#ffcf3f';
const MENTHE = '#8af2bf';
const LAGON = '#35c3e6';
const NUIT = '#27348b';
const line = { fill: 'none', stroke: INK, strokeWidth: 3.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;
const edge = { stroke: INK, strokeWidth: 3.5, strokeLinejoin: 'round' } as const;

const SKIN: Record<string, string> = {
  corail: CORAIL,
  sable: SABLE,
  algue: '#3fcf8e',
  lagon: LAGON,
  menthe: MENTHE,
  lilas: '#b9a4f5',
  rose: '#ff9ec7',
  blanc: '#ffffff',
  or: '#ffc21a',
  nuit: NUIT,
  lave: '#ff5a36',
};

const HEAD = 'M50 26c20 0 34 13 34 32 0 18-14 31-34 31S16 76 16 58c0-19 14-32 34-32z';
// Le buste, sous la tête : les épaules et le haut du corps.
const TORSO = 'M14 124c0-24 14-40 36-40s36 16 36 40z';
const star = (cx: number, cy: number, r: number) => {
  let d = '';
  for (let i = 0; i < 10; i++) {
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const k = i % 2 ? r * 0.45 : r;
    d += `${i ? 'L' : 'M'}${(cx + k * Math.cos(a)).toFixed(1)} ${(cy + k * Math.sin(a)).toFixed(1)}`;
  }
  return `${d}z`;
};

// Les corps : ce que le joueur porte. `clip` découpe un motif à la forme du buste.
const BODY: Record<string, (clip: string) => ReactNode> = {
  mariniere: (clip) => (
    <>
      <path d={TORSO} fill="#fff" {...edge} />
      <path clipPath={clip} d="M10 98h80M10 107h80M10 116h80" fill="none" stroke={INK} strokeWidth="4.5" />
      <path d={TORSO} fill="none" {...edge} />
    </>
  ),
  pull: () => (
    <>
      <path d={TORSO} fill={MENTHE} {...edge} />
      <path {...line} strokeWidth="3" d="M38 90q12 9 24 0" />
    </>
  ),
  cire: () => (
    <>
      <path d={TORSO} fill={SABLE} {...edge} />
      <path {...line} strokeWidth="3" d="M50 92v32" />
      <circle cx="56" cy="102" r="2.6" fill={INK} />
      <circle cx="56" cy="114" r="2.6" fill={INK} />
      <path d="M34 88q16 12 32 0l5 6q-21 14-42 0z" fill={SABLE} {...edge} strokeWidth="3" />
    </>
  ),
  veste: () => (
    <>
      <path d={TORSO} fill={NUIT} {...edge} />
      <path d="M39 87l11 19 11-19q-11 6-22 0z" fill="#fff" {...edge} strokeWidth="3" />
      <circle cx="44" cy="112" r="2.8" fill={SABLE} stroke={INK} strokeWidth="1.5" />
      <circle cx="56" cy="112" r="2.8" fill={SABLE} stroke={INK} strokeWidth="1.5" />
      <path d="M16 104q4-10 12-13l3 7q-8 2-11 9zM84 104q-4-10-12-13l-3 7q8 2 11 9z" fill={SABLE} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
    </>
  ),
  royal: () => (
    <>
      <path d={TORSO} fill={CORAIL} {...edge} />
      <path d="M24 92q26-12 52 0l4 12q-30-10-60 0z" fill="#fff" {...edge} strokeWidth="3" />
      <circle cx="33" cy="96" r="1.8" fill={INK} />
      <circle cx="44" cy="93" r="1.8" fill={INK} />
      <circle cx="56" cy="93" r="1.8" fill={INK} />
      <circle cx="67" cy="96" r="1.8" fill={INK} />
      <path d={star(50, 113, 6)} fill={SABLE} stroke={INK} strokeWidth="2" strokeLinejoin="round" />
    </>
  ),
};

function round(cx: number, r = 9.5, pupil = 4.5) {
  return (
    <>
      <circle cx={cx} cy="56" r={r} fill="#fff" stroke={INK} strokeWidth="3" />
      <circle cx={cx + 2} cy="57" r={pupil} fill={INK} />
      <circle cx={cx + 3.5} cy="55" r={pupil / 3} fill="#fff" />
    </>
  );
}

const EYES: Record<string, ReactNode> = {
  rond: <>{round(37)}{round(63)}</>,
  content: <path {...line} strokeWidth="4" d="M29 59q8-11 16 0M55 59q8-11 16 0" />,
  malin: (
    <>
      {[37, 63].map((cx) => (
        <g key={cx}>
          <circle cx={cx} cy="56" r="9.5" fill="#fff" stroke={INK} strokeWidth="3" />
          <circle cx={cx + 3} cy="59" r="4" fill={INK} />
          <path d={`M${cx - 9.5} 56a9.5 9.5 0 0 1 19 0z`} fill={INK} />
        </g>
      ))}
    </>
  ),
  surpris: <>{round(36, 11, 3.2)}{round(64, 11, 3.2)}</>,
  etoiles: (
    <>
      <path d={star(37, 56, 11)} fill={SABLE} {...edge} strokeWidth="2.5" />
      <path d={star(63, 56, 11)} fill={SABLE} {...edge} strokeWidth="2.5" />
    </>
  ),
};

// Les lunettes se posent sur les yeux, quels qu'ils soient.
const GLASSES: Record<string, ReactNode> = {
  aucune: null,
  rondes: (
    <>
      <path {...line} strokeWidth="3" d="M24 54l-7-3M76 54l7-3M47.5 55h5" />
      <circle cx="36.5" cy="56" r="12" fill="#fff" fillOpacity="0.28" stroke={INK} strokeWidth="3.5" />
      <circle cx="63.5" cy="56" r="12" fill="#fff" fillOpacity="0.28" stroke={INK} strokeWidth="3.5" />
    </>
  ),
  carrees: (
    <>
      <path {...line} strokeWidth="3" d="M24 53l-7-3M76 53l7-3M47 54h6" />
      <rect x="24" y="45" width="23" height="21" rx="5" fill="#fff" fillOpacity="0.28" stroke={INK} strokeWidth="3.5" />
      <rect x="53" y="45" width="23" height="21" rx="5" fill="#fff" fillOpacity="0.28" stroke={INK} strokeWidth="3.5" />
    </>
  ),
  cacheoeil: (
    <>
      <path {...line} strokeWidth="3" d="M19 45 82 53" />
      <path d="M52 47h22v9a11 11 0 0 1-22 0z" fill={INK} />
    </>
  ),
  soleil: (
    <>
      <path {...line} d="M26 53l-8-4M74 53l8-4M47 54h6" />
      <rect x="24" y="46" width="24" height="18" rx="8" fill={INK} />
      <rect x="52" y="46" width="24" height="18" rx="8" fill={INK} />
      <path d="M30 52h7M58 52h7" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" opacity="0.8" />
    </>
  ),
  coeurs: (
    <>
      <path {...line} strokeWidth="3" d="M24 53l-7-3M76 53l7-3M47 55h6" />
      {[36, 64].map((cx) => (
        <path key={cx} d={`M${cx} 67c-9-6-13-11-13-16a6.5 6.5 0 0 1 13-2.5 6.5 6.5 0 0 1 13 2.500c0 5-4 10-13 16z`} fill={CORAIL} stroke={INK} strokeWidth="3" strokeLinejoin="round" />
      ))}
      <path d="M29 50q2-4 5-3M57 50q2-4 5-3" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" opacity="0.8" />
    </>
  ),
  monocle: (
    <>
      <circle cx="63" cy="56" r="13" fill="#fff" fillOpacity="0.2" stroke={INK} strokeWidth="6" />
      <circle cx="63" cy="56" r="13" fill="none" stroke={SABLE} strokeWidth="2.5" />
      <path d="M72 66q7 8 4 19" fill="none" stroke={INK} strokeWidth="2" strokeLinecap="round" strokeDasharray="1 4" />
    </>
  ),
};

const MOUTH: Record<string, ReactNode> = {
  sourire: <path {...line} d="M40 74q10 9 20 0" />,
  dents: (
    <>
      <path d="M38 72h24c0 9-5 13-12 13s-12-4-12-13z" fill="#fff" {...edge} strokeWidth="3" />
      <path d="M44 73v6M50 73v7M56 73v6" fill="none" stroke={INK} strokeWidth="2" />
    </>
  ),
  langue: (
    <>
      <path d="M39 72h22c0 9-5 13-11 13s-11-4-11-13z" fill={INK} {...edge} strokeWidth="3" />
      <path d="M44 81q6-5 12 0-1 6-6 6t-6-6z" fill={CORAIL} stroke={INK} strokeWidth="2" />
    </>
  ),
  o: <ellipse cx="50" cy="78" rx="5.5" ry="6.5" fill={INK} />,
};

// Les barbes. La grande laisse une ouverture à la couleur du visage, pour la bouche.
const BEARD: Record<string, (skin: string) => ReactNode> = {
  aucune: () => null,
  moustache: () => <path d="M50 69c-4-6-13-5-17 2 6 3 13 3 17-1 4 4 11 4 17 1-4-7-13-8-17-2z" fill={NUIT} {...edge} strokeWidth="2.5" />,
  barbiche: () => <path d="M42 86q8 4 16 0-1 12-8 15-7-3-8-15z" fill={NUIT} {...edge} strokeWidth="3" />,
  barbe: (skin) => (
    <>
      <path d="M16 60c0 26 13 40 34 40s34-14 34-40c-5 8-11 9-17 6-5-3-12-3-17 1-5-4-12-4-17-1-6 3-12 2-17-6z" fill={NUIT} {...edge} />
      <ellipse cx="50" cy="78" rx="14" ry="9.5" fill={skin} stroke={INK} strokeWidth="2.5" />
    </>
  ),
};

const HAT: Record<string, ReactNode> = {
  aucun: null,
  bonnet: (
    <>
      <circle cx="50" cy="11" r="7" fill="#fff" {...edge} />
      <path d="M19 42c1-19 14-30 31-30s30 11 31 30z" fill={MENTHE} {...edge} />
      <rect x="14" y="36" width="72" height="11" rx="5.5" fill="#fff" {...edge} />
    </>
  ),
  bandana: (
    <>
      <path d="M80 37l14-5-3 10 7 8-15-3z" fill={CORAIL} {...edge} />
      <path d="M17 45c1-18 14-29 33-29s32 11 33 29c-21-7-45-7-66 0z" fill={CORAIL} {...edge} />
      <circle cx="36" cy="29" r="2.6" fill="#fff" />
      <circle cx="53" cy="25" r="2.6" fill="#fff" />
      <circle cx="68" cy="31" r="2.6" fill="#fff" />
    </>
  ),
  perroquet: (
    <>
      <path d="M70 37c-3-15 5-26 16-24 9 2 11 13 7 24-3 8-19 9-23 0z" fill={CORAIL} {...edge} />
      <path d="M80 31q8-7 12 3-6 7-12-3z" fill={LAGON} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M72 21l-9 3 9 5z" fill={SABLE} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
      <circle cx="79" cy="21" r="3.6" fill="#fff" stroke={INK} strokeWidth="2" />
      <circle cx="78.5" cy="21" r="1.5" fill={INK} />
    </>
  ),
  tricorne: (
    <>
      <path d="M27 30q23-26 46 0z" fill={NUIT} {...edge} />
      <path d="M5 42q12-19 45-19t45 19q-10 7-21 0-24 8-48 0-11 7-21 0z" fill={NUIT} {...edge} />
      <path d="M14 41q7 3 13-1 23 7 46 0 6 4 13 1" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
      <circle cx="50" cy="31" r="4.5" fill={SABLE} stroke={INK} strokeWidth="2.5" />
    </>
  ),
  capitaine: (
    <>
      <path d="M22 36c-5-15 8-25 28-25s33 10 28 25z" fill="#fff" {...edge} />
      <path d="M21 33h58v8H21z" fill={NUIT} {...edge} />
      <path d="M23 41q27-9 54 0-4 9-27 9t-27-9z" fill={INK} {...edge} />
      <circle cx="50" cy="24" r="6.5" fill={SABLE} stroke={INK} strokeWidth="2.5" />
    </>
  ),
  meche: (
    <>
      <path d="M50 22c0-12 11-15 16-8" fill="none" stroke={INK} strokeWidth="9" strokeLinecap="round" />
      <path d="M50 22c0-12 11-15 16-8" fill="none" stroke="#b9c9f7" strokeWidth="4" strokeLinecap="round" />
      <rect x="40" y="19" width="20" height="10" rx="3" fill={NUIT} {...edge} />
      <path d={star(69, 11, 10)} fill={CORAIL} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
      <path d={star(69, 11, 5)} fill={SABLE} />
    </>
  ),
  crayon: (
    <g transform="rotate(38 76 22)">
      <path d="M70 34l6 11 6-11z" fill="#ffe9b0" {...edge} strokeWidth="3" />
      <path d="M74 41l2 4 2-4z" fill={INK} />
      <rect x="70" y="4" width="12" height="30" fill={SABLE} {...edge} strokeWidth="3" />
      <rect x="70" y="0" width="12" height="8" rx="3" fill={CORAIL} {...edge} strokeWidth="3" />
    </g>
  ),
  hautdeforme: (
    <>
      <path d="M31 36l-3-34h44l-3 34z" fill={NUIT} {...edge} />
      <path d="M30.5 26h39l-.8 9h-37.400z" fill={CORAIL} stroke={INK} strokeWidth="2.5" strokeLinejoin="round" />
      <path d="M14 36q36-9 72 0-2 9-36 9t-36-9z" fill={NUIT} {...edge} />
    </>
  ),
  couronne: (
    <>
      <path d="M24 41l-5-27 17 12 14-19 14 19 17-12-5 27z" fill={SABLE} {...edge} />
      <circle cx="36" cy="33" r="3" fill={CORAIL} stroke={INK} strokeWidth="1.5" />
      <circle cx="50" cy="31" r="3" fill={MENTHE} stroke={INK} strokeWidth="1.5" />
      <circle cx="64" cy="33" r="3" fill={CORAIL} stroke={INK} strokeWidth="1.5" />
    </>
  ),
};

// L'avatar d'un joueur. Sans code valable, la tête que son nom lui donne.
export function Avatar({ code, name = '', className = '' }: { code?: string | null; name?: string; className?: string }) {
  const look = parse(code) ?? fromName(name);
  const id = useId().replace(/[^a-zA-Z0-9]/g, '');
  const rainbow = look.color === 'arcenciel';
  const lava = look.color === 'lave';
  const skin = rainbow ? `url(#r${id})` : lava ? `url(#l${id})` : SKIN[look.color];
  return (
    <svg className={`avatar ${className}`} viewBox="-4 -4 108 128" aria-hidden="true">
      <defs>
        {/* Le liseré blanc de l'autocollant, autour de tout le dessin. */}
        <filter id={`s${id}`} x="-10%" y="-10%" width="120%" height="120%">
          <feMorphology in="SourceAlpha" operator="dilate" radius="2.6" result="grow" />
          <feFlood floodColor="#fff" />
          <feComposite in2="grow" operator="in" result="rim" />
          <feMerge>
            <feMergeNode in="rim" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <clipPath id={`t${id}`}><path d={TORSO} /></clipPath>
        {lava && (
          <linearGradient id={`l${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.1" stopColor={SABLE} />
            <stop offset="0.55" stopColor="#ff8a2a" />
            <stop offset="1" stopColor="#e5302f" />
          </linearGradient>
        )}
        {rainbow && (
          <linearGradient id={`r${id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={CORAIL} />
            <stop offset="0.3" stopColor={SABLE} />
            <stop offset="0.55" stopColor={MENTHE} />
            <stop offset="0.78" stopColor={LAGON} />
            <stop offset="1" stopColor="#b9a4f5" />
          </linearGradient>
        )}
      </defs>
      {/* Le buste est coupé au bas du cadre, comme sur un portrait. */}
      <g filter={`url(#s${id})`}>
        {BODY[look.body](`url(#t${id})`)}
        <path d={HEAD} fill={skin} {...edge} />
        {look.color === 'nuit' && (
          <path d={`${star(27, 70, 4)}${star(74, 73, 3)}${star(50, 38, 3)}${star(76, 44, 2.5)}`} fill={SABLE} />
        )}
        <path d="M26 50q4-12 15-16" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity={look.color === 'blanc' ? 0 : 0.5} />
        {BEARD[look.beard](skin)}
        {EYES[look.eyes]}
        {MOUTH[look.mouth]}
        {GLASSES[look.glasses]}
        {HAT[look.hat]}
      </g>
    </svg>
  );
}

// Une pièce seule, pour l'atelier : on choisit un chapeau en voyant le chapeau, pas l'avatar
// entier. Chaque sorte de pièce est cadrée sur l'endroit du visage où elle se porte.
const FRAME: Record<Slot, string> = {
  color: '10 20 80 75',
  body: '8 78 84 50',
  eyes: '20 40 60 32',
  mouth: '30 62 40 30',
  beard: '10 54 80 52',
  glasses: '12 36 76 40',
  hat: '-2 -6 104 60',
};
// Les pièces posées dans un coin ont leur propre cadre, pour ne pas paraître minuscules.
const TIGHT: Record<string, string> = {
  perroquet: '56 4 46 42',
  meche: '34 -6 50 40',
  crayon: '56 -8 44 54',
  monocle: '42 38 46 52',
  couronne: '12 0 76 48',
  hautdeforme: '8 -4 84 54',
  moustache: '26 58 48 22',
  barbiche: '34 78 32 28',
};
const NONE = new Set(['aucun', 'aucune']);

export function PartIcon({ slot, id }: { slot: Slot; id: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  if (NONE.has(id)) {
    // « Sans » : un rond barré.
    return (
      <svg className="part" viewBox="0 0 40 40" aria-hidden="true">
        <circle cx="20" cy="20" r="11" fill="none" stroke={INK} strokeWidth="3" opacity="0.55" />
        <path d="M12.5 27.500l15-15" stroke={INK} strokeWidth="3" strokeLinecap="round" opacity="0.55" />
      </svg>
    );
  }
  const rainbow = slot === 'color' && id === 'arcenciel';
  const lava = slot === 'color' && id === 'lave';
  return (
    <svg className="part" viewBox={TIGHT[id] ?? FRAME[slot]} aria-hidden="true">
      <defs>
        <clipPath id={`pt${uid}`}><path d={TORSO} /></clipPath>
        {lava && (
          <linearGradient id={`pl${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0.1" stopColor={SABLE} />
            <stop offset="0.55" stopColor="#ff8a2a" />
            <stop offset="1" stopColor="#e5302f" />
          </linearGradient>
        )}
        {rainbow && (
          <linearGradient id={`pr${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={CORAIL} />
            <stop offset="0.3" stopColor={SABLE} />
            <stop offset="0.55" stopColor={MENTHE} />
            <stop offset="0.78" stopColor={LAGON} />
            <stop offset="1" stopColor="#b9a4f5" />
          </linearGradient>
        )}
      </defs>
      {slot === 'color' && (
        <>
          <path d={HEAD} fill={rainbow ? `url(#pr${uid})` : lava ? `url(#pl${uid})` : SKIN[id]} {...edge} />
          {id === 'nuit' && <path d={`${star(27, 70, 4)}${star(74, 73, 3)}${star(50, 38, 3)}${star(76, 44, 2.5)}${star(40, 58, 5)}${star(62, 62, 3.5)}`} fill={SABLE} />}
          {id !== 'blanc' && <path d="M26 50q4-12 15-16" fill="none" stroke="#fff" strokeWidth="4" strokeLinecap="round" opacity="0.5" />}
        </>
      )}
      {slot === 'body' && BODY[id](`url(#pt${uid})`)}
      {slot === 'eyes' && EYES[id]}
      {slot === 'mouth' && MOUTH[id]}
      {slot === 'beard' && BEARD[id]('#e9eefb')}
      {slot === 'glasses' && GLASSES[id]}
      {slot === 'hat' && HAT[id]}
    </svg>
  );
}
