package server

import (
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/bingops-com/games/internal/store"
)

const (
	// A player is online for this long after their last request: the page
	// asks for its friends more often than that.
	onlineFor = 50 * time.Second
	// An invitation to a room is offered for this long.
	inviteFor  = 2 * time.Minute
	maxInvites = 10
)

// roomInvite asks a friend to come and play.
type roomInvite struct {
	From   string `json:"from"`
	Avatar string `json:"avatar"`
	Code   string `json:"code"`
	Game   string `json:"game"`
	at     time.Time
}

// presence remembers, in memory, who was seen lately and who was invited
// where. It is lost on restart, like the rooms.
type presence struct {
	mu      sync.Mutex
	seen    map[string]time.Time
	invites map[string][]roomInvite
}

func newPresence() *presence {
	return &presence{seen: map[string]time.Time{}, invites: map[string][]roomInvite{}}
}

func (p *presence) touch(userID string) {
	p.mu.Lock()
	p.seen[userID] = time.Now()
	p.mu.Unlock()
}

func (p *presence) online(userID string) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return time.Since(p.seen[userID]) < onlineFor
}

// invite offers a room to a player; a second invitation to the same room
// replaces the first.
func (p *presence) invite(to string, inv roomInvite) {
	p.mu.Lock()
	defer p.mu.Unlock()
	list := p.pending(to)
	for i, old := range list {
		if old.Code == inv.Code {
			list = append(list[:i], list[i+1:]...)
			break
		}
	}
	if len(list) >= maxInvites {
		list = list[1:]
	}
	p.invites[to] = append(list, inv)
}

// pending returns the invitations still on offer. The caller holds the lock.
func (p *presence) pending(to string) []roomInvite {
	list := p.invites[to][:0:0]
	for _, inv := range p.invites[to] {
		if time.Since(inv.at) < inviteFor {
			list = append(list, inv)
		}
	}
	if len(list) == 0 {
		delete(p.invites, to)
	} else {
		p.invites[to] = list
	}
	return list
}

func (p *presence) invitesFor(to string) []roomInvite {
	p.mu.Lock()
	defer p.mu.Unlock()
	return append([]roomInvite{}, p.pending(to)...)
}

// sweep forgets who has not been seen for a while and what has expired.
func (p *presence) sweep() {
	p.mu.Lock()
	defer p.mu.Unlock()
	for id, at := range p.seen {
		if time.Since(at) > 10*onlineFor {
			delete(p.seen, id)
		}
	}
	for id := range p.invites {
		p.pending(id)
	}
}

// present says, for each friend, whether they are on the site and where.
func (s *Server) present(list *store.FriendList) {
	for i := range list.Friends {
		f := &list.Friends[i]
		f.Online = s.presence.online(f.ID)
		if f.Online {
			f.Room, f.Game = s.hub.RoomOf(f.ID)
		}
	}
}

// inviteToRoom handles POST /api/tables/{code}/invite: a player in a room asks
// one of their friends to join it.
func (s *Server) inviteToRoom(w http.ResponseWriter, r *http.Request) (any, error) {
	ctx := r.Context()
	u, err := s.signedIn(r)
	if err != nil {
		return nil, err
	}
	t := s.hub.Get(tableCode(r.PathValue("code")))
	if t == nil || !t.Has(u.ID) {
		return nil, httpError{http.StatusNotFound, "Vous n'êtes pas dans ce salon"}
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
	rel, err := s.store.Relation(ctx, u.ID, other.ID)
	if err != nil {
		return nil, err
	}
	if rel != store.Friends {
		return nil, bad("On n'invite dans un salon que ses amis")
	}
	if blocked, err := s.store.Blocks(ctx, u.ID, other.ID); err != nil {
		return nil, err
	} else if blocked {
		return nil, httpError{http.StatusForbidden, "Ce joueur n'est pas joignable"}
	}
	if !s.inviteLimit.allow(u.ID) {
		return nil, httpError{http.StatusTooManyRequests, "Trop d'invitations d'un coup, réessayez dans un instant"}
	}
	s.presence.invite(other.ID, roomInvite{From: u.Name, Avatar: u.Avatar, Code: t.Code, Game: t.Game(), at: time.Now()})
	return map[string]string{"name": other.Name}, nil
}
