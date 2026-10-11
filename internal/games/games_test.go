package games

import (
	"encoding/json"
	"fmt"
	"math/rand/v2"
	"slices"
	"strings"
	"testing"
	"time"
)

var t0 = time.Date(2026, 10, 10, 20, 0, 0, 0, time.UTC)

func rng(seed uint64) *rand.Rand { return rand.New(rand.NewPCG(seed, 1)) }

func act(g Game, seat int, now time.Time, format string, args ...any) error {
	return g.Act(seat, json.RawMessage(fmt.Sprintf(format, args...)), now)
}

func TestSpecs(t *testing.T) {
	for id, spec := range Specs {
		if spec.ID != id || spec.Min < 2 || spec.Max < spec.Min || spec.Rate <= 0 {
			t.Errorf("%s: bad spec %+v", id, spec)
		}
		for n := spec.Min; n <= spec.Max; n++ {
			g := spec.New(n, rng(uint64(n)), t0, Options{})
			if over, _ := g.Winners(); over {
				t.Errorf("%s with %d players is over before it starts", id, n)
			}
			for seat := -1; seat < n; seat++ {
				if _, err := json.Marshal(g.View(seat, t0)); err != nil {
					t.Errorf("%s: view of seat %d: %v", id, seat, err)
				}
			}
		}
	}
}

// ---------- Ono ----------

func terreCards(g *terre) int {
	n := len(g.deck) + len(g.pile) + 1
	for _, h := range g.hands {
		n += len(h)
	}
	return n
}

func TestTerrePlaysToTheEnd(t *testing.T) {
	for seed := uint64(1); seed <= 40; seed++ {
		players := 2 + int(seed%7)
		g := newTerre(players, rng(seed), t0).(*terre)
		now := t0
		for turn := 0; g.winner < 0; turn++ {
			if turn > 5000 {
				t.Fatalf("seed %d: no winner after %d turns", seed, turn)
			}
			if n := terreCards(g); n != 108 {
				t.Fatalf("seed %d: %d cards in the game, want 108", seed, n)
			}
			now = now.Add(time.Second)
			seat := g.turn
			v := g.View(seat, now).(terreView)
			if len(v.Hand) == 2 {
				act(g, seat, now, `{"t":"terre"}`)
			}
			var err error
			switch {
			case len(v.Playable) > 0:
				err = act(g, seat, now, `{"t":"play","id":%d,"color":"lagon"}`, v.Playable[0])
			case v.Drawn >= 0:
				err = act(g, seat, now, `{"t":"pass"}`)
			default:
				err = act(g, seat, now, `{"t":"draw"}`)
			}
			if err != nil {
				t.Fatalf("seed %d, seat %d: %v", seed, seat, err)
			}
		}
		if over, w := g.Winners(); !over || len(w) != 1 || len(g.hands[w[0]]) != 0 {
			t.Fatalf("seed %d: winners %v", seed, w)
		}
	}
}

