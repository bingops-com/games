package games

// Four fixed wall layouts, selected uniformly for every new game. Crates and
// bonuses are generated afresh in mirrored groups: all four starting corners
// have the same opportunities, including when only two or three are occupied.
type pdArena struct {
	id          string
	crateChance float64
	pillar      func(x, y int) bool
}

var pdArenas = []pdArena{
	{id: "classic", crateChance: .72, pillar: func(x, y int) bool {
		return x%2 == 1 && y%2 == 1
	}},
	{id: "crossroads", crateChance: .64, pillar: func(x, y int) bool {
		return x%2 == 1 && y%2 == 1 && y != pdH/2
	}},
	{id: "bastions", crateChance: .68, pillar: func(x, y int) bool {
		edge := x%2 == 1 && y%2 == 1 && (x == 1 || x == pdW-2 || y == 1 || y == pdH-2)
		blocks := (x >= 3 && x <= 4 || x >= 8 && x <= 9) && (y >= 3 && y <= 4 || y >= 6 && y <= 7)
		return edge || blocks
	}},
	{id: "rings", crateChance: .58, pillar: func(x, y int) bool {
		corners := (x == 1 || x == pdW-2) && (y == 1 || y == pdH-2)
		outer := ((x == 2 || x == 10) && y >= 2 && y <= 8 && y != 5) || ((y == 2 || y == 8) && x >= 2 && x <= 10 && x != 6)
		inner := ((x == 4 || x == 8) && y >= 4 && y <= 6 && y != 5) || ((y == 4 || y == 6) && x >= 4 && x <= 8 && x != 6)
		return corners || outer || inner
	}},
}

var pdCorners = [...]int{0, pdW*pdH - 1, pdW - 1, pdW * (pdH - 1)}

// The same L-shaped refuge at every corner: lay a bomb on one arm, then
// retreat through the spawn to the other arm, outside the blast's line.
func pdSpawnSpace(x, y int) bool {
	return ((x == 0 || x == pdW-1) && (y <= 1 || y >= pdH-2)) ||
		((y == 0 || y == pdH-1) && (x <= 1 || x >= pdW-2))
}

func (g *poudriere) buildArena(arena pdArena) {
	g.arena = arena.id
	clear(g.hidden)
	for y := 0; y <= pdH/2; y++ {
		for x := 0; x <= pdW/2; x++ {
			tile, bonus := byte(pdEmpty), byte(0)
			switch {
			case arena.pillar(x, y):
				tile = pdPillar
			case !pdSpawnSpace(x, y) && g.rng.Float64() < arena.crateChance:
				tile = pdCrate
				if g.rng.Float64() < .34 {
					bonus = pdBonuses[g.rng.IntN(len(pdBonuses))]
				}
			}
			// Duplicate cells on the central axes just receive the same value again.
			for _, cell := range [...]int{y*pdW + x, y*pdW + pdW - 1 - x, (pdH-1-y)*pdW + x, (pdH-1-y)*pdW + pdW - 1 - x} {
				g.grid[cell] = tile
				if bonus != 0 {
					g.hidden[cell] = bonus
				}
			}
		}
	}
}
