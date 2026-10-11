package games

import (
	"encoding/json"
	"math/rand/v2"
	"strings"
	"time"
	"unicode/utf8"
)

// Gartik Phone follows the rules of Gartic Phone: everyone writes a sentence,
// the next player draws it, the next describes the drawing, and so on; at the
// end the albums are read together. Nobody wins.

const (
	gkWrite    = 50 * time.Second
	gkDraw     = 90 * time.Second
	gkDescribe = 50 * time.Second
	gkRounds   = 6
	gkText     = 120
)

type gkItem struct {
	Seat    int      `json:"seat"`
	Text    string   `json:"text"`
	Strokes []stroke `json:"strokes"`
	Draw    bool     `json:"draw"`
}

type gartik struct {
	// How long each kind of round lasts.
	writeFor, drawFor time.Duration
	n                 int
	rounds            int
	round             int
	phase             string // "write", "draw", "describe", "album", "over"
	chains            [][]gkItem
	texts             []string
	sk                []sketch
	done              []bool
	out               []bool
	deadline          time.Time
	// The album being read: which chain, and how far.
	chain, step int
}

func newGartik(players int, rng *rand.Rand, now time.Time) Game {
	return newGartikWith(players, rng, now, Options{})
}

func newGartikWith(players int, rng *rand.Rand, now time.Time, o Options) Game {
	g := &gartik{writeFor: o.seconds("write", gkWrite), drawFor: o.seconds("draw", gkDraw), n: players, rounds: min(players, gkRounds), chains: make([][]gkItem, players), texts: make([]string, players),
		sk: make([]sketch, players), done: make([]bool, players), out: make([]bool, players)}
	g.open(now)
	return g
}

// chainOf is the album a seat works on this round: albums move one seat on
// each round, so nobody sees the same one twice.
func (g *gartik) chainOf(seat int) int { return (seat + g.round) % g.n }

func (g *gartik) open(now time.Time) {
	switch {
	case g.round == 0:
		g.phase, g.deadline = "write", now.Add(g.writeFor)
	case g.round%2 == 1:
		g.phase, g.deadline = "draw", now.Add(g.drawFor)
	default:
		g.phase, g.deadline = "describe", now.Add(g.writeFor)
	}
	for seat := range g.done {
		g.texts[seat], g.sk[seat], g.done[seat] = "", sketch{}, g.out[seat]
	}
}

// close files what everyone made and opens the next round, or the albums.
func (g *gartik) close(now time.Time) {
	for seat := range g.n {
		c := g.chainOf(seat)
		item := gkItem{Seat: seat, Draw: g.phase == "draw", Text: strings.TrimSpace(g.texts[seat]), Strokes: g.sk[seat].view()}
		if !item.Draw {
			item.Strokes = []stroke{}
		}
		g.chains[c] = append(g.chains[c], item)
	}
	if g.round++; g.round < g.rounds {
		g.open(now)
		return
	}
	g.phase, g.chain, g.step = "album", 0, 0
}

func (g *gartik) allDone() bool {
	for _, d := range g.done {
		if !d {
			return false
		}
	}
	return true
}

// reader is the seat that turns the pages: the host, or the next player
// still there.
func (g *gartik) reader() int {
	for seat, out := range g.out {
		if !out {
			return seat
		}
	}
	return -1
}

func (g *gartik) Act(seat int, action json.RawMessage, now time.Time) error {
	var a struct {
		T    string `json:"t"`
		Text string `json:"text"`
		V    bool   `json:"v"`
	}
	if err := kind(action, &a); err != nil {
		return err
	}
	if seat < 0 || g.out[seat] || g.phase == "over" {
		return Error("Vous ne jouez pas cette partie")
	}
	if g.phase == "album" {
		if a.T != "next" || seat != g.reader() {
			return Error("Un seul joueur tourne les pages")
		}
		if g.step++; g.step >= len(g.chains[g.chain]) {
			g.chain, g.step = g.chain+1, 0
		}
		if g.chain >= g.n {
			g.phase = "over"
		}
		return nil
	}
	switch a.T {
	case "done":
		g.done[seat] = a.V
		if g.allDone() {
			g.close(now)
		}
		return nil
	case "text":
		if g.phase == "draw" || g.done[seat] {
			return nil
		}
		if utf8.RuneCountInString(a.Text) > gkText {
			return Error("Texte trop long")
		}
		g.texts[seat] = a.Text
		return nil
	}
	if g.phase != "draw" || g.done[seat] {
		return nil // a stroke that arrives after the bell
	}
	ok, err := g.sk[seat].act(a.T, action)
	if !ok {
		return Error("Action inconnue")
	}
	return err
}

func (g *gartik) Tick(now time.Time) bool {
	if g.phase == "album" || g.phase == "over" || now.Before(g.deadline) {
		return false
	}
	g.close(now)
	return true
}

func (g *gartik) Drop(seat int, now time.Time) {
	if g.phase == "over" || g.out[seat] {
		return
	}
	g.out[seat], g.done[seat] = true, true
	left := 0
	for _, out := range g.out {
		if !out {
			left++
		}
	}
	switch {
	case left < 2:
		g.phase = "over"
	case g.phase != "album" && g.allDone():
		g.close(now)
	}
}

type gkView struct {
	Phase    string `json:"phase"`
	Round    int    `json:"round"`
	Rounds   int    `json:"rounds"`
	Deadline int64  `json:"deadline"`
	Done     []bool `json:"done"`
	Out      []bool `json:"out"`
	// Prompt is what this player received: a sentence to draw, or a drawing
	// to describe.
	Prompt *gkItem `json:"prompt"`
	// What this player has made so far this round.
	Text    string   `json:"text"`
	Strokes []stroke `json:"strokes"`
	// The album being read: its pages turned so far.
	Chain  int      `json:"chain"`
	Chains int      `json:"chains"`
	Pages  []gkItem `json:"pages"`
	Total  int      `json:"total"`
	Reader int      `json:"reader"`
}

func (g *gartik) View(seat int, now time.Time) any {
	v := gkView{Phase: g.phase, Round: min(g.round+1, g.rounds), Rounds: g.rounds, Deadline: ms(g.deadline), Done: g.done, Out: g.out,
		Strokes: []stroke{}, Chains: g.n, Pages: []gkItem{}, Reader: g.reader()}
	switch g.phase {
	case "album":
		v.Chain, v.Total = g.chain, len(g.chains[g.chain])
		v.Pages = g.chains[g.chain][:g.step+1]
	case "over":
		v.Chain = g.n
	default:
		if seat >= 0 {
			v.Text, v.Strokes = g.texts[seat], g.sk[seat].view()
			if c := g.chains[g.chainOf(seat)]; len(c) > 0 {
				v.Prompt = &c[len(c)-1]
			}
		}
	}
	return v
}

func (g *gartik) Winners() (bool, []int) { return g.phase == "over", nil }
