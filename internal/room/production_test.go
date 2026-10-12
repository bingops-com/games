package room

import (
	"encoding/json"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"
)

func TestSlowClientReleasesMembership(t *testing.T) {
	for _, playing := range []bool{false, true} {
		t.Run(map[bool]string{false: "lobby", true: "playing"}[playing], func(t *testing.T) {
			h := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)))
			r, _ := h.Create("terre", false)
			c, _ := r.Join(Who{ID: "slow", Name: "Slow"})
			r.mu.Lock()
			if playing {
				r.phase = "playing"
			}
			for range cap(c.Send) + 1 {
				c.push(map[string]string{"t": "chat"})
			}
			if !c.gone || len(r.clients) != 0 || r.empty.IsZero() {
				t.Fatal("full send queue did not release the connection")
			}
			if playing {
				m := r.member("slow")
				if m == nil || m.conns != 0 || m.left.IsZero() {
					t.Fatal("disconnected player will not expire from the game")
				}
			} else if r.member("slow") != nil {
				t.Fatal("disconnected host kept its lobby seat")
			}
			r.mu.Unlock()
			c.Close() // Cleanup must be idempotent after queue overflow.
		})
	}
}

func TestSlowHostHandsLobbyToConnectedPlayer(t *testing.T) {
	h := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)))
	r, _ := h.Create("terre", false)
	host, _ := r.Join(Who{ID: "host", Name: "Host"})
	guest, _ := r.Join(Who{ID: "guest", Name: "Guest"})
	defer guest.Close()
	for len(guest.Send) > 0 {
		<-guest.Send
	}
	r.mu.Lock()
	for len(host.Send) < cap(host.Send) {
		host.Send <- []byte(`{}`)
	}
	r.broadcast()
	r.mu.Unlock()
	host.Close()
	var last state
	for len(guest.Send) > 0 {
		if err := json.Unmarshal(<-guest.Send, &last); err != nil {
			t.Fatal(err)
		}
	}
	if last.Host != "guest" || len(last.Members) != 1 || !last.Members[0].On {
		t.Fatalf("final snapshot contains a ghost host: %+v", last)
	}
}

func TestConcurrentGameReadAndChange(t *testing.T) {
	h := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)))
	r, _ := h.Create("terre", false)
	var wg sync.WaitGroup
	wg.Add(2)
	go func() {
		defer wg.Done()
		for range 2000 {
			_ = r.Game()
		}
	}()
	go func() {
		defer wg.Done()
		for range 2000 {
			r.mu.Lock()
			r.spec.ID = "meche"
			r.mu.Unlock()
		}
	}()
	wg.Wait()
}

func TestSavedOccupancyTracksLastConnection(t *testing.T) {
	h := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)))
	states := make(chan []byte, 4)
	h.Save = func(_ string, raw []byte) { states <- raw }
	r, _ := h.Create("terre", false)
	c, _ := r.Join(Who{ID: "player", Name: "Player"})
	want := func(occupied bool) {
		t.Helper()
		select {
		case raw := <-states:
			var sv saved
			if err := json.Unmarshal(raw, &sv); err != nil || sv.Occupied != occupied {
				t.Fatalf("saved occupancy = %s, want %v", raw, occupied)
			}
		case <-time.After(time.Second):
			t.Fatal("room was not persisted")
		}
	}
	want(true)
	c.Close()
	want(false)
}
