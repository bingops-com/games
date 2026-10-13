package games

import (
	"encoding/json"
	"math/rand/v2"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"golang.org/x/text/unicode/norm"
)

// Codenoms follows the rules of Codenames: two teams, a grid of twenty-five
// words, one player per team who knows which words are theirs and gives a
// one-word clue and a number.

// What a word of the grid is: one team's, the other's, nobody's, or the
// forbidden word that loses the game at once.
const (
	pavNeutral   = 2
	pavForbidden = 3
)

type pavClue struct {
	Team  int    `json:"team"`
	Word  string `json:"word"`
	Count int    `json:"count"`
}

// pavReveal is the last word turned over.
type pavReveal struct {
	Seat int `json:"seat"`
	I    int `json:"i"`
	Kind int `json:"kind"`
}

type pavillons struct {
	last     *pavReveal
	phase    string // "teams", "play", "over"
	team     []int  // 0, 1, or -1 for a player who left
	guide    []bool // gives the clues of their team
	words    []string
	key      []int
	revealed []bool
	turn     int // the team playing
	clue     *pavClue
	left     int // guesses left for this clue
	clues    []pavClue
	winner   int
}

func newPavillons(players int, rng *rand.Rand, now time.Time) Game {
	return newPavillonsWith(players, rng, now, Options{})
}

func newPavillonsWith(players int, rng *rand.Rand, now time.Time, o Options) Game {
	g := &pavillons{phase: "teams", team: make([]int, players), guide: make([]bool, players), revealed: make([]bool, 25), winner: -1}
	for seat := range g.team {
		g.team[seat] = seat % 2
		g.guide[seat] = seat < 2
	}
	pool := o.words(25)
	picks := rng.Perm(len(pool))[:25]
	for _, i := range picks {
		g.words = append(g.words, pool[i])
	}
	g.turn = rng.IntN(2)
	// The team that starts has one more word to find.
	g.key = make([]int, 0, 25)
	for range 9 {
		g.key = append(g.key, g.turn)
	}
	for range 8 {
		g.key = append(g.key, 1-g.turn)
	}
	for range 7 {
		g.key = append(g.key, pavNeutral)
	}
	g.key = append(g.key, pavForbidden)
	rng.Shuffle(25, func(i, j int) { g.key[i], g.key[j] = g.key[j], g.key[i] })
	return g
}

// ready says whether each team has someone to give clues and someone to
// guess.
func (g *pavillons) ready() bool {
	var guides, guessers [2]int
	for seat, t := range g.team {
		if t < 0 {
			continue
		}
		if g.guide[seat] {
			guides[t]++
		} else {
			guessers[t]++
		}
	}
	return guides[0] == 1 && guides[1] == 1 && guessers[0] > 0 && guessers[1] > 0
}

func (g *pavillons) remaining(team int) int {
	n := 0
	for i, k := range g.key {
		if k == team && !g.revealed[i] {
			n++
		}
	}
	return n
}

func (g *pavillons) endTurn() {
	g.turn = 1 - g.turn
	g.clue = nil
	g.left = 0
}

// fold compares words whatever their case and accents.
func fold(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(norm.NFC.String(strings.TrimSpace(s))) {
		switch r {
		case '’':
			r = '\''
		case 'à', 'â', 'ä':
			r = 'a'
		case 'é', 'è', 'ê', 'ë':
			r = 'e'
		case 'î', 'ï':
			r = 'i'
		case 'ô', 'ö':
			r = 'o'
		case 'ù', 'û', 'ü':
			r = 'u'
		case 'ç':
			r = 'c'
		case 'œ':
			b.WriteString("oe")
			continue
		}
		b.WriteRune(r)
	}
	return b.String()
}

