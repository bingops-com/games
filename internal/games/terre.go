package games

import (
	"encoding/json"
	"math/rand/v2"
	"slices"
	"time"
)

// Ono follows the rules of Uno: get rid of your cards by colour or
// by figure, and say "Ono !" when one card is left.

const (
	terreHand = 7
	terreTurn = 30 * time.Second
	// What forgetting to announce the last card costs.
	terrePenalty = 2
)

var terreColors = []string{"corail", "sable", "algue", "lagon"}

// Card kinds: "0" to "9", "skip", "rev", "+2", and without a colour "wild"
// and "+4".
type terreCard struct {
	ID    int    `json:"id"`
	Color string `json:"c"`
	Kind  string `json:"k"`
}

// terreEvent is the last thing that happened, for the interface to tell.
// T is "play", "draw" (drew a card they may still play), "drawpass" (drew and
// lost the turn), "pass", "timeout", "terre" or "counter".
type terreEvent struct {
	Seat   int        `json:"seat"`
	T      string     `json:"t"`
	Card   *terreCard `json:"card,omitempty"`
	Target int        `json:"target"` // who draws or is skipped, or -1
	N      int        `json:"n"`      // cards drawn by the target
}

type terre struct {
	// turnFor is how long a player has to play.
	turnFor  time.Duration
	last     *terreEvent
	rng      *rand.Rand
	deck     []terreCard
	pile     []terreCard // played cards under the top one
	top      terreCard
	color    string
	hands    [][]terreCard
	out      []bool
	said     []bool
	turn     int
	dir      int
	drawn    int // id of the card just drawn this turn, or -1
	exposed  int // seat holding one card without having said so, or -1
	winner   int
	deadline time.Time
}

func newTerre(players int, rng *rand.Rand, now time.Time) Game {
	return newTerreWith(players, rng, now, Options{})
}

func newTerreWith(players int, rng *rand.Rand, now time.Time, o Options) Game {
	g := &terre{turnFor: o.seconds("turn", terreTurn), rng: rng, hands: make([][]terreCard, players), out: make([]bool, players), said: make([]bool, players), dir: 1, drawn: -1, exposed: -1, winner: -1}
	id := 0
	add := func(color, kind string) {
		g.deck = append(g.deck, terreCard{ID: id, Color: color, Kind: kind})
		id++
	}
	for _, c := range terreColors {
		add(c, "0")
		for _, k := range []string{"1", "2", "3", "4", "5", "6", "7", "8", "9", "skip", "rev", "+2"} {
			add(c, k)
			add(c, k)
		}
	}
	for range 4 {
		add("", "wild")
		add("", "+4")
	}
	rng.Shuffle(len(g.deck), func(i, j int) { g.deck[i], g.deck[j] = g.deck[j], g.deck[i] })
	for seat := range g.hands {
		g.hands[seat] = g.take(terreHand)
	}
	// The game opens on a plain number.
	i := slices.IndexFunc(g.deck, func(c terreCard) bool { return len(c.Kind) == 1 })
	g.top, g.deck = g.deck[i], slices.Delete(g.deck, i, i+1)
	g.color = g.top.Color
	g.turn = rng.IntN(players)
	g.deadline = now.Add(g.turnFor)
	return g
}

// take draws n cards, turning the played cards into a new deck when it runs
// out. It may return fewer when every card is in a hand.
func (g *terre) take(n int) []terreCard {
	var cards []terreCard
	for range n {
		if len(g.deck) == 0 {
			g.deck, g.pile = g.pile, nil
			g.rng.Shuffle(len(g.deck), func(i, j int) { g.deck[i], g.deck[j] = g.deck[j], g.deck[i] })
		}
		if len(g.deck) == 0 {
			break
		}
		cards = append(cards, g.deck[len(g.deck)-1])
		g.deck = g.deck[:len(g.deck)-1]
	}
	return cards
}

func (g *terre) give(seat, n int) {
	g.hands[seat] = append(g.hands[seat], g.take(n)...)
	g.said[seat] = false
	if g.exposed == seat {
		g.exposed = -1
	}
}

