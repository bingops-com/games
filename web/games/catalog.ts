import type { Lang, T } from '@/lib/i18n';

// Les jeux de l'étagère. Leurs règles sont jouées par le serveur (internal/games) ; ici,
// ce qu'il faut pour les présenter.
export interface Game {
  id: string;
  name: string;
  players: [min: number, max: number];
  minutes: number;
  pitch: string;
  rules: string[];
  // Le même texte en anglais. Le nom du jeu, lui, ne se traduit pas.
  en: { pitch: string; rules: string[] };
  ready: boolean;
  // Personne ne gagne : on joue pour le résultat.
  noWinner?: boolean;
}

export const GAMES: Game[] = [
  {
    id: 'terre',
    name: 'Ono',
    players: [2, 8],
    minutes: 15,
    pitch: 'Posez vos cartes avant les autres, et annoncez « Ono ! » quand il ne vous en reste qu’une.',
    rules: [
      'Chacun reçoit sept cartes. À votre tour, posez une carte de la même couleur ou du même chiffre que celle du dessus.',
      'Rien à poser : vous piochez.',
      'Certaines cartes font passer un tour, changent le sens du jeu ou font piocher le joueur suivant.',
      'Le premier joueur sans carte gagne la manche.',
    ],
    en: {
      pitch: "Play your cards before the others, and call \"Ono!\" when you have one left.",
      rules: [
        "Everyone gets seven cards. On your turn, play a card of the same colour or the same figure as the one on top.",
        "Nothing to play: you draw.",
        "Some cards skip a turn, reverse the order of play or make the next player draw.",
        "The first player with no cards wins the round.",
      ],
    },
    ready: true,
  },
  {
    id: 'pavillons',
    name: 'Codenoms',
    players: [4, 10],
    minutes: 20,
    pitch: 'Deux équipes, vingt-cinq mots, et un seul indice par tour pour faire deviner les siens.',
    rules: [
      'Deux équipes se partagent une grille de vingt-cinq mots. Dans chacune, un joueur sait quels mots sont les siens.',
      'Il donne un indice d’un seul mot et un nombre ; son équipe désigne les mots qu’elle pense visés.',
      'Un mot de l’autre équipe lui profite. Le mot interdit fait perdre la partie aussitôt.',
      'La première équipe à trouver tous ses mots gagne.',
    ],
    en: {
      pitch: "Two teams, twenty-five words, and a single clue per turn to make yours guess theirs.",
      rules: [
        "Two teams share a grid of twenty-five words. In each team, one player knows which words are theirs.",
        "They give a one-word clue and a number; their team points at the words they think are meant.",
        "A word of the other team counts for them. The forbidden word loses the game at once.",
        "The first team to find all its words wins.",
        "The words of the grid are in French.",
      ],
    },
    ready: true,
  },
  {
    id: 'meche',
    name: 'BoomParty',
    players: [2, 12],
    minutes: 10,
    pitch: 'Une syllabe, une mèche qui brûle : trouvez un mot qui la contient avant que ça saute.',
    rules: [
      'À votre tour, une syllabe s’affiche. Écrivez un mot français qui la contient pour passer la bombe au suivant.',
      'Un mot déjà joué ne compte pas.',
      'La bombe explose à un moment que personne ne connaît : le joueur qui la tient perd une vie.',
      'Le dernier joueur en vie gagne.',
    ],
    en: {
      pitch: "A syllable, a burning fuse: find a word that contains it before it blows.",
      rules: [
        "On your turn, a syllable is shown. Write a French word that contains it to pass the bomb on.",
        "A word already played does not count.",
        "The bomb goes off at a moment nobody knows: the player holding it loses a life.",
        "The last player alive wins.",
      ],
    },
    ready: true,
  },
  {
    id: 'poudriere',
    name: 'Bombermat',
    players: [2, 4],
    minutes: 5,
    pitch: 'Posez vos bombes, faites sauter les caisses et restez le dernier debout.',
    rules: [
      'Déplacez-vous avec les flèches ou ZQSD, posez une bombe avec Espace. Sur un téléphone, les boutons sont sous la grille.',
      'Une bombe explose en croix après deux secondes et demie. Elle détruit les caisses, déclenche les autres bombes et élimine qui s’y trouve, vous compris.',
      'On se déplace librement dans les couloirs : relâchez la touche et le poseur de bombes s’arrête, même entre deux cases.',
      'Les caisses cachent des bonus : une bombe de plus, une explosion plus longue, des patins, le coup de pied qui pousse une bombe, les bombes perçantes, le gilet qui encaisse une explosion, le plein feu. La tête de mort, elle, ralentit.',
      'Après deux minutes, la grille se referme par les bords. Le dernier joueur debout gagne.',
    ],
    en: {
      pitch: "Lay your bombs, blow up the crates and be the last one standing.",
      rules: [
        "Move with the arrow keys or WASD, lay a bomb with Space. On a phone, the buttons are under the grid.",
        "A bomb blows in a cross after two and a half seconds. It destroys crates, sets off other bombs and takes out anyone in it, you included.",
        "You move freely along the corridors: release the key and your bomber stops, even between two cells.",
        "Crates hide bonuses: one more bomb, a longer blast, skates, the kick that pushes a bomb, piercing bombs, the vest that takes one blast, full fire. The skull slows you down.",
        "After two minutes, the grid closes in from its edges. The last player standing wins.",
      ],
    },
    ready: true,
  },
  {
    id: 'skrib',
    name: 'Skribouille',
    players: [2, 12],
    minutes: 10,
    pitch: 'Un joueur dessine un mot, les autres devinent : plus vite on trouve, plus on marque.',
    rules: [
      'Chacun dessine à son tour. Le dessinateur choisit un mot parmi trois, puis a 75 secondes pour le dessiner, sans lettres ni chiffres.',
      'Les autres écrivent ce qu’ils pensent voir. Accents et majuscules ne comptent pas ; à une lettre près, le jeu vous dit que vous y êtes presque.',
      'Trouver vite rapporte jusqu’à 100 points, trouver tard 40. Le dessinateur gagne 20 points par joueur qui trouve.',
      'Des lettres du mot se dévoilent avec le temps. Le meilleur score gagne.',
    ],
    en: {
      pitch: 'One player draws a word, the others guess: the quicker you find it, the more you score.',
      rules: [
        'Everyone draws in turn. The drawer picks one word out of three, then has 75 seconds to draw it, without letters or digits.',
        'The others write what they think they see. Accents and capitals do not matter; one letter off, the game tells you that you are close.',
        'Finding it quickly earns up to 100 points, late 40. The drawer earns 20 points for each player who finds it.',
        'Letters of the word are given away as time passes. The best score wins.',
        'The words are in French.',
      ],
    },
    ready: true,
  },
  {
    id: 'gartik',
    name: 'Gartik Phone',
    players: [3, 12],
    minutes: 10,
    pitch: 'Le téléphone arabe en dessins : une phrase, un dessin, une phrase… et on lit les albums ensemble.',
    rules: [
      'Tout le monde écrit une phrase en même temps.',
      'Chaque phrase passe à un autre joueur, qui la dessine. Son dessin passe au suivant, qui écrit ce qu’il voit, et ainsi de suite, six manches au plus.',
      'Chaque manche est chronométrée ; « Terminé » la clôt dès que tout le monde a fini.',
      'À la fin, l’hôte tourne les pages de chaque album devant tout le monde. Personne ne gagne.',
    ],
    en: {
      pitch: 'Chinese whispers in drawings: a sentence, a drawing, a sentence… then everyone reads the albums together.',
      rules: [
        'Everyone writes a sentence at the same time.',
        'Each sentence goes to another player, who draws it. The drawing goes to the next, who writes what they see, and so on, six rounds at most.',
        'Each round is timed; "Done" closes it as soon as everybody has finished.',
        'At the end, the host turns the pages of each album in front of everyone. Nobody wins.',
      ],
    },
    ready: true,
    noWinner: true,
  },
];

export const byId = (id: string) => GAMES.find((g) => g.id === id);

export const playersOf = (g: Game, t: T) => t(`${g.players[0]} à ${g.players[1]} joueurs`, `${g.players[0]} to ${g.players[1]} players`);
export const rangeOf = (g: Game, t: T) => t(`${g.players[0]} à ${g.players[1]}`, `${g.players[0]} to ${g.players[1]}`);
export const lengthOf = (g: Game, t: T) => t(`${g.minutes} minutes environ`, `about ${g.minutes} minutes`);
export const pitchOf = (g: Game, lang: Lang) => (lang === 'en' ? g.en.pitch : g.pitch);
export const rulesOf = (g: Game, lang: Lang) => (lang === 'en' ? g.en.rules : g.rules);