func TestTerreRules(t *testing.T) {
	g := newTerre(3, rng(7), t0).(*terre)
	g.turn, g.dir = 0, 1
	g.top, g.color = terreCard{ID: 900, Color: "corail", Kind: "5"}, "corail"
	g.hands[0] = []terreCard{{ID: 901, Color: "sable", Kind: "9"}, {ID: 902, Color: "corail", Kind: "+2"}, {ID: 903, Kind: "wild"}}
	before := len(g.hands[1])

	if err := act(g, 1, t0, `{"t":"play","id":%d}`, g.hands[1][0].ID); err == nil {
		t.Fatal("played out of turn")
	}
	if err := act(g, 0, t0, `{"t":"play","id":901}`); err == nil {
		t.Fatal("played a card of another colour and figure")
	}
	if err := act(g, 0, t0, `{"t":"play","id":903}`); err == nil {
		t.Fatal("played a wild card without choosing a colour")
	}
	if err := act(g, 0, t0, `{"t":"play","id":902}`); err != nil {
		t.Fatal(err)
	}
	if g.last.T != "play" || g.last.Target != 1 || g.last.N != 2 {
		t.Fatalf("+2 told as %+v", g.last)
	}
	if len(g.hands[1]) != before+2 || g.turn != 2 {
		t.Fatalf("+2: next player has %d cards (had %d), turn is %d", len(g.hands[1]), before, g.turn)
	}

	// Seat 0 goes down to one card without saying so: anyone may call it.
	g.turn = 0
	if err := act(g, 0, t0, `{"t":"play","id":903,"color":"sable"}`); err != nil {
		t.Fatal(err)
	}
	if g.exposed != 0 || g.color != "sable" {
		t.Fatalf("exposed = %d, colour = %s", g.exposed, g.color)
	}
	if err := act(g, 2, t0, `{"t":"counter"}`); err != nil {
		t.Fatal(err)
	}
	if len(g.hands[0]) != 3 || g.exposed != -1 {
		t.Fatalf("after the call: %d cards, exposed %d", len(g.hands[0]), g.exposed)
	}

	// A player who runs out of time draws and loses the turn.
	seat, had := g.turn, len(g.hands[g.turn])
	if !g.Tick(g.deadline) || g.turn == seat || len(g.hands[seat]) != had+1 {
		t.Fatalf("timeout: turn %d, cards %d", g.turn, len(g.hands[seat]))
	}

	// A view shows a hand to its owner only.
	if v := g.View(-1, t0).(terreView); len(v.Hand) != 0 {
		t.Fatal("a spectator sees a hand")
	}

	// When the others leave, the last player wins.
	g.Drop(1, t0)
	g.Drop(2, t0)
	if over, w := g.Winners(); !over || !slices.Equal(w, []int{0}) {
		t.Fatalf("after the others left: %v %v", over, w)
	}
}

// ---------- Codenoms ----------

func TestPavillons(t *testing.T) {
	g := newPavillons(4, rng(3), t0).(*pavillons)
	if len(g.words) != 25 || len(slices.Compact(slices.Sorted(slices.Values(g.words)))) != 25 {
		t.Fatalf("grid: %v", g.words)
	}
	// Seats 0 and 1 give the clues; 2 and 3 guess.
	if err := act(g, 2, t0, `{"t":"guess","i":0}`); err == nil {
		t.Fatal("guessed before the teams were made")
	}
	if err := act(g, 2, t0, `{"t":"team","team":0,"guide":true}`); err != nil {
		t.Fatal(err)
	}
	if err := act(g, 0, t0, `{"t":"begin"}`); err == nil {
		t.Fatal("began with two clue givers in a team")
	}
	act(g, 2, t0, `{"t":"team","team":0,"guide":false}`)
	if err := act(g, 0, t0, `{"t":"begin"}`); err != nil {
		t.Fatal(err)
	}

	team := g.turn
	guide, guesser, other := team, team+2, 1-team+2
	if v := g.View(guesser, t0).(pavView); slices.ContainsFunc(v.Key, func(k int) bool { return k >= 0 }) {
		t.Fatal("a guesser sees the key")
	}
	if v := g.View(guide, t0).(pavView); slices.Contains(v.Key, -1) {
		t.Fatal("a clue giver does not see the key")
	}
	if err := act(g, guesser, t0, `{"t":"guess","i":0}`); err == nil {
		t.Fatal("guessed before the clue")
	}
	if err := act(g, guide, t0, `{"t":"clue","word":"deux mots","n":2}`); err == nil {
		t.Fatal("a clue of two words was accepted")
	}
	if err := act(g, guide, t0, `{"t":"clue","word":%q,"n":2}`, strings.ToUpper(g.words[4])); err == nil {
		t.Fatal("a word of the grid was accepted as a clue")
	}
	if err := act(g, guide, t0, `{"t":"clue","word":"océan","n":1}`); err != nil {
		t.Fatal(err)
	}
	if err := act(g, guide, t0, `{"t":"guess","i":0}`); err == nil {
		t.Fatal("the clue giver guessed")
	}
	if err := act(g, other, t0, `{"t":"guess","i":0}`); err == nil {
		t.Fatal("the other team guessed")
	}
	// Two right words use up a clue for one, and the turn passes.
	mine := []int{}
	for i, k := range g.key {
		if k == team {
			mine = append(mine, i)
		}
	}
	act(g, guesser, t0, `{"t":"guess","i":%d}`, mine[0])
	if g.turn != team {
		t.Fatal("a right word ended the turn")
	}
	act(g, guesser, t0, `{"t":"guess","i":%d}`, mine[1])
	if g.turn == team || g.clue != nil {
		t.Fatal("the turn did not pass after count + 1 words")
	}
	// A neutral word ends the other team's turn.
	act(g, 1-team, t0, `{"t":"clue","word":"hasard","n":3}`)
	act(g, other, t0, `{"t":"guess","i":%d}`, slices.Index(g.key, pavNeutral))
	if g.turn != team {
		t.Fatal("a neutral word did not end the turn")
	}
	// The forbidden word loses the game.
	act(g, guide, t0, `{"t":"clue","word":"danger","n":1}`)
	act(g, guesser, t0, `{"t":"guess","i":%d}`, slices.Index(g.key, pavForbidden))
	over, winners := g.Winners()
	if !over || !slices.Equal(winners, []int{1 - team, other}) {
		t.Fatalf("after the forbidden word: %v %v", over, winners)
	}

	// Finding every word wins.
	g = newPavillons(4, rng(5), t0).(*pavillons)
	act(g, 0, t0, `{"t":"begin"}`)
	team = g.turn
	act(g, team, t0, `{"t":"clue","word":"tout","n":9}`)
	for i, k := range g.key {
		if k == team {
			if err := act(g, team+2, t0, `{"t":"guess","i":%d}`, i); err != nil {
				t.Fatal(err)
			}
		}
	}
	if over, winners := g.Winners(); !over || !slices.Equal(winners, []int{team, team + 2}) {
		t.Fatalf("after every word: %v %v", over, winners)
	}
}

