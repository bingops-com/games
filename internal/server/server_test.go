package server

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/cookiejar"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/coder/websocket"

	"github.com/bingops-com/games/internal/store"
)

type client struct {
	t    *testing.T
	http *http.Client
	base string
}

func (c *client) do(method, path, body string, headers ...string) (int, map[string]any) {
	c.t.Helper()
	req, _ := http.NewRequest(method, c.base+path, strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	res, err := c.http.Do(req)
	if err != nil {
		c.t.Fatal(err)
	}
	defer res.Body.Close()
	raw, _ := io.ReadAll(res.Body)
	var out map[string]any
	json.Unmarshal(raw, &out)
	return res.StatusCode, out
}

// want fails the test unless the call answers with the given status.
func (c *client) want(status int, method, path, body string, headers ...string) map[string]any {
	c.t.Helper()
	code, out := c.do(method, path, body, headers...)
	if code != status {
		c.t.Fatalf("%s %s %s = %d %v, want %d", method, path, body, code, out, status)
	}
	return out
}

// testStore opens a store in a schema of its own, dropped when the test ends.
// The tests need a PostgreSQL to talk to: GAMES_TEST_DATABASE_URL names it.
func testStore(t *testing.T) *store.Store {
	st, _ := testStoreURL(t)
	return st
}

func testStoreURL(t *testing.T) (*store.Store, string) {
	t.Helper()
	base := os.Getenv("GAMES_TEST_DATABASE_URL")
	if base == "" {
		t.Skip("GAMES_TEST_DATABASE_URL is not set: start a PostgreSQL (make db) and run make test")
	}
	ctx := context.Background()
	admin, err := sql.Open("pgx", base)
	if err != nil {
		t.Fatal(err)
	}
	raw := make([]byte, 6)
	rand.Read(raw)
	schema := "test_" + hex.EncodeToString(raw)
	if _, err := admin.ExecContext(ctx, "CREATE SCHEMA "+schema); err != nil {
		t.Fatal(err)
	}
	u, err := url.Parse(base)
	if err != nil {
		t.Fatal(err)
	}
	q := u.Query()
	q.Set("search_path", schema)
	u.RawQuery = q.Encode()
	st, err := store.Open(ctx, u.String())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		st.Close()
		admin.ExecContext(ctx, "DROP SCHEMA "+schema+" CASCADE")
		admin.Close()
	})
	return st, u.String()
}

func start(t *testing.T) (*httptest.Server, *store.Store) {
	t.Helper()
	st := testStore(t)
	web := fstest.MapFS{
		"index.html":           {Data: []byte("<h1>accueil</h1>")},
		"404.html":             {Data: []byte("<h1>introuvable</h1>")},
		"g/terre/index.html":   {Data: []byte("<h1>terre</h1>")},
		"u/index.html":         {Data: []byte("<h1>profil</h1>")},
		"u/index.txt":          {Data: []byte("donnees de la page")},
		"_next/static/app.css": {Data: []byte(strings.Repeat("body{margin:0}", 200))},
	}
	srv, err := New(st, web, Config{TrustProxy: true, Log: slog.New(slog.NewTextHandler(io.Discard, nil))})
	if err != nil {
		t.Fatal(err)
	}
	ts := httptest.NewServer(srv)
	t.Cleanup(ts.Close)
	return ts, st
}

// player opens a browser of its own on the server, signed in when name is set.
func player(t *testing.T, ts *httptest.Server, name string) *client {
	t.Helper()
	jar, _ := cookiejar.New(nil)
	c := &client{t: t, http: &http.Client{Jar: jar, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}, base: ts.URL}
	if name != "" {
		c.want(200, "POST", "/api/register", `{"name":"`+name+`","password":"long enough"}`)
	}
	return c
}

// signedIn says whether /api/me names an account.
func (c *client) signedIn() bool {
	c.t.Helper()
	return c.want(200, "GET", "/api/me", "")["user"] != nil
}

