package server

import (
	"errors"
	"math/rand/v2"
	"net/http"
	"time"

	"github.com/bingops-com/games/internal/store"
)

// What the shop sells. A name effect ("fx:vague") animates the player's name
// wherever it is shown; a part ("hat:hautdeforme") is an avatar part no
// objective gives. The interface names and draws them (web/lib/shop.ts,
// web/lib/avatar.tsx).
type shopItem struct {
	ID    string `json:"id"`
	Price int    `json:"price"`
}

var shopCatalog = []shopItem{
	{"fx:vague", 40},
	{"fx:rebond", 40},
	{"fx:tangage", 50},
	{"fx:neon", 80},
	{"fx:arcenciel", 100},
	{"fx:or", 140},
	{"hat:hautdeforme", 60},
	{"glasses:coeurs", 60},
	{"color:lave", 90},
}

// How many of them are on sale each day.
const shopSize = 4

// todaysShop returns the items on sale on a day (counted from 1970, UTC): the
// same for everyone, and another draw the next day.
func todaysShop(day int) []shopItem {
	order := rand.New(rand.NewPCG(uint64(day), 0x6c61622e62696e67)).Perm(len(shopCatalog))
	out := make([]shopItem, 0, shopSize)
	for _, i := range order[:shopSize] {
		out = append(out, shopCatalog[i])
	}
	return out
}

func shopDay(now time.Time) int { return int(now.Unix() / 86400) }

func priceToday(id string, now time.Time) (int, bool) {
	for _, it := range todaysShop(shopDay(now)) {
		if it.ID == id {
			return it.Price, true
		}
	}
	return 0, false
}

// shop is public: a guest sees what is on sale, without being able to buy.
func (s *Server) shop(w http.ResponseWriter, r *http.Request) (any, error) {
	now := time.Now()
	return map[string]any{
		"items": todaysShop(shopDay(now)),
		// Everything the shop ever sells, to show what comes back another day.
		"catalog": shopCatalog,
		// Seconds until the next draw.
		"next": 86400 - now.Unix()%86400,
	}, nil
}

func (s *Server) buy(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	u, err := s.signedIn(r)
	if err != nil {
		return nil, err
	}
	var body struct {
		Item string `json:"item"`
	}
	if err := readJSON(r, &body); err != nil {
		return nil, err
	}
	price, ok := priceToday(body.Item, time.Now())
	if !ok {
		return nil, bad("Cet article n'est pas en vente aujourd'hui")
	}
	_, err = s.store.Buy(ctx, u.ID, body.Item, price)
	switch {
	case errors.Is(err, store.ErrOwned):
		return nil, httpError{http.StatusConflict, "Vous avez déjà cet article"}
	case errors.Is(err, store.ErrTooPoor):
		return nil, httpError{http.StatusConflict, "Il vous manque des crédits pour cet article"}
	case err != nil:
		return nil, err
	}
	fresh, err := s.store.User(ctx, u.ID)
	if err != nil {
		return nil, err
	}
	return s.account(ctx, fresh)
}

// setFx chooses the animation the player's name wears: one they bought, or
// none.
func (s *Server) setFx(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	u, err := s.signedIn(r)
	if err != nil {
		return nil, err
	}
	var body struct {
		Fx string `json:"fx"`
	}
	if err := readJSON(r, &body); err != nil {
		return nil, err
	}
	if body.Fx != "" {
		items, err := s.store.Items(ctx, u.ID)
		if err != nil {
			return nil, err
		}
		owned := false
		for _, it := range items {
			owned = owned || it == "fx:"+body.Fx
		}
		if !owned {
			return nil, bad("Vous n'avez pas cet effet")
		}
	}
	if err := s.store.SetFx(ctx, u.ID, body.Fx); err != nil {
		return nil, err
	}
	return map[string]string{"fx": body.Fx}, nil
}
