import type { CSSProperties } from 'react';
import { partName, type Slot } from './avatar';
import type { T } from './i18n';

// Ce que le magasin vend (internal/server/shop.go tire chaque jour ce qui est en vente) :
// des pièces d'avatar, et des effets qui animent le pseudo partout où il s'affiche.
export interface ShopItem {
  id: string;
  price: number;
}

const FX: Record<string, [fr: string, en: string]> = {
  vague: ['Vague', 'Wave'],
  rebond: ['Rebond', 'Bounce'],
  tangage: ['Tangage', 'Rocking'],
  neon: ['Néon', 'Neon'],
  arcenciel: ['Arc-en-ciel', 'Rainbow'],
  or: ['Or', 'Gold'],
};

export const fxName = (fx: string, t: T) => (FX[fx] ? t(FX[fx][0], FX[fx][1]) : fx);

// Un article : ce que c'est, et son nom.
export function describe(id: string, t: T) {
  const [kind, what] = id.split(':');
  if (kind === 'fx') return { fx: what, kind: t('Effet de pseudo', 'Name effect'), name: fxName(what, t) };
  return { slot: kind as Slot, part: what, kind: t('Pièce d’avatar', 'Avatar part'), name: partName(kind as Slot, what, t) };
}

// Un pseudo, avec l'effet que son joueur a choisi. La vague anime chaque lettre : il faut
// donc les séparer ; le lecteur d'écran lit le nom entier.
export function Name({ name, fx }: { name: string; fx?: string }) {
  if (!fx || !FX[fx]) return <>{name}</>;
  if (fx !== 'vague') return <span className={`fx fx-${fx}`}>{name}</span>;
  return (
    <span className="fx fx-vague" aria-label={name}>
      {[...name].map((c, i) => <span key={i} aria-hidden="true" style={{ '--i': i } as CSSProperties}>{c}</span>)}
    </span>
  );
}
