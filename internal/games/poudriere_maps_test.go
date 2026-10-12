package games

import (
	"maps"
	"slices"
	"strings"
	"testing"
	"time"
)

func TestPoudriereArenaLayouts(t *testing.T) {
	if len(pdArenas) != 4 {
		t.Fatalf("got %d arenas, want four", len(pdArenas))
	}
	shapes := map[string]string{}
	for _, arena := range pdArenas {
		t.Run(arena.id, func(t *testing.T) {
			var shape string
			variations := map[string]bool{}
			for seed := uint64(0); seed < 100; seed++ {
				g := newPoudriere(4, rng(seed), t0).(*poudriere)
				g.buildArena(arena)
				mask := make([]byte, len(g.grid))
				floor := 0
				for cell, tile := range g.grid {
					x, y := pdXY(cell)
					if tile != pdEmpty && tile != pdCrate && tile != pdPillar {
						t.Fatalf("invalid tile %q", tile)
					}
					if (tile == pdPillar) != arena.pillar(x, y) {
						t.Fatalf("wrong walls at %d,%d", x, y)
					}
					mask[cell] = pdEmpty
					if tile == pdPillar {
						mask[cell] = pdPillar
					} else {
						floor++
					}
					if pdSpawnSpace(x, y) && tile != pdEmpty {
						t.Fatalf("blocked spawn refuge at %d,%d", x, y)
					}
					for _, mirror := range []int{y*pdW + pdW - 1 - x, (pdH-1-y)*pdW + x} {
						if g.grid[mirror] != tile || g.hidden[mirror] != g.hidden[cell] {
							t.Fatalf("unfair terrain/bonus at %d,%d", x, y)
						}
					}
				}
				if seed == 0 {
					shape = string(mask)
				} else if shape != string(mask) {
					t.Fatal("random crates changed fixed walls")
				}
				variations[string(g.grid)] = true
				for cell, bonus := range g.hidden {
					if cell < 0 || cell >= len(g.grid) || g.grid[cell] != pdCrate || !strings.ContainsRune(pdBonuses, rune(bonus)) {
						t.Fatalf("invalid hidden bonus at %d", cell)
					}
				}
				// All non-wall cells must be connected once crates have been blasted.
				reached := map[int]bool{0: true}
				queue := []int{0}
				for i := 0; i < len(queue); i++ {
					for _, dir := range []int{-1, 1, -pdW, pdW} {
						next := step(queue[i], dir)
						if next >= 0 && g.grid[next] != pdPillar && !reached[next] {
							reached[next] = true
							queue = append(queue, next)
						}
					}
				}
				if len(reached) != floor {
					t.Fatalf("disconnected arena: %d of %d floor cells reachable", len(reached), floor)
				}
				// Every spawn has two free arms, and a bomb on either arm can be escaped.
				for _, corner := range pdCorners {
					x, y := pdXY(corner)
					dx, dy := 1, pdW
					if x != 0 {
						dx = -1
					}
					if y != 0 {
						dy = -pdW
					}
					for _, cell := range []int{corner, corner + dx, corner + dy} {
						if !g.walkable(cell) {
							t.Fatalf("no starting escape at %d", cell)
						}
					}
				}
			}
			if len(variations) < 10 {
				t.Fatal("crates are not regenerated")
			}
			if previous, exists := shapes[shape]; exists {
				t.Fatalf("same wall layout as %s", previous)
			}
			shapes[shape] = arena.id
		})
	}
}

func TestPoudriereRandomArenas(t *testing.T) {
	selected := map[string]int{}
	for seed := uint64(0); seed < 256; seed++ {
		a := newPoudriere(2, rng(seed), t0).(*poudriere)
		b := newPoudriere(2, rng(seed), t0).(*poudriere)
		if a.arena != b.arena || !slices.Equal(a.grid, b.grid) || !maps.Equal(a.hidden, b.hidden) {
			t.Fatal("same seed is not reproducible")
		}
		for _, players := range []int{3, 4} {
			other := newPoudriere(players, rng(seed), t0).(*poudriere)
			if other.arena != a.arena || !slices.Equal(other.grid, a.grid) || !maps.Equal(other.hidden, a.hidden) {
				t.Fatal("player count changed starting fairness")
			}
		}
		for _, seat := range []int{-1, 0, 1} {
			v := a.View(seat, t0).(pdView)
			if v.Arena != a.arena || v.Grid != string(a.grid) || v.W != pdW || v.H != pdH {
				t.Fatal("players do not share the same arena")
			}
		}
		selected[a.arena]++
	}
	for _, arena := range pdArenas {
		if selected[arena.id] == 0 {
			t.Fatalf("arena %s is never selected", arena.id)
		}
	}
	if len(selected) != 4 {
		t.Fatalf("unknown arena selected: %v", selected)
	}
}

func TestPoudriereAllArenasClose(t *testing.T) {
	for _, arena := range pdArenas {
		for players := 2; players <= 4; players++ {
			g := newPoudriere(players, rng(8), t0).(*poudriere)
			g.buildArena(arena)
			g.Tick(g.start.Add(g.shrinkAfter + time.Duration(pdW*pdH)*pdShrinkEvery + time.Second))
			if over, winners := g.Winners(); !over || len(winners) > 1 {
				t.Fatalf("%s with %d players does not finish", arena.id, players)
			}
		}
	}
}
