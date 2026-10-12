package server

import (
	"context"
	"errors"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/bingops-com/games/internal/store"
)

func TestStalePasswordCheckCannotChangeRecoveryCredentials(t *testing.T) {
	st := testStore(t)
	ctx := context.Background()
	u, err := st.CreateUser(ctx, "CredentialRace", "old-hash", "race@example.invalid")
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
	if err := st.SetEmail(ctx, u.ID, "attacker@example.invalid", "old-hash"); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("stale recovery email change accepted: %v", err)
	}
	fresh, err := st.User(ctx, u.ID)
	if err != nil || fresh.Email != u.Email {
		t.Fatalf("recovery address changed: %v, %v", fresh, err)
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

func TestResetLinksRemainValidUntilOneIsConsumed(t *testing.T) {
	_, st := start(t)
	u, err := st.CreateUser(context.Background(), "Recovery", dummyHash, "recovery@example.invalid")
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	if err := st.CreateCheck(ctx, u.ID, u.Email, "confirmation", time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := st.ConfirmEmail(ctx, "confirmation"); err != nil {
		t.Fatal(err)
	}
	for _, key := range []string{"first", "second"} {
		if err := st.CreateReset(ctx, u.ID, u.Email, key, time.Now().Add(time.Hour)); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := st.ResetUser(ctx, "first"); err != nil {
		t.Fatal("anonymous reissue invalidated an existing reset link:", err)
	}
	if _, err := st.ResetPassword(ctx, "first", dummyHash); err != nil {
		t.Fatal(err)
	}
	if _, err := st.ResetPassword(ctx, "second", dummyHash); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("successful recovery did not invalidate sibling links:", err)
	}
}

func TestRecoveryMailCooldownAcrossAliasesAndAddresses(t *testing.T) {
	st := testStore(t)
	box := &outbox{}
	ts := startOn(t, st, box)
	c := player(t, ts, "MailOwner")
	box.wait(t, 1)
	u := auditConfirmed(t, st, "MailOwner")
	server := ts.Config.Handler.(*Server)
	c.want(200, "POST", "/api/forgot", `{"name":"MailOwner"}`)
	box.wait(t, 2)
	for i, name := range []string{u.Email, strings.ToUpper(u.Name), u.Email} {
		req, _ := http.NewRequest("POST", ts.URL+"/api/forgot", strings.NewReader(`{"name":"`+name+`"}`))
		req.Header.Set("X-Forwarded-For", []string{"192.0.2.2", "192.0.2.3", "192.0.2.4"}[i])
		// Holding the limiter lock lets the test wait for the asynchronous lookup
		// to reach the cooldown before asserting the mailbox stays unchanged.
		server.recoveryLimit.mu.Lock()
		before := server.recoveryLimit.buckets[u.ID].seen
		res, err := http.DefaultClient.Do(req)
		server.recoveryLimit.mu.Unlock()
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 200 {
			t.Fatal("cooldown disclosed whether the account exists")
		}
		deadline := time.Now().Add(time.Second)
		for {
			server.recoveryLimit.mu.Lock()
			seen := server.recoveryLimit.buckets[u.ID].seen
			server.recoveryLimit.mu.Unlock()
			if seen.After(before) {
				break
			}
			if time.Now().After(deadline) {
				t.Fatal("asynchronous recovery did not reach the cooldown")
			}
			time.Sleep(time.Millisecond)
		}
	}
	box.mu.Lock()
	defer box.mu.Unlock()
	if len(box.sent) != 2 {
		t.Fatalf("recovery aliases bypassed the mail cooldown: %d messages", len(box.sent))
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
