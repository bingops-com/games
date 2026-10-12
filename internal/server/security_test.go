package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bingops-com/games/internal/store"
	"github.com/coder/websocket"
)

func auditSocket(t *testing.T, c *client, code string) *websocket.Conn {
	t.Helper()
	conn, _, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(c.base, "http")+"/api/ws?code="+code, &websocket.DialOptions{HTTPClient: c.http})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { conn.CloseNow() })
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	for {
		_, raw, err := conn.Read(ctx)
		if err != nil {
			t.Fatal(err)
		}
		var m struct{ T string }
		if json.Unmarshal(raw, &m) == nil && m.T == "state" {
			return conn
		}
	}
}

func auditSocketClosed(t *testing.T, conn *websocket.Conn) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	for {
		_, _, err := conn.Read(ctx)
		if err != nil {
			if errors.Is(err, context.DeadlineExceeded) {
				t.Fatal("revoked socket stayed open")
			}
			return
		}
	}
}

func auditConfirmed(t *testing.T, st *store.Store, name string) *store.User {
	t.Helper()
	u, err := st.UserByName(context.Background(), name)
	if err != nil {
		t.Fatal(err)
	}
	key := tokenHash("synthetic confirmation for " + name)
	if err := st.CreateCheck(context.Background(), u.ID, u.Email, key, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if _, err := st.ConfirmEmail(context.Background(), key); err != nil {
		t.Fatal(err)
	}
	return u
}

func TestSecurityStalePasswordCannotCreateSession(t *testing.T) {
	ts, st := start(t)
	owner := player(t, ts, "PasswordRace")
	ctx := context.Background()
	id, oldHash, err := st.Credentials(ctx, "PasswordRace")
	if err != nil {
		t.Fatal(err)
	}
	owner.want(200, "POST", "/api/account/password", `{"old":"long enough","new":"changed password"}`)
	if err := st.CreateSessionForPassword(ctx, id, tokenHash("stale synthetic session"), oldHash, time.Now().Add(time.Hour)); !errors.Is(err, store.ErrNotFound) {
		t.Fatalf("stale password check created a new session: %v", err)
	}
	guest := player(t, ts, "")
	guest.want(401, "POST", "/api/login", `{"name":"PasswordRace","password":"long enough"}`)
	guest.want(200, "POST", "/api/login", `{"name":"PasswordRace","password":"changed password"}`)
}

func TestSecuritySessionSocketsRevoked(t *testing.T) {
	for _, operation := range []string{"logout", "password", "reset", "expiry"} {
		t.Run(operation, func(t *testing.T) {
			ts, st := start(t)
			old := player(t, ts, "SocketOwner")
			code := old.want(200, "POST", "/api/tables", `{"game":"terre"}`)["code"].(string)
			if operation == "expiry" {
				u, err := st.UserByName(context.Background(), "SocketOwner")
				if err != nil {
					t.Fatal(err)
				}
				raw := strings.Repeat("e", 64)
				if err := st.CreateSession(context.Background(), u.ID, tokenHash(raw), time.Now().Add(400*time.Millisecond)); err != nil {
					t.Fatal(err)
				}
				base, _ := url.Parse(ts.URL)
				old.http.Jar.SetCookies(base, []*http.Cookie{{Name: cookieName, Value: raw, Path: "/"}})
			}
			stale := auditSocket(t, old, code)
			switch operation {
			case "logout":
				second := auditSocket(t, old, code)
				old.want(200, "POST", "/api/logout", "")
				auditSocketClosed(t, second)
			case "password":
				owner := player(t, ts, "")
				owner.want(200, "POST", "/api/login", `{"name":"SocketOwner","password":"long enough"}`)
				kept := auditSocket(t, owner, code)
				owner.want(200, "POST", "/api/account/password", `{"old":"long enough","new":"different password"}`)
				ctx, done := context.WithTimeout(context.Background(), 2*time.Second)
				defer done()
				if err := kept.Write(ctx, websocket.MessageText, []byte(`{"t":"game","id":"poudriere"}`)); err != nil {
					t.Fatal("current session was revoked:", err)
				}
				for {
					_, raw, err := kept.Read(ctx)
					if err != nil {
						t.Fatal("current session no longer receives states:", err)
					}
					var m struct{ T, Game string }
					json.Unmarshal(raw, &m)
					if m.T == "state" && m.Game == "poudriere" {
						break
					}
				}
			case "reset":
				u := auditConfirmed(t, st, "SocketOwner")
				raw := strings.Repeat("a", 64)
				if err := st.CreateReset(context.Background(), u.ID, u.Email, tokenHash(raw), time.Now().Add(time.Hour)); err != nil {
					t.Fatal(err)
				}
				guest := player(t, ts, "")
				guest.want(200, "POST", "/api/reset", fmt.Sprintf(`{"token":%q,"password":"recovered password"}`, raw))
			}
			auditSocketClosed(t, stale)
			if old.signedIn() {
				t.Fatal("revoked HTTP session remains valid")
			}
		})
	}
}

func TestSecurityResetSingleUseAndAddressChanges(t *testing.T) {
	ts, st := start(t)
	owner := player(t, ts, "RecoveryOwner")
	u := auditConfirmed(t, st, "RecoveryOwner")
	ctx := context.Background()
	raw := strings.Repeat("b", 64)
	key := tokenHash(raw)
	if err := st.CreateReset(ctx, u.ID, u.Email, key, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	// Both HTTP requests pass the cheap lookup before hashing is released.
	for range cap(hashing) {
		hashing <- struct{}{}
	}
	release := sync.OnceFunc(func() {
		for range cap(hashing) {
			<-hashing
		}
	})
	defer release()
	statuses := make(chan int, 2)
	for i := range 2 {
		go func(i int) {
			res, err := http.Post(ts.URL+"/api/reset", "application/json", strings.NewReader(fmt.Sprintf(`{"token":%q,"password":"synthetic password %d"}`, raw, i)))
			if err != nil {
				statuses <- 0
				return
			}
			res.Body.Close()
			statuses <- res.StatusCode
		}(i)
	}
	time.Sleep(100 * time.Millisecond)
	release()
	a, b := <-statuses, <-statuses
	if !((a == 200 && b == 410) || (a == 410 && b == 200)) {
		t.Fatalf("single-use reset statuses: %d, %d", a, b)
	}
	if owner.signedIn() {
		t.Fatal("reset did not revoke the old session")
	}
	if err := st.CreateReset(ctx, u.ID, u.Email, key, time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	_, currentHash, err := st.Credentials(ctx, u.Name)
	if err != nil {
		t.Fatal(err)
	}
	if err := st.SetEmail(ctx, u.ID, "new@audit.invalid", currentHash); err != nil {
		t.Fatal(err)
	}
	if _, err := st.ResetPassword(ctx, key, dummyHash); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("old-address link still accepted:", err)
	}
	if err := st.CreateReset(ctx, u.ID, u.Email, key, time.Now().Add(time.Hour)); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("stale asynchronous email request created a reset:", err)
	}
	if err := st.CreateCheck(ctx, u.ID, u.Email, key, time.Now().Add(time.Hour)); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("stale asynchronous email request created a confirmation:", err)
	}
}

