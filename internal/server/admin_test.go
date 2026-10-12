package server

import (
	"context"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"io"
	"io/fs"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"testing/fstest"
	"time"

	"github.com/bingops-com/games/web"
	"github.com/go-jose/go-jose/v4"
)

type fakeAdminIssuer struct {
	mu                   sync.Mutex
	url                  string
	key                  *rsa.PrivateKey
	nonce, challenge     string
	username, subject    string
	allowed, group, down bool
	invalid              string
	exchanges            int
}

func newFakeAdminIssuer(t *testing.T) (*httptest.Server, *fakeAdminIssuer) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatal(err)
	}
	f := &fakeAdminIssuer{key: key, username: "bingops", subject: "operator-subject", allowed: true, group: true}
	ts := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		f.mu.Lock()
		defer f.mu.Unlock()
		if f.down {
			http.Error(w, "synthetic outage", 503)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		switch r.URL.Path {
		case "/authorize":
			q := r.URL.Query()
			f.nonce = q.Get("nonce")
			f.challenge = q.Get("code_challenge")
			http.Redirect(w, r, q.Get("redirect_uri")+"?code=synthetic-code&state="+url.QueryEscape(q.Get("state")), 303)
		case "/application/o/games-admin/.well-known/openid-configuration":
			json.NewEncoder(w).Encode(map[string]any{"issuer": f.url + "/application/o/games-admin/", "authorization_endpoint": f.url + "/authorize", "token_endpoint": f.url + "/token", "userinfo_endpoint": f.url + "/userinfo", "jwks_uri": f.url + "/keys", "id_token_signing_alg_values_supported": []string{"RS256"}})
		case "/keys":
			json.NewEncoder(w).Encode(jose.JSONWebKeySet{Keys: []jose.JSONWebKey{{Key: &f.key.PublicKey, KeyID: "test", Algorithm: "RS256", Use: "sig"}}})
		case "/token":
			if err := r.ParseForm(); err != nil {
				http.Error(w, "bad form", 400)
				return
			}
			hash := sha256.Sum256([]byte(r.Form.Get("code_verifier")))
			if r.Form.Get("code") != "synthetic-code" || r.Form.Get("client_id") != "games-admin" || base64.RawURLEncoding.EncodeToString(hash[:]) != f.challenge {
				http.Error(w, "bad PKCE", 400)
				return
			}
			f.exchanges++
			claims := map[string]any{"iss": f.url + "/application/o/games-admin/", "aud": "games-admin", "sub": f.subject, "iat": time.Now().Unix(), "exp": time.Now().Add(time.Hour).Unix(), "nonce": f.nonce}
			if f.invalid == "issuer" {
				claims["iss"] = "https://untrusted.example.invalid/"
			}
			if f.invalid == "audience" {
				claims["aud"] = "different-app"
			}
			if f.invalid == "expiry" {
				claims["exp"] = time.Now().Add(-time.Hour).Unix()
			}
			if f.invalid == "nonce" {
				claims["nonce"] = "wrong"
			}
			if f.invalid == "azp" {
				claims["azp"] = "different-app"
			}
			key := f.key
			if f.invalid == "signature" {
				key, _ = rsa.GenerateKey(rand.Reader, 2048)
			}
			signer, err := jose.NewSigner(jose.SigningKey{Algorithm: jose.RS256, Key: key}, (&jose.SignerOptions{}).WithHeader("kid", "test"))
			if err != nil {
				t.Fatal(err)
			}
			payload, _ := json.Marshal(claims)
			signed, err := signer.Sign(payload)
			if err != nil {
				t.Fatal(err)
			}
			raw, _ := signed.CompactSerialize()
			json.NewEncoder(w).Encode(map[string]any{"access_token": "synthetic-access-token", "token_type": "Bearer", "expires_in": 3600, "id_token": raw})
		case "/userinfo":
			if r.Header.Get("Authorization") != "Bearer synthetic-access-token" {
				http.Error(w, "missing credential", 401)
				return
			}
			groups := []string{}
			if f.group {
				groups = append(groups, "games-admins")
			}
			json.NewEncoder(w).Encode(map[string]any{"sub": f.subject, "preferred_username": f.username, "groups": groups, "games_admin": f.allowed})
		default:
			http.NotFound(w, r)
		}
	}))
	f.url = ts.URL
	t.Cleanup(ts.Close)
	return ts, f
}

