import type { T } from './i18n';

// Un objectif, tel que le serveur le compte (internal/server/objectives.go) : où en est le
// joueur, et la pièce d'avatar qu'il débloque. Les textes sont ici.
export interface Objective {
  id: string;
  have: number;
  goal: number;
  done: boolean;
  slot: 'color' | 'body' | 'eyes' | 'mouth' | 'beard' | 'glasses' | 'hat';
  item: string;
}

export interface Streak {
  days: number;
  best: number;
  today: boolean;
}

const TEXT: Record<string, [frTitle: string, enTitle: string, frHow: string, enHow: string]> = {
  premiere: ['Première partie', 'First game', 'Jouez une partie jusqu’au bout', 'Play one game to the end'],
  victoire: ['Première victoire', 'First win', 'Gagnez une partie', 'Win a game'],
  equipage: ['Un équipier', 'A crewmate', 'Ayez un ami sur la plateforme', 'Have one friend on the platform'],
  habitue: ['Habitué', 'Regular', 'Jouez 5 parties', 'Play 5 games'],
  assidu: ['Trois jours de suite', 'Three days in a row', 'Jouez trois jours de suite', 'Play three days in a row'],
  as: ['Carré d’as', 'Four aces', 'Gagnez 3 parties de Ono', 'Win 3 games of Ono'],
  capitaine: ['Capitaine', 'Captain', 'Gagnez 5 parties', 'Win 5 games'],
  artificier: ['Artificier', 'Fuse master', 'Jouez 5 parties de BoomParty', 'Play 5 games of BoomParty'],
  artiste: ['Artiste', 'Artist', 'Jouez 5 parties de Skribouille', 'Play 5 games of Skribouille'],
  stratege: ['Fin stratège', 'Sharp mind', 'Gagnez 3 parties de Codenoms', 'Win 3 games of Codenoms'],
  tour: ['Tour de la flotte', 'Tour of the fleet', 'Jouez aux six jeux', 'Play all six games'],
  flotte: ['Grande tablée', 'Full table', 'Ayez 5 amis', 'Have 5 friends'],
  semaine: ['Une semaine entière', 'A whole week', 'Jouez sept jours de suite', 'Play seven days in a row'],
  champion: ['Champion', 'Champion', 'Gagnez 10 parties', 'Win 10 games'],
  loup: ['Vieux loup de mer', 'Old sea dog', 'Jouez 25 parties', 'Play 25 games'],
  legende: ['Légende', 'Legend', 'Gagnez 25 parties', 'Win 25 games'],
};

// Les objectifs, rangés par ce qu'ils demandent.
export const GROUPS: { ids: string[]; fr: string; en: string }[] = [
  { ids: ['premiere', 'habitue', 'loup'], fr: 'Parties jouées', en: 'Games played' },
  { ids: ['victoire', 'capitaine', 'champion', 'legende'], fr: 'Victoires', en: 'Wins' },
  { ids: ['as', 'stratege', 'artificier', 'artiste', 'tour'], fr: 'Jeu par jeu', en: 'Game by game' },
  { ids: ['assidu', 'semaine'], fr: 'Jours de suite', en: 'Days in a row' },
  { ids: ['equipage', 'flotte'], fr: 'Amis', en: 'Friends' },
];

export const titleOf = (o: Objective, t: T) => (TEXT[o.id] ? t(TEXT[o.id][0], TEXT[o.id][1]) : o.id);
export const howOf = (o: Objective, t: T) => (TEXT[o.id] ? t(TEXT[o.id][2], TEXT[o.id][3]) : '');

// L'objectif à montrer pour donner envie : le plus avancé de ceux qui restent, le premier
// de la liste à égalité.
export function nextObjective(list: Objective[]) {
  let best: Objective | undefined;
  for (const o of list) {
    if (!o.done && (!best || o.have / o.goal > best.have / best.goal)) best = o;
  }
  return best;
}