func (g *pavillons) Act(seat int, action json.RawMessage, now time.Time) error {
	var a struct {
		T     string `json:"t"`
		Team  int    `json:"team"`
		Guide bool   `json:"guide"`
		Word  string `json:"word"`
		N     int    `json:"n"`
		I     int    `json:"i"`
	}
	if err := kind(action, &a); err != nil {
		return err
	}
	if seat < 0 || g.team[seat] < 0 {
		return Error("Vous ne jouez pas cette partie")
	}
	switch g.phase {
	case "over":
		return Error("La partie est terminée")
	case "teams":
		switch a.T {
		case "team":
			if a.Team != 0 && a.Team != 1 {
				return Error("Équipe inconnue")
			}
			g.team[seat], g.guide[seat] = a.Team, a.Guide
		case "begin":
			if !g.ready() {
				return Error("Il faut dans chaque équipe un joueur qui donne les indices, un seul, et au moins un qui devine")
			}
			g.phase = "play"
		default:
			return Error("Les équipes ne sont pas encore faites")
		}
		return nil
	}
	if g.team[seat] != g.turn {
		return Error("C'est à l'autre équipe de jouer")
	}
	switch a.T {
	case "clue":
		if !g.guide[seat] {
			return Error("Seul le joueur qui connaît la grille donne l'indice")
		}
		if g.clue != nil {
			return Error("L'indice est déjà donné")
		}
		word := norm.NFC.String(strings.TrimSpace(a.Word))
		if n := utf8.RuneCountInString(word); n < 1 || n > 24 {
			return Error("L'indice doit contenir de 1 à 24 caractères")
		}
		if strings.IndexFunc(word, unicode.IsSpace) >= 0 {
			return Error("L'indice tient en un seul mot")
		}
		if !pavClueWord(word) {
			return Error("Utilisez un mot composé de lettres, avec tiret ou apostrophe à l’intérieur")
		}
		if slices.ContainsFunc(g.words, func(w string) bool { return fold(w) == fold(word) }) {
			return Error("L'indice ne peut pas être un mot de la grille")
		}
		if a.N < 0 || a.N > 9 {
			return Error("Le nombre va de 0 à 9")
		}
		g.clue = &pavClue{Team: g.turn, Word: word, Count: a.N}
		g.clues = append(g.clues, *g.clue)
		// One more guess than announced, to catch up on an earlier clue.
		// Zero means "none of ours go with this word": guesses are not counted.
		g.left = a.N + 1
		if a.N == 0 {
			g.left = 25
		}
	case "guess":
		if g.guide[seat] {
			return Error("Vous connaissez la grille : c'est à vos coéquipiers de désigner")
		}
		if g.clue == nil {
			return Error("Attendez l'indice")
		}
		if a.I < 0 || a.I >= 25 || g.revealed[a.I] {
			return Error("Ce mot est déjà retourné")
		}
		g.revealed[a.I] = true
		g.last = &pavReveal{Seat: seat, I: a.I, Kind: g.key[a.I]}
		switch k := g.key[a.I]; {
		case k == pavForbidden:
			g.winner, g.phase = 1-g.turn, "over"
		case g.remaining(0) == 0:
			g.winner, g.phase = 0, "over"
		case g.remaining(1) == 0:
			g.winner, g.phase = 1, "over"
		case k != g.turn:
			g.endTurn()
		default:
			if g.left--; g.left == 0 {
				g.endTurn()
			}
		}
	case "end":
		if g.guide[seat] || g.clue == nil {
			return Error("Le tour se passe après l'indice, par ceux qui devinent")
		}
		g.endTurn()
	default:
		return Error("Action inconnue")
	}
	return nil
}

// A single letter is a valid clue. Separators belong inside a word, and
// combining marks must follow a letter, including on non-French keyboards.
func pavClueWord(word string) bool {
	letter := false
	for _, r := range word {
		switch {
		case unicode.IsLetter(r):
			letter = true
		case unicode.IsMark(r) && letter:
		case (r == '-' || r == '\'' || r == '’') && letter:
			letter = false
		default:
			return false
		}
	}
	return letter
}

func (g *pavillons) Tick(time.Time) bool { return false }

func (g *pavillons) Drop(seat int, now time.Time) {
	g.team[seat], g.guide[seat] = -1, false
}

