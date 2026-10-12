package server

import (
	"context"
	"errors"
	"io"
	"net/http"
	"testing"
	"time"

	"github.com/bingops-com/games/internal/store"
)

func TestStalePasswordCheckCannotChangeRecoveryCredentials(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	u, err := st.CreateUser(ctx, "CredentialRace", "old-hash", nil)
	if err != nil {
		t.Fatal(err)
	}
	// Simulate a reset finishing after another request verified the old hash.
	if err := st.SetPassword(ctx, u.ID, "reset-hash", "", "old-hash"); err != nil {
		t.Fatal(err)
	}
	if err := st.SetPassword(ctx, u.ID, "attacker-hash", "", "old-hash"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("stale password change accepted: %v", err)
	}
	_, hashes, err := newRecoveryCodes()
	if err != nil {
		t.Fatal(err)
	}
	if err := st.SetRecoveryCodes(ctx, u.ID, "old-hash", "", hashes); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("stale recovery credential change accepted: %v", err)
	}
	fresh, err := st.User(ctx, u.ID)
	if err != nil || fresh.RecoveryCodesRemaining != 0 {
		t.Fatal("stale rotation installed codes")
	}

}

func TestRoomRestorationKeepsOccupiedRooms(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	for code, raw := range map[string]string{
		"ABCDEFGH": `{"game":"terre","occupied":true,"members":[]}`,
		"BCDEFGHJ": `{"game":"terre","occupied":false,"members":[]}`,
		"CDEFGHJK": `{"game":"terre","members":[]}`,
	} {
		if err := st.SaveRoom(ctx, code, []byte(raw)); err != nil {
			t.Fatal(err)
		}
	}
	// Move the expiry boundary past the save time, without sleeping ten minutes.
	rooms, err := st.Rooms(ctx, time.Now().Add(time.Minute))
	if err != nil || len(rooms) != 1 || rooms["ABCDEFGH"] == nil {
		t.Fatalf("occupied room lost or expired empty room retained: %v, %v", rooms, err)
	}
}

func TestLivenessSurvivesDatabaseOutage(t *testing.T) {
	ts, st := start(t)
	st.Close()
	for path, want := range map[string]int{"/livez": 200, "/healthz": 503} {
		res, err := http.Get(ts.URL + path)
		if err != nil {
			t.Fatal(err)
		}
		io.Copy(io.Discard, res.Body)
		res.Body.Close()
		if res.StatusCode != want {
			t.Fatalf("%s returned %d, want %d", path, res.StatusCode, want)
		}
	}
}
