// Les pictogrammes de lab.bingo games, tous de la même main : une grille de 24, un trait
// épais aux bouts ronds de la couleur du texte, un aplat pâle (« tint ») pour le volume, et
// un plein (« dot ») pour le détail qui compte.
//
// Leur dessin est celui que tout le monde connaît déjà : un avion en papier envoie, un plus
// crée, une loupe cherche, une flèche entre ou sort. Le thème marin reste aux illustrations
// et au décor ; un pictogramme qu'il faut deviner fait perdre le joueur.
//
// Un pictogramme n'est jamais seul à dire quelque chose : il accompagne un mot, ou son
// bouton porte un aria-label.

const ICONS = {
  // --- La navigation
  // Jouer : deux cartes, celle du dessus marquée d'une étoile.
  home: (
    <>
      <rect className="tint" x="3.5" y="6" width="10" height="14" rx="2.2" transform="rotate(-12 8.5 13)" />
      <rect className="tint" x="10.5" y="4.5" width="10" height="14" rx="2.2" transform="rotate(10 15.5 11.5)" />
      <path className="dot" d="M15.5 8.2l1 2.3 2.3 1-2.3 1-1 2.3-1-2.3-2.3-1 2.3-1z" />
    </>
  ),
  // Amis : deux têtes rondes, comme les avatars.
  friends: (
    <>
      <circle className="tint" cx="8.5" cy="9" r="4" />
      <path className="tint" d="M2 20.5c.3-3.6 3-5.5 6.5-5.5s6.200 1.900 6.500 5.500z" />
      <circle cx="17" cy="9.5" r="3.2" />
      <path d="M17.5 15c2.700.200 4.300 2 4.500 5.500h-3.500" />
    </>
  ),
  // Objectifs, victoires : la coupe.
  cup: (
    <>
      <path className="tint" d="M7 3.5h10V9a5 5 0 0 1-10 0z" />
      <path d="M7 5.5H4V7a3 3 0 0 0 3 3M17 5.500h3V7a3 3 0 0 1-3 3M12 14v3.500M8 20.500h8M9.500 17.500h5" />
    </>
  ),
  // Magasin : un sac, son anse et son étiquette.
  shop: (
    <>
      <path className="tint" d="M5 8.5h14l-1 11.500H6z" />
      <path d="M8.5 8.500V7a3.500 3.500 0 0 1 7 0v1.500" />
      <circle className="dot" cx="12" cy="14" r="1.600" />
    </>
  ),
  // Mon profil : une tête d'avatar, ses yeux et son sourire.
  me: (
    <>
      <path className="tint" d="M12 3.500c5 0 8.500 3.400 8.500 8.300S17 20.500 12 20.500s-8.500-3.800-8.500-8.700S7 3.500 12 3.500z" />
      <circle className="dot" cx="9" cy="10.500" r="1.400" />
      <circle className="dot" cx="15" cy="10.500" r="1.400" />
      <path d="M8.500 14.500q3.500 3 7 0" />
    </>
  ),

  // --- Les salons
  // Partie publique : chercher un salon où jouer.
  search: (
    <>
      <circle className="tint" cx="10.500" cy="10.500" r="6.500" />
      <path d="M15.500 15.500l5 5" />
    </>
  ),
  // Rejoindre : la porte, et la flèche qui y entre.
  enter: (
    <>
      <path className="tint" d="M13 4.500h4.500a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H13z" />
      <path d="M9 8l4 4-4 4M13 12H4" />
    </>
  ),
  // Quitter : la porte, et la flèche qui en sort.
  leave: (
    <>
      <path className="tint" d="M13 4.500h4.500a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H13z" />
      <path d="M10 8l-4 4 4 4M6 12h9" />
    </>
  ),
  // Le lien d'invitation : deux maillons de chaîne.
  link: (
    <>
      <path d="M10.500 13.500a4 4 0 0 0 5.700 0l3-3a4 4 0 0 0-5.700-5.700l-1.200 1.200" />
      <path d="M13.500 10.500a4 4 0 0 0-5.700 0l-3 3a4 4 0 0 0 5.700 5.700l1.200-1.200" />
    </>
  ),
  copy: (
    <>
      <rect className="tint" x="8.500" y="8.500" width="11" height="11" rx="2.500" />
      <path d="M15.500 5.500v-1a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h1" />
    </>
  ),
  // Les règles : le livre et son signet.
  book: (
    <>
      <path className="tint" d="M5 5.500A2.500 2.500 0 0 1 7.500 3H19v15H7.500A2.500 2.500 0 0 0 5 20.500z" />
      <path d="M5 20.500A2.500 2.500 0 0 1 7.500 18H19v3H7.500A2.500 2.500 0 0 1 5 20.500z" />
      <path className="dot" d="M10.500 3h4v6.500l-2-1.500-2 1.500z" />
    </>
  ),
  // Lancer la partie.
  play: <path className="tint" d="M8 5v14l11.500-7z" />,
  // Arrêter la partie.
  stop: (
    <>
      <circle className="tint" cx="12" cy="12" r="9" />
      <rect className="dot" x="8.500" y="8.500" width="7" height="7" rx="1.500" />
    </>
  ),
  // Rejouer : un tour de plus.
  again: <path d="M5 12a7 7 0 1 1 2.300 5.200M4.500 19.500V15H9" />,
  expand: <path d="M4 9.500V4h5.500M20 9.500V4h-5.500M4 14.500V20h5.500M20 14.500V20h-5.500" />,
  shrink: <path d="M9.500 4v5.500H4M14.500 4v5.500H20M9.500 20v-5.500H4M14.500 20v-5.500H20" />,
  // Les réglages : trois curseurs.
  sliders: (
    <>
      <path d="M4.500 7h8M17.500 7h2M4.500 12h2M11.500 12h8M4.500 17h8M17.500 17h2" />
      <circle className="dot" cx="15" cy="7" r="2" />
      <circle className="dot" cx="9" cy="12" r="2" />
      <circle className="dot" cx="15" cy="17" r="2" />
    </>
  ),

  // --- La discussion
  // Envoyer : l'avion en papier.
  send: (
    <>
      <path className="tint" d="M20.500 3.500l-6 17-3.500-7.500-7.500-3.500z" />
      <path d="M20.500 3.500L11 13" />
    </>
  ),
  // Une bulle : la discussion.
  talk: <path className="tint" d="M4 6.500A2.500 2.500 0 0 1 6.500 4h11A2.500 2.500 0 0 1 20 6.500v7a2.500 2.500 0 0 1-2.500 2.500H11l-4.500 4v-4A2.500 2.500 0 0 1 4 13.500z" />,
  // Masquer les messages de quelqu'un : la bulle barrée.
  hush: (
    <>
      <path className="tint" d="M4 6.500A2.500 2.500 0 0 1 6.500 4h11A2.500 2.500 0 0 1 20 6.500v7a2.500 2.500 0 0 1-2.500 2.500H11l-4.500 4v-4A2.500 2.500 0 0 1 4 13.500z" />
      <path d="M3.500 3.500l17 17" />
    </>
  ),
  sound: (
    <>
      <path className="tint" d="M4 9.500h3.500L12 5.500v13l-4.500-4H4z" />
      <path d="M15.500 9a4 4 0 0 1 0 6M18 6.500a7.500 7.500 0 0 1 0 11" />
    </>
  ),
  mute: (
    <>
      <path className="tint" d="M4 9.500h3.500L12 5.500v13l-4.500-4H4z" />
      <path d="M16 9.500l5 5M21 9.500l-5 5" />
    </>
  ),

  // --- Les joueurs
  // L'hôte : la couronne.
  crown: (
    <>
      <path className="tint" d="M4.500 17l-1.500-9 5 4 4-7 4 7 5-4-1.500 9z" />
      <path d="M5 20.500h14" />
    </>
  ),
  // Celui qui regarde.
  eye: (
    <>
      <path className="tint" d="M2.500 12s3.500-6.500 9.500-6.500S21.500 12 21.500 12s-3.500 6.500-9.500 6.500S2.500 12 2.500 12z" />
      <circle className="dot" cx="12" cy="12" r="2.600" />
    </>
  ),
  // Inviter : un joueur, et un plus.
  invite: (
    <>
      <circle className="tint" cx="9" cy="8.500" r="3.800" />
      <path className="tint" d="M2.500 20.500c.400-3.800 2.900-6 6.500-6s6.100 2.200 6.500 6z" />
      <path d="M19 7.500v6M16 10.500h6" />
    </>
  ),
  // Retirer du salon : un joueur, et une croix.
  remove: (
    <>
      <circle className="tint" cx="9" cy="8.500" r="3.800" />
      <path className="tint" d="M2.500 20.500c.400-3.800 2.900-6 6.500-6s6.100 2.200 6.500 6z" />
      <path d="M16.500 8l5 5M21.500 8l-5 5" />
    </>
  ),
  block: (
    <>
      <circle className="tint" cx="12" cy="12" r="9" />
      <path d="M5.700 5.700l12.600 12.600" />
    </>
  ),
  // Signaler : le drapeau.
  flag: (
    <>
      <path className="tint" d="M6 4.500h12l-3 4 3 4H6z" />
      <path d="M6 21V3.500" />
    </>
  ),
  heart: <path className="tint" d="M12 20.500S4 15.500 4 9.500A4.200 4.200 0 0 1 12 7.800a4.200 4.200 0 0 1 8 1.700c0 6-8 11-8 11z" />,

  // --- Le compte
  mail: (
    <>
      <rect className="tint" x="3" y="5.500" width="18" height="13" rx="2.500" />
      <path d="M3.500 7.500l8.500 6 8.500-6" />
    </>
  ),
  key: (
    <>
      <circle className="tint" cx="8" cy="15.500" r="4.500" />
      <path d="M11.200 12.300L20 3.500M16.500 7l2.500 2.500M13.500 10l2 2" />
    </>
  ),
  // Modifier : le crayon.
  pencil: (
    <>
      <path className="tint" d="M4 20l1-4.500L16.500 4a2.100 2.100 0 0 1 3 3L8 18.500z" />
      <path d="M14.500 6l3 3" />
    </>
  ),
  // Remplir une zone du dessin : le pot de peinture.
  bucket: (
    <>
      <path className="tint" d="M4 10l7-7 9 9-7 7a2 2 0 0 1-3 0l-6-6a2 2 0 0 1 0-3z" />
      <path d="M3.5 12h16M8 2l6 6" />
      <path className="dot" d="M20 16s-2 2.4-2 3.5a2 2 0 0 0 4 0C22 18.4 20 16 20 16z" />
    </>
  ),
  // Au hasard : le dé.
  dice: (
    <>
      <rect className="tint" x="3.500" y="3.500" width="17" height="17" rx="4" />
      <circle className="dot" cx="8.500" cy="8.500" r="1.400" />
      <circle className="dot" cx="15.500" cy="8.500" r="1.400" />
      <circle className="dot" cx="12" cy="12" r="1.400" />
      <circle className="dot" cx="8.500" cy="15.500" r="1.400" />
      <circle className="dot" cx="15.500" cy="15.500" r="1.400" />
    </>
  ),
  // La langue : le globe.
  globe: (
    <>
      <circle className="tint" cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c3.300 3 3.300 15 0 18M12 3c-3.300 3-3.300 15 0 18" />
    </>
  ),
  lock: (
    <>
      <rect className="tint" x="5" y="10.500" width="14" height="9.500" rx="2.500" />
      <path d="M8.500 10.500V8a3.500 3.500 0 0 1 7 0v2.500" />
    </>
  ),
  // Un crédit du magasin : une pièce frappée d'une étoile.
  coin: (
    <>
      <circle className="tint" cx="12" cy="12" r="8.500" />
      <path className="dot" d="M12 7.500l1.300 3.200 3.200 1.300-3.200 1.300L12 16.500l-1.300-3.200L7.500 12l3.200-1.300z" />
    </>
  ),
  // Le temps qui passe : le sablier.
  hourglass: (
    <>
      <path className="tint" d="M7.500 3.500h9v3.500l-4.500 5 4.500 5v3.500h-9V17l4.500-5-4.500-5z" />
      <path d="M6 3.500h12M6 20.500h12" />
    </>
  ),

  // --- Les gestes simples
  check: <path d="M5 12.500l4.500 4.500L19 7.500" />,
  close: <path d="M6 6l12 12M18 6L6 18" />,
  plus: <path d="M12 5v14M5 12h14" />,
  minus: <path d="M5 12h14" />,
  dots: (
    <>
      <circle className="dot" cx="5" cy="12" r="2" />
      <circle className="dot" cx="12" cy="12" r="2" />
      <circle className="dot" cx="19" cy="12" r="2" />
    </>
  ),
  up: <path className="tint" d="M12 5.500l7.500 12h-15z" />,
  down: <path className="tint" d="M12 18.500l7.500-12h-15z" />,
  left: <path className="tint" d="M5.500 12l12-7.500v15z" />,
  right: <path className="tint" d="M18.500 12l-12-7.500v15z" />,
  // Des nouveautés plus bas.
  below: <path d="M12 5v14M6 13l6 6 6-6" />,
};

export type IconName = keyof typeof ICONS;
export const ICON_NAMES = Object.keys(ICONS) as IconName[];

export function Ic({ name, className = '' }: { name: IconName; className?: string }) {
  return <svg className={className ? `ic ${className}` : 'ic'} viewBox="0 0 24 24" aria-hidden="true">{ICONS[name]}</svg>;
}
