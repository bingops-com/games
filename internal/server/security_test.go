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
				out := old.want(200, "POST", "/api/account/recovery-codes", `{"password":"long enough"}`)
				raw := out["recoveryCodes"].([]any)[0].(string)
				guest := player(t, ts, "")
				guest.want(200, "POST", "/api/reset", fmt.Sprintf(`{"name":"SocketOwner","code":%q,"password":"recovered password"}`, raw))
			}
			auditSocketClosed(t, stale)
			if old.signedIn() {
				t.Fatal("revoked HTTP session remains valid")
			}
		})
	}
}

func TestSecurityProductionConfig(t *testing.T) {
	for _, tc := range []struct {
		name  string
		cfg   Config
		valid bool
	}{
		{"local without mail", Config{}, true},
		{"missing production values", Config{Production: true}, false},
		{"production without mail", Config{Production: true, PublicURL: "https://games.audit.invalid"}, true},
		{"HTTP production", Config{Production: true, PublicURL: "http://games.audit.invalid"}, false},
		{"credentials in origin", Config{PublicURL: "https://fake:fake@games.audit.invalid"}, false},
		{"query in origin", Config{PublicURL: "https://games.audit.invalid/?host=evil"}, false},
		{"path in origin", Config{PublicURL: "https://games.audit.invalid/path"}, false},
		{"valid production", Config{Production: true, PublicURL: "https://games.audit.invalid/"}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if err := tc.cfg.Validate(); (err == nil) != tc.valid {
				t.Fatalf("validation=%v, want valid=%v", err, tc.valid)
			}
		})
	}
	r := httptest.NewRequest("POST", "http://games.audit.invalid/api/reset", nil)
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
