package server

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strings"
)

// block handles POST /api/blocks/add and /remove: a player who does not want
// to hear from another. Neither can invite the other any more, as a friend or
// into a room; the page hides what the blocked player writes.
func (s *Server) block(w http.ResponseWriter, r *http.Request) (any, error) {
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
	switch r.PathValue("action") {
	case "add":
		if err := s.store.Block(ctx, u.ID, other.ID); err != nil {
			return nil, err
		}
		// A blocked player is no friend.
		err = s.store.Unlink(ctx, u.ID, other.ID)
	case "remove":
		err = s.store.Unblock(ctx, u.ID, other.ID)
	default:
		return nil, httpError{http.StatusNotFound, "Route inconnue"}
	}
	if err != nil {
		return nil, err
	}
	blocked, err := s.store.Blocked(ctx, u.ID)
	return map[string]any{"blocked": blocked}, err
}

var reportReasons = map[string]bool{"insultes": true, "dessin": true, "pseudo": true, "triche": true, "autre": true}

// report handles POST /api/report: a player tells whoever runs the site about
// another. Nothing happens by itself; the report waits in the database with
// what the reported player last wrote in the room.
func (s *Server) report(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	var body struct {
		Room   string `json:"room"`
		Target string `json:"target"`
		Reason string `json:"reason"`
		Text   string `json:"text"`
	}
	if err := readJSON(r, &body); err != nil {
		return nil, err
	}
	if !reportReasons[body.Reason] {
		return nil, bad("Motif inconnu")
	}
	if len(body.Text) > 500 {
		return nil, bad("Texte trop long")
	}
	u, err := s.user(r)
	if err != nil {
		return nil, err
	}
	// A guest is told apart by a digest of their address, never the address.
	reporter := "invité "
	if u != nil {
		reporter = u.Name
	} else {
		sum := sha256.Sum256([]byte(s.clientIP(r)))
		reporter += hex.EncodeToString(sum[:6])
	}
	if !s.reportLimit.allow(reporter) {
		return nil, httpError{http.StatusTooManyRequests, "Trop de signalements d'un coup, réessayez plus tard"}
	}
	t := s.hub.Get(tableCode(body.Room))
	if t == nil {
		return nil, httpError{http.StatusNotFound, "Aucun salon ne porte ce code"}
	}
	name, said, ok := t.Describe(body.Target)
	if !ok {
		return nil, bad("Ce joueur n'est plus dans le salon")
	}
	detail := strings.TrimSpace(body.Text)
	if len(said) > 0 {
		detail += "\n--- ses derniers messages ---\n" + strings.Join(said, "\n")
	}
	if err := s.store.Report(ctx, reporter, name+" ("+body.Target+")", t.Code, body.Reason, detail); err != nil {
		return nil, err
	}
	s.log.Warn("player reported", "room", t.Code, "target", name, "reason", body.Reason)
	return struct{}{}, nil
}
