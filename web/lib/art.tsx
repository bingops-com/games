import { memo, type ReactNode } from 'react';

// Les dessins des scènes, d'une même main : grille de 64, aplats blancs, détails navy, ni
// contour ni dégradé. Ils sont blancs, donc toujours posés sur du bleu. Ce sont des pièces
// de jeu (la bombe de BoomParty, celles de Bombermat) ; pour présenter un jeu, GameCover.
function Drawing({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <svg className={`art ${className}`} viewBox="0 0 64 64" aria-hidden="true">
      {children}
    </svg>
  );
}

// Ono : une main de cartes, celle du dessus marquée d'une rose des vents.
function Terre() {
  return (
    <Drawing>
      <rect className="art-pale" x="20" y="11" width="24" height="36" rx="4.5" transform="rotate(-24 32 62)" />
      <rect className="art-pale" x="20" y="11" width="24" height="36" rx="4.5" transform="rotate(24 32 62)" />
      <rect x="19" y="12" width="26" height="39" rx="5" />
      <path className="art-ink" d="M32 20.5l3.2 7.8 7.8 3.2-7.8 3.2-3.2 7.8-3.2-7.8-7.8-3.2 7.8-3.2z" />
    </Drawing>
  );
}

// Codenoms : la grille de mots, et au milieu le mot interdit.
function Pavillons() {
  const at = [7, 24.5, 42];
  const pale = [1, 3, 5, 6];
  return (
    <Drawing>
      {at.flatMap((y, row) =>
        at.map((x, col) => {
          const i = row * 3 + col;
          const cls = i === 4 ? 'art-ink' : pale.includes(i) ? 'art-pale' : undefined;
          return <rect key={i} className={cls} x={x} y={y} width="15" height="15" rx="3.5" />;
        }),
      )}
      <path className="art-stroke" d="M28.5 28.5l7 7M35.5 28.5l-7 7" />
    </Drawing>
  );
}

// BoomParty : la bombe, sa mèche et l'étincelle.
function Meche() {
  return (
    <Drawing>
      <circle cx="28" cy="39" r="19" />
      <rect x="36.5" y="15.5" width="11" height="9" rx="2.5" transform="rotate(38 42 20)" />
      <path className="art-stroke" d="M45.5 16.5c3-5 7-6 10-3" />
      <path d="M57 6.5l1.3 3.2 3.2 1.3-3.2 1.3L57 15.5l-1.3-3.2-3.2-1.3 3.2-1.3z" />
      <path className="art-line" d="M16.5 36a12 12 0 0 1 7.5-9" />
    </Drawing>
  );
}

// Bombermat : le baril de poudre et sa mèche allumée.
function Poudriere() {
  return (
    <Drawing>
      <path d="M17 22c0-3 3-5 6-5h18c3 0 6 2 6 5 3 9 3 21 0 30 0 3-3 5-6 5H23c-3 0-6-2-6-5-3-9-3-21 0-30z" />
      <path className="art-line" d="M16.5 29h31M16.5 46h31" />
      <path className="art-stroke" d="M32 17c0-5 3-8 8-8" />
      <path d="M45 2.5l1.3 3.2 3.2 1.3-3.2 1.3L45 11.5l-1.3-3.2-3.2-1.3 3.2-1.3z" />
    </Drawing>
  );
}

// Skribouille : le crayon, et le trait qu'il vient de laisser.
function Skrib() {
  return (
    <Drawing>
      <path d="M41.5 8.5l14 14-27 27-17.5 3.5 3.5-17.5z" />
      <path className="art-ink" d="M11 53l1.6-8 6.4 6.4z" />
      <path className="art-line" d="M36.5 13.5l14 14" />
      <path className="art-stroke art-pale" d="M30 57c6-5 9 3 15-1s8-2 11 1" />
    </Drawing>
  );
}

// Gartik Phone : la bulle, et dedans le gribouillis qu'on se passe.
function Gartik() {
  return (
    <Drawing>
      <path d="M12 9h40a7 7 0 0 1 7 7v24a7 7 0 0 1-7 7H33L20 58V47h-8a7 7 0 0 1-7-7V16a7 7 0 0 1 7-7z" />
      <path className="art-line" d="M16 31c4-9 7-9 9 0s5 9 8 0 5-9 8 0 5 6 7 1" />
    </Drawing>
  );
}

export const Art: Record<string, () => ReactNode> = { terre: Terre, pavillons: Pavillons, meche: Meche, poudriere: Poudriere, skrib: Skrib, gartik: Gartik };

// L'illustration d'un jeu : une image cartoon détourée, générée puis préparée par
// art/build.py. Elle présente le jeu partout hors des scènes ; `big` pour une couverture.
export function GameCover({ id, big = false }: { id: string; big?: boolean }) {
  const size = big ? 640 : 192;
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="art" src={`/games/${id}${big ? '' : '-192'}.webp`} alt="" width={size} height={size} decoding="async" />;
}

export function GameArt({ id }: { id: string }) {
  const Draw = Art[id];
  return Draw ? <Draw /> : null;
}

// Décors raster générés, avec les obstacles et accessoires dans un atlas 2 × 2.
// Le centre reste libre : seuls les éléments du moteur occupent les cases jouables.
export type BombermatArena = 'classic' | 'crossroads' | 'bastions' | 'rings';

export const BombermatArenaArt = memo(function BombermatArenaArt({ arena }: { arena: BombermatArena }) {
  return (
    <div className="pd-scenery" aria-hidden="true" data-scenery={arena}>
      <div className="pd-backdrop" style={{ backgroundImage: `url('/games/bombermat/${arena}-background.webp')` }} />
      <i className="pd-scenery-prop pd-prop-a" />
      <i className="pd-scenery-prop pd-prop-b" />
    </div>
  );
});