func (g *terre) playable(c terreCard) bool {
	return c.Color == "" || c.Color == g.color || c.Kind == g.top.Kind
}

func (g *terre) active() int {
	n := 0
	for _, out := range g.out {
		if !out {
			n++
		}
	}
	return n
}

func (g *terre) next(from int) int {
	for {
		from = (from + g.dir + len(g.hands)) % len(g.hands)
		if !g.out[from] {
			return from
		}
	}
}

// pass hands the turn on, skipping `skip` players on the way.
func (g *terre) pass(skip int, now time.Time) {
	for range skip + 1 {
		g.turn = g.next(g.turn)
	}
	g.drawn = -1
	g.deadline = now.Add(g.turnFor)
}

func (g *terre) Act(seat int, action json.RawMessage, now time.Time) error {
	var a struct {
		T     string `json:"t"`
		ID    int    `json:"id"`
		Color string `json:"color"`
	}
	if err := kind(action, &a); err != nil {
		return err
	}
	if g.winner >= 0 || seat < 0 || g.out[seat] {
		return Error("La partie est terminée pour vous")
	}
	switch a.T {
	case "terre":
		if len(g.hands[seat]) == 1 && !g.said[seat] {
			g.said[seat] = true
			if g.exposed == seat {
				g.exposed = -1
			}
			g.last = &terreEvent{Seat: seat, T: "terre", Target: -1}
			return nil
		}
		return Error("« Ono ! » s'annonce quand il vous reste une carte")
	case "counter":
		if g.exposed < 0 || g.exposed == seat {
			return Error("Personne n'a oublié d'annoncer sa dernière carte")
		}
		g.last = &terreEvent{Seat: seat, T: "counter", Target: g.exposed, N: terrePenalty}
		g.give(g.exposed, terrePenalty)
		return nil
	}
	if g.turn != seat {
		return Error("Ce n'est pas votre tour")
	}
	// Once the next player acts, a forgotten announcement is forgiven.
	if g.exposed != seat {
		g.exposed = -1
	}
	switch a.T {
	case "draw":
		if g.drawn >= 0 {
			return Error("Vous avez déjà pioché")
		}
		cards := g.take(1)
		g.last = &terreEvent{Seat: seat, T: "drawpass", Target: -1}
		if len(cards) == 0 {
			g.pass(0, now)
			return nil
		}
		g.give(seat, 0)
		g.hands[seat] = append(g.hands[seat], cards[0])
		if g.playable(cards[0]) {
			g.drawn = cards[0].ID
			g.last.T = "draw"
		} else {
			g.pass(0, now)
		}
	case "pass":
		if g.drawn < 0 {
			return Error("Piochez d'abord une carte")
		}
		g.last = &terreEvent{Seat: seat, T: "pass", Target: -1}
		g.pass(0, now)
	case "play":
		i := slices.IndexFunc(g.hands[seat], func(c terreCard) bool { return c.ID == a.ID })
		if i < 0 {
			return Error("Vous n'avez pas cette carte")
		}
		c := g.hands[seat][i]
		if g.drawn >= 0 && c.ID != g.drawn {
			return Error("Après avoir pioché, seule la carte piochée peut être posée")
		}
		if !g.playable(c) {
			return Error("Cette carte ne va ni avec la couleur ni avec la figure du dessus")
		}
		if c.Color == "" && !slices.Contains(terreColors, a.Color) {
			return Error("Choisissez une couleur")
		}
		g.hands[seat] = slices.Delete(g.hands[seat], i, i+1)
		g.pile = append(g.pile, g.top)
		g.top, g.color = c, c.Color
		if c.Color == "" {
			g.color = a.Color
		}
		g.last = &terreEvent{Seat: seat, T: "play", Card: &c, Target: -1}
		switch len(g.hands[seat]) {
		case 0:
			g.winner = seat
			return nil
		case 1:
			if !g.said[seat] {
				g.exposed = seat
			}
		}
		skip := 0
		switch c.Kind {
		case "skip":
			skip, g.last.Target = 1, g.next(seat)
		case "rev":
			g.dir = -g.dir
			if g.active() == 2 {
				skip, g.last.Target = 1, g.next(seat)
			}
		case "+2", "+4":
			skip, g.last.Target, g.last.N = 1, g.next(seat), 2
			if c.Kind == "+4" {
				g.last.N = 4
			}
			g.give(g.last.Target, g.last.N)
		}
		g.pass(skip, now)
	default:
		return Error("Action inconnue")
	}
	return nil
}

