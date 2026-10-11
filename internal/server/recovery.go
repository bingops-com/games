package server

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"github.com/bingops-com/games/internal/store"
)

// A link to choose a new password works once, for this long.
const resetLife = time.Hour

var emailRule = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

func validEmail(email string) bool {
	return len(email) <= 254 && emailRule.MatchString(email)
}

// confirmed returns the signed-in account once it has given its password
// again: changing how an account is recovered takes more than a session.
func (s *Server) confirmed(r *http.Request, password string) (*store.User, error) {
	u, err := s.signedIn(r)
	if err != nil {
		return nil, err
	}
	if err := s.throttleAuth(r); err != nil {
		return nil, err
	}
	_, hash, err := s.store.Credentials(r.Context(), u.Name)
	if err != nil {
		return nil, err
	}
	if len(password) > 128 || !checkPassword(hash, password) {
		return nil, httpError{http.StatusForbidden, "Mot de passe incorrect"}
	}
	return u, nil
}

// setEmail saves the address a lost password can be recovered through, or
// removes it when it is empty.
func (s *Server) setEmail(w http.ResponseWriter, r *http.Request) (any, error) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := readJSON(r, &body); err != nil {
		return nil, err
	}
	u, err := s.confirmed(r, body.Password)
	if err != nil {
		return nil, err
	}
	email := strings.TrimSpace(body.Email)
	if email != "" && !validEmail(email) {
		return nil, bad("Cette adresse e-mail n'est pas valable")
	}
	err = s.store.SetEmail(r.Context(), u.ID, email)
	if errors.Is(err, store.ErrEmailUsed) {
		return nil, httpError{http.StatusConflict, "Cette adresse est déjà utilisée par un autre compte"}
	}
	if err != nil {
		return nil, err
	}
	return map[string]string{"email": email}, nil
}

// setPassword changes the password and closes the other sessions.
func (s *Server) setPassword(w http.ResponseWriter, r *http.Request) (any, error) {
	var body struct {
		Old string `json:"old"`
		New string `json:"new"`
	}
	if err := readJSON(r, &body); err != nil {
		return nil, err
	}
	u, err := s.confirmed(r, body.Old)
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
	if err := s.store.SetPassword(r.Context(), u.ID, hashPassword(body.New), keep); err != nil {
		return nil, err
	}
	return struct{}{}, nil
}

// forgot sends a link to choose a new password to the address of the account
// a pseudo or an address names. It answers the same whether the account
// exists, has an address, or not: it must not tell who plays here.
func (s *Server) forgot(w http.ResponseWriter, r *http.Request) (any, error) {
	if err := s.throttleAuth(r); err != nil {
		return nil, err
	}
	var body struct {
		Name string `json:"name"`
	}
	if err := readJSON(r, &body); err != nil {
		return nil, err
	}
	who := strings.TrimSpace(body.Name)
	base := s.cfg.PublicURL
	if base == "" {
		scheme := "http"
		if s.secure(r) {
			scheme = "https"
		}
		base = scheme + "://" + r.Host
	}
	// The message leaves after the answer: how long it takes must not tell
	// whether there was one to send.
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
		defer cancel()
		var u *store.User
		var err error
		if strings.Contains(who, "@") {
			u, err = s.store.UserByEmail(ctx, who)
		} else if nameRule.MatchString(who) {
			u, err = s.store.UserByName(ctx, who)
		} else {
			return
		}
		if err != nil || u.Email == "" {
			return
		}
		raw := make([]byte, 32)
		rand.Read(raw)
		token := hex.EncodeToString(raw)
		if err := s.store.CreateReset(ctx, u.ID, tokenHash(token), time.Now().Add(resetLife)); err != nil {
			s.log.Error("create reset", "err", err)
			return
		}
		link := strings.TrimRight(base, "/") + "/reinitialiser/?t=" + token
		text := "Bonjour " + u.Name + ",\n\n" +
			"Quelqu'un a demandé à choisir un nouveau mot de passe pour votre compte lab.bingo games. Si c'est vous, ouvrez ce lien, valable une heure :\n\n" +
			link + "\n\n" +
			"Si ce n'est pas vous, ignorez ce message : votre mot de passe ne change pas.\n\n" +
			"---\n\n" +
			"Hello " + u.Name + ",\n\n" +
			"Someone asked to choose a new password for your lab.bingo games account. If it was you, open the link above; it works for one hour. If it was not you, ignore this message: your password stays the same.\n"
		if err := s.cfg.Mail.Send(ctx, u.Email, "Votre mot de passe lab.bingo games", text); err != nil {
			s.log.Error("send reset", "err", err)
		}
	}()
	return struct{}{}, nil
}

// reset chooses a new password with a link received by mail, and signs in.
func (s *Server) reset(w http.ResponseWriter, r *http.Request) (any, error) {
	if err := s.throttleAuth(r); err != nil {
		return nil, err
	}
	var body struct {
		Token    string `json:"token"`
		Password string `json:"password"`
	}
	if err := readJSON(r, &body); err != nil {
		return nil, err
	}
	if len(body.Password) < 8 || len(body.Password) > 128 {
		return nil, bad("Mot de passe : 8 caractères minimum")
	}
	ctx := r.Context()
	id, err := s.store.ResetUser(ctx, tokenHash(body.Token))
	if errors.Is(err, store.ErrNotFound) {
		return nil, httpError{http.StatusGone, "Ce lien ne marche plus : demandez-en un nouveau"}
	}
	if err != nil {
		return nil, err
	}
	// Every session closes, and the link with them.
	if err := s.store.SetPassword(ctx, id, hashPassword(body.Password), ""); err != nil {
		return nil, err
	}
	if err := s.openSession(w, r, id); err != nil {
		return nil, err
	}
	u, err := s.store.User(ctx, id)
	if err != nil {
		return nil, err
	}
	return s.account(ctx, u)
}