func TestAccounts(t *testing.T) {
	ts, _ := start(t)
	c := player(t, ts, "")
	if c.signedIn() {
		t.Fatal("signed in without a session")
	}
	c.want(400, "POST", "/api/register", `{"name":"x","password":"long enough","email":"bing@example.org"}`)
	c.want(400, "POST", "/api/register", `{"name":"Bing","password":"short","email":"bing@example.org"}`)
	out := c.want(200, "POST", "/api/register", `{"name":"Bing","password":"long enough"}`)
	if u := out["user"].(map[string]any); u["name"] != "Bing" || u["recoveryCodesRemaining"] != 10.0 {
		t.Fatalf("register returned incorrect account metadata")
	}
	if _, found := out["user"].(map[string]any)["email"]; found {
		t.Fatal("account exposes an email")
	}
	if codes, ok := out["recoveryCodes"].([]any); !ok || len(codes) != 10 {
		t.Fatal("missing initial recovery codes")
	}
	if !c.signedIn() {
		t.Fatal("not signed in after registering")
	}
	c.want(200, "POST", "/api/logout", "")
	if c.signedIn() {
		t.Fatal("still signed in after logging out")
	}
	// The same pseudo in another case is the same player.
	c.want(409, "POST", "/api/register", `{"name":"bing","password":"long enough","email":"other@example.org"}`)
	c.want(401, "POST", "/api/login", `{"name":"Bing","password":"wrong one"}`)
	c.want(401, "POST", "/api/login", `{"name":"Nobody","password":"long enough"}`)
	c.want(200, "POST", "/api/login", `{"name":"bing","password":"long enough"}`)
	if !c.signedIn() {
		t.Fatal("not signed in after logging in")
	}
}

func TestForeignOriginRefused(t *testing.T) {
	ts, _ := start(t)
	c := player(t, ts, "Bing")
	if code, _ := c.do("POST", "/api/logout", "", "Origin", "https://ailleurs.example", "Sec-Fetch-Site", "cross-site"); code != 403 {
		t.Fatalf("cross-site request = %d, want 403", code)
	}
	if !c.signedIn() {
		t.Fatal("a cross-site request signed the player out")
	}
}

func TestFriends(t *testing.T) {
	ts, _ := start(t)
	bing, anne, guest := player(t, ts, "Bing"), player(t, ts, "Anne"), player(t, ts, "")

	guest.want(401, "GET", "/api/friends", "")
	guest.want(401, "POST", "/api/friends/invite", `{"name":"Anne"}`)
	bing.want(404, "POST", "/api/friends/invite", `{"name":"Personne"}`)
	bing.want(400, "POST", "/api/friends/invite", `{"name":"bing"}`)
	bing.want(409, "POST", "/api/friends/accept", `{"name":"Anne"}`)

	if out := bing.want(200, "POST", "/api/friends/invite", `{"name":"anne"}`); out["relation"] != "sent" || out["name"] != "Anne" {
		t.Fatalf("invite: %v", out)
	}
	// Asking twice changes nothing.
	if out := bing.want(200, "POST", "/api/friends/invite", `{"name":"Anne"}`); out["relation"] != "sent" {
		t.Fatalf("second invite: %v", out)
	}
	if out := anne.want(200, "GET", "/api/me", ""); out["user"].(map[string]any)["received"] != 1.0 {
		t.Fatalf("pending count: %v", out)
	}
	if out := anne.want(200, "GET", "/api/profile/Bing", ""); out["relation"] != "received" {
		t.Fatalf("profile seen by the invited player: %v", out)
	}
	if out := bing.want(200, "GET", "/api/friends", ""); len(out["sent"].([]any)) != 1 || len(out["friends"].([]any)) != 0 {
		t.Fatalf("list before the answer: %v", out)
	}
	anne.want(200, "POST", "/api/friends/accept", `{"name":"Bing"}`)
	for _, c := range []*client{bing, anne} {
		if out := c.want(200, "GET", "/api/friends", ""); len(out["friends"].([]any)) != 1 || len(out["sent"].([]any))+len(out["received"].([]any)) != 0 {
			t.Fatalf("list once friends: %v", out)
		}
	}
	if out := guest.want(200, "GET", "/api/profile/anne", ""); out["friends"] != 1.0 || out["relation"] != nil {
		t.Fatalf("public profile: %v", out)
	}
	anne.want(200, "POST", "/api/friends/remove", `{"name":"Bing"}`)
	if out := bing.want(200, "GET", "/api/profile/Anne", ""); out["relation"] != "none" || out["friends"] != 0.0 {
		t.Fatalf("after removal: %v", out)
	}

	// Two invitations that cross make a friendship.
	bing.want(200, "POST", "/api/friends/invite", `{"name":"Anne"}`)
	if out := anne.want(200, "POST", "/api/friends/invite", `{"name":"Bing"}`); out["relation"] != "friends" {
		t.Fatalf("crossed invitations: %v", out)
	}
}