type pavView struct {
	Phase    string     `json:"phase"`
	Team     []int      `json:"team"`
	Guide    []bool     `json:"guide"`
	Ready    bool       `json:"ready"`
	Words    []string   `json:"words"`
	Key      []int      `json:"key"` // -1 where the viewer may not know
	Revealed []bool     `json:"revealed"`
	Turn     int        `json:"turn"`
	Clue     *pavClue   `json:"clue"`
	Left     int        `json:"left"`
	Clues    []pavClue  `json:"clues"`
	Remain   [2]int     `json:"remain"`
	Winner   int        `json:"winner"`
	Last     *pavReveal `json:"last"`
}

func (g *pavillons) View(seat int, now time.Time) any {
	v := pavView{Phase: g.phase, Team: g.team, Guide: g.guide, Ready: g.ready(), Words: g.words, Key: make([]int, 25), Revealed: g.revealed,
		Turn: g.turn, Clue: g.clue, Left: g.left, Clues: g.clues, Remain: [2]int{g.remaining(0), g.remaining(1)}, Winner: g.winner, Last: g.last}
	if v.Clues == nil {
		v.Clues = []pavClue{}
	}
	knows := g.phase == "over" || (seat >= 0 && g.guide[seat] && g.phase == "play")
	for i, k := range g.key {
		if knows || g.revealed[i] {
			v.Key[i] = k
		} else {
			v.Key[i] = -1
		}
	}
	return v
}

func (g *pavillons) Winners() (bool, []int) {
	if g.phase != "over" {
		return false, nil
	}
	var seats []int
	for seat, t := range g.team {
		if t == g.winner {
			seats = append(seats, seat)
		}
	}
	return true, seats
}

// Common, concrete French nouns with more than one sense where possible: the
// fun of the game is in the double meanings.
var pavWords = strings.Fields(`
ancre voile phare marée vague port quai navire canon trésor carte boussole île plage sable corail requin baleine pieuvre crabe
mouette perroquet capitaine pirate mousse matelot corsaire sabre crochet pavillon coffre perle bouteille tonneau rhum corde nœud mât pont cale
hublot barre gouvernail hamac lanterne longue-vue tempête éclair brume étoile lune soleil vent orage glace neige feu flamme cendre fumée
pierre roche montagne volcan grotte forêt arbre feuille racine fleur rose épine herbe champ jardin rivière lac source puits fontaine
château tour muraille porte clé serrure fenêtre toit cave grenier escalier cuisine table chaise lit miroir horloge cloche bougie lampe
livre page plume encre lettre timbre journal histoire conte légende roi reine prince chevalier dragon fée sorcière géant fantôme vampire
loup renard ours cerf lapin souris chat chien cheval âne vache mouton chèvre cochon poule coq canard cygne aigle corbeau
hibou serpent grenouille tortue papillon abeille fourmi araignée mouche poisson saumon thon sardine huître moule homard crevette méduse dauphin phoque
pain fromage beurre lait œuf miel sucre sel poivre farine gâteau tarte crêpe chocolat café thé vin bière cidre soupe
pomme poire cerise fraise citron orange banane raisin noix amande tomate carotte oignon ail salade champignon riz pâte olive piment
main pied tête œil oreille nez bouche dent langue cœur bras jambe genou doigt ongle cheveu barbe peau os sang
chapeau botte gant manteau robe chemise ceinture bouton poche bague collier couronne masque lunettes montre sac valise parapluie canne éventail
marteau clou scie hache pelle râteau échelle roue moteur hélice aile fusée avion train voiture vélo bateau barque radeau ballon
piano violon guitare tambour flûte trompette harpe chanson danse théâtre scène rideau cirque clown magicien dé pion échec dame
or argent fer cuivre verre bois papier tissu laine soie coton cuir diamant rubis cristal aimant ressort chaîne cadenas filet
école classe tableau craie cahier règle compas gomme crayon pinceau peinture couleur ligne cercle carré point angle nombre zéro million
ville village rue place marché tunnel gare hôtel banque prison hôpital église moulin ferme usine mine camp tente cabane
jour nuit matin soir hiver été printemps automne siècle minute heure calendrier anniversaire fête cadeau surprise secret rêve ombre écho
`)
