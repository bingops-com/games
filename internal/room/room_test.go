package room

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"
)

func TestNomDeCodeOnlyCurrentHostBegins(t *testing.T) {
	for _, transfer := range []bool{false, true} {
		t.Run(fmt.Sprintf("transfer=%t", transfer), func(t *testing.T) {
			hub := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)))
			r, err := hub.Create("pavillons", false)
			if err != nil {
				t.Fatal(err)
			}
			clients := make([]*Client, 4)
			for i := range clients {
				clients[i], err = r.Join(Who{ID: fmt.Sprintf("test-%d", i), Name: fmt.Sprintf("Test%d", i)})
				if err != nil {
					t.Fatal(err)
				}
			}
			t.Cleanup(func() {
				r.mu.Lock()
				r.halt()
				r.mu.Unlock()
				for _, c := range clients {
					c.Close()
				}
			})
			handle := func(c *Client, msg message) error {
				r.mu.Lock()
				defer r.mu.Unlock()
				return r.handle(c, msg)
			}
			phase := func() string {
				r.mu.Lock()
				defer r.mu.Unlock()
				raw, err := json.Marshal(r.game.View(0, time.Now()))
				if err != nil {
					t.Fatal(err)
				}
				var view struct{ Phase string }
				if err := json.Unmarshal(raw, &view); err != nil {
					t.Fatal(err)
				}
				return view.Phase
			}
			if err := handle(clients[1], message{T: "start"}); err != Error("Seul l'hôte lance la partie") {
				t.Fatalf("guest starts the room: %v", err)
			}
			if err := handle(clients[0], message{T: "start"}); err != nil {
				t.Fatal(err)
			}
			begin := message{T: "act", A: json.RawMessage(`{"t":"begin"}`)}
			if err := handle(clients[1], begin); err != Error("Seul l'hôte lance la partie") || phase() != "teams" {
				t.Fatalf("guest begins the grid: %v", err)
			}
			// Role choices remain open to every player, and readiness still applies.
			if err := handle(clients[2], message{T: "act", A: json.RawMessage(`{"t":"team","team":0,"guide":true}`)}); err != nil {
				t.Fatal(err)
			}
			if err := handle(clients[0], begin); err == nil || phase() != "teams" {
				t.Fatal("host began with two clue givers in one team")
			}
			if err := handle(clients[2], message{T: "act", A: json.RawMessage(`{"t":"team","team":0,"guide":false}`)}); err != nil {
				t.Fatal(err)
			}
			host := clients[0]
			if transfer {
				if err := handle(host, message{T: "host", ID: clients[2].id}); err != nil {
					t.Fatal(err)
				}
				if err := handle(host, begin); err != Error("Seul l'hôte lance la partie") || phase() != "teams" {
					t.Fatalf("former host begins after handover: %v", err)
				}
				host = clients[2] // A guesser, not seat zero or a clue giver.
			}
			if err := handle(host, begin); err != nil || phase() != "play" {
				t.Fatalf("current host could not begin: %v", err)
			}
		})
	}
}

func TestSecurityRoomCodesAndConnections(t *testing.T) {
	hub := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)))
	r, err := hub.Create("terre", false)
	if err != nil {
		t.Fatal(err)
	}
	if len(r.Code) != 8 {
		t.Fatal("short invitation code")
	}
	for _, c := range r.Code {
		if !strings.ContainsRune(codeLetters, c) {
			t.Fatal("invalid code alphabet")
		}
	}
	var clients []*Client
	defer func() {
		for _, c := range clients {
			c.Close()
		}
	}()
	for range 3 {
		c, err := r.Join(Who{ID: "synthetic", Name: "Audit"})
		if err != nil {
			t.Fatal(err)
		}
		clients = append(clients, c)
	}
	if _, err := r.Join(Who{ID: "synthetic", Name: "Audit"}); err == nil {
		t.Fatal("duplicate connections bypassed room cap")
	}
	clients[0].Close()
	if c, err := r.Join(Who{ID: "synthetic", Name: "Audit"}); err != nil {
		t.Fatal("room connection slot not released")
	} else {
		clients = append(clients, c)
	}
	old := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)))
	old.Restore("ABCD", []byte(`{"game":"terre"}`))
	if old.Get("ABCD") != nil {
		t.Fatal("weak legacy room code was restored")
	}
}

func TestSecurityRevokedQueuedAction(t *testing.T) {
	hub := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)))
	r, err := hub.Create("terre", false)
	if err != nil {
		t.Fatal(err)
	}
	c, err := r.Join(Who{ID: "host", Name: "Audit"})
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	ctx, cancel := context.WithCancel(context.Background())
	done := make(chan struct{})
	r.mu.Lock()
	go func() { c.HandleContext(ctx, []byte(`{"t":"game","id":"poudriere"}`)); close(done) }()
	cancel()
	r.mu.Unlock()
	<-done
	if r.Game() != "terre" {
		t.Fatal("revoked queued action changed the room")
	}
	if _, err := r.JoinContext(ctx, Who{ID: "revoked", Name: "Audit"}); err == nil {
		t.Fatal("revoked queued join was accepted")
	}
}