func TestProfile(t *testing.T) {
	ts, st := start(t)
	bing, guest := player(t, ts, "Bing"), player(t, ts, "")
	guest.want(404, "GET", "/api/profile/Personne", "")
	guest.want(404, "GET", "/api/profile/pas%20un%20pseudo", "")
	if out := bing.want(200, "GET", "/api/profile/Bing", ""); out["relation"] != "self" || len(out["stats"].([]any)) != 0 {
		t.Fatalf("own profile: %v", out)
	}
	u, err := st.UserByName(context.Background(), "bing")
	if err != nil {
		t.Fatal(err)
	}
	for _, won := range []bool{true, false, true} {
		if err := st.RecordGame(context.Background(), u.ID, "terre", won); err != nil {
			t.Fatal(err)
		}
	}
	out := guest.want(200, "GET", "/api/profile/Bing", "")
	stats := out["stats"].([]any)
	if len(stats) != 1 {
		t.Fatalf("stats: %v", out)
	}
	if s := stats[0].(map[string]any); s["game"] != "terre" || s["played"] != 3.0 || s["won"] != 2.0 {
		t.Fatalf("stats: %v", s)
	}
	if _, leaked := out["password"]; leaked {
		t.Fatal("profile shows the password hash")
	}
}

// seat connects a player to a table and returns a function reading the next
// state the table sends, and one sending a message.
func (c *client) seat(code, guest string) (next func() map[string]any, send func(string)) {
	c.t.Helper()
	url := "ws" + strings.TrimPrefix(c.base, "http") + "/api/ws?code=" + code
	if guest != "" {
		url += "&guest=" + guest + "&name=" + guest[:6]
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	c.t.Cleanup(cancel)
	conn, _, err := websocket.Dial(ctx, url, &websocket.DialOptions{HTTPClient: c.http})
	if err != nil {
		c.t.Fatal(err)
	}
	c.t.Cleanup(func() { conn.CloseNow() })
	next = func() map[string]any {
		c.t.Helper()
		_, raw, err := conn.Read(ctx)
		if err != nil {
			c.t.Fatal(err)
		}
		var out map[string]any
		json.Unmarshal(raw, &out)
		return out
	}
	send = func(msg string) {
		c.t.Helper()
		if err := conn.Write(ctx, websocket.MessageText, []byte(msg)); err != nil {
			c.t.Fatal(err)
		}
	}
	return
}

// until reads states until one satisfies ok.
func until(t *testing.T, next func() map[string]any, ok func(map[string]any) bool) map[string]any {
	t.Helper()
	for range 200 {
		if st := next(); ok(st) {
			return st
		}
	}
	t.Fatal("the expected state never came")
	return nil
}

func TestTable(t *testing.T) {
	ts, st := start(t)
	bing, guest := player(t, ts, "Bing"), player(t, ts, "")
	guest.want(404, "GET", "/api/tables/ZZZZ", "")
	guest.want(400, "POST", "/api/tables", `{"game":"belote"}`)
	// A room opened without naming a game starts on the default one.
	if out := guest.want(200, "POST", "/api/tables", `{}`); out["game"] != "terre" {
		t.Fatalf("default game: %v", out)
	}
	code := bing.want(200, "POST", "/api/tables", `{"game":"terre"}`)["code"].(string)
	if out := guest.want(200, "GET", "/api/tables/"+strings.ToLower(code), ""); out["game"] != "terre" {
		t.Fatalf("table: %v", out)
	}

	nextB, sendB := bing.seat(code, "")
	lobby := until(t, nextB, func(s map[string]any) bool { return s["t"] == "state" })
	if lobby["phase"] != "lobby" || lobby["host"] != "u:Bing" || lobby["you"] != "u:Bing" {
		t.Fatalf("lobby: %v", lobby)
	}
	// The host picks another game, then comes back to the first.
	sendB(`{"t":"game","id":"poudriere"}`)
	if st := until(t, nextB, func(s map[string]any) bool { return s["game"] == "poudriere" }); st["max"] != 4.0 {
		t.Fatalf("after choosing a game: %v", st)
	}
	sendB(`{"t":"game","id":"terre"}`)
	until(t, nextB, func(s map[string]any) bool { return s["game"] == "terre" })
	// Alone, the game cannot start.
	sendB(`{"t":"start"}`)
	if e := until(t, nextB, func(s map[string]any) bool { return s["t"] == "error" }); e["msg"] == "" {
		t.Fatalf("start alone: %v", e)
	}
	nextG, sendG := guest.seat(code, "mousse-0123456789abcdef")
	until(t, nextB, func(s map[string]any) bool { return s["t"] == "state" && len(s["members"].([]any)) == 2 })
	// Only the host starts.
	sendG(`{"t":"start"}`)
	until(t, nextG, func(s map[string]any) bool { return s["t"] == "error" })
	sendB(`{"t":"start"}`)
	play := until(t, nextB, func(s map[string]any) bool { return s["phase"] == "playing" })
	if hand := play["view"].(map[string]any)["hand"].([]any); len(hand) != 7 {
		t.Fatalf("hand of %d cards", len(hand))
	}
	// The guest's secret id is not shown to the others.
	if raw, _ := json.Marshal(play); strings.Contains(string(raw), "mousse-0123456789abcdef") {
		t.Fatal("the guest id is broadcast")
	}
	// Only the host removes a player; the one removed is told and stays out.
	other := player(t, ts, "")
	nextO, sendO := other.seat(code, "mousse-fedcba9876543210")
	var hostID, otherID string
	until(t, nextO, func(s map[string]any) bool {
		if s["t"] != "state" {
			return false
		}
		hostID, otherID = s["host"].(string), s["you"].(string)
		return true
	})
	sendO(`{"t":"kick","id":"` + hostID + `"}`)
	until(t, nextO, func(s map[string]any) bool { return s["t"] == "error" })
	sendB(`{"t":"kick","id":"` + otherID + `"}`)
	until(t, nextO, func(s map[string]any) bool { return s["t"] == "kicked" })
	until(t, nextB, func(s map[string]any) bool { return s["t"] == "state" && len(s["members"].([]any)) == 2 })
	back, _, err := websocket.Dial(context.Background(), "ws"+strings.TrimPrefix(ts.URL, "http")+"/api/ws?code="+code+"&guest=mousse-fedcba9876543210&name=mousse", nil)
	if err == nil {
		rctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		_, _, err = back.Read(rctx)
		cancel()
		back.CloseNow()
	}
	if err == nil {
		t.Fatal("a removed player came back")
	}
	// The guest leaves: the player left wins, but a game ended by a walk-out is
	// void and counts on nobody's profile.
	sendG(`{"t":"leave"}`)
	over := until(t, nextB, func(s map[string]any) bool { return s["phase"] == "over" })
	if w := over["winners"].([]any); len(w) != 1 || w[0] != over["seat"] {
		t.Fatalf("winners %v, my seat %v", w, over["seat"])
	}
	// A void game adds nothing to the room's own tally either.
	for _, m := range over["members"].([]any) {
		if m.(map[string]any)["wins"] != float64(0) {
			t.Fatalf("a void game counted as a win in the room: %v", m)
		}
	}
	if over["void"] != true {
		t.Fatalf("a game ended by a walk-out is not void: %v", over["void"])
	}
	time.Sleep(300 * time.Millisecond)
	u, _ := st.UserByName(context.Background(), "Bing")
	if stats, _ := st.Stats(context.Background(), u.ID); len(stats) != 0 {
		t.Fatalf("a void game was recorded: %v", stats)
	}
}

func get(t *testing.T, ts *httptest.Server, path string, headers ...string) *http.Response {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, ts.URL+path, nil)
	for i := 0; i+1 < len(headers); i += 2 {
		req.Header.Set(headers[i], headers[i+1])
	}
	tr := &http.Transport{DisableCompression: true}
	res, err := (&http.Client{Transport: tr, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}).Do(req)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { res.Body.Close() })
	return res
}

