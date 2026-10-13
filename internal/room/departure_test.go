package room

import (
	"io"
	"log/slog"
	"testing"
	"time"
)

func departureRoom(t *testing.T) (*Room, []*Client) {
	t.Helper()
	h := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)))
	r, err := h.Create("poudriere", false)
	if err != nil {
		t.Fatal(err)
	}
	var clients []*Client
	for _, id := range []string{"host", "guest", "third"} {
		c, err := r.Join(Who{ID: id, Name: id})
		if err != nil {
			t.Fatal(err)
		}
		clients = append(clients, c)
	}
	r.mu.Lock()
	err = r.handle(clients[0], message{T: "start"})
	r.mu.Unlock()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		r.mu.Lock()
		r.halt()
		r.mu.Unlock()
		for _, c := range clients {
			c.Close()
		}
	})
	return r, clients
}

func TestIntentionalDepartureDropsSeatAndHandsOverHost(t *testing.T) {
	r, cs := departureRoom(t)
	cs[0].Depart()
	cs[0].Depart()
	cs[0].Close()
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.member("host") != nil || !r.gone[0] || len(r.members) != 2 || r.members[0].ID != "guest" {
		t.Fatal("departed host kept their seat or host ownership")
	}
	if r.phase != "playing" {
		t.Fatal("remaining players cannot continue")
	}
}

func TestNetworkLossRetainsSeatForReconnect(t *testing.T) {
	r, cs := departureRoom(t)
	cs[1].Close()
	r.mu.Lock()
	m := r.member("guest")
	retained := m != nil && m.conns == 0 && !r.gone[m.seat] && time.Since(m.left) < time.Second
	r.mu.Unlock()
	if !retained {
		t.Fatal("network loss immediately removed the player")
	}
	back, err := r.Join(Who{ID: "guest", Name: "guest"})
	if err != nil {
		t.Fatal(err)
	}
	defer back.Close()
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.member("guest").seat != 1 || r.member("guest").conns != 1 {
		t.Fatal("reconnection lost the original seat")
	}
}

func TestDepartureKeepsAnotherTabAndCannotRemoveOtherPlayer(t *testing.T) {
	r, cs := departureRoom(t)
	other, err := r.Join(Who{ID: "guest", Name: "guest"})
	if err != nil {
		t.Fatal(err)
	}
	defer other.Close()
	cs[1].Handle([]byte(`{"t":"depart","id":"host"}`))
	r.mu.Lock()
	kept := r.member("guest") != nil && r.member("guest").conns == 1 && !r.gone[1] && r.members[0].ID == "host"
	r.mu.Unlock()
	if !kept {
		t.Fatal("one tab departure removed another connection or another identity")
	}
	other.Depart()
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.member("guest") != nil || !r.gone[1] {
		t.Fatal("last tab departure kept a ghost player")
	}
}
