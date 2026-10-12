package server

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"io"
	"net"
	"net/http"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"golang.org/x/oauth2"
)

// Admin authentication is separate from player accounts and proxy headers.
type AdminConfig struct {
	Enabled                           bool
	Issuer, ClientID, Username, Group string
}

func (c Config) validateAdmin() error {
	if !c.Admin.Enabled {
		return nil
	}
	u, err := url.Parse(c.Admin.Issuer)
	if err != nil || u.Hostname() == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" || !strings.HasSuffix(u.Path, "/") {
		return errors.New("admin issuer must be an absolute URL with a trailing slash, without credentials, query or fragment")
	}
	loopback := net.ParseIP(u.Hostname())
	if u.Scheme != "https" && !(u.Scheme == "http" && !c.Production && loopback != nil && loopback.IsLoopback()) {
		return errors.New("admin issuer requires HTTPS (HTTP loopback is allowed only in development)")
	}
	if c.PublicURL == "" || c.Admin.ClientID == "" || c.Admin.Username == "" || c.Admin.Group == "" {
		return errors.New("admin requires public URL, client ID, username and dedicated group")
	}
	return nil
}

type adminFlow struct {
	state, nonce, verifier string
	expires                time.Time
}
type adminSession struct {
	subject, username, access, csrf string
	expires                         time.Time
}
type adminAuth struct {
	cfg           Config
	client        *http.Client
	providerMu    sync.Mutex
	provider      *oidc.Provider
	oauth         oauth2.Config
	verifier      *oidc.IDTokenVerifier
	mu            sync.Mutex
	flows         map[string]adminFlow
	sessions      map[string]adminSession
	limit, global *limiter
}

// Credentials can only be sent back to the configured issuer's HTTPS origin.
// Redirects and oversized discovery/JWKS/userinfo responses fail closed.
type issuerTransport struct {
	origin *url.URL
	base   http.RoundTripper
}
type limitedBody struct {
	io.Reader
	io.Closer
}

func (t issuerTransport) RoundTrip(r *http.Request) (*http.Response, error) {
	if r.URL.Scheme != t.origin.Scheme || r.URL.Host != t.origin.Host || r.URL.User != nil {
		return nil, errors.New("OIDC endpoint outside issuer origin")
	}
	res, err := t.base.RoundTrip(r)
	if err == nil {
		res.Body = limitedBody{io.LimitReader(res.Body, 1<<20), res.Body}
	}
	return res, err
}

func newAdminAuth(cfg Config) *adminAuth {
	u, _ := url.Parse(cfg.Admin.Issuer)
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.MaxConnsPerHost = 8
	return &adminAuth{cfg: cfg, client: &http.Client{Timeout: 6 * time.Second, Transport: issuerTransport{u, transport}, CheckRedirect: func(*http.Request, []*http.Request) error { return errors.New("OIDC redirect refused") }},
		flows: map[string]adminFlow{}, sessions: map[string]adminSession{}, limit: newLimiter(1.0/10, 8), global: newLimiter(5, 20)}
}

func (a *adminAuth) context(ctx context.Context) context.Context {
	return oidc.ClientContext(ctx, a.client)
}
func (a *adminAuth) discover(ctx context.Context) error {
	a.providerMu.Lock()
	defer a.providerMu.Unlock()
	if a.provider != nil {
		return nil
	}
	p, err := oidc.NewProvider(a.context(ctx), a.cfg.Admin.Issuer)
	if err != nil {
		return err
	}
	var meta struct {
		JWKS string `json:"jwks_uri"`
	}
	if err := p.Claims(&meta); err != nil {
		return err
	}
	origin, _ := url.Parse(a.cfg.Admin.Issuer)
	for _, raw := range []string{p.Endpoint().AuthURL, p.Endpoint().TokenURL, p.UserInfoEndpoint(), meta.JWKS} {
		u, err := url.Parse(raw)
		if err != nil || u.Scheme != origin.Scheme || u.Host != origin.Host || u.User != nil || u.Fragment != "" {
			return errors.New("untrusted OIDC endpoint")
		}
	}
	a.oauth = oauth2.Config{ClientID: a.cfg.Admin.ClientID, RedirectURL: strings.TrimSuffix(a.cfg.PublicURL, "/") + "/api/admin/callback", Endpoint: p.Endpoint(), Scopes: []string{oidc.ScopeOpenID, "profile", "groups"}}
	// Public PKCE client: no Basic credentials, secret or refresh token.
	a.oauth.Endpoint.AuthStyle = oauth2.AuthStyleInParams
	a.verifier = p.VerifierContext(a.context(context.Background()), &oidc.Config{ClientID: a.cfg.Admin.ClientID, SupportedSigningAlgs: []string{oidc.RS256}})
	a.provider = p
	return nil
}