func TestPages(t *testing.T) {
	ts, _ := start(t)
	for path, want := range map[string]string{"/": "accueil", "/g/terre/": "terre", "/g/terre": "terre", "/u/?n=Bing": "profil", "/u/index.txt": "donnees"} {
		res := get(t, ts, path)
		body, _ := io.ReadAll(res.Body)
		if res.StatusCode != http.StatusOK || !strings.Contains(string(body), want) {
			t.Errorf("GET %s = %d %q, want 200 with %q", path, res.StatusCode, body, want)
		}
	}
	res := get(t, ts, "/g/inconnu/")
	body, _ := io.ReadAll(res.Body)
	if res.StatusCode != http.StatusNotFound || !strings.Contains(string(body), "introuvable") {
		t.Errorf("unknown page = %d %q, want the 404 page", res.StatusCode, body)
	}
	// The address players share leads to the profile page.
	if res := get(t, ts, "/u/Bing"); res.StatusCode != http.StatusFound || res.Header.Get("Location") != "/u/?n=Bing" {
		t.Errorf("GET /u/Bing = %d to %q", res.StatusCode, res.Header.Get("Location"))
	}
}

func TestHeaders(t *testing.T) {
	ts, _ := start(t)
	res := get(t, ts, "/")
	for _, h := range []string{"Content-Security-Policy", "X-Content-Type-Options", "Referrer-Policy"} {
		if res.Header.Get(h) == "" {
			t.Errorf("missing header %s", h)
		}
	}
	if res.Header.Get("Strict-Transport-Security") != "" {
		t.Error("HSTS sent over plain HTTP")
	}
	if get(t, ts, "/", "X-Forwarded-Proto", "https").Header.Get("Strict-Transport-Security") == "" {
		t.Error("HSTS missing behind an HTTPS proxy")
	}
}

