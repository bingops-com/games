package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"

	"github.com/bingops-com/games/internal/store"
)

// Each code has 128 random bits. Formatting is for readability only; only a
// domain-separated SHA-256 hash reaches the database. No expiry: codes are
// offline credentials until used or explicitly replaced by their owner.
func newRecoveryCodes() ([]string, []string, error) {
	codes := make([]string, store.RecoveryCodeCount)
	hashes := make([]string, len(codes))
	for i := range codes {
		var raw [16]byte
		if _, err := rand.Read(raw[:]); err != nil {
			return nil, nil, err
		}
		text := hex.EncodeToString(raw[:])
		codes[i] = text[:8] + "-" + text[8:16] + "-" + text[16:24] + "-" + text[24:]
		hashes[i] = recoveryHash(text)
	}
	return codes, hashes, nil
}

func recoveryHash(code string) string {
	return tokenHash("games-recovery-code:" + code)
}

func normalizeRecoveryCode(code string) (string, bool) {
	if len(code) > 128 {
		return "", false
	}
	code = strings.ToLower(strings.NewReplacer("-", "", " ", "", "\t", "", "\n", "", "\r", "").Replace(code))
	if len(code) != 32 {
		return "", false
	}
	_, err := hex.DecodeString(code)
	return code, err == nil
}

// confirmed rechecks the current password before changing recovery credentials.
func (s *Server) confirmed(r *http.Request, password string) (*store.User, string, error) {
	u, err := s.signedIn(r)
	if err != nil {
		return nil, "", err
	}
	if err := s.throttleAuth(r); err != nil {
		return nil, "", err
	}
	_, hash, err := s.store.Credentials(r.Context(), u.Name)
	if err != nil {
		return nil, "", err
	}
	if len(password) > 128 || !checkPassword(hash, password) {
		return nil, "", httpError{http.StatusForbidden, "Mot de passe incorrect"}
	}
	return u, hash, nil
}

func (s *Server) accountWithCodes(ctx context.Context, u *store.User, codes []string) (any, error) {
	response, err := s.account(ctx, u)
	if err != nil {
		return nil, err
	}
	response["recoveryCodes"] = codes
	return response, nil
}

func (s *Server) regenerateRecoveryCodes(w http.ResponseWriter, r *http.Request) (any, error) {
	var body struct {
		Password string `json:"password"`
	}
	if err := readJSON(r, &body); err != nil {
		return nil, err
	}
	u, verifiedHash, err := s.confirmed(r, body.Password)
	if err != nil {
		return nil, err
	}
	codes, hashes, err := newRecoveryCodes()
	if err != nil {
		return nil, err
	}
	keep := ""
	if cookie, err := r.Cookie(cookieName); err == nil {
		keep = tokenHash(cookie.Value)
	}
	if err := s.store.SetRecoveryCodes(r.Context(), u.ID, verifiedHash, keep, hashes); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return nil, errAuth
		}
		return nil, err
	}
	s.sockets.revoke("", u.ID, keep)
	u.RecoveryCodesRemaining = len(codes)
	return s.accountWithCodes(r.Context(), u, codes)
}

func (s *Server) setPassword(w http.ResponseWriter, r *http.Request) (any, error) {
	var body struct {
		Old string `json:"old"`
		New string `json:"new"`
	}
	if err := readJSON(r, &body); err != nil {
		return nil, err
	}
	u, verifiedHash, err := s.confirmed(r, body.Old)
	if err != nil {
		return nil, err
	}
	if len(body.New) < 8 || len(body.New) > 128 {
		return nil, bad("Mot de passe : 8 caractères minimum")
	}
	keep := ""
	if c, err := r.Cookie(cookieName); err == nil {
		keep = tokenHash(c.Value)
	}
	if err := s.store.SetPassword(r.Context(), u.ID, hashPassword(body.New), keep, verifiedHash); err != nil {
		if errors.Is(err, store.ErrNotFound) {
			return nil, errAuth
		}
		return nil, err
	}
	s.sockets.revoke("", u.ID, keep)
	return struct{}{}, nil
}

// reset accepts a username and an offline code. Unknown users, wrong codes
// and already-used codes have the same response. Codes never enter a URL.
func (s *Server) reset(w http.ResponseWriter, r *http.Request) (any, error) {
	if err := s.throttleAuth(r); err != nil {
		return nil, err
	}
	var body struct {
		Name     string `json:"name"`
		Code     string `json:"code"`
		Password string `json:"password"`
	}
	if err := readJSON(r, &body); err != nil {
		return nil, err
	}
	if len(body.Password) < 8 || len(body.Password) > 128 {
		return nil, bad("Mot de passe : 8 caractères minimum")
	}
	name := strings.TrimSpace(body.Name)
	invalid := httpError{http.StatusBadRequest, "Pseudo ou code de récupération incorrect"}
	code, valid := normalizeRecoveryCode(body.Code)
	if !nameRule.MatchString(name) || !valid {
		return nil, invalid
	}
	if !s.recoveryLimit.allow(strings.ToLower(name)) {
		return nil, httpError{http.StatusTooManyRequests, "Trop de tentatives, réessayez plus tard"}
	}
	hash := recoveryHash(code)
	found, err := s.store.HasRecoveryCode(r.Context(), name, hash)
	if err != nil {
		return nil, err
	}
	if !found {
		return nil, invalid
	}
	passwordHash := hashPassword(body.Password)
	id, err := s.store.RecoverPassword(r.Context(), name, hash, passwordHash)
	if errors.Is(err, store.ErrNotFound) {
		return nil, invalid
	}
	if err != nil {
		return nil, err
	}
	s.sockets.revoke("", id, "")
	if err := s.openSession(w, r, id, passwordHash); err != nil {
		return nil, err
	}
	u, err := s.store.User(r.Context(), id)
	if err != nil {
		return nil, err
	}
	return s.account(r.Context(), u)
}