// ---------- BoomParty ----------

func TestFrench(t *testing.T) {
	loadFrench()
	if len(french) < 300_000 || !slices.IsSorted(french) {
		t.Fatalf("%d words, sorted: %v", len(french), slices.IsSorted(french))
	}
	for _, w := range []string{"bateau", "etendue", "coeur", "mangeaient"} {
		if !isFrench(w) {
			t.Errorf("%q is not in the list", w)
		}
	}
	if isFrench("xqzt") {
		t.Error("xqzt is in the list")
	}
	// Every syllable can be answered.
	for _, s := range syllables {
		if !slices.ContainsFunc(french, func(w string) bool { return strings.Contains(w, s) }) {
			t.Errorf("no word contains %q", s)
		}
	}
}

func TestMeche(t *testing.T) {
	g := newMeche(3, rng(2), t0).(*meche)
	g.turn, g.syllable = 0, "ate"
	if err := act(g, 1, t0, `{"t":"word","w":"bateau"}`); err == nil {
		t.Fatal("a player without the bomb answered")
	}
	for word, why := range map[string]string{"navire": "sans la syllabe", "atexyz": "inconnu"} {
		act(g, 0, t0, `{"t":"word","w":%q}`, word)
		if g.turn != 0 || g.last.Result != why {
			t.Fatalf("%q: turn %d, result %q, want %q", word, g.turn, g.last.Result, why)
		}
	}
	// Accents and capitals do not matter; the bomb passes on.
	late := g.fuse.Add(-time.Second)
	if err := act(g, 0, late, `{"t":"word","w":"  Bâteau "}`); err != nil {
		t.Fatal(err)
	}
	if g.turn != 1 || g.last.Result != "ok" || g.fuse.Sub(late) < mecheGrace {
		t.Fatalf("after a right word: turn %d, result %q, %v left", g.turn, g.last.Result, g.fuse.Sub(late))
	}
	g.syllable = "ate"
	act(g, 1, late, `{"t":"word","w":"bateau"}`)
	if g.turn != 1 || g.last.Result != "déjà joué" {
		t.Fatalf("a word played twice: turn %d, result %q", g.turn, g.last.Result)
	}
	// The bomb goes off: a life is lost and the next player takes it.
	if g.Tick(g.fuse.Add(-time.Millisecond)) {
		t.Fatal("the bomb went off early")
	}
	if !g.Tick(g.fuse) || g.lives[1] != mecheLives-1 || g.turn != 2 {
		t.Fatalf("explosion: lives %v, turn %d", g.lives, g.turn)
	}
	// Until one player is left.
	now := g.fuse
	for i := 0; !g.over(); i++ {
		if i > 100 {
			t.Fatal("the game does not end")
		}
		now = g.fuse
		g.Tick(now)
	}
	over, winners := g.Winners()
	if !over || len(winners) != 1 || g.lives[winners[0]] == 0 {
		t.Fatalf("end: %v %v, lives %v", over, winners, g.lives)
	}
}