func (g *terre) Tick(now time.Time) bool {
	if g.winner >= 0 || now.Before(g.deadline) {
		return false
	}
	// Time is up: the player draws if they had not, and the turn moves on.
	g.last = &terreEvent{Seat: g.turn, T: "timeout", Target: -1}
	if g.drawn < 0 {
		g.give(g.turn, 1)
	}
	if g.exposed != g.turn {
		g.exposed = -1
	}
	g.pass(0, now)
	return true
}

func (g *terre) Drop(seat int, now time.Time) {
	if g.winner >= 0 || g.out[seat] {
		return
	}
	g.out[seat] = true
	g.deck = append(g.hands[seat], g.deck...)
	g.hands[seat] = nil
	if g.exposed == seat {
		g.exposed = -1
	}
	if g.active() == 1 {
		g.winner = slices.Index(g.out, false)
		return
	}
	if g.turn == seat {
		g.pass(0, now)
	}
}

type terreView struct {
	Top      terreCard   `json:"top"`
	Color    string      `json:"color"`
	Dir      int         `json:"dir"`
	Turn     int         `json:"turn"`
	Deadline int64       `json:"deadline"`
	Counts   []int       `json:"counts"`
	Out      []bool      `json:"out"`
	Deck     int         `json:"deck"`
	Hand     []terreCard `json:"hand"`
	Playable []int       `json:"playable"`
	Drawn    int         `json:"drawn"`
	Said     bool        `json:"said"`
	Exposed  int         `json:"exposed"`
	Winner   int         `json:"winner"`
	Last     *terreEvent `json:"last"`
	// How long a turn lasts, in milliseconds, to draw the time left.
	TurnMs int64 `json:"turnMs"`
}

func (g *terre) View(seat int, now time.Time) any {
	v := terreView{Top: g.top, Color: g.color, Dir: g.dir, Turn: g.turn, Deadline: ms(g.deadline), Out: g.out,
		Deck: len(g.deck), Hand: []terreCard{}, Playable: []int{}, Drawn: -1, Exposed: g.exposed, Winner: g.winner, Last: g.last, TurnMs: g.turnFor.Milliseconds()}
	for _, h := range g.hands {
		v.Counts = append(v.Counts, len(h))
	}
	if seat < 0 {
		return v
	}
	v.Hand = slices.Clone(g.hands[seat])
	// Sorted for the eye: by colour, then by figure; the cards without a
	// colour last.
	slices.SortStableFunc(v.Hand, func(a, b terreCard) int {
		ca, cb := slices.Index(terreColors, a.Color), slices.Index(terreColors, b.Color)
		if ca < 0 {
			ca = len(terreColors)
		}
		if cb < 0 {
			cb = len(terreColors)
		}
		if ca != cb {
			return ca - cb
		}
		if a.Kind != b.Kind {
			if a.Kind < b.Kind {
				return -1
			}
			return 1
		}
		return a.ID - b.ID
	})
	v.Said = g.said[seat]
	if g.turn == seat && g.winner < 0 {
		v.Drawn = g.drawn
		for _, c := range g.hands[seat] {
			if g.playable(c) && (g.drawn < 0 || c.ID == g.drawn) {
				v.Playable = append(v.Playable, c.ID)
			}
		}
	}
	return v
}

func (g *terre) Winners() (bool, []int) {
	if g.winner < 0 {
		return false, nil
	}
	return true, []int{g.winner}
}