func adminRandom() string {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	return base64.RawURLEncoding.EncodeToString(b)
}
func (a *adminAuth) prune() {
	now := time.Now()
	for key, flow := range a.flows {
		if !now.Before(flow.expires) {
			delete(a.flows, key)
		}
	}
	for key, session := range a.sessions {
		if !now.Before(session.expires) {
			delete(a.sessions, key)
		}
	}
}
func (a *adminAuth) cookie(w http.ResponseWriter, kind, value string, life time.Duration) {
	name := "games_admin_" + kind
	if a.cfg.Production {
		name = "__Host-" + name
	}
	maxAge := int(life.Seconds())
	if life < 0 {
		maxAge = -1
	}
	http.SetCookie(w, &http.Cookie{Name: name, Value: value, Path: "/", HttpOnly: true, Secure: a.cfg.Production, SameSite: http.SameSiteLaxMode, MaxAge: maxAge})
}
func (a *adminAuth) key(r *http.Request, kind string) string {
	name := "games_admin_" + kind
	if a.cfg.Production {
		name = "__Host-" + name
	}
	c, err := r.Cookie(name)
	if err != nil || len(c.Value) != 43 {
		return ""
	}
	return tokenHash(c.Value)
}

func adminHeaders(w http.ResponseWriter) {
	w.Header().Set("Cache-Control", "no-store")
	w.Header().Set("Referrer-Policy", "no-referrer")
	w.Header().Set("X-Robots-Tag", "noindex, nofollow")
}
func (s *Server) adminLogin(w http.ResponseWriter, r *http.Request) {
	adminHeaders(w)
	a := s.admin
	if a == nil {
		http.NotFound(w, r)
		return
	}
	if !a.limit.allow(s.clientIP(r)) || !a.global.allow("login") {
		http.Error(w, "Réessayez dans un instant", 429)
		return
	}
	if err := a.discover(r.Context()); err != nil {
		http.Error(w, "Authentik indisponible", 503)
		return
	}
	raw := adminRandom()
	f := adminFlow{adminRandom(), adminRandom(), oauth2.GenerateVerifier(), time.Now().Add(5 * time.Minute)}
	a.mu.Lock()
	a.prune()
	if len(a.flows) >= 128 {
		a.mu.Unlock()
		http.Error(w, "Réessayez dans un instant", 503)
		return
	}
	// A new attempt invalidates this browser's previous pending flow.
	delete(a.flows, a.key(r, "flow"))
	a.flows[tokenHash(raw)] = f
	a.mu.Unlock()
	a.cookie(w, "flow", raw, 5*time.Minute)
	http.Redirect(w, r, a.oauth.AuthCodeURL(f.state, oidc.Nonce(f.nonce), oauth2.S256ChallengeOption(f.verifier)), http.StatusSeeOther)
}

func (s *Server) adminCallback(w http.ResponseWriter, r *http.Request) {
	adminHeaders(w)
	a := s.admin
	if a == nil {
		http.NotFound(w, r)
		return
	}
	a.cookie(w, "flow", "", -time.Second)
	a.mu.Lock()
	a.prune()
	f, ok := a.flows[a.key(r, "flow")]
	delete(a.flows, a.key(r, "flow"))
	a.mu.Unlock()
	state, code := r.URL.Query().Get("state"), r.URL.Query().Get("code")
	if !ok || len(state) != 43 || subtle.ConstantTimeCompare([]byte(state), []byte(f.state)) != 1 || code == "" || len(code) > 4096 || r.URL.Query().Get("error") != "" {
		http.Redirect(w, r, "/admin/connexion/?erreur=connexion", http.StatusSeeOther)
		return
	}
	if err := a.discover(r.Context()); err != nil {
		http.Redirect(w, r, "/admin/connexion/?erreur=indisponible", 303)
		return
	}
	token, err := a.oauth.Exchange(a.context(r.Context()), code, oauth2.VerifierOption(f.verifier))
	if err != nil {
		http.Redirect(w, r, "/admin/connexion/?erreur=connexion", 303)
		return
	}
	rawID, _ := token.Extra("id_token").(string)
	id, err := a.verifier.Verify(a.context(r.Context()), rawID)
	if err != nil || id.Subject == "" || subtle.ConstantTimeCompare([]byte(id.Nonce), []byte(f.nonce)) != 1 || token.AccessToken == "" {
		http.Redirect(w, r, "/admin/connexion/?erreur=connexion", 303)
		return
	}
	var claims struct {
		AZP string `json:"azp"`
	}
	if id.Claims(&claims) != nil || (claims.AZP != "" && claims.AZP != a.cfg.Admin.ClientID) || (len(id.Audience) > 1 && claims.AZP != a.cfg.Admin.ClientID) {
		http.Redirect(w, r, "/admin/connexion/?erreur=connexion", 303)
		return
	}
	session := adminSession{subject: id.Subject, access: token.AccessToken, csrf: adminRandom(), expires: minTime(id.Expiry, time.Now().Add(15*time.Minute))}
	if !token.Expiry.IsZero() {
		session.expires = minTime(session.expires, token.Expiry)
	}
	name, err := a.identity(r.Context(), session)
	if err != nil {
		http.Redirect(w, r, "/admin/connexion/?erreur=acces", 303)
		return
	}
	session.username = name
	raw := adminRandom()
	a.mu.Lock()
	a.prune()
	if len(a.sessions) >= 64 {
		a.mu.Unlock()
		http.Redirect(w, r, "/admin/connexion/?erreur=indisponible", 303)
		return
	}
	delete(a.sessions, a.key(r, "session"))
	a.sessions[tokenHash(raw)] = session
	a.mu.Unlock()
	a.cookie(w, "session", raw, time.Until(session.expires))
	s.log.Info("admin login", "subject", session.subject, "username", name)
	http.Redirect(w, r, "/admin/", 303)
}
func minTime(a, b time.Time) time.Time {
	if a.Before(b) {
		return a
	}
	return b
}