// ---------- Bombermat ----------

func TestPoudriere(t *testing.T) {
	g := newPoudriere(4, rng(4), t0.Add(-pdCountdown)).(*poudriere)
	if g.Tick(t0.Add(-time.Second)) {
		t.Fatal("the game moves during the countdown")
	}
	for cell, c := range g.grid {
		if x, y := pdXY(cell); (x%2 == 1 && y%2 == 1) != (c == pdPillar) {
			t.Fatalf("cell %d: %c", cell, c)
		}
	}
	for seat, p := range g.players {
		if g.grid[p.at()] != pdEmpty {
			t.Fatalf("seat %d starts in a wall", seat)
		}
	}
	if len(g.spiral) != pdW*pdH || len(slices.Compact(slices.Sorted(slices.Values(g.spiral)))) != pdW*pdH {
		t.Fatal("the spiral does not cover the grid once")
	}

	// Seat 0 walks right one cell, lays a bomb, comes back and steps down.
	now := t0
	tick := func(d time.Duration) {
		for end := now.Add(d); now.Before(end); {
			now = now.Add(50 * time.Millisecond)
			g.Tick(now)
		}
	}
	p := g.players[0]
	act(g, 0, now, `{"t":"dir","d":"r"}`)
	tick(pdStep)
	act(g, 0, now, `{"t":"dir","d":""}`)
	tick(pdStep)
	if p.x != 1 || p.y != 0 {
		t.Fatalf("after one step right: at %v, %v", p.x, p.y)
	}
	// A player stops where the key is released, between two cells if need be,
	// and counts as standing in the nearer one.
	act(g, 0, now, `{"t":"dir","d":"l"}`)
	tick(pdStep / 4)
	act(g, 0, now, `{"t":"dir","d":""}`)
	tick(pdStep)
	if p.x != 0.75 || p.at() != 1 {
		t.Fatalf("after a quarter step left: x %v, cell %d", p.x, p.at())
	}
	// Turning between two cells rounds the corner: down is open from cell 0
	// only (cell 1 has a pillar below), so the player slides there first.
	act(g, 0, now, `{"t":"dir","d":"d"}`)
	tick(pdStep)
	if p.x != 0 || p.y != 0.25 {
		t.Fatalf("after turning down between two cells: at %v, %v", p.x, p.y)
	}
	act(g, 0, now, `{"t":"dir","d":"u"}`)
	tick(pdStep)
	act(g, 0, now, `{"t":"dir","d":"r"}`)
	tick(pdStep)
	act(g, 0, now, `{"t":"dir","d":""}`)
	if p.x != 1 || p.y != 0 {
		t.Fatalf("back on cell 1: at %v, %v", p.x, p.y)
	}
	act(g, 0, now, `{"t":"bomb"}`)
	act(g, 0, now, `{"t":"bomb"}`)
	if len(g.bombs) != 1 {
		t.Fatalf("%d bombs laid with one in hand", len(g.bombs))
	}
	act(g, 0, now, `{"t":"dir","d":"l"}`)
	tick(pdStep)
	act(g, 0, now, `{"t":"dir","d":"r"}`)
	tick(pdStep)
	if p.x != 0 {
		t.Fatalf("walked back onto the bomb: x %v", p.x)
	}
	act(g, 0, now, `{"t":"dir","d":"d"}`)
	tick(pdStep * 2)
	act(g, 0, now, `{"t":"dir","d":""}`)
	if p.at() != pdW || p.y != 1 {
		t.Fatalf("after stepping down: cell %d, y %v", p.at(), p.y)
	}
	g.grid[2], g.hidden[2] = pdCrate, 'r'
	g.grid[3] = pdCrate
	tick(pdFuse)
	if len(g.bombs) != 0 || g.grid[2] != pdEmpty || g.grid[3] != pdCrate || g.ups[2] != 'r' {
		t.Fatalf("after the blast: %d bombs, cells %c %c, bonus %q", len(g.bombs), g.grid[2], g.grid[3], g.ups[2])
	}
	if !p.alive {
		t.Fatal("killed around the corner from the blast")
	}
	// The same bomb, standing in its line.
	tick(pdFlame)
	act(g, 0, now, `{"t":"dir","d":"u"}`)
	tick(pdStep * 2)
	act(g, 0, now, `{"t":"dir","d":""}`)
	act(g, 0, now, `{"t":"bomb"}`)
	tick(pdFuse + 100*time.Millisecond)
	if p.alive {
		t.Fatal("survived standing on a bomb")
	}
	if over, _ := g.Winners(); over {
		t.Fatal("over with three players left")
	}

	// Left alone, the grid closes in until one player is left at most.
	for i := 0; !g.over; i++ {
		if i > 100_000 {
			t.Fatal("the game does not end")
		}
		tick(time.Second)
	}
	if over, winners := g.Winners(); !over || len(winners) > 1 {
		t.Fatalf("end: %v %v", over, winners)
	}
}

