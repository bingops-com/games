// L'interface existe en français et en anglais. Chaque texte est écrit dans les deux
// langues là où il sert : t('Rejoindre', 'Join'). Les messages du serveur, eux, arrivent
// en français ; leur traduction est ici.
export type Lang = 'fr' | 'en';
export type T = (fr: string, en: string) => string;

export const LANG_KEY = 'games.lang';

export function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'fr' || saved === 'en') return saved;
  } catch {
    /* le stockage peut être refusé */
  }
  return navigator.language.toLowerCase().startsWith('fr') ? 'fr' : 'en';
}

const SERVER: Record<string, string> = {
  'Action illisible': 'Unreadable action',
  'Mot de passe incorrect': 'Wrong password',
  "Cette adresse e-mail n'est pas valable": 'This email address is not valid',
  "Il n'y a pas d'adresse à confirmer": 'There is no address to confirm',
  'Cette adresse est déjà utilisée par un autre compte': 'This address is already used by another account',
  'Ce lien ne marche plus : demandez-en un nouveau': 'This link no longer works: ask for a new one',
  "Ce pseudo n'est pas accepté": 'This username is not accepted',
  "Ce joueur n'est pas joignable": 'This player cannot be reached',
  'Motif inconnu': 'Unknown reason',
  "Trop de signalements d'un coup, réessayez plus tard": 'Too many reports at once, try again later',
  "Seul l'hôte règle la partie, entre deux parties": 'Only the host changes the settings, between two games',
  'Réglage illisible': 'Unreadable setting',
  'Réglage inconnu': 'Unknown setting',
  'Ce jeu ne tire pas de mots': 'This game draws no words',
  'Liste de mots illisible': 'Unreadable list of words',
  "Seul l'hôte ouvre ou ferme le salon": 'Only the host opens or closes the room',
  "Seul l'hôte passe la main": 'Only the host hands the room over',
  'Message illisible': 'Unreadable message',
  'Message trop long': 'Message too long',
  "Cet article n'est pas en vente aujourd'hui": 'This item is not on sale today',
  'Vous avez déjà cet article': 'You already have this item',
  'Il vous manque des crédits pour cet article': 'You do not have enough credits for this item',
  "Vous n'avez pas cet effet": 'You do not have this effect',
  "Vous n'êtes pas dans ce salon": 'You are not in this room',
  "On n'invite dans un salon que ses amis": 'You can only invite your friends to a room',
  "Seul l'hôte retire un joueur": 'Only the host removes a player',
  "Ce joueur n'est plus dans le salon": 'This player is no longer in the room',
  "L'hôte vous a retiré de ce salon": 'The host removed you from this room',
  "Cette tenue n'est pas encore débloquée": 'This look is not unlocked yet',
  'Trait illisible': 'Unreadable stroke',
  'Le dessin est plein : effacez pour continuer': 'The drawing is full: clear some of it to go on',
  'Proposition trop longue': 'Guess too long',
  "Ce n'est pas vous qui dessinez": 'You are not the one drawing',
  'Le mot est déjà choisi': 'The word is already chosen',
  'Un seul joueur tourne les pages': 'Only one player turns the pages',
  'Texte trop long': 'Text too long',
  'Action inconnue': 'Unknown action',
  'Après avoir pioché, seule la carte piochée peut être posée': 'After drawing, only the card you drew can be played',
  "Attendez l'indice": 'Wait for the clue',
  "Aucune partie n'est en cours": 'No game is being played',
  'Aucun salon ne porte ce code': 'No room has this code',
  'Aucun joueur ne porte ce pseudo': 'No player has this username',
  'Ce mot est déjà retourné': 'This word is already turned over',
  "Ce n'est pas votre tour": 'It is not your turn',
  "Ce n'est pas vous qui tenez la bombe": 'You are not holding the bomb',
  'Ce pseudo est déjà pris': 'This username is already taken',
  "C'est à l'autre équipe de jouer": "It is the other team's turn",
  "C'est votre propre pseudo": 'That is your own username',
  'Cette carte ne va ni avec la couleur ni avec la figure du dessus': 'This card matches neither the colour nor the figure on top',
  "Cette invitation n'existe plus": 'This invitation no longer exists',
  'Ce salon est complet': 'This room is full',
  'Choisissez une couleur': 'Choose a colour',
  'Connexion requise': 'Sign in first',
  'Direction inconnue': 'Unknown direction',
  'Équipe inconnue': 'Unknown team',
  'Erreur interne': 'Internal error',
  'Invité inconnu': 'Unknown guest',
  'Requête refusée : origine étrangère': 'Request refused: it comes from another site',
  'Il faut dans chaque équipe un joueur qui donne les indices, un seul, et au moins un qui devine': 'Each team needs one player who gives the clues, only one, and at least one who guesses',
  'Il manque des joueurs pour lancer la partie': 'More players are needed to start the game',
  'Il y a trop de joueurs dans ce salon pour ce jeu': 'There are too many players in this room for this game',
  'Jeu inconnu': 'Unknown game',
  'JSON invalide': 'Invalid JSON',
  'La partie est terminée': 'The game is over',
  'La partie est terminée pour vous': 'The game is over for you',
  'Le nombre va de 0 à 9': 'The number goes from 0 to 9',
  'Les équipes ne sont pas encore faites': 'The teams are not made yet',
  "Le tour se passe après l'indice, par ceux qui devinent": 'Only the guessers end the turn, once the clue is given',
  "L'indice est déjà donné": 'The clue is already given',
  "L'indice ne peut pas être un mot de la grille": 'The clue cannot be a word of the grid',
  "L'indice tient en un seul mot": 'The clue must be a single word',
  'Message inconnu': 'Unknown message',
  'Mot de passe : 8 caractères minimum': 'Password: at least 8 characters',
  'Mot trop long': 'Word too long',
  "Personne n'a oublié d'annoncer sa dernière carte": 'Nobody forgot to announce their last card',
  "Piochez d'abord une carte": 'Draw a card first',
  'Pseudo : 3 à 16 caractères (lettres, chiffres, _ et -)': 'Username: 3 to 16 characters (letters, digits, _ and -)',
  'Pseudo ou mot de passe incorrect': 'Wrong username or password',
  'Route inconnue': 'Unknown route',
  "Seul le joueur qui connaît la grille donne l'indice": 'Only the player who knows the grid gives the clue',
  "Seul l'hôte arrête la partie": 'Only the host stops the game',
  "Seul l'hôte lance la partie": 'Only the host starts the game',
  "Seul l'hôte choisit le jeu, entre deux parties": 'Only the host picks the game, between two games',
  "« Ono ! » s'annonce quand il vous reste une carte": '"Ono!" is called when you have one card left',
  'Tous les salons sont pris, réessayez plus tard': 'Every room is taken, try again later',
  "Trop de salons ouverts d'un coup, réessayez dans un instant": 'Too many rooms opened at once, try again in a moment',
  'Trop de tentatives, réessayez plus tard': 'Too many attempts, try again later',
  "Trop d'invitations d'un coup, réessayez dans un instant": 'Too many invitations at once, try again in a moment',
  "Trop d'invitations sans réponse : annulez-en avant d'en envoyer d'autres": 'Too many unanswered invitations: cancel some before sending more',
  'Vous avez déjà pioché': 'You have already drawn',
  "Vous connaissez la grille : c'est à vos coéquipiers de désigner": 'You know the grid: your teammates do the guessing',
  "Vous n'avez pas cette carte": 'You do not have this card',
  'Vous ne jouez pas cette partie': 'You are not playing this game',
  "Vous n'êtes plus dans ce salon": 'You are no longer in this room',
  'Vous regardez cette partie : vous jouerez la suivante': 'You are watching this game: you will play the next one',
};

// Un message du serveur dans la langue du joueur ; le français tel quel si la traduction manque.
export const serverMessage = (msg: string, lang: Lang) => (lang === 'en' ? (SERVER[msg] ?? msg) : msg);
