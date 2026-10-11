package server

import (
	"context"
	"io"
	"log/slog"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/bingops-com/games/internal/store"
)

// outbox keeps the mail the server sends instead of sending it.
type outbox struct {
	mu   sync.Mutex
	sent []string
}

func (o *outbox) Send(_ context.Context, to, subject, text string) error {
	o.mu.Lock()
	defer o.mu.Unlock()
	o.sent = append(o.sent, to+"\n"+text)
	return nil
}

func (o *outbox) wait(t *testing.T, n int) []string {
	t.Helper()
	for range 100 {
		o.mu.Lock()
		got := append([]string{}, o.sent...)
		o.mu.Unlock()
		if len(got) >= n {
			return got
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatalf("%d messages sent, want %d", len(o.sent), n)
	return nil
}

func startOn(t *testing.T, st *store.Store, box *outbox) *httptest.Server {
	t.Helper()
	srv, err := New(st, fstest.MapFS{"index.html": {Data: []byte("x")}, "404.html": {Data: []byte("x")}},
		Config{TrustProxy: true, Log: slog.New(slog.NewTextHandler(io.Discard, nil)), Mail: box, PublicURL: "https://games.example"})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(srv)
	t.Cleanup(ts.Close)
	return ts
}

func TestAccountRecovery(t *testing.T) {
	box := &outbox{}
	ts := startOn(t, testStore(t), box)
	c := player(t, ts, "Bing")
	guest := player(t, ts, "")

	// Each account is mailed a link to confirm the address it gave.
	linkIn := func(mail []string, to, path string) string {
		t.Helper()
		for i := len(mail) - 1; i >= 0; i-- {
			if j := strings.Index(mail[i], "https://games.example"+path+"?t="); j >= 0 && strings.HasPrefix(mail[i], to+"\n") {
				return strings.Fields(mail[i][j+len("https://games.example"+path+"?t="):])[0]
			}
		}
		t.Fatalf("no %s link sent to %s in %d messages", path, to, len(mail))
		return ""
	}
	if got := c.want(200, "GET", "/api/me", "")["user"].(map[string]any)["emailChecked"]; got != false {
		t.Fatalf("a new address is confirmed: %v", got)
	}

	// An address is changed with the password, to a valid one, and never removed.
	c.want(403, "POST", "/api/account/email", `{"email":"bing@example.org","password":"wrong"}`)
	c.want(400, "POST", "/api/account/email", `{"email":"not an address","password":"long enough"}`)
	c.want(400, "POST", "/api/account/email", `{"email":"","password":"long enough"}`)
	c.want(200, "POST", "/api/account/email", `{"email":"bing@example.org","password":"long enough"}`)
	if got := c.want(200, "GET", "/api/me", "")["user"].(map[string]any)["email"]; got != "bing@example.org" {
		t.Fatalf("email = %v", got)
	}
	ana := player(t, ts, "Ana")
	ana.want(409, "POST", "/api/account/email", `{"email":"BING@example.org","password":"long enough"}`)
	// Three links so far: Bing's first address, his second one, Ana's.
	sent := len(box.wait(t, 3))

	// Asking for a link answers the same for an account, an unknown pseudo and
	// an account whose address is not confirmed; nothing is sent before Bing
	// opens the link sent to his address.
	guest.want(200, "POST", "/api/forgot", `{"name":"Nobody"}`)
	guest.want(200, "POST", "/api/forgot", `{"name":"Ana"}`)
	guest.want(200, "POST", "/api/forgot", `{"name":"bing"}`)
	time.Sleep(150 * time.Millisecond)
	if n := len(box.wait(t, sent)); n != sent {
		t.Fatalf("%d messages sent to addresses nobody confirmed", n-sent)
	}
	guest.want(410, "POST", "/api/confirm", `{"token":"`+strings.Repeat("0", 64)+`"}`)
	guest.want(200, "POST", "/api/confirm", `{"token":"`+linkIn(box.wait(t, sent), "bing@example.org", "/confirmer/")+`"}`)
	if got := c.want(200, "GET", "/api/me", "")["user"].(map[string]any)["emailChecked"]; got != true {
		t.Fatalf("after the link: emailChecked = %v", got)
	}
	c.want(400, "POST", "/api/account/email/check", "")
	ana.want(200, "POST", "/api/account/email/check", "")
	sent = len(box.wait(t, sent+1))
	guest.want(200, "POST", "/api/forgot", `{"name":"Ana"}`)
	guest.want(200, "POST", "/api/forgot", `{"name":"bing"}`)
	mail := box.wait(t, sent+1)
	time.Sleep(100 * time.Millisecond)
	if n := len(box.wait(t, sent+1)); n != sent+1 {
		t.Fatalf("%d messages for one account with a confirmed address", n-sent)
	}
	mail = mail[len(mail)-1:]
	if !strings.HasPrefix(mail[0], "bing@example.org\n") {
		t.Fatalf("sent to %q", mail[0][:30])
	}
	i := strings.Index(mail[0], "https://games.example/reinitialiser/?t=")
	if i < 0 {
		t.Fatalf("no link in %q", mail[0])
	}
	token := strings.Fields(mail[0][i+len("https://games.example/reinitialiser/?t="):])[0]

	// The link sets a new password once, signs in, and closes the old sessions.
	guest.want(410, "POST", "/api/reset", `{"token":"`+strings.Repeat("0", 64)+`","password":"brand new one"}`)
	guest.want(400, "POST", "/api/reset", `{"token":"`+token+`","password":"short"}`)
	guest.want(200, "POST", "/api/reset", `{"token":"`+token+`","password":"brand new one"}`)
	if !guest.signedIn() {
		t.Fatal("the link did not sign in")
	}
	if c.signedIn() {
		t.Fatal("the old session survived a reset")
	}
	guest.want(410, "POST", "/api/reset", `{"token":"`+token+`","password":"another one!"}`)
	player(t, ts, "").want(401, "POST", "/api/login", `{"name":"Bing","password":"long enough"}`)
	player(t, ts, "").want(200, "POST", "/api/login", `{"name":"Bing","password":"brand new one"}`)

	// Changing the password takes the current one.
	guest.want(403, "POST", "/api/account/password", `{"old":"long enough","new":"yet another one"}`)
	guest.want(200, "POST", "/api/account/password", `{"old":"brand new one","new":"yet another one"}`)
	if !guest.signedIn() {
		t.Fatal("changing the password closed the session that did it")
	}
}

func TestDailyCap(t *testing.T) {
	ts, st := start(t)
	ctx := context.Background()
	c := player(t, ts, "Bing")
	u, _ := st.UserByName(ctx, "Bing")
	games := store.CreditsPerDay/(store.CreditsPlayed+store.CreditsWon) + 5
	for range games {
		if err := st.RecordGame(ctx, u.ID, "terre", true); err != nil {
			t.Fatal(err)
		}
	}
	user := c.want(200, "GET", "/api/me", "")["user"].(map[string]any)
	if user["credits"] != float64(store.CreditsPerDay) || user["earnedToday"] != float64(store.CreditsPerDay) || user["dailyCap"] != float64(store.CreditsPerDay) {
		t.Fatalf("after %d wins: credits %v, earned today %v, cap %v", games, user["credits"], user["earnedToday"], user["dailyCap"])
	}
	// The games still count, whatever they paid.
	if o := user["objectives"].([]any)[0].(map[string]any); o["done"] != true {
		t.Fatalf("objective = %v", o)
	}
}

func TestRoomLife(t *testing.T) {
	st := testStore(t)
	ts := startOn(t, st, &outbox{})
	bing, guest := player(t, ts, "Bing"), player(t, ts, "")
	code := bing.want(200, "POST", "/api/tables", `{"game":"meche","public":true}`)["code"].(string)
	nextB, sendB := bing.seat(code, "")
	nextG, sendG := guest.seat(code, "mousse-0123456789abcdef")
	var guestID string
	until(t, nextG, func(s map[string]any) bool {
		if s["t"] == "state" {
			guestID = s["you"].(string)
		}
		return s["t"] == "state"
	})
	lobby := until(t, nextB, func(s map[string]any) bool { return s["t"] == "state" && len(s["members"].([]any)) == 2 })
	if lobby["public"] != true {
		t.Fatalf("public = %v", lobby["public"])
	}

	// A public room waiting for players is listed; a private one is not.
	rooms := guest.want(200, "GET", "/api/rooms", "")["rooms"].([]any)
	if len(rooms) != 1 || rooms[0].(map[string]any)["code"] != code || rooms[0].(map[string]any)["players"] != float64(2) {
		t.Fatalf("rooms = %v", rooms)
	}
	// The host limits the room to the two players it has: it is full, and no
	// longer listed. With room for five it is back, and says so.
	sendB(`{"t":"limit","a":2}`)
	until(t, nextB, func(s map[string]any) bool { return s["t"] == "state" && s["limit"] == float64(2) })
	if rooms := guest.want(200, "GET", "/api/rooms", "")["rooms"].([]any); len(rooms) != 0 {
		t.Fatalf("a full room is listed: %v", rooms)
	}
	sendB(`{"t":"limit","a":5}`)
	until(t, nextB, func(s map[string]any) bool { return s["t"] == "state" && s["limit"] == float64(5) })
	if rooms := guest.want(200, "GET", "/api/rooms", "")["rooms"].([]any); len(rooms) != 1 || rooms[0].(map[string]any)["max"] != float64(5) {
		t.Fatalf("rooms with a limit of five = %v", rooms)
	}
	sendG(`{"t":"public","a":false}`)
	until(t, nextG, func(s map[string]any) bool { return s["t"] == "error" })
	sendB(`{"t":"public","a":false}`)
	until(t, nextB, func(s map[string]any) bool { return s["t"] == "state" && s["public"] == false })
	if rooms := guest.want(200, "GET", "/api/rooms", "")["rooms"].([]any); len(rooms) != 0 {
		t.Fatalf("a private room is listed: %v", rooms)
	}

	// Conversation reaches everyone, with rude words masked.
	sendG(`{"t":"chat","a":"salut  bande de connards"}`)
	line := until(t, nextB, func(s map[string]any) bool { return s["t"] == "chat" })["m"].(map[string]any)
	if line["text"] != "salut bande de ********" || line["from"] != guestID {
		t.Fatalf("chat line = %v", line)
	}

	// The host's settings: within bounds, and only the host's.
	sendG(`{"t":"opt","id":"lives","a":5}`)
	until(t, nextG, func(s map[string]any) bool { return s["t"] == "error" })
	sendB(`{"t":"opt","id":"lives","a":99}`)
	set := until(t, nextB, func(s map[string]any) bool {
		return s["t"] == "state" && len(s["options"].([]any)) == 1 && s["options"].([]any)[0].(map[string]any)["value"] == float64(5)
	})
	if o := set["options"].([]any)[0].(map[string]any); o["key"] != "lives" || o["max"] != float64(5) {
		t.Fatalf("option = %v", o)
	}

	// The host hands the room over.
	sendB(`{"t":"host","id":"` + guestID + `"}`)
	until(t, nextB, func(s map[string]any) bool { return s["t"] == "state" && s["host"] == guestID })

	// A report keeps what the reported player said.
	bing.want(400, "POST", "/api/report", `{"room":"`+code+`","target":"`+guestID+`","reason":"parce que"}`)
	bing.want(200, "POST", "/api/report", `{"room":"`+code+`","target":"`+guestID+`","reason":"insultes","text":"pas sympa"}`)

	// A restart: the room comes back in its lobby, with its players, its host
	// and its settings, and the page reconnects to it.
	time.Sleep(200 * time.Millisecond)
	ts2 := startOn(t, st, &outbox{})
	bing2 := &client{t: t, http: bing.http, base: ts2.URL}
	bing2.want(200, "GET", "/api/tables/"+code, "")
	// The session cookie belongs to the first address: sign in again on the second.
	back := player(t, ts2, "")
	back.want(200, "POST", "/api/login", `{"name":"Bing","password":"long enough"}`)
	nextR, _ := back.seat(code, "")
	again := until(t, nextR, func(s map[string]any) bool { return s["t"] == "state" })
	if again["phase"] != "lobby" || again["game"] != "meche" || again["host"] != guestID || len(again["members"].([]any)) != 2 {
		t.Fatalf("after a restart: %v", again)
	}
	if o := again["options"].([]any)[0].(map[string]any); o["value"] != float64(5) {
		t.Fatalf("settings after a restart: %v", o)
	}
}

func TestBlocksAndNames(t *testing.T) {
	ts, _ := start(t)
	bing, ana := player(t, ts, "Bing"), player(t, ts, "Ana")
	bing.want(200, "POST", "/api/friends/invite", `{"name":"Ana"}`)
	ana.want(200, "POST", "/api/friends/accept", `{"name":"Bing"}`)

	// Blocking ends the friendship and stops invitations both ways.
	out := bing.want(200, "POST", "/api/blocks/add", `{"name":"Ana"}`)
	if b := out["blocked"].([]any); len(b) != 1 || b[0] != "Ana" {
		t.Fatalf("blocked = %v", out)
	}
	if f := bing.want(200, "GET", "/api/friends", "")["friends"].([]any); len(f) != 0 {
		t.Fatalf("still friends: %v", f)
	}
	ana.want(403, "POST", "/api/friends/invite", `{"name":"Bing"}`)
	bing.want(403, "POST", "/api/friends/invite", `{"name":"Ana"}`)
	bing.want(200, "POST", "/api/blocks/remove", `{"name":"Ana"}`)
	ana.want(200, "POST", "/api/friends/invite", `{"name":"Bing"}`)

	// A rude pseudo is refused, however it is dressed.
	player(t, ts, "").want(400, "POST", "/api/register", `{"name":"Sal0pe_42","password":"long enough","email":"rude@example.org"}`)
	for word, want := range map[string]bool{"Enculé": true, "c0nnard": true, "pute": true, "dispute": false, "analyse": false, "bonjour": false} {
		if got := isFoul(word); got != want {
			t.Errorf("isFoul(%q) = %v", word, got)
		}
	}
	if foulName("Poulpe-Tenace") || !foulName("xXconnardXx") {
		t.Error("foulName misjudges a name")
	}
}
