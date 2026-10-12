package games

import (
	"encoding/json"
	"math"
	"math/rand/v2"
	"slices"
	"time"
)

// Bombermat follows the rules of Bomberman: a grid of pillars and crates,
// bombs that blow in a cross, bonuses under the crates, last one standing.

const (
	pdW, pdH = 13, 11

	pdEmpty  = '.'
	pdPillar = '#'
	pdCrate  = 'x'

	// Before anything moves, the players get a moment to find themselves.
	pdCountdown = 4 * time.Second

	pdFuse  = 2500 * time.Millisecond
	pdFlame = 450 * time.Millisecond
	// Time to cross one cell, before any speed bonus.
	pdStep    = 200 * time.Millisecond
	pdStepMin = 110 * time.Millisecond
	// After this long the grid closes in from its edge, one cell at a time.
	pdShrinkAfter = 120 * time.Second
	pdShrinkEvery = 450 * time.Millisecond

	// A kicked bomb slides one cell in this long.
	pdSlide = 70 * time.Millisecond
	// A vest takes one blast, and its wearer walks out of the flames unharmed.
	pdSpared = 1200 * time.Millisecond
	// The skull slows whoever picks it up, for this long.
	pdCurse     = 9 * time.Second
	pdCurseStep = 330 * time.Millisecond
)

// The bonuses under the crates, each as often as it is written here, as in
// Bomberman: 'b' one more bomb, 'r' a longer blast, 's' a quicker step, 'k' a
// kick that sends a bomb sliding, 'p' bombs whose blast goes through crates,
// 'v' a vest that takes one blast, 'f' the longest blast at once, and 'x' the
// skull, which is no gift.
const pdBonuses = "bbbbbbrrrrrrssssskkkppvvfxx"

const pdReachMax = 8

type pdBomb struct {
	id     int
	cell   int
	owner  int
	reach  int
	pierce bool
	at     time.Time
	// A kicked bomb slides this way, a cell at a time, until something stops it.
	dir    int
	moveAt time.Time
}

type pdFire struct {
	id    int
	from  int // the cell of the bomb
	cells []int
	until time.Time
}

// A player walks freely along the corridors: they stop where the key is
// released, between two cells if need be. Their place is counted in cells,
// (2, 0.5) being halfway between the cells (2, 0) and (2, 1); one of the two
// is always a whole number, since a corridor is one cell wide.
type pdPlayer struct {
	alive bool
	x, y  float64
	dir   int // held direction as a cell offset, 0 for none
	face  int // the last direction they walked in
	moved bool
	bombs int
	reach int
	step  time.Duration
	// What the rarer bonuses gave.
	kick, pierce, vest bool
	spared             time.Time // no blast hurts before this
	cursed             time.Time // slowed until this
}

// pace is how long the player takes to cross a cell right now.
func (p *pdPlayer) pace(now time.Time) time.Duration {
	if now.Before(p.cursed) {
		return pdCurseStep
	}
	return p.step
}

// What is left of a move once it is too small to matter.
const pdEps = 1e-9

func (p *pdPlayer) put(cell int) {
	x, y := pdXY(cell)
	p.x, p.y = float64(x), float64(y)
}

// at is the cell a player counts as being in: the nearest one.
func (p *pdPlayer) at() int {
	return int(math.Round(p.y))*pdW + int(math.Round(p.x))
}

// over says whether the player covers any part of a cell.
func (p *pdPlayer) over(cell int) bool {
	x, y := pdXY(cell)
	return math.Abs(p.x-float64(x)) < 1-pdEps && math.Abs(p.y-float64(y)) < 1-pdEps
}

type poudriere struct {
	// shrinkAfter is when the grid starts closing in.
	shrinkAfter time.Duration
	rng         *rand.Rand
	arena       string
	grid        []byte
	hidden      map[int]byte // bonus under a crate: 'b' bomb, 'r' reach, 's' speed
	ups         map[int]byte // bonus lying on the floor
	bombs       []*pdBomb
	fires       []pdFire
	players     []*pdPlayer
	start       time.Time
	last        time.Time
	spiral      []int
	closed      int
	over        bool
	nextID      int
}

func pdXY(cell int) (int, int) { return cell % pdW, cell / pdW }

func newPoudriere(n int, rng *rand.Rand, now time.Time) Game {
	return newPoudriereWith(n, rng, now, Options{})
}

