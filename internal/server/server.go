// Package server exposes games over HTTP: accounts, public profiles, friends,
// and the embedded interface.
package server

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"

	"github.com/bingops-com/games/internal/mail"
	"github.com/bingops-com/games/internal/room"
	"github.com/bingops-com/games/internal/store"
)

const (
	cookieName  = "games_session"
	sessionLife = 30 * 24 * time.Hour
	maxBody     = 20_000
)

type Config struct {
	// TrustProxy says a reverse proxy sits in front and sets X-Forwarded-For
	// and X-Forwarded-Proto. Never set it when the server is reached directly.
	TrustProxy bool
	Log        *slog.Logger
	// Mail sends the links to choose a new password; nil writes them to the
	// log. PublicURL is the address players reach the site at, for those
	// links; empty takes it from the request.
	Mail      mail.Sender
	PublicURL string
}

type Server struct {
	cfg   Config
	store *store.Store
	log   *slog.Logger
	hub   *room.Hub
	// Sign-ups and logins per address, invitations per account, tables
	// opened per address.
	authLimit   *limiter
	inviteLimit *limiter
	tableLimit  *limiter
	reportLimit *limiter
	presence    *presence
	handler     http.Handler
}

// New builds the server. web holds the built interface.
func New(st *store.Store, web fs.FS, cfg Config) (*Server, error) {
	if cfg.Log == nil {
		cfg.Log = slog.Default()
	}
	if cfg.Mail == nil {
		cfg.Mail = mail.Log{Log: cfg.Log}
	}
	files, err := newStatic(web)
	if err != nil {
		return nil, err
	}
	s := &Server{
		cfg: cfg, store: st, log: cfg.Log,
		authLimit:   newLimiter(30.0/600, 30), // 30 attempts, then one every 20 s
		inviteLimit: newLimiter(1.0/30, 20),   // 20 invitations, then one every 30 s
		tableLimit:  newLimiter(1.0/20, 10),   // 10 tables, then one every 20 s
		reportLimit: newLimiter(1.0/120, 5),   // 5 reports, then one every 2 min
		hub:         room.NewHub(cfg.Log),
		presence:    newPresence(),
	}
	s.hub.Record = func(userID, game string, won bool) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := st.RecordGame(ctx, userID, game, won); err != nil {
			s.log.Error("record game", "game", game, "err", err)
		}
	}

	// What players write to each other goes through the word filter, and the
	// rooms are saved so that a restart does not close them.
	s.hub.Clean = cleanText
	s.hub.Save = func(code string, state []byte) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := st.SaveRoom(ctx, code, state); err != nil {
			s.log.Error("save room", "code", code, "err", err)
		}
	}
	s.hub.Forget = func(code string) {
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if err := st.DeleteRoom(ctx, code); err != nil {
			s.log.Error("forget room", "code", code, "err", err)
		}
	}
	{
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		saved, err := st.Rooms(ctx, time.Now().Add(-room.EmptyLife))
		cancel()
		if err != nil {
			return nil, err
		}
		for code, state := range saved {
			s.hub.Restore(code, state)
		}
		if len(saved) > 0 {
			s.log.Info("rooms restored", "count", len(saved))
		}
	}

	api := http.NewServeMux()
	api.HandleFunc("POST /api/register", s.handle(s.register))
	api.HandleFunc("POST /api/login", s.handle(s.login))
	api.HandleFunc("POST /api/logout", s.handle(s.logout))
	api.HandleFunc("GET /api/me", s.handle(s.me))
	api.HandleFunc("POST /api/account/email", s.handle(s.setEmail))
	api.HandleFunc("POST /api/account/email/check", s.handle(s.resendCheck))
	api.HandleFunc("POST /api/confirm", s.handle(s.confirm))
	api.HandleFunc("POST /api/account/password", s.handle(s.setPassword))
	api.HandleFunc("POST /api/forgot", s.handle(s.forgot))
	api.HandleFunc("POST /api/reset", s.handle(s.reset))
	api.HandleFunc("POST /api/blocks/{action}", s.handle(s.block))
	api.HandleFunc("POST /api/report", s.handle(s.report))
	api.HandleFunc("GET /api/rooms", s.handle(s.rooms))
	api.HandleFunc("POST /api/avatar", s.handle(s.setAvatar))
	api.HandleFunc("POST /api/fx", s.handle(s.setFx))
	api.HandleFunc("GET /api/shop", s.handle(s.shop))
	api.HandleFunc("POST /api/shop/buy", s.handle(s.buy))
	api.HandleFunc("GET /api/profile/{name}", s.handle(s.profile))
	api.HandleFunc("GET /api/friends", s.handle(s.friends))
	api.HandleFunc("POST /api/friends/{action}", s.handle(s.friend))
	api.HandleFunc("POST /api/tables", s.handle(s.openTable))
	api.HandleFunc("GET /api/tables/{code}", s.handle(s.table))
	api.HandleFunc("POST /api/tables/{code}/invite", s.handle(s.inviteToRoom))
	api.HandleFunc("GET /api/ws", s.socket)
	api.HandleFunc("/api/", s.handle(func(http.ResponseWriter, *http.Request) (any, error) {
		return nil, httpError{http.StatusNotFound, "Route inconnue"}
	}))

	// The session travels in a cookie, so a request that changes anything must
	// come from our own pages.
	sameOrigin := http.NewCrossOriginProtection()
	sameOrigin.SetDenyHandler(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		writeJSON(w, http.StatusForbidden, map[string]string{"error": "Requête refusée : origine étrangère"})
	}))

	mux := http.NewServeMux()
	mux.Handle("/api/", sameOrigin.Handler(api))
	mux.HandleFunc("GET /healthz", func(w http.ResponseWriter, r *http.Request) {
		if err := st.Ping(r.Context()); err != nil {
			http.Error(w, "database unavailable", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		io.WriteString(w, "ok\n")
	})
	// The address a player shares, /u/Bing, leads to the profile page, which
	// is one static file for every player. The page's own files sit in the
	// same folder; a pseudo has no dot, so they are told apart.
	mux.HandleFunc("GET /u/{name}", func(w http.ResponseWriter, r *http.Request) {
		if name := r.PathValue("name"); nameRule.MatchString(name) {
			http.Redirect(w, r, "/u/?n="+url.QueryEscape(name), http.StatusFound)
			return
		}
		files.ServeHTTP(w, r)
	})
	mux.Handle("/", files)
	s.handler = s.middleware(mux)
	return s, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) { s.handler.ServeHTTP(w, r) }

// Housekeeping forgets expired sessions and idle rate-limit entries until ctx
// is done.
func (s *Server) Housekeeping(ctx context.Context) {
	tick := time.NewTicker(10 * time.Minute)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-tick.C:
			if err := s.store.PurgeSessions(ctx); err != nil && ctx.Err() == nil {
				s.log.Error("purge sessions", "err", err)
			}
			s.authLimit.sweep()
			s.inviteLimit.sweep()
			s.tableLimit.sweep()
			s.reportLimit.sweep()
			s.hub.Sweep()
			s.presence.sweep()
		}
	}
}