// A chain: a bomb in the blast of another goes off with it.
func TestPoudriereChain(t *testing.T) {
	g := newPoudriere(2, rng(9), t0.Add(-pdCountdown)).(*poudriere)
	for i := range g.grid {
		if g.grid[i] == pdCrate {
			g.grid[i] = pdEmpty
		}
	}
	g.players[0].put(6 * pdW)
	g.bombs = []*pdBomb{{cell: 2, owner: 0, reach: 3, at: t0.Add(time.Second)}, {cell: 4, owner: 0, reach: 3, at: t0.Add(time.Hour)}}
	g.Tick(t0.Add(time.Second))
	if len(g.bombs) != 0 || len(g.fires) != 2 {
		t.Fatalf("%d bombs left, %d fires", len(g.bombs), len(g.fires))
	}
}

// The rarer bonuses: a kicked bomb slides to the wall, a piercing blast goes
// through a crate, a vest takes one blast, the skull slows.
func TestPoudriereBonuses(t *testing.T) {
	g := newPoudriere(2, rng(9), t0.Add(-pdCountdown)).(*poudriere)
	for i := range g.grid {
		if g.grid[i] == pdCrate {
			g.grid[i] = pdEmpty
		}
	}
	now := t0
	tick := func(d time.Duration) {
		for end := now.Add(d); now.Before(end); {
			now = now.Add(50 * time.Millisecond)
			g.Tick(now)
		}
	}
	tick(50 * time.Millisecond)
	p := g.players[0]
	g.players[1].put(10*pdW + 6)

	// Row 0 is open from end to end: the bomb kicked from cell 1 stops at the wall.
	p.put(0)
	g.ups[0] = 'k'
	g.pick(p)
	g.bombs = []*pdBomb{{id: 1, cell: 1, owner: 0, reach: 2, at: now.Add(time.Hour)}}
	act(g, 0, now, `{"t":"dir","d":"r"}`)
	tick(pdSlide * time.Duration(pdW))
	act(g, 0, now, `{"t":"dir","d":""}`)
	if b := g.bombs[0]; b.cell != pdW-1 || b.dir != 0 {
		t.Fatalf("the kicked bomb is on cell %d, sliding %d", b.cell, b.dir)
	}

	// A piercing blast breaks the crate and reaches the cell behind it.
	g.bombs, g.fires = nil, nil
	p.put(4 * pdW)
	g.grid[1], g.grid[2] = pdCrate, pdEmpty
	b := &pdBomb{id: 2, cell: 0, owner: 0, reach: 3, pierce: true, at: now}
	g.bombs = []*pdBomb{b}
	g.explode(b, now)
	if g.grid[1] != pdEmpty || !slices.Contains(g.fires[0].cells, 2) {
		t.Fatalf("a piercing blast stopped at the crate: %v", g.fires[0].cells)
	}

	// A vest takes one blast; the next one kills.
	g.fires = nil
	tick(pdFlame + 50*time.Millisecond)
	p.put(0)
	g.ups[0] = 'v'
	g.pick(p)
	b = &pdBomb{id: 3, cell: 0, owner: 1, reach: 1, at: now.Add(50 * time.Millisecond)}
	g.bombs = []*pdBomb{b}
	tick(pdFlame)
	if !p.alive || p.vest {
		t.Fatalf("after a blast with a vest: alive %v, vest %v", p.alive, p.vest)
	}
	tick(pdSpared)
	b = &pdBomb{id: 4, cell: 0, owner: 1, reach: 1, at: now.Add(50 * time.Millisecond)}
	g.bombs = []*pdBomb{b}
	tick(pdFlame)
	if p.alive {
		t.Fatal("survived a second blast without a vest")
	}

	// The skull slows; the full fire gives the longest blast.
	q := g.players[1]
	g.ups[q.at()] = 'x'
	g.pick(q)
	if q.pace(now) != pdCurseStep || q.pace(now.Add(pdCurse)) != pdStep {
		t.Fatalf("the skull: pace %v now, %v after", q.pace(now), q.pace(now.Add(pdCurse)))
	}
	g.ups[q.at()] = 'f'
	g.pick(q)
	if q.reach != pdReachMax {
		t.Fatalf("full fire: reach %d", q.reach)
	}
}

