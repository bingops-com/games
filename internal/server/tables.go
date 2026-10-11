package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/coder/websocket"

	"github.com/bingops-com/games/internal/room"
)

const (
	// A connection that sends more than this is not a player.
	socketBurst = 60
	socketRate  = 30 // messages per second
	socketMax   = 4096
)

func (s *Server) openTable(w http.ResponseWriter, r *http.Request) (any, error) {
	if !s.tableLimit.allow(s.clientIP(r)) {
		return nil, httpError{http.StatusTooManyRequests, "Trop de salons ouverts d'un coup, réessayez dans un instant"}
	}
	var body struct {
		Game   string `json:"game"`
		Public bool   `json:"public"`
	}
	if err := readJSON(r, &body); err != nil {
		return nil, err
	}
	t, err := s.hub.Create(body.Game, body.Public)
	switch {
	case errors.Is(err, room.ErrNoGame):
		return nil, bad("Jeu inconnu")
	case errors.Is(err, room.ErrTooMany):
		return nil, httpError{http.StatusServiceUnavailable, "Tous les salons sont pris, réessayez plus tard"}
	case err != nil:
		return nil, err
	}
	return map[string]string{"code": t.Code, "game": t.Game()}, nil
}

// rooms lists the public rooms waiting for players.
func (s *Server) rooms(w http.ResponseWriter, r *http.Request) (any, error) {
	return map[string]any{"rooms": s.hub.Public()}, nil
}

func tableCode(raw string) string { return strings.ToUpper(strings.TrimSpace(raw)) }

func (s *Server) table(w http.ResponseWriter, r *http.Request) (any, error) {
	t := s.hub.Get(tableCode(r.PathValue("code")))
	if t == nil {
		return nil, httpError{http.StatusNotFound, "Aucun salon ne porte ce code"}
	}
	return map[string]string{"code": t.Code, "game": t.Game()}, nil
}

// who names the player behind a connection: the account when there is one,
// otherwise the guest the page describes.
func (s *Server) who(r *http.Request) (room.Who, error) {
	u, err := s.user(r)
	if err != nil {
		return room.Who{}, err
	}
	if u != nil {
		return room.Who{ID: "u:" + u.Name, Name: u.Name, UserID: u.ID, Avatar: u.Avatar, Fx: u.Fx}, nil
	}
	q := r.URL.Query()
	guest, name := q.Get("guest"), strings.TrimSpace(q.Get("name"))
	if len(guest) < 16 || len(guest) > 64 {
		return room.Who{}, bad("Invité inconnu")
	}
	if name == "" || utf8.RuneCountInString(name) > 16 || strings.ContainsFunc(name, func(r rune) bool { return r < ' ' }) || foulName(name) {
		name = "Invité"
	}
	// The guest id is the guest's secret: the others see a digest of it.
	sum := sha256.Sum256([]byte(guest))
	// A guest wears free parts only.
	avatar, _ := cleanAvatar(q.Get("avatar"), nil)
	return room.Who{ID: "g:" + hex.EncodeToString(sum[:8]), Name: name, Avatar: avatar}, nil
}

// socket connects a player to a table for as long as the page stays open.
func (s *Server) socket(w http.ResponseWriter, r *http.Request) {
	t := s.hub.Get(tableCode(r.URL.Query().Get("code")))
	if t == nil {
		writeJSON(w, http.StatusNotFound, map[string]string{"error": "Aucun salon ne porte ce code"})
		return
	}
	who, err := s.who(r)
	if err != nil {
		writeJSON(w, http.StatusBadRequest, map[string]string{"error": "Invité inconnu"})
		return
	}
	// Accept refuses a page from another origin.
	conn, err := websocket.Accept(w, r, nil)
	if err != nil {
		return
	}
	defer conn.CloseNow()
	conn.SetReadLimit(socketMax)
	c, err := t.Join(who)
	if err != nil {
		conn.Close(websocket.StatusPolicyViolation, err.Error())
		return
	}
	defer c.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()
	go func() {
		defer cancel()
		ping := time.NewTicker(25 * time.Second)
		defer ping.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case msg, ok := <-c.Send:
				if !ok {
					conn.Close(websocket.StatusNormalClosure, "")
					return
				}
				wctx, done := context.WithTimeout(ctx, 10*time.Second)
				err := conn.Write(wctx, websocket.MessageText, msg)
				done()
				if err != nil {
					return
				}
			case <-ping.C:
				pctx, done := context.WithTimeout(ctx, 10*time.Second)
				err := conn.Ping(pctx)
				done()
				if err != nil {
					return
				}
			}
		}
	}()

	tokens, last := float64(socketBurst), time.Now()
	for {
		_, msg, err := conn.Read(ctx)
		if err != nil {
			return
		}
		now := time.Now()
		tokens = min(socketBurst, tokens+now.Sub(last).Seconds()*socketRate)
		last = now
		if tokens < 1 {
			conn.Close(websocket.StatusPolicyViolation, "Trop de messages")
			return
		}
		tokens--
		c.Handle(msg)
	}
}