// ---------- plumbing ----------

type httpError struct {
	status int
	msg    string
}

func (e httpError) Error() string { return e.msg }

func bad(msg string) error { return httpError{http.StatusBadRequest, msg} }

var (
	errAuth     = httpError{http.StatusUnauthorized, "Connexion requise"}
	errNoPlayer = httpError{http.StatusNotFound, "Aucun joueur ne porte ce pseudo"}
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(v)
}

func (s *Server) handle(fn func(http.ResponseWriter, *http.Request) (any, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxBody)
		out, err := fn(w, r)
		if err == nil {
			writeJSON(w, http.StatusOK, out)
			return
		}
		status, msg := http.StatusInternalServerError, "Erreur interne"
		var he httpError
		var tooBig *http.MaxBytesError
		switch {
		case errors.As(err, &he):
			status, msg = he.status, he.msg
		case errors.As(err, &tooBig):
			status, msg = http.StatusRequestEntityTooLarge, "Requête trop volumineuse"
		case errors.Is(err, context.Canceled):
			status, msg = 499, "Requête abandonnée"
		default:
			s.log.Error("request failed", "method", r.Method, "path", r.URL.Path, "err", err)
		}
		writeJSON(w, status, map[string]string{"error": msg})
	}
}

type statusWriter struct {
	http.ResponseWriter
	status int
}