func TestCaching(t *testing.T) {
	ts, _ := start(t)
	res := get(t, ts, "/_next/static/app.css", "Accept-Encoding", "gzip")
	if res.Header.Get("Content-Encoding") != "gzip" || !strings.Contains(res.Header.Get("Cache-Control"), "immutable") {
		t.Errorf("built file: encoding %q, cache %q", res.Header.Get("Content-Encoding"), res.Header.Get("Cache-Control"))
	}
	etag := get(t, ts, "/").Header.Get("ETag")
	if res := get(t, ts, "/", "If-None-Match", etag); res.StatusCode != http.StatusNotModified {
		t.Errorf("revalidation = %d, want 304", res.StatusCode)
	}
}

func TestHealth(t *testing.T) {
	ts, _ := start(t)
	res := get(t, ts, "/healthz")
	if body, _ := io.ReadAll(res.Body); res.StatusCode != http.StatusOK || string(body) != "ok\n" {
		t.Errorf("healthz = %d %q", res.StatusCode, body)
	}
}

func TestAvatarAndObjectives(t *testing.T) {
	ts, st := start(t)
	ctx := context.Background()
	c := player(t, ts, "Bing")
	objective := func(id string) map[string]any {
		t.Helper()
		user := c.want(200, "GET", "/api/me", "")["user"].(map[string]any)
		for _, o := range user["objectives"].([]any) {
			if o := o.(map[string]any); o["id"] == id {
				return o
			}
		}
		t.Fatalf("no objective %q", id)
		return nil
	}

	// A new player wears free parts; a part behind an objective is refused.
	c.want(200, "POST", "/api/avatar", `{"avatar":"corail.mariniere.rond.sourire.aucune.aucune.bonnet"}`)
	c.want(400, "POST", "/api/avatar", `{"avatar":"corail.mariniere.rond.sourire.aucune.cacheoeil.bonnet"}`)
	c.want(400, "POST", "/api/avatar", `{"avatar":"corail.mariniere.rond.sourire.aucune.aucune"}`)
	c.want(400, "POST", "/api/avatar", `{"avatar":"corail.mariniere.rond.sourire.aucune.aucune.casque"}`)
	if o := objective("premiere"); o["done"] != false || o["have"] != float64(0) {
		t.Fatalf("premiere before any game = %v", o)
	}
	player(t, ts, "").want(401, "POST", "/api/avatar", `{"avatar":"corail.mariniere.rond.sourire.aucune.aucune.bonnet"}`)

	// One finished game reaches the first objective and starts the streak.
	u, err := st.UserByName(ctx, "Bing")
	if err != nil {
		t.Fatal(err)
	}
	if err := st.RecordGame(ctx, u.ID, "terre", false); err != nil {
		t.Fatal(err)
	}
	if err := st.RecordGame(ctx, u.ID, "terre", false); err != nil {
		t.Fatal(err)
	}
	if o := objective("premiere"); o["done"] != true || o["slot"] != "glasses" || o["item"] != "cacheoeil" {
		t.Fatalf("premiere after a game = %v", o)
	}
	if o := objective("habitue"); o["have"] != float64(2) || o["goal"] != float64(5) || o["done"] != false {
		t.Fatalf("habitue after two games = %v", o)
	}
	user := c.want(200, "GET", "/api/me", "")["user"].(map[string]any)
	if s := user["streak"].(map[string]any); s["days"] != float64(1) || s["best"] != float64(1) || s["today"] != true {
		t.Fatalf("streak after two games the same day = %v", s)
	}
	c.want(200, "POST", "/api/avatar", `{"avatar":"corail.mariniere.rond.sourire.aucune.cacheoeil.bonnet"}`)
	c.want(400, "POST", "/api/avatar", `{"avatar":"corail.mariniere.etoiles.sourire.aucune.aucune.bonnet"}`)

	// The avatar is on the public profile, with how many objectives are reached.
	p := player(t, ts, "").want(200, "GET", "/api/profile/Bing", "")
	if p["avatar"] != "corail.mariniere.rond.sourire.aucune.cacheoeil.bonnet" || p["done"] != float64(1) || p["objectives"] != float64(len(objectives)) {
		t.Fatalf("profile = %v", p)
	}

	// A guest cannot wear what an objective unlocks.
	if got, ok := cleanAvatar("corail.mariniere.rond.sourire.aucune.cacheoeil.bonnet", nil); ok || got != "" {
		t.Fatalf("guest with a locked part = %q %v", got, ok)
	}
	if got, ok := cleanAvatar("lilas.cire.malin.dents.barbiche.rondes.bandana", nil); !ok || got == "" {
		t.Fatalf("guest with free parts = %q %v", got, ok)
	}
}