// ---------- Skribouille ----------

func TestSketch(t *testing.T) {
	var s sketch
	raw := func(s string) json.RawMessage { return json.RawMessage(s) }
	if _, err := s.act("begin", raw(`{"c":1,"w":1,"p":"0a0b"}`)); err != nil || len(s.strokes) != 1 {
		t.Fatalf("begin: %v, %d strokes", err, len(s.strokes))
	}
	s.act("more", raw(`{"p":"0c0d0e0f"}`))
	if s.strokes[0].P != "0a0b0c0d0e0f" || s.points != 3 {
		t.Fatalf("after more: %+v, %d points", s.strokes, s.points)
	}
	for _, bad := range []string{`{"c":1,"w":1,"p":"0a0"}`, `{"c":1,"w":1,"p":"0A0b"}`, `{"c":99,"w":1,"p":"0a0b"}`, `{"c":1,"w":9,"p":"0a0b"}`} {
		if _, err := s.act("begin", raw(bad)); err == nil {
			t.Errorf("accepted %s", bad)
		}
	}
	s.act("undo", nil)
	if len(s.strokes) != 0 || s.points != 0 {
		t.Fatalf("after undo: %d strokes, %d points", len(s.strokes), s.points)
	}
	if ok, _ := s.act("dance", nil); ok {
		t.Fatal("an unknown action was taken for a drawing action")
	}
}

