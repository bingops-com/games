package games

import (
	"fmt"
	"strings"
	"testing"
)

func TestOnoAnnouncedOnlyWithOneCard(t *testing.T) {
	for _, cards := range []int{0, 1, 2, 7} {
		for _, ownTurn := range []bool{false, true} {
			t.Run(fmt.Sprintf("cards=%d/ownTurn=%t", cards, ownTurn), func(t *testing.T) {
				g := newTerre(3, rng(9), t0).(*terre)
				g.hands[0] = g.hands[0][:cards]
				g.turn = 1
				if ownTurn {
					g.turn = 0
				}
				beforeTurn, beforeDeadline := g.turn, g.deadline
				err := act(g, 0, t0, `{"t":"terre"}`)
				if (err == nil) != (cards == 1) || g.said[0] != (cards == 1) {
					t.Fatalf("announcement with %d cards: %v", cards, err)
				}
				if g.turn != beforeTurn || g.deadline != beforeDeadline {
					t.Fatal("announcing Ono consumed the turn or reset its timer")
				}
			})
		}
	}
}

func TestOnoAnnouncedAfterPlayingAndPenaltyStillWorks(t *testing.T) {
	for _, announce := range []bool{false, true} {
		g := newTerre(3, rng(9), t0).(*terre)
		g.turn = 0
		g.top, g.color = terreCard{ID: 900, Color: "corail", Kind: "5"}, "corail"
		g.hands[0] = []terreCard{{ID: 901, Color: "corail", Kind: "6"}, {ID: 902, Color: "lagon", Kind: "2"}}
		if err := act(g, 0, t0, `{"t":"terre"}`); err == nil {
			t.Fatal("pre-announcement with two cards was accepted")
		}
		if err := act(g, 0, t0, `{"t":"play","id":901}`); err != nil {
			t.Fatal(err)
		}
		if g.exposed != 0 || g.turn != 1 {
			t.Fatal("the one-card player cannot announce after passing the turn")
		}
		if announce {
			if err := act(g, 0, t0, `{"t":"terre"}`); err != nil {
				t.Fatal(err)
			}
			if err := act(g, 1, t0, `{"t":"counter"}`); err == nil || len(g.hands[0]) != 1 {
				t.Fatal("an announced hand was penalized")
			}
		} else if err := act(g, 1, t0, `{"t":"counter"}`); err != nil || len(g.hands[0]) != 3 {
			t.Fatal("the forgotten announcement no longer draws two cards")
		}
	}
}

func TestCodenomsClueCharactersAndSingleWord(t *testing.T) {
	for _, tc := range []struct {
		word, accepted string
	}{
		{"a", "a"}, {"É", "É"}, {"e\u0301", "é"}, {"  A  ", "A"},
		{"l’été", "l’été"}, {"arc-en-ciel", "arc-en-ciel"}, {strings.Repeat("a", 24), strings.Repeat("a", 24)},
		{"", ""}, {" ", ""}, {"deux mots", ""}, {"deux\nmots", ""}, {"1", ""}, {"--", ""}, {"'", ""}, {"-a", ""}, {"a-", ""},
		{strings.Repeat("a", 25), ""}, {"ÉCOLE", ""}, {"e\u0301cole", ""},
	} {
		t.Run(fmt.Sprintf("%q", tc.word), func(t *testing.T) {
			g := newPavillons(4, rng(9), t0).(*pavillons)
			if err := act(g, 0, t0, `{"t":"begin"}`); err != nil {
				t.Fatal(err)
			}
			g.words[0] = "école"
			err := act(g, g.turn, t0, `{"t":"clue","word":%q,"n":1}`, tc.word)
			if tc.accepted == "" {
				if err == nil || g.clue != nil || len(g.clues) != 0 {
					t.Fatalf("invalid or secret-grid clue changed the game: %v", err)
				}
			} else if err != nil || g.clue.Word != tc.accepted || g.clue.Count != 1 {
				t.Fatalf("single word was refused or changed: %v", err)
			}
		})
	}
}

func TestCodenomsTypographyDoesNotBypassGridWordRefusal(t *testing.T) {
	for _, gridWord := range []string{"l'été", "e\u0301cole"} {
		g := newPavillons(4, rng(9), t0).(*pavillons)
		if err := act(g, 0, t0, `{"t":"begin"}`); err != nil {
			t.Fatal(err)
		}
		g.words[0] = gridWord
		clue := "école"
		if gridWord == "l'été" {
			clue = "l’été"
		}
		if err := act(g, g.turn, t0, `{"t":"clue","word":%q,"n":1}`, clue); err != Error("L'indice ne peut pas être un mot de la grille") {
			t.Fatalf("typographic variant of a grid word was accepted: %v", err)
		}
	}
}
