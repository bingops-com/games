// Package games holds the rules of the games, without network or storage. A
// game is played by seats numbered from 0; the room decides who sits where.
package games

import (
	"encoding/json"
	"math/rand/v2"
	"time"
)

// Error is a refusal a player may read: not their turn, a card that cannot be
// played. It is written in French, like the interface.
type Error string

func (e Error) Error() string { return string(e) }

type Game interface {
	// Act applies what the player in a seat asked for.
	Act(seat int, action json.RawMessage, now time.Time) error
	// Tick lets time pass; it reports whether anything changed.
	Tick(now time.Time) bool
	// Drop takes a player who left out of the game.
	Drop(seat int, now time.Time)
	// View is what a seat may see; seat -1 is a spectator.
	View(seat int, now time.Time) any
	// Winners says whether the game is over and which seats won.
	Winners() (over bool, seats []int)
}

// Option is a setting the host may change before a game: how long a turn
// lasts, how many rounds are played. Def 0 with Min above 0 means the game
// decides by itself unless the host says otherwise.
type Option struct {
	Key            string `json:"key"`
	Min, Max, Step int
	Def            int
}

// Options are the host's choices for one game: the settings they changed, and
// their own list of words for the games that draw words.
type Options struct {
	Values map[string]int
	Words  []string
}

// Int returns a setting, or def when the host left it alone.
func (o Options) Int(key string, def int) int {
	if v, ok := o.Values[key]; ok {
		return v
	}
	return def
}

func (o Options) seconds(key string, def time.Duration) time.Duration {
	return time.Duration(o.Int(key, int(def/time.Second))) * time.Second
}

// words returns the host's list when it has at least enough words for the
// game, the built-in one otherwise.
func (o Options) words(enough int) []string {
	if len(o.Words) >= enough {
		return o.Words
	}
	return pavWords
}

type Spec struct {
	ID       string
	Min, Max int
	// Rate is how often Tick is called while the game runs.
	Rate time.Duration
	New  func(players int, rng *rand.Rand, now time.Time, o Options) Game
	// Options are the settings the host may change; Words is how many words a
	// custom list needs, 0 for a game that draws none.
	Options []Option
	Words   int
}

var Specs = map[string]Spec{
	"terre": {ID: "terre", Min: 2, Max: 8, Rate: 250 * time.Millisecond, New: newTerreWith,
		Options: []Option{{Key: "turn", Min: 10, Max: 60, Step: 5, Def: 30}}},
	"pavillons": {ID: "pavillons", Min: 4, Max: 10, Rate: time.Second, New: newPavillonsWith, Words: 25},
	"meche": {ID: "meche", Min: 2, Max: 12, Rate: 100 * time.Millisecond, New: newMecheWith,
		Options: []Option{{Key: "lives", Min: 1, Max: 5, Step: 1, Def: 2}}},
	"poudriere": {ID: "poudriere", Min: 2, Max: 4, Rate: 50 * time.Millisecond, New: newPoudriereWith,
		Options: []Option{{Key: "shrink", Min: 60, Max: 240, Step: 30, Def: 120}}},
	"skrib": {ID: "skrib", Min: 2, Max: 12, Rate: 250 * time.Millisecond, New: newSkribWith, Words: 12,
		Options: []Option{{Key: "draw", Min: 30, Max: 150, Step: 15, Def: 75}, {Key: "rounds", Min: 1, Max: 4, Step: 1, Def: 0}}},
	"gartik": {ID: "gartik", Min: 3, Max: 12, Rate: 250 * time.Millisecond, New: newGartikWith,
		Options: []Option{{Key: "write", Min: 30, Max: 120, Step: 10, Def: 50}, {Key: "draw", Min: 45, Max: 180, Step: 15, Def: 90}}},
}

func ms(t time.Time) int64 { return t.UnixMilli() }

// kind reads the "t" field every action carries.
func kind(action json.RawMessage, into any) error {
	if err := json.Unmarshal(action, into); err != nil {
		return Error("Action illisible")
	}
	return nil
}