func TestSkrib(t *testing.T) {
	g := newSkrib(3, rng(6), t0).(*skrib)
	if len(g.order) != 6 {
		t.Fatalf("%d turns for three players", len(g.order))
	}
	d := g.drawer
	a, b := (d+1)%3, (d+2)%3
	if v := g.View(a, t0).(skView); len(v.Choices) != 0 || v.Word != "" {
		t.Fatal("a guesser sees the words to choose from")
	}
	if err := act(g, a, t0, `{"t":"choose","i":0}`); err == nil {
		t.Fatal("a guesser chose the word")
	}
	if err := act(g, d, t0, `{"t":"choose","i":1}`); err != nil {
		t.Fatal(err)
	}
	word := g.word
	if v := g.View(a, t0).(skView); v.Word != "" || strings.Count(v.Mask, "_") != len(g.hints) {
		t.Fatalf("what a guesser sees: word %q, mask %q", v.Word, v.Mask)
	}
	if err := act(g, d, t0, `{"t":"begin","c":0,"w":1,"p":"0a0b"}`); err != nil {
		t.Fatal(err)
	}
	if err := act(g, a, t0, `{"t":"begin","c":0,"w":1,"p":"0a0b"}`); err == nil {
		t.Fatal("a guesser drew")
	}
	if v := g.View(b, t0).(skView); len(v.Strokes) != 1 {
		t.Fatal("the others do not see the drawing")
	}
	// A wrong guess is shown to all; a right one is not.
	act(g, a, t0, `{"t":"guess","text":"n'importe quoi"}`)
	early := t0.Add(5 * time.Second)
	act(g, a, early, `{"t":"guess","text":%q}`, strings.ToUpper(word))
	if !g.found[a] || g.scores[a] < 90 || g.scores[d] != 20 || g.phase != "draw" {
		t.Fatalf("after a right guess: found %v, scores %v, phase %s", g.found, g.scores, g.phase)
	}
	if v := g.View(b, early).(skView); len(v.Log) != 2 || v.Log[1].Text != "" || v.Word != "" {
		t.Fatalf("what the other guesser sees: %+v, word %q", v.Log, v.Word)
	}
	// Letters are given away as time passes.
	if !g.Tick(t0.Add(skDraw*8/10)) && len(g.hints) >= 3 {
		t.Fatal("no letter was given away")
	}
	// The last guess ends the turn; later is worth less.
	late := t0.Add(skDraw - 5*time.Second)
	act(g, b, late, `{"t":"guess","text":%q}`, word)
	if g.phase != "reveal" || g.scores[b] >= g.scores[a] {
		t.Fatalf("after everyone found: phase %s, scores %v", g.phase, g.scores)
	}
	if v := g.View(-1, late).(skView); v.Word != word {
		t.Fatal("the word is not revealed")
	}
	// Then every other turn runs out of time.
	now := late
	for i := 0; g.phase != "over"; i++ {
		if i > 100 {
			t.Fatal("the game does not end")
		}
		now = g.deadline
		g.Tick(now)
	}
	if over, w := g.Winners(); !over || !slices.Equal(w, []int{a}) {
		t.Fatalf("winners %v, scores %v", w, g.scores)
	}
	if !near("bateau", "bateaux") || !near("chien", "chiem") || near("chien", "chat") || near("or", "os") {
		t.Fatal("near is off")
	}
}

// ---------- Gartik Phone ----------