func startAdmin(t *testing.T, assets ...fs.FS) (*Server, *client, *fakeAdminIssuer) {
	t.Helper()
	issuer, f := newFakeAdminIssuer(t)
	st := testStore(t)
	ts := httptest.NewUnstartedServer(nil)
	cfg := Config{PublicURL: "http://" + ts.Listener.Addr().String(), Log: slog.New(slog.NewTextHandler(io.Discard, nil)), Admin: AdminConfig{Enabled: true, Issuer: issuer.URL + "/application/o/games-admin/", ClientID: "games-admin", Username: "bingops", Group: "games-admins"}}
	var files fs.FS = fstest.MapFS{"index.html": {Data: []byte("public")}, "admin/index.html": {Data: []byte("admin shell")}, "admin/index.txt": {Data: []byte("admin RSC")}, "admin/connexion/index.html": {Data: []byte("login")}}
	if len(assets) > 0 {
		files = assets[0]
	}
	s, err := New(st, files, cfg)
	if err != nil {
		t.Fatal(err)
	}
	ts.Config.Handler = s
	ts.Start()
	t.Cleanup(ts.Close)
	jar, _ := cookiejar.New(nil)
	c := &client{t: t, base: ts.URL, http: &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}}
	return s, c, f
}
func beginAdmin(t *testing.T, c *client, f *fakeAdminIssuer) string {
	t.Helper()
	res, err := c.http.Post(c.base+"/api/admin/login", "application/x-www-form-urlencoded", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 303 {
		t.Fatalf("login status %d", res.StatusCode)
	}
	u, err := url.Parse(res.Header.Get("Location"))
	if err != nil {
		t.Fatal(err)
	}
	if u.Query().Get("code_challenge_method") != "S256" || u.Query().Get("scope") != "openid profile groups" {
		t.Fatal("missing PKCE or wrong scopes")
	}
	f.mu.Lock()
	f.nonce = u.Query().Get("nonce")
	f.challenge = u.Query().Get("code_challenge")
	f.mu.Unlock()
	return "/api/admin/callback?code=synthetic-code&state=" + url.QueryEscape(u.Query().Get("state"))
}
func finishAdmin(t *testing.T, c *client, path string) string {
	t.Helper()
	res, err := c.http.Get(c.base + path)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	if res.StatusCode != 303 || res.Header.Get("Cache-Control") != "no-store" || res.Header.Get("Referrer-Policy") != "no-referrer" {
		t.Fatal("unsafe callback response")
	}
	return res.Header.Get("Location")
}
func TestAdminOIDCAndAuthorization(t *testing.T) {
	s, c, f := startAdmin(t)
	c.want(401, "GET", "/api/admin/overview", "")
	c.want(401, "GET", "/api/admin/me", "", "X-authentik-username", "bingops", "X-authentik-groups", "games-admins")
	for _, path := range []string{"/admin/", "/admin%2findex.html", "/%2e/admin%2findex.txt"} {
		res, err := c.http.Get(c.base + path)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 303 || res.Header.Get("Location") != "/admin/connexion/" {
			t.Fatalf("anonymous admin page bypass: %s status %d", path, res.StatusCode)
		}
	}
	if target := finishAdmin(t, c, beginAdmin(t, c, f)); target != "/admin/" {
		t.Fatal("valid OIDC refused")
	}
	me := c.want(200, "GET", "/api/admin/me", "")
	csrf := me["csrf"].(string)
	if me["username"] != "bingops" || len(csrf) != 43 {
		t.Fatal("invalid admin session")
	}
	c.want(200, "GET", "/api/admin/overview", "")
	c.want(200, "GET", "/api/admin/users", "")
	for _, path := range []string{"/admin/", "/admin/index.html", "/admin/index.txt"} {
		res, err := c.http.Get(c.base + path)
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode != 200 || res.Header.Get("Cache-Control") != "no-store" {
			t.Fatal("admin HTML/RSC gate or caching failed")
		}
	}
	c.want(403, "POST", "/api/admin/logout", "{}")
	c.want(403, "POST", "/api/admin/users/invalid/revoke", `{"reason":"synthetic action"}`, "X-Admin-CSRF", "wrong")
	c.want(403, "POST", "/api/admin/logout", "{}", "X-Admin-CSRF", csrf, "Origin", "https://evil.example.invalid")
	c.want(200, "POST", "/api/admin/logout", "{}", "X-Admin-CSRF", csrf)
	c.want(401, "GET", "/api/admin/overview", "")
	s.admin.mu.Lock()
	remaining := len(s.admin.sessions)
	s.admin.mu.Unlock()
	if remaining != 0 {
		t.Fatal("logout retained admin session")
	}
}
func TestAdminRejectsInvalidTokens(t *testing.T) {
	for _, invalid := range []string{"issuer", "audience", "expiry", "nonce", "azp", "signature"} {
		t.Run(invalid, func(t *testing.T) {
			_, c, f := startAdmin(t)
			f.invalid = invalid
			if finishAdmin(t, c, beginAdmin(t, c, f)) == "/admin/" {
				t.Fatal("invalid token accepted")
			}
			c.want(401, "GET", "/api/admin/me", "")
		})
	}
}
func TestAdminMembershipAndOutage(t *testing.T) {
	for _, change := range []string{"username", "group", "inactive", "subject", "outage"} {
		t.Run(change, func(t *testing.T) {
			_, c, f := startAdmin(t)
			if finishAdmin(t, c, beginAdmin(t, c, f)) != "/admin/" {
				t.Fatal("login failed")
			}
			f.mu.Lock()
			switch change {
			case "username":
				f.username = "ordinary"
			case "group":
				f.group = false
			case "inactive":
				f.allowed = false
			case "subject":
				f.subject = "other-subject"
			case "outage":
				f.down = true
			}
			f.mu.Unlock()
			want := 403
			if change == "outage" {
				want = 503
			}
			c.want(want, "GET", "/api/admin/overview", "")
			res, err := c.http.Get(c.base + "/livez")
			if err != nil {
				t.Fatal(err)
			}
			res.Body.Close()
			if res.StatusCode != 200 {
				t.Fatal("OIDC outage affected public liveness")
			}
		})
	}
}
func TestAdminStateBindingReplayAndExpiry(t *testing.T) {
	s, c, f := startAdmin(t)
	path := beginAdmin(t, c, f)
	otherJar, _ := cookiejar.New(nil)
	other := &client{t: t, base: c.base, http: &http.Client{Jar: otherJar, CheckRedirect: c.http.CheckRedirect}}
	if finishAdmin(t, other, path) == "/admin/" {
		t.Fatal("flow not bound to browser")
	}
	if finishAdmin(t, c, path) != "/admin/" {
		t.Fatal("valid flow failed")
	}
	if finishAdmin(t, c, path) == "/admin/" {
		t.Fatal("authorization code replay accepted")
	}
	f.mu.Lock()
	n := f.exchanges
	f.mu.Unlock()
	if n != 1 {
		t.Fatal("replayed state reached token exchange")
	}
	s.admin.mu.Lock()
	for key, session := range s.admin.sessions {
		session.expires = time.Now().Add(-time.Second)
		s.admin.sessions[key] = session
	}
	s.admin.mu.Unlock()
	c.want(401, "GET", "/api/admin/me", "")
	path = beginAdmin(t, c, f)
	s.admin.mu.Lock()
	for key, flow := range s.admin.flows {
		flow.expires = time.Now().Add(-time.Second)
		s.admin.flows[key] = flow
	}
	s.admin.mu.Unlock()
	if finishAdmin(t, c, path) == "/admin/" {
		t.Fatal("expired flow accepted")
	}
}
func TestAdminAuditAndRevocation(t *testing.T) {
	s, c, f := startAdmin(t)
	u, err := s.store.CreateUser(context.Background(), "SyntheticPlayer", "synthetic password hash", nil)
	if err != nil {
		t.Fatal(err)
	}
	if err := s.store.CreateSession(context.Background(), u.ID, tokenHash("synthetic-player-token"), time.Now().Add(time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := s.store.Report(context.Background(), "reporter", "target", "ABCDEFGH", "autre", "synthetic context"); err != nil {
		t.Fatal(err)
	}
	if finishAdmin(t, c, beginAdmin(t, c, f)) != "/admin/" {
		t.Fatal("login failed")
	}
	csrf := c.want(200, "GET", "/api/admin/me", "")["csrf"].(string)
	c.want(400, "POST", "/api/admin/users/"+u.ID+"/revoke", `{"reason":""}`, "X-Admin-CSRF", csrf)
	c.want(200, "POST", "/api/admin/users/"+u.ID+"/revoke", `{"reason":"Synthetic security response"}`, "X-Admin-CSRF", csrf)
	if _, err := s.store.UserBySession(context.Background(), tokenHash("synthetic-player-token")); err == nil {
		t.Fatal("player session survived revocation")
	}
	c.want(200, "POST", "/api/admin/reports/1", `{"status":"resolved","reason":"Synthetic report reviewed"}`, "X-Admin-CSRF", csrf)
	c.want(409, "POST", "/api/admin/reports/1", `{"status":"dismissed","reason":"Duplicate synthetic review"}`, "X-Admin-CSRF", csrf)
	entries, err := s.store.AdminAudit(context.Background(), 100)
	if err != nil || len(entries) != 2 {
		t.Fatal("missing transactional audit")
	}
	users := c.want(200, "GET", "/api/admin/users", "")
	raw, _ := json.Marshal(users)
	for _, secret := range []string{"password", "email", "token_hash", "recovery"} {
		if strings.Contains(string(raw), secret) {
			t.Fatal("credentials disclosed")
		}
	}
}
func TestAdminCookieAndTransport(t *testing.T) {
	a := newAdminAuth(Config{Production: true, Admin: AdminConfig{Issuer: "https://auth.example.invalid/application/o/games-admin/"}})
	w := httptest.NewRecorder()
	a.cookie(w, "session", adminRandom(), 15*time.Minute)
	cookies := w.Result().Cookies()
	if len(cookies) != 1 || cookies[0].Name != "__Host-games_admin_session" || !cookies[0].Secure || !cookies[0].HttpOnly || cookies[0].Domain != "" || cookies[0].SameSite != http.SameSiteLaxMode || cookies[0].Path != "/" {
		t.Fatal("unsafe production cookie")
	}
	req, _ := http.NewRequest("GET", "https://evil.example.invalid/", nil)
	if _, err := a.client.Do(req); err == nil {
		t.Fatal("OIDC credentials can leave issuer origin")
	}
}

// Explicit opt-in: uses Chromium and the compiled UI with a real, signed fake
// OIDC issuer. No production authentication bypass is added to the binary.
func TestAdminBrowser(t *testing.T) {
	if os.Getenv("GAMES_ADMIN_BROWSER_CHECK") != "true" {
		t.Skip("set GAMES_ADMIN_BROWSER_CHECK=true after building the UI")
	}
	s, c, _ := startAdmin(t, web.Files())
	if _, err := s.hub.Create("terre", false); err != nil {
		t.Fatal(err)
	}
	user, err := s.store.CreateUser(context.Background(), "BrowserPlayer", "synthetic password hash", nil)
	if err != nil {
		t.Fatal(err)
	}
	for i, game := range []string{"terre", "terre", "meche", "poudriere"} {
		if err := s.store.RecordGame(context.Background(), user.ID, game, i == 0); err != nil {
			t.Fatal(err)
		}
	}
	if err := s.store.Report(context.Background(), "Synthetic reporter", "Synthetic player", "ABCDEFGH", "autre", "Synthetic report context"); err != nil {
		t.Fatal(err)
	}
	path, err := filepath.Abs("../../web")
	if err != nil {
		t.Fatal(err)
	}
	command := exec.Command("node", "e2e/admin.mjs")
	command.Dir = path
	command.Env = append(os.Environ(), "GAMES_URL="+c.base)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("admin browser: %v\n%s", err, output)
	} else {
		t.Log(string(output))
	}
}
