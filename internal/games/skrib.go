package games

import (
	"encoding/json"
	"math/rand/v2"
	"slices"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"
)

// Skribouille follows the rules of skribbl.io: one player draws a word, the
// others write what they think it is; the quicker the guess, the more points.

const (
	skChoose = 12 * time.Second
	skDraw   = 75 * time.Second
	skReveal = 6 * time.Second
	skLog    = 40
)

// A line of the guesses. Kind is "guess", "found", or "close" (one letter
// off, said to the player who wrote it only).
type skLine struct {
	Seat int    `json:"seat"`
	Text string `json:"text,omitempty"`
	Kind string `json:"kind"`
}

type skrib struct {
	// drawFor is how long a drawing lasts; pool is where the words come from.
	drawFor  time.Duration
	pool     []string
	rng      *rand.Rand
	scores   []int
	gained   []int // points won this turn, shown when the word is revealed
	out      []bool
	order    []int // who draws, turn after turn
	turn     int
	phase    string // "choose", "draw", "reveal", "over"
	drawer   int
	choices  []string
	word     string
	hints    []int // letters of the word, in the order they are given away
	shown    int
	sk       sketch
	found    []bool
	log      []skLine
	used     map[string]bool
	started  time.Time
	deadline time.Time
}

func newSkrib(players int, rng *rand.Rand, now time.Time) Game {
	return newSkribWith(players, rng, now, Options{})
}

func newSkribWith(players int, rng *rand.Rand, now time.Time, o Options) Game {
	g := &skrib{drawFor: o.seconds("draw", skDraw), pool: o.words(12), rng: rng, scores: make([]int, players), gained: make([]int, players), out: make([]bool, players), found: make([]bool, players), used: map[string]bool{}}
	rounds := 1
	if players <= 6 {
		rounds = 2
	}
	rounds = o.Int("rounds", rounds)
	first := rng.IntN(players)
	for range rounds {
		for i := range players {
			g.order = append(g.order, (first+i)%players)
		}
	}
	g.turn = -1
	g.next(now)
	return g
}

func (g *skrib) active() int {
	n := 0
	for _, out := range g.out {
		if !out {
			n++
		}
	}
	return n
}

// next opens the following turn, or ends the game.
func (g *skrib) next(now time.Time) {
	for g.turn++; g.turn < len(g.order) && g.out[g.order[g.turn]]; g.turn++ {
	}
	if g.turn >= len(g.order) || g.active() < 2 {
		g.phase = "over"
		return
	}
	g.drawer, g.phase = g.order[g.turn], "choose"
	g.choices = g.choices[:0]
	for len(g.choices) < 3 {
		w := g.pool[g.rng.IntN(len(g.pool))]
		if !g.used[w] && !slices.Contains(g.choices, w) {
			g.choices = append(g.choices, w)
		}
	}
	g.word, g.sk, g.log, g.shown = "", sketch{}, nil, 0
	clear(g.found)
	clear(g.gained)
	g.deadline = now.Add(skChoose)
}

func (g *skrib) choose(i int, now time.Time) {
	g.word = g.choices[i]
	g.used[g.word] = true
	g.hints = g.hints[:0]
	for i, r := range []rune(g.word) {
		if unicode.IsLetter(r) {
			g.hints = append(g.hints, i)
		}
	}
	g.rng.Shuffle(len(g.hints), func(a, b int) { g.hints[a], g.hints[b] = g.hints[b], g.hints[a] })
	g.phase, g.started, g.deadline = "draw", now, now.Add(g.drawFor)
}

func (g *skrib) reveal(now time.Time) {
	g.phase, g.deadline = "reveal", now.Add(skReveal)
}

// hinted is how many letters are given away: one after 40 % of the time, a
// second after 70 %, never more than a third of the word.
func (g *skrib) hinted(now time.Time) int {
	elapsed := float64(now.Sub(g.started)) / float64(g.drawFor)
	k := 0
	if elapsed >= 0.4 {
		k = 1
	}
	if elapsed >= 0.7 {
		k = 2
	}
	return min(k, len(g.hints)/3)
}

// near says whether two words differ by one letter added, removed or changed.
func near(a, b string) bool {
	ra, rb := []rune(a), []rune(b)
	if len(ra) > len(rb) {
		ra, rb = rb, ra
	}
	if len(rb)-len(ra) > 1 || len(rb) < 4 {
		return false
	}
	i := 0
	for i < len(ra) && ra[i] == rb[i] {
		i++
	}
	if len(ra) == len(rb) {
		return string(ra[i+1:]) == string(rb[i+1:])
	}
	return string(ra[i:]) == string(rb[i+1:])
}

