package games

import (
	"bufio"
	"bytes"
	"compress/gzip"
	_ "embed"
	"encoding/json"
	"math/rand/v2"
	"slices"
	"sort"
	"strings"
	"sync"
	"time"
)

// BoomParty follows the rules of BombParty: a syllable is shown, the
// player holding the bomb writes a word that contains it to pass the bomb on,
// and loses a life if it goes off first.

const (
	mecheLives = 2
	// The fuse is lit for a time nobody knows.
	mecheFuseMin = 10 * time.Second
	mecheFuseMax = 25 * time.Second
	// A player who receives the bomb always has this long.
	mecheGrace = 5 * time.Second
)

// The word list is Debian's wfrench (GPL-3+), lower case and without accents:
// "etendue" stands for "étendue". The syllables are the groups of two or three
// letters found in enough of its words.
//
//go:embed words/french.txt.gz
var frenchGz []byte

//go:embed words/syllables.txt
var syllablesTxt string

var (
	french     []string
	syllables  []string
	frenchOnce sync.Once
)

func loadFrench() {
	frenchOnce.Do(func() {
		zr, err := gzip.NewReader(bytes.NewReader(frenchGz))
		if err != nil {
			panic(err)
		}
		sc := bufio.NewScanner(zr)
		for sc.Scan() {
			french = append(french, sc.Text())
		}
		if err := sc.Err(); err != nil {
			panic(err)
		}
		syllables = strings.Fields(syllablesTxt)
	})
}

// isFrench says whether a word, already folded, is in the list.
func isFrench(word string) bool {
	loadFrench()
	i := sort.SearchStrings(french, word)
	return i < len(french) && french[i] == word
}

type mecheLast struct {
	Seat int    `json:"seat"`
	Word string `json:"word"`
	// "ok", "boom", or why the word was refused.
	Result string `json:"result"`
}

type meche struct {
	rng      *rand.Rand
	lives    []int
	turn     int
	syllable string
	used     map[string]bool
	typing   string
	fuse     time.Time
	last     *mecheLast
	words    int
}

func newMeche(players int, rng *rand.Rand, now time.Time) Game {
	return newMecheWith(players, rng, now, Options{})
}

func newMecheWith(players int, rng *rand.Rand, now time.Time, o Options) Game {
	loadFrench()
	g := &meche{rng: rng, lives: make([]int, players), used: map[string]bool{}, turn: rng.IntN(players)}
	for seat := range g.lives {
		g.lives[seat] = o.Int("lives", mecheLives)
	}
	g.light(now)
	return g
}

func (g *meche) light(now time.Time) {
	g.syllable = syllables[g.rng.IntN(len(syllables))]
	g.fuse = now.Add(mecheFuseMin + time.Duration(g.rng.Int64N(int64(mecheFuseMax-mecheFuseMin))))
}

func (g *meche) alive() int {
	n := 0
	for _, l := range g.lives {
		if l > 0 {
			n++
		}
	}
	return n
}

func (g *meche) next() {
	for {
		g.turn = (g.turn + 1) % len(g.lives)
		if g.lives[g.turn] > 0 {
			break
		}
	}
	g.typing = ""
}

func (g *meche) over() bool { return g.alive() <= 1 }

func (g *meche) Act(seat int, action json.RawMessage, now time.Time) error {
	var a struct {
		T string `json:"t"`
		W string `json:"w"`
	}
	if err := kind(action, &a); err != nil {
		return err
	}
	if g.over() || seat != g.turn {
		return Error("Ce n'est pas vous qui tenez la bombe")
	}
	if len(a.W) > 60 {
		return Error("Mot trop long")
	}
	word := fold(a.W)
	switch a.T {
	case "type":
		// What the player is writing, shown to the others as they write.
		g.typing = strings.TrimSpace(a.W)
	case "word":
		refuse := func(why string) error {
			g.last = &mecheLast{Seat: seat, Word: word, Result: why}
			return nil
		}
		switch {
		case !strings.Contains(word, g.syllable):
			return refuse("sans la syllabe")
		case g.used[word]:
			return refuse("déjà joué")
		case !isFrench(word):
			return refuse("inconnu")
		}
		g.used[word] = true
		g.words++
		g.last = &mecheLast{Seat: seat, Word: word, Result: "ok"}
		g.next()
		g.syllable = syllables[g.rng.IntN(len(syllables))]
		if g.fuse.Sub(now) < mecheGrace {
			g.fuse = now.Add(mecheGrace)
		}
	default:
		return Error("Action inconnue")
	}
	return nil
}

func (g *meche) explode(now time.Time) {
	g.lives[g.turn]--
	g.last = &mecheLast{Seat: g.turn, Word: g.typing, Result: "boom"}
	if g.over() {
		return
	}
	g.next()
	g.light(now)
}

func (g *meche) Tick(now time.Time) bool {
	if g.over() || now.Before(g.fuse) {
		return false
	}
	g.explode(now)
	return true
}

func (g *meche) Drop(seat int, now time.Time) {
	if g.over() || g.lives[seat] == 0 {
		return
	}
	g.lives[seat] = 0
	if !g.over() && g.turn == seat {
		g.next()
		g.light(now)
	}
}

type mecheView struct {
	Lives    []int      `json:"lives"`
	Turn     int        `json:"turn"`
	Syllable string     `json:"syllable"`
	Typing   string     `json:"typing"`
	Last     *mecheLast `json:"last"`
	Words    int        `json:"words"`
	Winner   int        `json:"winner"`
}

// View never says when the bomb goes off: nobody knows.
func (g *meche) View(seat int, now time.Time) any {
	v := mecheView{Lives: g.lives, Turn: g.turn, Syllable: g.syllable, Typing: g.typing, Last: g.last, Words: g.words, Winner: -1}
	if g.over() {
		v.Winner = slices.IndexFunc(g.lives, func(l int) bool { return l > 0 })
	}
	return v
}

func (g *meche) Winners() (bool, []int) {
	if !g.over() {
		return false, nil
	}
	if w := slices.IndexFunc(g.lives, func(l int) bool { return l > 0 }); w >= 0 {
		return true, []int{w}
	}
	return true, nil
}
