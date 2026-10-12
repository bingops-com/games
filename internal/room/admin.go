package room

import "slices"

// AdminRoom is metadata only: never expose chat or a game's private state.
type AdminRoom struct {
	Code    string `json:"code"`
	Game    string `json:"game"`
	Phase   string `json:"phase"`
	Public  bool   `json:"public"`
	Players int    `json:"players"`
	Online  int    `json:"online"`
}

func (h *Hub) AdminRooms() []AdminRoom {
	h.mu.Lock()
	rooms := make([]*Room, 0, len(h.rooms))
	for _, r := range h.rooms {
		rooms = append(rooms, r)
	}
	h.mu.Unlock()
	out := make([]AdminRoom, 0, len(rooms))
	for _, r := range rooms {
		r.mu.Lock()
		online := 0
		for _, m := range r.members {
			if m.conns > 0 {
				online++
			}
		}
		out = append(out, AdminRoom{r.Code, r.spec.ID, r.phase, r.public, len(r.members), online})
		r.mu.Unlock()
	}
	slices.SortFunc(out, func(a, b AdminRoom) int {
		if a.Code < b.Code {
			return -1
		}
		if a.Code > b.Code {
			return 1
		}
		return 0
	})
	return out
}