func (w *statusWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

// Unwrap lets a WebSocket take the connection over.
func (w *statusWriter) Unwrap() http.ResponseWriter { return w.ResponseWriter }

// The interface loads nothing from another site. Next.js starts its pages
// with inline scripts.
const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; " +
	"img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"

func (s *Server) middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		h := w.Header()
		h.Set("Content-Security-Policy", csp)
		h.Set("X-Content-Type-Options", "nosniff")
		h.Set("Referrer-Policy", "same-origin")
		h.Set("Cross-Origin-Opener-Policy", "same-origin")
		if s.secure(r) {
			h.Set("Strict-Transport-Security", "max-age=31536000")
		}
		sw := &statusWriter{ResponseWriter: w, status: http.StatusOK}
		start := time.Now()
		defer func() {
			if v := recover(); v != nil {
				if v == http.ErrAbortHandler {
					panic(v)
				}
				s.log.Error("panic", "method", r.Method, "path", r.URL.Path, "panic", v)
				if sw.status == http.StatusOK {
					writeJSON(sw, http.StatusInternalServerError, map[string]string{"error": "Erreur interne"})
				}
			}
			// One line per API call; never the body, which may hold a password.
			if strings.HasPrefix(r.URL.Path, "/api/") {
				s.log.Info("api", "method", r.Method, "path", r.URL.Path, "status", sw.status, "ms", time.Since(start).Milliseconds(), "ip", s.clientIP(r))
			}
		}()
		next.ServeHTTP(sw, r)
	})
}

func (s *Server) secure(r *http.Request) bool {
	return r.TLS != nil || (s.cfg.TrustProxy && r.Header.Get("X-Forwarded-Proto") == "https")
}

func (s *Server) clientIP(r *http.Request) string {
	if s.cfg.TrustProxy {
		// The last entry is the one our own proxy wrote; earlier ones are the
		// client's word.
		parts := strings.Split(r.Header.Get("X-Forwarded-For"), ",")
		if ip := strings.TrimSpace(parts[len(parts)-1]); ip != "" {
			return ip
		}
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func readJSON(r *http.Request, v any) error {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		return err
	}
	if len(body) == 0 {
		return nil
	}
	if err := json.Unmarshal(body, v); err != nil {
		return bad("JSON invalide")
	}
	return nil
}

// ---------- accounts ----------

var nameRule = regexp.MustCompile(`^[A-Za-z0-9_-]{3,16}$`)

type credentials struct {
	Name     string `json:"name"`
	Password string `json:"password"`
	// Email is read when registering only.
	Email string `json:"email"`
}

// account is what a signed-in player learns about themselves.
type account struct {
	Name  string `json:"name"`
	Since int64  `json:"since"`
	// Invitations waiting for an answer.
	Received int `json:"received"`
	// How the player looks, what they are working towards and what it unlocks.
	Avatar     string          `json:"avatar"`
	Objectives []objectiveView `json:"objectives"`
	Streak     store.Streak    `json:"streak"`
	// Credits to spend, what was bought, and the animation the name wears.
	Credits int      `json:"credits"`
	Items   []string `json:"items"`
	Fx      string   `json:"fx"`
	// What today's games have paid, out of the most a day may pay.
	EarnedToday int `json:"earnedToday"`
	DailyCap    int `json:"dailyCap"`
	// The address a lost password is recovered through, and who is blocked.
	Email string `json:"email"`
	// EmailChecked says the address was confirmed by the link sent to it.
	EmailChecked bool     `json:"emailChecked"`
	Blocked      []string `json:"blocked"`
}

func (s *Server) account(ctx context.Context, u *store.User) (map[string]any, error) {
	_, received, err := s.store.Counts(ctx, u.ID)
	if err != nil {
		return nil, err
	}
	p, streak, err := s.progress(ctx, u.ID)
	if err != nil {
		return nil, err
	}
	items, err := s.store.Items(ctx, u.ID)
	if err != nil {
		return nil, err
	}
	blocked, err := s.store.Blocked(ctx, u.ID)
	if err != nil {
		return nil, err
	}
	return map[string]any{"user": account{Name: u.Name, Since: u.Since, Received: received, Avatar: u.Avatar, Objectives: objectiveViews(p), Streak: streak, Credits: u.Credits, Items: items, Fx: u.Fx,
		EarnedToday: u.EarnedToday, DailyCap: store.CreditsPerDay, Email: u.Email, EmailChecked: u.EmailChecked, Blocked: blocked}}, nil
}

func tokenHash(token string) string {
	sum := sha256.Sum256([]byte(token))
	return hex.EncodeToString(sum[:])
}

func (s *Server) openSession(w http.ResponseWriter, r *http.Request, userID string) error {
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return err
	}
	token := hex.EncodeToString(raw)
	if err := s.store.CreateSession(r.Context(), userID, tokenHash(token), time.Now().Add(sessionLife)); err != nil {
		return err
	}
	// Lax, not Strict: a profile link opened from a chat must still show the
	// visitor as signed in. Changes are protected by the same-origin check.
	http.SetCookie(w, &http.Cookie{
		Name: cookieName, Value: token, Path: "/", MaxAge: int(sessionLife.Seconds()),
		HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: s.secure(r),
	})
	return nil
}