func TestGartik(t *testing.T) {
	g := newGartik(3, rng(8), t0).(*gartik)
	if g.rounds != 3 || g.phase != "write" {
		t.Fatalf("%d rounds, phase %s", g.rounds, g.phase)
	}
	for seat := range 3 {
		act(g, seat, t0, `{"t":"text","text":"phrase %d"}`, seat)
		act(g, seat, t0, `{"t":"done","v":true}`)
	}
	if g.phase != "draw" || g.round != 1 {
		t.Fatalf("after everyone wrote: phase %s, round %d", g.phase, g.round)
	}
	// Each player draws the sentence of the one before.
	for seat := range 3 {
		v := g.View(seat, t0).(gkView)
		if want := fmt.Sprintf("phrase %d", (seat+1)%3); v.Prompt == nil || v.Prompt.Text != want {
			t.Fatalf("seat %d must draw %v, want %q", seat, v.Prompt, want)
		}
	}
	act(g, 0, t0, `{"t":"begin","c":2,"w":0,"p":"0a0b"}`)
	if v := g.View(1, t0).(gkView); len(v.Strokes) != 0 {
		t.Fatal("a player sees another's drawing before it is passed on")
	}
	act(g, 0, t0, `{"t":"done","v":true}`)
	act(g, 0, t0, `{"t":"begin","c":2,"w":0,"p":"0c0d"}`)
	if len(g.sk[0].strokes) != 1 {
		t.Fatal("drew after saying done")
	}
	// The others run out of time.
	if !g.Tick(g.deadline) || g.phase != "describe" {
		t.Fatalf("after the bell: phase %s", g.phase)
	}
	if v := g.View(2, t0).(gkView); v.Prompt == nil || !v.Prompt.Draw || len(v.Prompt.Strokes) != 1 || v.Prompt.Seat != 0 {
		t.Fatalf("seat 2 must describe seat 0's drawing, got %+v", v.Prompt)
	}
	g.Tick(g.deadline)
	if g.phase != "album" {
		t.Fatalf("after the last round: phase %s", g.phase)
	}
	for c, chain := range g.chains {
		if len(chain) != 3 || chain[0].Draw || !chain[1].Draw || chain[2].Draw {
			t.Fatalf("album %d: %+v", c, chain)
		}
		if seats := []int{chain[0].Seat, chain[1].Seat, chain[2].Seat}; len(slices.Compact(slices.Sorted(slices.Values(seats)))) != 3 {
			t.Fatalf("album %d was made by %v", c, seats)
		}
	}
	// One player turns the pages, for everyone.
	if err := act(g, 1, t0, `{"t":"next"}`); err == nil {
		t.Fatal("a player who is not the reader turned a page")
	}
	if v := g.View(2, t0).(gkView); len(v.Pages) != 1 || v.Total != 3 {
		t.Fatalf("first page: %d pages of %d", len(v.Pages), v.Total)
	}
	for range 9 {
		if over, _ := g.Winners(); over {
			t.Fatal("over before the last page")
		}
		if err := act(g, 0, t0, `{"t":"next"}`); err != nil {
			t.Fatal(err)
		}
	}
	if over, w := g.Winners(); !over || len(w) != 0 {
		t.Fatalf("end: %v %v", over, w)
	}
}

// The host's settings change how a game is dealt, and nothing else.
func TestOptions(t *testing.T) {
	now := time.Unix(1_700_000_000, 0)
	rng := func() *rand.Rand { return rand.New(rand.NewPCG(1, 2)) }

	g := Specs["meche"].New(3, rng(), now, Options{Values: map[string]int{"lives": 4}})
	if v := g.View(0, now).(mecheView); v.Lives[0] != 4 || v.Lives[2] != 4 {
		t.Fatalf("lives = %v, want 4 each", v.Lives)
	}

	g = Specs["terre"].New(2, rng(), now, Options{Values: map[string]int{"turn": 45}})
	if v := g.View(0, now).(terreView); v.TurnMs != 45_000 {
		t.Fatalf("turn = %d ms, want 45000", v.TurnMs)
	}

	// Enough words of their own: every word of the grid comes from the list.
	own := make([]string, 30)
	for i := range own {
		own[i] = "mot" + string(rune('a'+i%26)) + string(rune('a'+i/26))
	}
	g = Specs["pavillons"].New(4, rng(), now, Options{Words: own})
	for _, w := range g.(*pavillons).words {
		if !strings.HasPrefix(w, "mot") {
			t.Fatalf("word %q does not come from the host's list", w)
		}
	}
	// Too few: the built-in list is used.
	g = Specs["pavillons"].New(4, rng(), now, Options{Words: own[:10]})
	if w := g.(*pavillons).words[0]; strings.HasPrefix(w, "mot") {
		t.Fatalf("a list of 10 words was used for a grid of 25: %q", w)
	}
}
