package server

import (
	"context"
	"sync"
)

const (
	maxSockets            = 256
	maxSocketsPerIP       = 24
	maxSocketsPerIdentity = 3
)

type socketLease struct {
	ip, identity, user, token string
	cancel                    context.CancelFunc
}

// liveSockets bounds resources and disconnects revoked sessions immediately.
// Cancel outside the lock: releasing a lease uses the same mutex.
type liveSockets struct {
	mu     sync.Mutex
	leases map[*socketLease]bool
}

func (s *liveSockets) acquire(ip, identity, user, token string, cancel context.CancelFunc) (*socketLease, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if len(s.leases) >= maxSockets {
		return nil, false
	}
	var addresses, identities int
	for l := range s.leases {
		if l.ip == ip {
			addresses++
		}
		if l.identity == identity {
			identities++
		}
	}
	if addresses >= maxSocketsPerIP || identities >= maxSocketsPerIdentity {
		return nil, false
	}
	if s.leases == nil {
		s.leases = make(map[*socketLease]bool)
	}
	l := &socketLease{ip: ip, identity: identity, user: user, token: token, cancel: cancel}
	s.leases[l] = true
	return l, true
}

func (s *liveSockets) release(l *socketLease) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.leases, l)
}

// Match one token, or every token of a user except keep (empty keeps none).
func (s *liveSockets) revoke(token, user, keep string) {
	s.mu.Lock()
	var stops []context.CancelFunc
	for l := range s.leases {
		if (token != "" && l.token == token) || (user != "" && l.user == user && l.token != keep) {
			stops = append(stops, l.cancel)
		}
	}
	s.mu.Unlock()
	for _, stop := range stops {
		stop()
	}
}