func TestPresenceAndRoomInvites(t *testing.T) {
	ts, _ := start(t)
	bing, ana, zoe := player(t, ts, "Bing"), player(t, ts, "Ana"), player(t, ts, "Zoe")
	bing.want(200, "POST", "/api/friends/invite", `{"name":"Ana"}`)
	ana.want(200, "POST", "/api/friends/accept", `{"name":"Bing"}`)

	// Ana just made a request: Bing sees her online, in no room.
	list := bing.want(200, "GET", "/api/friends", "")
	if f := list["friends"].([]any)[0].(map[string]any); f["name"] != "Ana" || f["online"] != true || f["room"] != nil {
		t.Fatalf("friend = %v", f)
	}

	// Bing opens a room and sits in it; Ana sees where he is.
	code := bing.want(200, "POST", "/api/tables", `{"game":"meche"}`)["code"].(string)
	// Inviting takes being in the room, and a friend.
	bing.want(404, "POST", "/api/tables/"+code+"/invite", `{"name":"Ana"}`)
	next, _ := bing.seat(code, "")
	until(t, next, func(s map[string]any) bool { return s["t"] == "state" })
	if f := ana.want(200, "GET", "/api/friends", "")["friends"].([]any)[0].(map[string]any); f["room"] != code || f["game"] != "meche" {
		t.Fatalf("friend in a room = %v", f)
	}
	bing.want(400, "POST", "/api/tables/"+code+"/invite", `{"name":"Zoe"}`)
	zoe.want(404, "POST", "/api/tables/"+code+"/invite", `{"name":"Bing"}`)
	bing.want(200, "POST", "/api/tables/"+code+"/invite", `{"name":"Ana"}`)
	bing.want(200, "POST", "/api/tables/"+code+"/invite", `{"name":"Ana"}`)
	inv := ana.want(200, "GET", "/api/friends", "")["invites"].([]any)
	if len(inv) != 1 || inv[0].(map[string]any)["from"] != "Bing" || inv[0].(map[string]any)["code"] != code {
		t.Fatalf("invites = %v", inv)
	}
	if got := zoe.want(200, "GET", "/api/friends", "")["invites"].([]any); len(got) != 0 {
		t.Fatalf("a stranger was invited: %v", got)
	}
}