func newPoudriereWith(n int, rng *rand.Rand, now time.Time, o Options) Game {
	g := &poudriere{shrinkAfter: o.seconds("shrink", pdShrinkAfter), rng: rng, grid: make([]byte, pdW*pdH), hidden: map[int]byte{}, ups: map[int]byte{}, start: now.Add(pdCountdown), last: now.Add(pdCountdown)}
	for _, c := range pdCorners[:n] {
		p := &pdPlayer{alive: true, bombs: 1, reach: 2, step: pdStep}
		p.put(c)
		g.players = append(g.players, p)
	}
	g.buildArena(pdArenas[rng.IntN(len(pdArenas))])
	// The order in which the grid closes: a spiral from the top left corner.
	x0, y0, x1, y1 := 0, 0, pdW-1, pdH-1
	for x0 <= x1 && y0 <= y1 {
		for x := x0; x <= x1; x++ {
			g.spiral = append(g.spiral, y0*pdW+x)
		}
		for y := y0 + 1; y <= y1; y++ {
			g.spiral = append(g.spiral, y*pdW+x1)
		}
		if y1 > y0 {
			for x := x1 - 1; x >= x0; x-- {
				g.spiral = append(g.spiral, y1*pdW+x)
			}
		}
		if x1 > x0 {
			for y := y1 - 1; y > y0; y-- {
				g.spiral = append(g.spiral, y*pdW+x0)
			}
		}
		x0, y0, x1, y1 = x0+1, y0+1, x1-1, y1-1
	}
	return g
}

var pdDirs = map[string]int{"u": -pdW, "d": pdW, "l": -1, "r": 1, "": 0}

func (g *poudriere) bombAt(cell int) *pdBomb {
	for _, b := range g.bombs {
		if b.cell == cell {
			return b
		}
	}
	return nil
}

// step returns the cell next to `cell` in a direction, or -1 off the grid.
func step(cell, dir int) int {
	x, y := pdXY(cell)
	switch dir {
	case -1:
		x--
	case 1:
		x++
	case -pdW:
		y--
	case pdW:
		y++
	}
	if x < 0 || x >= pdW || y < 0 || y >= pdH {
		return -1
	}
	return y*pdW + x
}

func (g *poudriere) walkable(cell int) bool {
	return cell >= 0 && g.grid[cell] == pdEmpty && g.bombAt(cell) == nil
}

func (g *poudriere) Act(seat int, action json.RawMessage, now time.Time) error {
	var a struct {
		T string `json:"t"`
		D string `json:"d"`
	}
	if err := kind(action, &a); err != nil {
		return err
	}
	if seat < 0 || g.over || !g.players[seat].alive {
		return nil // a key pressed a moment too late is not worth a message
	}
	p := g.players[seat]
	if a.T == "bomb" && now.Before(g.start) {
		return nil
	}
	switch a.T {
	case "dir":
		d, ok := pdDirs[a.D]
		if !ok {
			return Error("Direction inconnue")
		}
		p.dir = d
	case "bomb":
		cell := p.at()
		mine := 0
		for _, b := range g.bombs {
			if b.owner == seat {
				mine++
			}
		}
		if mine < p.bombs && g.bombAt(cell) == nil {
			g.nextID++
			g.bombs = append(g.bombs, &pdBomb{id: g.nextID, cell: cell, owner: seat, reach: p.reach, pierce: p.pierce, at: now.Add(pdFuse)})
		}
	default:
		return Error("Action inconnue")
	}
	return nil
}

func (g *poudriere) pick(p *pdPlayer) {
	cell := p.at()
	switch g.ups[cell] {
	case 'b':
		p.bombs = min(p.bombs+1, 6)
	case 'r':
		p.reach = min(p.reach+1, pdReachMax)
	case 's':
		p.step = max(p.step-22*time.Millisecond, pdStepMin)
	case 'k':
		p.kick = true
	case 'p':
		p.pierce = true
	case 'v':
		p.vest = true
	case 'f':
		p.reach = pdReachMax
	case 'x':
		p.cursed = g.last.Add(pdCurse)
	default:
		return
	}
	delete(g.ups, cell)
}

// open says whether a player may walk into a cell. A bomb stops everyone but
// the player still standing partly on it, who may step back as well as away.
func (g *poudriere) open(p *pdPlayer, x, y int) bool {
	if x < 0 || x >= pdW || y < 0 || y >= pdH {
		return false
	}
	cell := y*pdW + x
	return g.grid[cell] == pdEmpty && (g.bombAt(cell) == nil || p.over(cell))
}

// advance moves a coordinate towards a target by at most budget, and returns
// what is left of the budget.
func advance(v *float64, target, budget float64) float64 {
	d := target - *v
	if math.Abs(d) <= budget {
		*v = target
		return budget - math.Abs(d)
	}
	*v += math.Copysign(budget, d)
	return 0
}