func (g *skrib) Act(seat int, action json.RawMessage, now time.Time) error {
	var a struct {
		T    string `json:"t"`
		I    int    `json:"i"`
		Text string `json:"text"`
	}
	if err := kind(action, &a); err != nil {
		return err
	}
	if seat < 0 || g.out[seat] || g.phase == "over" {
		return Error("Vous ne jouez pas cette partie")
	}
	if a.T == "guess" {
		text := strings.TrimSpace(a.Text)
		switch {
		case g.phase != "draw" || seat == g.drawer || g.found[seat]:
			return nil // written a moment too late, or by someone who knows
		case text == "" || utf8.RuneCountInString(text) > 40:
			return Error("Proposition trop longue")
		}
		line := skLine{Seat: seat, Text: text, Kind: "guess"}
		switch guess, word := fold(text), fold(g.word); {
		case guess == word:
			left := float64(g.deadline.Sub(now)) / float64(g.drawFor)
			g.gained[seat] = 40 + int(60*max(left, 0))
			g.gained[g.drawer] += 20
			g.scores[seat] += g.gained[seat]
			g.scores[g.drawer] += 20
			g.found[seat] = true
			line = skLine{Seat: seat, Kind: "found"}
		case near(guess, word):
			line.Kind = "close"
		}
		if g.log = append(g.log, line); len(g.log) > skLog {
			g.log = g.log[len(g.log)-skLog:]
		}
		for s := range g.found {
			if s != g.drawer && !g.out[s] && !g.found[s] {
				return nil
			}
		}
		g.reveal(now)
		return nil
	}
	if seat != g.drawer {
		return Error("Ce n'est pas vous qui dessinez")
	}
	switch {
	case a.T == "choose":
		if g.phase != "choose" || a.I < 0 || a.I >= len(g.choices) {
			return Error("Le mot est déjà choisi")
		}
		g.choose(a.I, now)
	case g.phase != "draw":
		return nil // a stroke that arrives after the bell
	default:
		ok, err := g.sk.act(a.T, action)
		if !ok {
			return Error("Action inconnue")
		}
		return err
	}
	return nil
}

func (g *skrib) Tick(now time.Time) bool {
	if g.phase == "over" {
		return false
	}
	if now.Before(g.deadline) {
		if g.phase == "draw" {
			if k := g.hinted(now); k != g.shown {
				g.shown = k
				return true
			}
		}
		return false
	}
	switch g.phase {
	case "choose":
		g.choose(0, now)
	case "draw":
		g.reveal(now)
	case "reveal":
		g.next(now)
	}
	return true
}

func (g *skrib) Drop(seat int, now time.Time) {
	if g.phase == "over" || g.out[seat] {
		return
	}
	g.out[seat] = true
	switch {
	case g.active() < 2:
		g.phase = "over"
	case seat == g.drawer && (g.phase == "choose" || g.phase == "draw"):
		if g.word == "" {
			g.word = g.choices[0]
		}
		g.reveal(now)
	}
}

type skView struct {
	Phase    string   `json:"phase"`
	Drawer   int      `json:"drawer"`
	Turn     int      `json:"turn"`
	Turns    int      `json:"turns"`
	Scores   []int    `json:"scores"`
	Gained   []int    `json:"gained"`
	Out      []bool   `json:"out"`
	Found    []bool   `json:"found"`
	Deadline int64    `json:"deadline"`
	DrawMs   int64    `json:"drawMs"`
	Choices  []string `json:"choices"`
	// Word is the word for who may know it; Mask is its shape for the others,
	// one "_" per hidden letter.
	Word    string   `json:"word"`
	Mask    string   `json:"mask"`
	Strokes []stroke `json:"strokes"`
	Log     []skLine `json:"log"`
}

func (g *skrib) View(seat int, now time.Time) any {
	v := skView{Phase: g.phase, Drawer: g.drawer, Turn: min(g.turn+1, len(g.order)), Turns: len(g.order), Scores: g.scores, Gained: g.gained, Out: g.out, Found: g.found,
		Deadline: ms(g.deadline), DrawMs: g.drawFor.Milliseconds(), Choices: []string{}, Strokes: g.sk.view(), Log: []skLine{}}
	knows := g.phase == "reveal" || g.phase == "over" || seat == g.drawer || (seat >= 0 && g.found[seat])
	if seat == g.drawer && g.phase == "choose" {
		v.Choices = g.choices
	}
	if g.word != "" {
		if knows {
			v.Word = g.word
		}
		open := g.hints[:min(g.shown, len(g.hints))]
		var mask strings.Builder
		for i, r := range []rune(g.word) {
			if unicode.IsLetter(r) && !slices.Contains(open, i) {
				mask.WriteRune('_')
			} else {
				mask.WriteRune(r)
			}
		}
		v.Mask = mask.String()
	}
	for _, l := range g.log {
		// "You are close" is for the player who wrote it.
		if l.Kind == "close" && l.Seat != seat {
			l.Kind = "guess"
		}
		v.Log = append(v.Log, l)
	}
	return v
}

func (g *skrib) Winners() (bool, []int) {
	if g.phase != "over" {
		return false, nil
	}
	best := -1
	var seats []int
	for seat, s := range g.scores {
		switch {
		case g.out[seat]:
		case s > best:
			best, seats = s, []int{seat}
		case s == best:
			seats = append(seats, seat)
		}
	}
	return true, seats
}