var errAdminRole = httpError{403, "Accès réservé à l’administrateur Authentik"}

func (a *adminAuth) identity(ctx context.Context, session adminSession) (string, error) {
	info, err := a.provider.UserInfo(a.context(ctx), oauth2.StaticTokenSource(&oauth2.Token{AccessToken: session.access, TokenType: "Bearer"}))
	if err != nil {
		return "", httpError{503, "Vérification Authentik indisponible"}
	}
	var claims struct {
		Username string   `json:"preferred_username"`
		Groups   []string `json:"groups"`
		Allowed  bool     `json:"games_admin"`
	}
	if info.Claims(&claims) != nil || info.Subject != session.subject || claims.Username != a.cfg.Admin.Username || !slices.Contains(claims.Groups, a.cfg.Admin.Group) || !claims.Allowed {
		return "", errAdminRole
	}
	return claims.Username, nil
}

func (s *Server) requireAdmin(w http.ResponseWriter, r *http.Request, mutation bool) (adminSession, error) {
	adminHeaders(w)
	a := s.admin
	if a == nil {
		return adminSession{}, httpError{404, "Route inconnue"}
	}
	a.mu.Lock()
	a.prune()
	session, ok := a.sessions[a.key(r, "session")]
	a.mu.Unlock()
	if !ok {
		return adminSession{}, errAuth
	}
	if !a.global.allow("requests") {
		return adminSession{}, httpError{429, "Réessayez dans un instant"}
	}
	if mutation && subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Admin-CSRF")), []byte(session.csrf)) != 1 {
		return adminSession{}, httpError{403, "Action refusée"}
	}
	if _, err := a.identity(r.Context(), session); err != nil {
		if errors.Is(err, errAdminRole) {
			a.mu.Lock()
			delete(a.sessions, a.key(r, "session"))
			a.mu.Unlock()
			a.cookie(w, "session", "", -time.Second)
		}
		return adminSession{}, err
	}
	// Logout or expiry during the upstream check must not resurrect access.
	a.mu.Lock()
	current, ok := a.sessions[a.key(r, "session")]
	a.mu.Unlock()
	if !ok || !time.Now().Before(current.expires) {
		return adminSession{}, errAuth
	}
	return session, nil
}

func (s *Server) adminPage(files http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		adminHeaders(w)
		if s.admin == nil {
			http.NotFound(w, r)
			return
		}
		if r.URL.Path == "/admin/connexion/" || r.URL.Path == "/admin/connexion/index.html" || r.URL.Path == "/admin/connexion/index.txt" {
			origin, _ := url.Parse(s.cfg.Admin.Issuer)
			w.Header().Set("Content-Security-Policy", strings.Replace(csp, "form-action 'self'", "form-action 'self' "+origin.Scheme+"://"+origin.Host, 1))
			files.ServeHTTP(w, r)
			return
		}
		if _, err := s.requireAdmin(w, r, false); err != nil {
			var e httpError
			if errors.As(err, &e) && e.status == 503 {
				http.Error(w, e.msg, 503)
				return
			}
			http.Redirect(w, r, "/admin/connexion/", http.StatusSeeOther)
			return
		}
		files.ServeHTTP(w, r)
	})
}

func (s *Server) adminLogout(w http.ResponseWriter, r *http.Request) (any, error) {
	adminHeaders(w)
	a := s.admin
	if a == nil {
		return nil, httpError{404, "Route inconnue"}
	}
	a.mu.Lock()
	session, ok := a.sessions[a.key(r, "session")]
	a.mu.Unlock()
	if ok && subtle.ConstantTimeCompare([]byte(r.Header.Get("X-Admin-CSRF")), []byte(session.csrf)) != 1 {
		return nil, httpError{403, "Action refusée"}
	}
	a.mu.Lock()
	delete(a.sessions, a.key(r, "session"))
	a.mu.Unlock()
	a.cookie(w, "session", "", -time.Second)
	return map[string]bool{"ok": true}, nil
}