// move walks a player in the direction they hold for dt. Along a corridor
// they go as far as the next closed cell; turning between two cells, they
// first slide to the nearer cell from which the way is open, as if rounding
// the corner.
func (g *poudriere) move(p *pdPlayer, dt time.Duration) {
	p.moved = false
	if p.dir == 0 {
		return
	}
	p.face = p.dir
	x0, y0 := p.x, p.y
	defer func() { p.moved = p.x != x0 || p.y != y0 }()
	budget := float64(dt) / float64(p.pace(g.last))
	// along is the coordinate that changes, across the other one; open reads
	// the grid in those terms, whichever way the player goes.
	along, across := &p.x, &p.y
	sign := float64(p.dir)
	cellAt := func(a, c int) (int, int) { return a, c }
	if p.dir == pdW || p.dir == -pdW {
		along, across = &p.y, &p.x
		sign = float64(p.dir / pdW)
		cellAt = func(a, c int) (int, int) { return c, a }
	}
	open := func(a, c int) bool {
		x, y := cellAt(a, c)
		return g.open(p, x, y)
	}
	for budget > pdEps {
		// The next cell along the way: the one being entered, or the one after.
		next := math.Floor(*along+pdEps) + 1
		if sign < 0 {
			next = math.Ceil(*along-pdEps) - 1
		}
		if lane := math.Round(*across); math.Abs(*across-lane) > pdEps {
			// Between two lanes: take the nearer one if the way is open from it,
			// else the other one, else stay.
			other := lane + math.Copysign(1, *across-lane)
			ahead := int(math.Round(*along)) + int(sign)
			switch {
			case open(ahead, int(lane)):
				budget = advance(across, lane, budget)
			case open(ahead, int(other)):
				budget = advance(across, other, budget)
			default:
				return
			}
			continue
		}
		if !open(int(next), int(math.Round(*across))) {
			// Walking into a bomb with the kick sends it sliding.
			if x, y := cellAt(int(next), int(math.Round(*across))); p.kick && x >= 0 && x < pdW && y >= 0 && y < pdH {
				if b := g.bombAt(y*pdW + x); b != nil && b.dir == 0 && math.Abs(*along-math.Round(*along)) < pdEps {
					b.dir, b.moveAt = p.dir, g.last
				}
			}
			return
		}
		budget = advance(along, next, budget)
		g.pick(p)
	}
}

func (g *poudriere) explode(b *pdBomb, now time.Time) {
	i := slices.Index(g.bombs, b)
	if i < 0 {
		return
	}
	g.bombs = slices.Delete(g.bombs, i, i+1)
	cells := []int{b.cell}
	var chain []*pdBomb
	for _, dir := range []int{-1, 1, -pdW, pdW} {
		cell := b.cell
		for range b.reach {
			cell = step(cell, dir)
			if cell < 0 || g.grid[cell] == pdPillar {
				break
			}
			cells = append(cells, cell)
			if g.grid[cell] == pdCrate {
				g.grid[cell] = pdEmpty
				if up, ok := g.hidden[cell]; ok {
					g.ups[cell] = up
					delete(g.hidden, cell)
				}
				// A piercing blast goes on through the crate it breaks.
				if b.pierce {
					continue
				}
				break
			}
			// A bonus left on the floor burns; one just uncovered does not.
			delete(g.ups, cell)
			if other := g.bombAt(cell); other != nil {
				chain = append(chain, other)
			}
		}
	}
	g.nextID++
	g.fires = append(g.fires, pdFire{id: g.nextID, from: b.cell, cells: cells, until: now.Add(pdFlame)})
	for _, other := range chain {
		g.explode(other, now)
	}
}

func (g *poudriere) alive() int {
	n := 0
	for _, p := range g.players {
		if p.alive {
			n++
		}
	}
	return n
}

func (g *poudriere) Tick(now time.Time) bool {
	if g.over || now.Before(g.start) {
		return false
	}
	dt := now.Sub(g.last)
	g.last = now
	for _, p := range g.players {
		if p.alive {
			g.move(p, dt)
		}
	}
	// A kicked bomb slides until a wall, a crate, another bomb or a player.
	for _, b := range g.bombs {
		for b.dir != 0 && !now.Before(b.moveAt) {
			to := step(b.cell, b.dir)
			if to < 0 || g.grid[to] != pdEmpty || g.bombAt(to) != nil || slices.ContainsFunc(g.players, func(p *pdPlayer) bool { return p.alive && p.over(to) }) {
				b.dir = 0
				break
			}
			b.cell, b.moveAt = to, b.moveAt.Add(pdSlide)
		}
	}
	for _, b := range slices.Clone(g.bombs) {
		if !now.Before(b.at) {
			g.explode(b, now)
		}
	}
	g.fires = slices.DeleteFunc(g.fires, func(f pdFire) bool { return !now.Before(f.until) })
	// The grid closes in.
	if since := now.Sub(g.start) - g.shrinkAfter; since >= 0 {
		for want := int(since/pdShrinkEvery) + 1; g.closed < want && g.closed < len(g.spiral); g.closed++ {
			cell := g.spiral[g.closed]
			g.grid[cell] = pdPillar
			delete(g.ups, cell)
			delete(g.hidden, cell)
			g.bombs = slices.DeleteFunc(g.bombs, func(b *pdBomb) bool { return b.cell == cell })
			for _, p := range g.players {
				if p.alive && p.at() == cell {
					p.alive = false
				}
			}
		}
	}
	for _, p := range g.players {
		if !p.alive {
			continue
		}
		for _, f := range g.fires {
			if !slices.Contains(f.cells, p.at()) || now.Before(p.spared) {
				continue
			}
			// The vest takes the blast, once, and gives time to walk out of it.
			if p.vest {
				p.vest, p.spared = false, now.Add(pdSpared)
				continue
			}
			p.alive = false
		}
	}
	if g.alive() <= 1 {
		g.over = true
	}
	return true
}