// user returns the signed-in account, or nil.
func (s *Server) user(r *http.Request) (*store.User, error) {
	c, err := r.Cookie(cookieName)
	if err != nil || len(c.Value) != 64 {
		return nil, nil
	}
	u, err := s.store.UserBySession(r.Context(), tokenHash(c.Value))
	if errors.Is(err, store.ErrNotFound) {
		return nil, nil
	}
	if err == nil {
		// Any request from a signed-in page says its player is around.
		s.presence.touch(u.ID)
	}
	return u, err
}

func (s *Server) signedIn(r *http.Request) (*store.User, error) {
	u, err := s.user(r)
	if err == nil && u == nil {
		err = errAuth
	}
	return u, err
}

func (s *Server) throttleAuth(r *http.Request) error {
	if !s.authLimit.allow(s.clientIP(r)) {
		return httpError{http.StatusTooManyRequests, "Trop de tentatives, réessayez plus tard"}
	}
	return nil
}

func (s *Server) register(w http.ResponseWriter, r *http.Request) (any, error) {
	if err := s.throttleAuth(r); err != nil {
		return nil, err
	}
	var c credentials
	if err := readJSON(r, &c); err != nil {
		return nil, err
	}
	if !nameRule.MatchString(c.Name) {
		return nil, bad("Pseudo : 3 à 16 caractères (lettres, chiffres, _ et -)")
	}
	if foulName(c.Name) {
		return nil, bad("Ce pseudo n'est pas accepté")
	}
	if len(c.Password) < 8 || len(c.Password) > 128 {
		return nil, bad("Mot de passe : 8 caractères minimum")
	}
	email := strings.TrimSpace(c.Email)
	if !validEmail(email) {
		return nil, bad("Cette adresse e-mail n'est pas valable")
	}
	u, err := s.store.CreateUser(r.Context(), c.Name, hashPassword(c.Password), email)
	if errors.Is(err, store.ErrNameTaken) {
		return nil, httpError{http.StatusConflict, "Ce pseudo est déjà pris"}
	}
	if errors.Is(err, store.ErrEmailUsed) {
		return nil, httpError{http.StatusConflict, "Cette adresse est déjà utilisée par un autre compte"}
	}
	if err != nil {
		return nil, err
	}
	if err := s.openSession(w, r, u.ID); err != nil {
		return nil, err
	}
	s.sendCheck(r, u)
	return s.account(r.Context(), u)
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) (any, error) {
	if err := s.throttleAuth(r); err != nil {
		return nil, err
	}
	var c credentials
	if err := readJSON(r, &c); err != nil {
		return nil, err
	}
	id, hash, err := s.store.Credentials(r.Context(), c.Name)
	if errors.Is(err, store.ErrNotFound) {
		id, hash, err = "", dummyHash, nil
	}
	if err != nil {
		return nil, err
	}
	if len(c.Password) > 128 || !checkPassword(hash, c.Password) || id == "" {
		return nil, httpError{http.StatusUnauthorized, "Pseudo ou mot de passe incorrect"}
	}
	if err := s.openSession(w, r, id); err != nil {
		return nil, err
	}
	u, err := s.store.User(r.Context(), id)
	if err != nil {
		return nil, err
	}
	return s.account(r.Context(), u)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) (any, error) {
	if c, err := r.Cookie(cookieName); err == nil {
		if err := s.store.DeleteSession(r.Context(), tokenHash(c.Value)); err != nil {
			return nil, err
		}
	}
	http.SetCookie(w, &http.Cookie{Name: cookieName, Path: "/", MaxAge: -1, HttpOnly: true, SameSite: http.SameSiteLaxMode, Secure: s.secure(r)})
	return struct{}{}, nil
}