func TestSecurityProductionConfig(t *testing.T) {
	box := &outbox{}
	for _, tc := range []struct {
		name  string
		cfg   Config
		valid bool
	}{
		{"local without mail", Config{}, true},
		{"missing production values", Config{Production: true}, false},
		{"missing mail", Config{Production: true, PublicURL: "https://games.audit.invalid"}, false},
		{"missing origin", Config{Mail: box}, false},
		{"HTTP production", Config{Production: true, Mail: box, PublicURL: "http://games.audit.invalid"}, false},
		{"credentials in origin", Config{Mail: box, PublicURL: "https://fake:fake@games.audit.invalid"}, false},
		{"query in origin", Config{Mail: box, PublicURL: "https://games.audit.invalid/?host=evil"}, false},
		{"path in origin", Config{Mail: box, PublicURL: "https://games.audit.invalid/path"}, false},
		{"valid production", Config{Production: true, Mail: box, PublicURL: "https://games.audit.invalid/"}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.cfg.Validate(); (err == nil) != tc.valid {
				t.Fatalf("validation=%v, want valid=%v", err, tc.valid)
			}
		})
	}
	s := &Server{cfg: Config{PublicURL: "https://games.audit.invalid/"}}
	r := httptest.NewRequest("POST", "http://recovery.attacker.invalid/api/forgot", nil)
	r.Header.Set("X-Forwarded-Host", "recovery.attacker.invalid")
	if got := s.baseURL(r); got != "https://games.audit.invalid" {
		t.Fatal("request controlled recovery origin:", got)
	}
	if got := (&Server{}).baseURL(r); got != "" {
		t.Fatal("unset origin fell back to request:", got)
	}
	r.Header.Set("X-Forwarded-Proto", "http")
	if !(&Server{cfg: Config{Production: true, TrustProxy: true}}).secure(r) {
		t.Fatal("production cookie security was downgraded by proxy headers")
	}
	if !(&Server{cfg: Config{Production: true}}).secure(r) {
		t.Fatal("production requires Secure cookies even without proxy detection")
	}
}