func (g *poudriere) Drop(seat int, now time.Time) {
	g.players[seat].alive = false
	if g.alive() <= 1 {
		g.over = true
	}
}

type pdPlayerView struct {
	X     float64 `json:"x"`
	Y     float64 `json:"y"`
	Alive bool    `json:"alive"`
	Bombs int     `json:"bombs"`
	Reach int     `json:"reach"`
	Speed int     `json:"speed"`
	// Which way they face ("u", "d", "l", "r") and whether they are walking.
	Face   string `json:"face"`
	Moving bool   `json:"moving,omitempty"`
	Kick   bool   `json:"kick,omitempty"`
	Pierce bool   `json:"pierce,omitempty"`
	Vest   bool   `json:"vest,omitempty"`
	// Just saved by the vest, and still walking out of the flames.
	Spared bool `json:"spared,omitempty"`
	Cursed bool `json:"cursed,omitempty"`
}

type pdItem struct {
	C int    `json:"c"`
	K string `json:"k,omitempty"`
}

type pdBombView struct {
	ID int `json:"id"`
	C  int `json:"c"`
	// When it goes off, and whether its blast goes through crates.
	At     int64 `json:"at"`
	Pierce bool  `json:"pierce,omitempty"`
}

// A blast: the cell of the bomb, then every cell it reaches.
type pdBlast struct {
	ID    int   `json:"id"`
	C     int   `json:"c"`
	Cells []int `json:"cells"`
}

var pdFaces = map[int]string{-pdW: "u", pdW: "d", -1: "l", 1: "r", 0: "d"}

type pdView struct {
	Arena   string         `json:"arena"`
	W       int            `json:"w"`
	H       int            `json:"h"`
	Grid    string         `json:"grid"`
	Ups     []pdItem       `json:"ups"`
	Bombs   []pdBombView   `json:"bombs"`
	Blasts  []pdBlast      `json:"blasts"`
	Players []pdPlayerView `json:"players"`
	// When the players may move, when the grid starts closing in, and how many
	// cells it has taken.
	StartAt  int64 `json:"startAt"`
	ShrinkAt int64 `json:"shrinkAt"`
	Closed   int   `json:"closed"`
	Over     bool  `json:"over"`
	Winner   int   `json:"winner"`
}

func (g *poudriere) View(seat int, now time.Time) any {
	v := pdView{Arena: g.arena, W: pdW, H: pdH, Grid: string(g.grid), Ups: []pdItem{}, Bombs: []pdBombView{}, Blasts: []pdBlast{},
		StartAt: ms(g.start), ShrinkAt: ms(g.start.Add(g.shrinkAfter)), Closed: g.closed, Over: g.over, Winner: -1}
	for cell, k := range g.ups {
		v.Ups = append(v.Ups, pdItem{C: cell, K: string(k)})
	}
	slices.SortFunc(v.Ups, func(a, b pdItem) int { return a.C - b.C })
	for _, b := range g.bombs {
		v.Bombs = append(v.Bombs, pdBombView{ID: b.id, C: b.cell, At: ms(b.at), Pierce: b.pierce})
	}
	for _, f := range g.fires {
		v.Blasts = append(v.Blasts, pdBlast{ID: f.id, C: f.from, Cells: f.cells})
	}
	for i, p := range g.players {
		v.Players = append(v.Players, pdPlayerView{
			X: math.Round(p.x*100) / 100, Y: math.Round(p.y*100) / 100,
			Alive: p.alive, Bombs: p.bombs, Reach: p.reach, Speed: int((pdStep-p.step)/(22*time.Millisecond)) + 1,
			Face: pdFaces[p.face], Moving: p.moved, Kick: p.kick, Pierce: p.pierce, Vest: p.vest,
			Spared: now.Before(p.spared), Cursed: now.Before(p.cursed),
		})
		if g.over && p.alive {
			v.Winner = i
		}
	}
	return v
}

func (g *poudriere) Winners() (bool, []int) {
	if !g.over {
		return false, nil
	}
	for i, p := range g.players {
		if p.alive {
			return true, []int{i}
		}
	}
	return true, nil
}