// me answers a visitor without a session too ("user": null): the interface
// asks on every page, and that is not an error.
func (s *Server) me(w http.ResponseWriter, r *http.Request) (any, error) {
	u, err := s.user(r)
	if err != nil {
		return nil, err
	}
	if u == nil {
		// A guest sees what there is to reach, with nothing reached yet.
		return map[string]any{"user": nil, "objectives": objectiveViews(&progress{})}, nil
	}
	return s.account(r.Context(), u)
}

// ---------- profiles and friends ----------

// player finds the account a pseudo names.
func (s *Server) player(ctx context.Context, name string) (*store.User, error) {
	if !nameRule.MatchString(name) {
		return nil, errNoPlayer
	}
	u, err := s.store.UserByName(ctx, name)
	if errors.Is(err, store.ErrNotFound) {
		return nil, errNoPlayer
	}
	return u, err
}

// profile is public: anyone with the address may read it. It says nothing
// about who a player's friends are, only how many.
func (s *Server) profile(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	p, err := s.player(ctx, r.PathValue("name"))
	if err != nil {
		return nil, err
	}
	stats, err := s.store.Stats(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	friends, _, err := s.store.Counts(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	prog, _, err := s.progress(ctx, p.ID)
	if err != nil {
		return nil, err
	}
	done := 0
	for _, o := range objectiveViews(prog) {
		if o.Done {
			done++
		}
	}
	out := map[string]any{"name": p.Name, "since": p.Since, "friends": friends, "stats": stats, "avatar": p.Avatar, "fx": p.Fx, "done": done, "objectives": len(objectives)}
	viewer, err := s.user(r)
	if err != nil {
		return nil, err
	}
	switch {
	case viewer == nil:
	case viewer.ID == p.ID:
		out["relation"] = "self"
	default:
		if out["relation"], err = s.store.Relation(ctx, viewer.ID, p.ID); err != nil {
			return nil, err
		}
	}
	return out, nil
}

func (s *Server) friends(w http.ResponseWriter, r *http.Request) (any, error) {
	u, err := s.signedIn(r)
	if err != nil {
		return nil, err
	}
	list, err := s.store.Friends(r.Context(), u.ID)
	if err != nil {
		return nil, err
	}
	s.present(list)
	// With the friends come the rooms they are inviting this player to.
	return struct {
		*store.FriendList
		Invites []roomInvite `json:"invites"`
	}{list, s.presence.invitesFor(u.ID)}, nil
}

// friend handles POST /api/friends/invite, accept and remove. "remove" undoes
// whatever ties the two players: it declines, cancels or unfriends.
func (s *Server) friend(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	u, err := s.signedIn(r)
	if err != nil {
		return nil, err
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := readJSON(r, &body); err != nil {
		return nil, err
	}
	other, err := s.player(ctx, strings.TrimSpace(body.Name))
	if err != nil {
		return nil, err
	}
	if other.ID == u.ID {
		return nil, bad("C'est votre propre pseudo")
	}
	rel := store.None
	switch r.PathValue("action") {
	case "invite":
		if blocked, err := s.store.Blocks(ctx, u.ID, other.ID); err != nil {
			return nil, err
		} else if blocked {
			return nil, httpError{http.StatusForbidden, "Ce joueur n'est pas joignable"}
		}
		if !s.inviteLimit.allow(u.ID) {
			return nil, httpError{http.StatusTooManyRequests, "Trop d'invitations d'un coup, réessayez dans un instant"}
		}
		rel, err = s.store.Invite(ctx, u.ID, other.ID)
		if errors.Is(err, store.ErrTooMany) {
			return nil, httpError{http.StatusConflict, "Trop d'invitations sans réponse : annulez-en avant d'en envoyer d'autres"}
		}
	case "accept":
		rel = store.Friends
		err = s.store.Accept(ctx, u.ID, other.ID)
		if errors.Is(err, store.ErrNotFound) {
			return nil, httpError{http.StatusConflict, "Cette invitation n'existe plus"}
		}
	case "remove":
		err = s.store.Unlink(ctx, u.ID, other.ID)
	default:
		return nil, httpError{http.StatusNotFound, "Route inconnue"}
	}
	if err != nil {
		return nil, err
	}
	return map[string]string{"name": other.Name, "relation": rel}, nil
}
