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

// A link to choose a new password works once, for this long; one to confirm
// an address, for longer: it may wait in a mailbox.
const (
	resetLife = time.Hour
	checkLife = 3 * 24 * time.Hour
)

var emailRule = regexp.MustCompile(`^[^@\s]+@[^@\s]+\.[^@\s]+$`)

func validEmail(email string) bool {
	return len(email) <= 254 && emailRule.MatchString(email)
}

// confirmed returns the signed-in account once it has given its password
// again: changing how an account is recovered takes more than a session.
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

// baseURL is where the links sent by mail lead.
func (s *Server) baseURL(_ *http.Request) string {
	return strings.TrimRight(s.cfg.PublicURL, "/")
}

func newToken() string {
	raw := make([]byte, 32)
	rand.Read(raw)
	return hex.EncodeToString(raw)
}

// sendCheck mails the link that confirms the address of an account. It leaves
// after the answer, like every message.
func (s *Server) sendCheck(r *http.Request, u *store.User) {
	base, id, name, email := s.baseURL(r), u.ID, u.Name, u.Email
	if email == "" || s.cfg.Mail == nil {
		return
	}
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 40*time.Second)
		defer cancel()
		token := newToken()
		if err := s.store.CreateCheck(ctx, id, email, tokenHash(token), time.Now().Add(checkLife)); err != nil {
			s.log.Error("create check", "err", err)
			return
		}
		link := base + "/confirmer/?t=" + token
		text := "Bonjour " + name + ",\n\n" +
			"Cette adresse a été donnée pour votre compte lab.bingo games. Pour la confirmer, ouvrez ce lien, valable trois jours :\n\n" +
			link + "\n\n" +
			"Elle ne sert qu'à retrouver un mot de passe perdu. Si ce compte n'est pas le vôtre, ignorez ce message.\n\n" +
			"---\n\n" +
			"Hello " + name + ",\n\n" +
			"This address was given for your lab.bingo games account. To confirm it, open the link above; it works for three days. It is only used to recover a lost password. If this account is not yours, ignore this message.\n"
		if err := s.cfg.Mail.Send(ctx, email, "Confirmez votre adresse lab.bingo games", text); err != nil {
			s.log.Error("send check", "err", err)
		}
	}()
}

// resendCheck sends the confirmation link again.
func (s *Server) resendCheck(w http.ResponseWriter, r *http.Request) (any, error) {
	u, err := s.signedIn(r)
	if err != nil {
		return nil, err
	}
	if err := s.throttleAuth(r); err != nil {
		return nil, err
	}
	if u.Email == "" || u.EmailChecked {
		return nil, bad("Il n'y a pas d'adresse à confirmer")
	}
	if s.cfg.Mail == nil {
		return nil, httpError{http.StatusServiceUnavailable, "L'envoi d'e-mail n'est pas configuré"}
	}
	s.sendCheck(r, u)
	return struct{}{}, nil
}

// confirm marks an address as confirmed, with the link sent to it. It needs
// no session: the link is often opened on another device.
func (s *Server) confirm(w http.ResponseWriter, r *http.Request) (any, error) {
	if err := s.throttleAuth(r); err != nil {
		return nil, err
	}
	var body struct {
		Token string `json:"token"`
	}
	if err := readJSON(r, &body); err != nil {
		return nil, err
	}
	email, err := s.store.ConfirmEmail(r.Context(), tokenHash(body.Token))
	if errors.Is(err, store.ErrNotFound) {
		return nil, httpError{http.StatusGone, "Ce lien ne marche plus : demandez-en un nouveau"}
	}
	if err != nil {
		return nil, err
	}
	return map[string]string{"email": email}, nil
}

// setEmail changes the address a lost password can be recovered through. An
// account keeps one: it may be changed, not removed.
func (s *Server) setEmail(w http.ResponseWriter, r *http.Request) (any, error) {
	var body struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := readJSON(r, &body); err != nil {
		return nil, err
	}
	u, verifiedHash, err := s.confirmed(r, body.Password)
	if err != nil {
		return nil, err
	}
	email := strings.TrimSpace(body.Email)
	if !validEmail(email) {
		return nil, bad("Cette adresse e-mail n'est pas valable")
	}
	err = s.store.SetEmail(r.Context(), u.ID, email, verifiedHash)
	if errors.Is(err, store.ErrNotFound) {
		return nil, errAuth
	}
	if errors.Is(err, store.ErrEmailUsed) {
		return nil, httpError{http.StatusConflict, "Cette adresse est déjà utilisée par un autre compte"}
	}
	if err != nil {
		return nil, err
	}
	// Another address is to be confirmed again.
	fresh, err := s.store.User(r.Context(), u.ID)
	if err != nil {
		return nil, err
	}
	if !fresh.EmailChecked {
		s.sendCheck(r, fresh)
	}
	return map[string]any{"email": email, "emailChecked": fresh.EmailChecked}, nil
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

// forgot sends a link to choose a new password to the address of the account
// a pseudo or an address names, once that address is confirmed. It answers
// the same whether the account exists, has such an address, or not: it must
// not tell who plays here.
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
	base := s.baseURL(r)
	if s.cfg.Mail == nil {
		return struct{}{}, nil
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
		// An address nobody confirmed may be someone else's: nothing goes there.
		if err != nil || u.Email == "" || !u.EmailChecked {
			return
		}
		// Resolve aliases first: the pseudo and email, from any address, share
		// one cooldown. Keep the HTTP answer neutral even when no mail leaves.
		if !s.recoveryLimit.allow(u.ID) {
			return
		}
		token := newToken()
		if err := s.store.CreateReset(ctx, u.ID, u.Email, tokenHash(token), time.Now().Add(resetLife)); err != nil {
			s.log.Error("create reset", "err", err)
			return
		}
		link := base + "/reinitialiser/?t=" + token
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
	_, err := s.store.ResetUser(ctx, tokenHash(body.Token))
	if errors.Is(err, store.ErrNotFound) {
		return nil, httpError{http.StatusGone, "Ce lien ne marche plus : demandez-en un nouveau"}
	}
	if err != nil {
		return nil, err
	}
	// Hash outside the transaction; consume the token and revoke atomically.
	passwordHash := hashPassword(body.Password)
	id, err := s.store.ResetPassword(ctx, tokenHash(body.Token), passwordHash)
	if errors.Is(err, store.ErrNotFound) {
		return nil, httpError{http.StatusGone, "Ce lien ne marche plus : demandez-en un nouveau"}
	}
	if err != nil {
		return nil, err
	}
	s.sockets.revoke("", id, "")
	if err := s.openSession(w, r, id, passwordHash); err != nil {
		return nil, err
	}
	u, err := s.store.User(ctx, id)
	if err != nil {
		return nil, err
	}
	return s.account(ctx, u)
}
