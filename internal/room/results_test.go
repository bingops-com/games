package room

import (
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"slices"
	"testing"
	"time"
)

func TestWinnerNamesSurviveLeavingAndResetForNextGame(t *testing.T) {
	hub := NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)))
	r, err := hub.Create("pavillons", false)
	if err != nil {
		t.Fatal(err)
	}
	clients := make([]*Client, 4)
	for i := range clients {
		clients[i], err = r.Join(Who{ID: fmt.Sprintf("result-%d", i), Name: fmt.Sprintf("Result%d", i)})
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
	r.mu.Lock()
	defer r.mu.Unlock()
	send := func(seat int, msg message) {
		t.Helper()
		if err := r.handle(clients[seat], msg); err != nil {
			t.Fatal(err)
		}
	}
	send(0, message{T: "start"})
	send(0, message{T: "act", A: json.RawMessage(`{"t":"begin"}`)})
	raw, _ := json.Marshal(r.game.View(0, time.Now()))
	var view struct {
		Turn int
		Key  []int
	}
	if err := json.Unmarshal(raw, &view); err != nil {
		t.Fatal(err)
	}
	send(view.Turn, message{T: "act", A: json.RawMessage(`{"t":"clue","word":"A","n":1}`)})
	send(view.Turn+2, message{T: "act", A: json.RawMessage(fmt.Sprintf(`{"t":"guess","i":%d}`, slices.Index(view.Key, 3)))})
	winner := 1 - view.Turn
	want := []string{fmt.Sprintf("Result%d", winner), fmt.Sprintf("Result%d", winner+2)}
	if r.phase != "over" || !slices.Equal(r.winnerNames, want) {
		t.Fatalf("winner names not captured: %v", r.winnerNames)
	}
	send(winner+2, message{T: "leave"})
	if len(r.members) != 3 || !slices.Equal(r.winnerNames, want) {
		t.Fatal("a winner leaving erased their name from the result")
	}
	r.toLobby()
	if len(r.winnerNames) != 0 || len(r.winners) != 0 {
		t.Fatal("the next lobby retains the previous result")
	}
}