func TestSecurityConnectionAccounting(t *testing.T) {
	var sockets liveSockets
	var leases []*socketLease
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	for range maxSocketsPerIdentity {
		l, ok := sockets.acquire("ip", "one", "user", "old", cancel)
		if !ok {
			t.Fatal("could not acquire allowed connection")
		}
		leases = append(leases, l)
	}
	if _, ok := sockets.acquire("ip", "one", "user", "old", cancel); ok {
		t.Fatal("identity connection cap bypassed")
	}
	sockets.release(leases[0])
	if _, ok := sockets.acquire("ip", "one", "user", "old", cancel); !ok {
		t.Fatal("connection slot was not released")
	}
	kept, stop := context.WithCancel(context.Background())
	defer stop()
	if _, ok := sockets.acquire("ip", "two", "user", "keep", stop); !ok {
		t.Fatal("could not acquire other session")
	}
	sockets.revoke("", "user", "keep")
	if ctx.Err() == nil || kept.Err() != nil {
		t.Fatal("revocation did not preserve only the current session")
	}
	sockets.revoke("keep", "", "")
	if kept.Err() == nil {
		t.Fatal("logout did not cancel its connection")
	}
	var perIP liveSockets
	for i := range maxSocketsPerIP {
		if _, ok := perIP.acquire("ip", fmt.Sprint(i), "", "", func() {}); !ok {
			t.Fatal("IP cap reached too soon")
		}
	}
	if _, ok := perIP.acquire("ip", "another", "", "", func() {}); ok {
		t.Fatal("IP connection cap bypassed")
	}
	var global liveSockets
	for i := range maxSockets {
		if _, ok := global.acquire(fmt.Sprint(i), fmt.Sprint(i), "", "", func() {}); !ok {
			t.Fatal("global cap reached too soon")
		}
	}
	if _, ok := global.acquire("extra", "extra", "", "", func() {}); ok {
		t.Fatal("global connection cap bypassed")
	}
}

func TestSecurityLimiterMemoryAndEnumeration(t *testing.T) {
	l := newLimiter(1, 1)
	for i := range maxLimiterKeys {
		if !l.allow(fmt.Sprint(i)) {
			t.Fatal("capacity reached too soon")
		}
	}
	if l.allow("extra") || len(l.buckets) != maxLimiterKeys {
		t.Fatal("unbounded limiter memory")
	}
	for _, b := range l.buckets {
		b.seen = time.Now().Add(-time.Minute)
	}
	l.sweep()
	if !l.allow("extra") {
		t.Fatal("idle limiter entries did not free capacity")
	}
	ts, _ := start(t)
	c := player(t, ts, "")
	for range 20 {
		c.want(404, "GET", "/api/tables/ZZZZZZZZ", "")
	}
	c.want(429, "GET", "/api/tables/ZZZZZZZZ", "")
	// Opening a socket is limited before looking up a room.
	for range 12 {
		c.want(404, "GET", "/api/ws?code=ZZZZZZZZ", "")
	}
	c.want(429, "GET", "/api/ws?code=ZZZZZZZZ", "")
}
