package server

import (
	"context"
	"net/http"
	"strings"

	"github.com/bingops-com/games/internal/store"
)

// An avatar is seven parts, written "color.body.eyes.mouth.beard.glasses.hat".
// Each part is free, or the reward of an objective. The interface draws them
// (web/lib/avatar.tsx) and words the objectives; this file says what exists
// and what it takes.
var avatarSlots = [...]string{"color", "body", "eyes", "mouth", "beard", "glasses", "hat"}

const (
	slotColor = iota
	slotBody
	slotEyes
	slotMouth
	slotBeard
	slotGlasses
	slotHat
)

// Free parts, by slot.
var freeParts = [len(avatarSlots)][]string{
	{"corail", "sable", "algue", "lagon", "menthe", "lilas", "rose", "blanc"},
	{"mariniere", "pull", "cire"},
	{"rond", "content", "malin", "surpris"},
	{"sourire", "dents", "langue", "o"},
	{"aucune", "moustache", "barbiche"},
	{"aucune", "rondes", "carrees"},
	{"aucun", "bonnet", "bandana"},
}

// progress is what a player has done, as the objectives count it.
type progress struct {
	games    map[string]store.GameStat
	played   int
	won      int
	distinct int
	friends  int
	streak   int
	// owned holds what the player bought in the shop ("hat:hautdeforme").
	owned map[string]bool
}

type objective struct {
	ID   string
	Goal int
	// The part this objective unlocks.
	Slot int
	Item string
	have func(p *progress) int
}

func playedAt(game string) func(*progress) int {
	return func(p *progress) int { return p.games[game].Played }
}

func wonAt(game string) func(*progress) int {
	return func(p *progress) int { return p.games[game].Won }
}

func played(p *progress) int  { return p.played }
func won(p *progress) int     { return p.won }
func friends(p *progress) int { return p.friends }
func streak(p *progress) int  { return p.streak }

// In the order the page lists them: first steps first.
var objectives = []objective{
	{"premiere", 1, slotGlasses, "cacheoeil", played},
	{"victoire", 1, slotEyes, "etoiles", won},
	{"equipage", 1, slotHat, "perroquet", friends},
	{"habitue", 5, slotHat, "tricorne", played},
	{"assidu", 3, slotGlasses, "soleil", streak},
	{"as", 3, slotHat, "capitaine", wonAt("terre")},
	{"capitaine", 5, slotBody, "veste", won},
	{"artificier", 5, slotHat, "meche", playedAt("meche")},
	{"artiste", 5, slotHat, "crayon", playedAt("skrib")},
	{"stratege", 3, slotGlasses, "monocle", wonAt("pavillons")},
	{"tour", 6, slotColor, "arcenciel", func(p *progress) int { return p.distinct }},
	{"flotte", 5, slotBeard, "barbe", friends},
	{"semaine", 7, slotColor, "or", streak},
	{"champion", 10, slotHat, "couronne", won},
	{"loup", 25, slotColor, "nuit", played},
	{"legende", 25, slotBody, "royal", won},
}

type objectiveView struct {
	ID   string `json:"id"`
	Have int    `json:"have"`
	Goal int    `json:"goal"`
	Done bool   `json:"done"`
	// The reward: a slot of the avatar and the part it unlocks.
	Slot string `json:"slot"`
	Item string `json:"item"`
}

func (s *Server) progress(ctx context.Context, userID string) (*progress, store.Streak, error) {
	stats, err := s.store.Stats(ctx, userID)
	if err != nil {
		return nil, store.Streak{}, err
	}
	p := &progress{games: map[string]store.GameStat{}}
	for _, g := range stats {
		p.games[g.Game] = g
		p.played += g.Played
		p.won += g.Won
		if g.Played > 0 {
			p.distinct++
		}
	}
	if p.friends, _, err = s.store.Counts(ctx, userID); err != nil {
		return nil, store.Streak{}, err
	}
	items, err := s.store.Items(ctx, userID)
	if err != nil {
		return nil, store.Streak{}, err
	}
	p.owned = map[string]bool{}
	for _, it := range items {
		p.owned[it] = true
	}
	streak, err := s.store.Streak(ctx, userID)
	p.streak = streak.Best
	return p, streak, err
}

func objectiveViews(p *progress) []objectiveView {
	out := make([]objectiveView, len(objectives))
	for i, o := range objectives {
		have := min(o.have(p), o.Goal)
		out[i] = objectiveView{ID: o.ID, Have: have, Goal: o.Goal, Done: have >= o.Goal, Slot: avatarSlots[o.Slot], Item: o.Item}
	}
	return out
}

// cleanAvatar returns code if it names parts the player may wear: free ones,
// ones whose objective p has reached, or ones bought in the shop. A guest has
// no progress.
func cleanAvatar(code string, p *progress) (string, bool) {
	parts := strings.Split(code, ".")
	if len(parts) != len(avatarSlots) {
		return "", false
	}
next:
	for slot, part := range parts {
		for _, free := range freeParts[slot] {
			if part == free {
				continue next
			}
		}
		for _, o := range objectives {
			if o.Slot == slot && o.Item == part && p != nil && o.have(p) >= o.Goal {
				continue next
			}
		}
		if p != nil && p.owned[avatarSlots[slot]+":"+part] {
			continue next
		}
		return "", false
	}
	return code, true
}

// setAvatar saves how the signed-in player looks.
func (s *Server) setAvatar(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	u, err := s.signedIn(r)
	if err != nil {
		return nil, err
	}
	var body struct {
		Avatar string `json:"avatar"`
	}
	if err := readJSON(r, &body); err != nil {
		return nil, err
	}
	p, _, err := s.progress(ctx, u.ID)
	if err != nil {
		return nil, err
	}
	avatar, ok := cleanAvatar(body.Avatar, p)
	if !ok {
		return nil, bad("Cette tenue n'est pas encore débloquée")
	}
	if err := s.store.SetAvatar(ctx, u.ID, avatar); err != nil {
		return nil, err
	}
	return map[string]string{"avatar": avatar}, nil
}