func TestShop(t *testing.T) {
	ts, st := start(t)
	ctx := context.Background()
	c := player(t, ts, "Bing")
	shop := player(t, ts, "").want(200, "GET", "/api/shop", "")
	items := shop["items"].([]any)
	if len(items) != shopSize {
		t.Fatalf("%d items on sale", len(items))
	}
	// The same day draws the same shop; another day, not necessarily.
	if a, b := todaysShop(20000), todaysShop(20000); a[0] != b[0] || a[3] != b[3] {
		t.Fatal("the shop changes within a day")
	}
	first := items[0].(map[string]any)
	id, price := first["id"].(string), int(first["price"].(float64))
	body := `{"item":"` + id + `"}`

	// No credits, no purchase; a guest cannot buy at all.
	c.want(409, "POST", "/api/shop/buy", body)
	player(t, ts, "").want(401, "POST", "/api/shop/buy", body)
	c.want(400, "POST", "/api/shop/buy", `{"item":"fx:inconnu"}`)

	// Wins pay: enough of them buy the item, once.
	u, _ := st.UserByName(ctx, "Bing")
	for paid := 0; paid < price; paid += store.CreditsPlayed + store.CreditsWon {
		if err := st.RecordGame(ctx, u.ID, "terre", true); err != nil {
			t.Fatal(err)
		}
	}
	before := int(c.want(200, "GET", "/api/me", "")["user"].(map[string]any)["credits"].(float64))
	user := c.want(200, "POST", "/api/shop/buy", body)["user"].(map[string]any)
	if got := int(user["credits"].(float64)); got != before-price {
		t.Fatalf("credits %d after paying %d from %d", got, price, before)
	}
	if owned := user["items"].([]any); len(owned) != 1 || owned[0] != id {
		t.Fatalf("items = %v", owned)
	}
	c.want(409, "POST", "/api/shop/buy", body)

	// A name effect is worn only once bought.
	c.want(400, "POST", "/api/fx", `{"fx":"jamais-vendu"}`)
	c.want(200, "POST", "/api/fx", `{"fx":""}`)
	if strings.HasPrefix(id, "fx:") {
		c.want(200, "POST", "/api/fx", `{"fx":"`+strings.TrimPrefix(id, "fx:")+`"}`)
	}
}
