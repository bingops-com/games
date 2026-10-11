// Package room runs the tables: who sits at each one, the game being played
// there, and what every connected player is shown. Tables live in memory: they
// are gone when the server restarts, and two instances do not share them.
package room

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"maps"
	mrand "math/rand/v2"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/bingops-com/games/internal/games"
)

const (
	codeLength = 4
	// Without I or O, which read as 1 and 0 when a code is spelt out.
	codeLetters = "ABCDEFGHJKLMNPQRSTUVWXYZ"
	maxRooms    = 500
	// Players and people watching, at one table.
	maxMembers = 24
	// How many may sit down before a game starts: the largest game takes twelve.
	lobbySeats = 12
	// The game a room opens on when none is asked for.
	defaultGame = "terre"
	// An empty table is kept this long, for a player who reloads the page.
	emptyLife = 10 * time.Minute
	// EmptyLife is the same, for whoever restores rooms after a restart.
	EmptyLife = emptyLife
	// A player who lost the connection during a game is taken out after this.
	awayLife = 45 * time.Second
	// A player brought back by a restart keeps their place this long.
	ghostLife = 2 * time.Minute
	// What a room remembers of its conversation, and how long a line may be.
	chatKept = 40
	chatMax  = 200
	// A host's own list of words: how many, and how long each.
	wordsMax   = 300
	wordLength = 24
)

var (
	ErrNoRoom  = errors.New("room: no such table")
	ErrTooMany = errors.New("room: too many tables")
	ErrNoGame  = errors.New("room: unknown game")
)

// Error is a refusal written for the player.
type Error string

func (e Error) Error() string { return string(e) }

// ErrBanned answers a player the host removed from the room.
const ErrBanned = Error("L'hôte vous a retiré de ce salon")

// Who is the identity of a player at a table.
type Who struct {
	// ID is unique and may be shown to the others.
	ID   string
	Name string
	// UserID is the account behind the player, empty for a guest.
	UserID string
	// Avatar is how the player looks, as the server package writes it, or empty.
	Avatar string
	// Fx is the animation their name wears, or empty.
	Fx string
}

type member struct {
	Who
	conns int
	// seat in the game being played, -1 for someone watching.
	seat int
	left time.Time // when the last connection closed
	// wins counts the games won in this room, for as long as the player stays.
	wins int
}

// Client is one connection to a table.
type Client struct {
	room *Room
	id   string
	// Send carries what the connection must write; it is closed when the
	// client is dropped.
	Send chan []byte
	gone bool
}

type Hub struct {
	mu    sync.Mutex
	rooms map[string]*Room
	// Record is told of each finished game, for the players with an account.
	Record func(userID, game string, won bool)
	Log    *slog.Logger
	// Clean rewrites what players write to each other; nil leaves it as is.
	Clean func(text string) string
	// Save is told what a room needs to come back after a restart, each time
	// that changes; Forget is told when the room closes.
	Save   func(code string, state []byte)
	Forget func(code string)
}

func NewHub(log *slog.Logger) *Hub {
	return &Hub{rooms: map[string]*Room{}, Log: log}
}

type Room struct {
	hub  *Hub
	mu   sync.Mutex
	Code string
	spec games.Spec

	members []*member // in order of arrival; the first is the host
	clients map[*Client]bool
	phase   string // "lobby", "playing", "over"
	game    games.Game
	winners []int
	stop    chan struct{}
	empty   time.Time // since when nobody is connected
	// banned holds the players the host removed: they do not come back.
	banned map[string]bool
	// gone holds the seats that walked out of the game being played. void says
	// the game ended because one did: it counts for nobody.
	gone map[int]bool
	void bool
	// public says anyone may find the room and join it.
	public bool
	// limit is how many players the host wants at most, 0 for as many as the
	// chosen game takes.
	limit int
	// byVote says the players choose the game together: the one with the most
	// votes is chosen. Otherwise the host chooses, and a vote is a wish. votes
	// holds the game each member voted for.
	byVote bool
	votes  map[string]string
	// unsaved is the state waiting to be written, and saving says a write is
	// under way.
	unsaved []byte
	saving  bool
	// opts and words are the host's settings for the chosen game.
	opts  map[string]int
	words []string
	// played counts the games finished here.
	played int
	chat   []ChatLine
	chatID int
	// dirty says something a restart must not lose has changed.
	dirty bool
}

// ChatLine is one thing a player said in a room.
type ChatLine struct {
	ID   int    `json:"id"`
	From string `json:"from"`
	Name string `json:"name"`
	Text string `json:"text"`
	At   int64  `json:"at"`
}

// saved is what a room keeps across a restart: who is there, what they
// chose and the evening's score. A game being played is not kept.
type saved struct {
	Game    string         `json:"game"`
	Public  bool           `json:"public"`
	Limit   int            `json:"limit,omitempty"`
	ByVote  bool           `json:"byVote,omitempty"`
	Opts    map[string]int `json:"opts,omitempty"`
	Words   []string       `json:"words,omitempty"`
	Banned  []string       `json:"banned,omitempty"`
	Played  int            `json:"played"`
	Members []savedMember  `json:"members"`
}

type savedMember struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
	Fx     string `json:"fx,omitempty"`
	UserID string `json:"user,omitempty"`
	Wins   int    `json:"wins"`
}

// Restore reopens a room saved before a restart, in its lobby. Its players
// are expected back: their pages reconnect by themselves.
func (h *Hub) Restore(code string, state []byte) {
	var sv saved
	if json.Unmarshal(state, &sv) != nil {
		return
	}
	spec, ok := games.Specs[sv.Game]
	if !ok {
		return
	}
	now := time.Now()
	r := &Room{hub: h, Code: code, spec: spec, clients: map[*Client]bool{}, phase: "lobby", empty: now,
		public: sv.Public, limit: sv.Limit, byVote: sv.ByVote, opts: sv.Opts, words: sv.Words, played: sv.Played, banned: map[string]bool{}}
	for _, id := range sv.Banned {
		r.banned[id] = true
	}
	for _, m := range sv.Members {
		r.members = append(r.members, &member{Who: Who{ID: m.ID, Name: m.Name, Avatar: m.Avatar, Fx: m.Fx, UserID: m.UserID}, seat: -1, wins: m.Wins, left: now})
	}
	h.mu.Lock()
	if h.rooms[code] == nil {
		h.rooms[code] = r
	}
	h.mu.Unlock()
}

// persist hands the hub what a restart must not lose, when it has changed.
// The caller holds the lock.
func (r *Room) persist() {
	if !r.dirty || r.hub.Save == nil {
		return
	}
	r.dirty = false
	sv := saved{Game: r.spec.ID, Public: r.public, Limit: r.limit, ByVote: r.byVote, Opts: r.opts, Words: r.words, Played: r.played}
	for id := range r.banned {
		sv.Banned = append(sv.Banned, id)
	}
	for _, m := range r.members {
		sv.Members = append(sv.Members, savedMember{ID: m.ID, Name: m.Name, Avatar: m.Avatar, Fx: m.Fx, UserID: m.UserID, Wins: m.wins})
	}
	raw, err := json.Marshal(sv)
	if err != nil {
		return
	}
	// One save at a time, and always the latest state: two of them written
	// side by side could land in the wrong order and bring back an old room.
	r.unsaved = raw
	if !r.saving {
		r.saving = true
		go r.save()
	}
}

// save writes what the room last asked to keep, until nothing is left.
func (r *Room) save() {
	for {
		r.mu.Lock()
		raw := r.unsaved
		r.unsaved = nil
		if raw == nil {
			r.saving = false
			r.mu.Unlock()
			return
		}
		r.mu.Unlock()
		r.hub.Save(r.Code, raw)
	}
}

// PublicRoom is a room anyone may join, as the home page lists it.
type PublicRoom struct {
	Code string `json:"code"`
	Game string `json:"game"`
	Host string `json:"host"`
	// Avatar is how the host looks.
	Avatar  string `json:"avatar"`
	Players int    `json:"players"`
	// Min is how many players the game needs, Max how many the room takes:
	// the host's limit, or what the game allows.
	Min int `json:"min"`
	Max int `json:"max"`
}

// seats is how many players the room takes while it waits: the host's limit,
// or as many as the chosen game allows.
func (r *Room) seats() int {
	most := min(lobbySeats, r.spec.Max)
	if r.limit > 0 {
		return min(r.limit, most)
	}
	return most
}

// Public lists the public rooms waiting for players, fullest first.
func (h *Hub) Public() []PublicRoom {
	h.mu.Lock()
	rooms := make([]*Room, 0, len(h.rooms))
	for _, r := range h.rooms {
		rooms = append(rooms, r)
	}
	h.mu.Unlock()
	out := []PublicRoom{}
	for _, r := range rooms {
		r.mu.Lock()
		on := 0
		for _, m := range r.members {
			if m.conns > 0 {
				on++
			}
		}
		if r.public && r.phase == "lobby" && on > 0 && len(r.members) < r.seats() {
			out = append(out, PublicRoom{Code: r.Code, Game: r.spec.ID, Host: r.members[0].Name, Avatar: r.members[0].Avatar, Players: len(r.members), Min: r.spec.Min, Max: r.seats()})
		}
		r.mu.Unlock()
	}
	slices.SortFunc(out, func(a, b PublicRoom) int { return b.Players - a.Players })
	return out
}

// Create opens a room. The host may change its game for as long as nothing is
// being played.
func (h *Hub) Create(game string, public bool) (*Room, error) {
	if game == "" {
		game = defaultGame
	}
	spec, ok := games.Specs[game]
	if !ok {
		return nil, ErrNoGame
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	if len(h.rooms) >= maxRooms {
		return nil, ErrTooMany
	}
	for {
		raw := make([]byte, codeLength)
		rand.Read(raw)
		for i, b := range raw {
			raw[i] = codeLetters[int(b)%len(codeLetters)]
		}
		code := string(raw)
		if h.rooms[code] == nil {
			r := &Room{hub: h, Code: code, spec: spec, clients: map[*Client]bool{}, phase: "lobby", empty: time.Now(), public: public}
			h.rooms[code] = r
			return r, nil
		}
	}
}

// RoomOf says which room an account is connected to, and the game chosen
// there; both are empty when it is in none.
func (h *Hub) RoomOf(userID string) (code, game string) {
	h.mu.Lock()
	rooms := make([]*Room, 0, len(h.rooms))
	for _, r := range h.rooms {
		rooms = append(rooms, r)
	}
	h.mu.Unlock()
	for _, r := range rooms {
		r.mu.Lock()
		for _, m := range r.members {
			if m.UserID == userID && m.conns > 0 {
				code, game = r.Code, r.spec.ID
			}
		}
		r.mu.Unlock()
		if code != "" {
			return
		}
	}
	return
}

// Describe returns the name of a player of the room and what they last said
// in it, for a report.
func (r *Room) Describe(id string) (name string, said []string, ok bool) {
	r.mu.Lock()
	defer r.mu.Unlock()
	m := r.member(id)
	if m == nil {
		return "", nil, false
	}
	for _, line := range r.chat {
		if line.From == id {
			said = append(said, line.Text)
		}
	}
	return m.Name, said, true
}

// Has says whether an account is connected to this room.
func (r *Room) Has(userID string) bool {
	r.mu.Lock()
	defer r.mu.Unlock()
	for _, m := range r.members {
		if m.UserID == userID && m.conns > 0 {
			return true
		}
	}
	return false
}

func (h *Hub) Get(code string) *Room {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.rooms[code]
}

// Game returns the id of the game a table is for.
func (r *Room) Game() string { return r.spec.ID }

// Sweep forgets the tables nobody has been connected to for a while.
func (h *Hub) Sweep() {
	h.mu.Lock()
	defer h.mu.Unlock()
	for code, r := range h.rooms {
		r.mu.Lock()
		if len(r.clients) == 0 && time.Since(r.empty) > emptyLife {
			r.halt()
			delete(h.rooms, code)
			if h.Forget != nil {
				go h.Forget(code)
			}
		}
		// A player a restart brought back, and who never reconnected, leaves.
		if r.phase == "lobby" {
			before := len(r.members)
			r.members = slices.DeleteFunc(r.members, func(m *member) bool { return m.conns == 0 && time.Since(m.left) > ghostLife })
			if len(r.members) != before {
				r.dirty = true
				r.broadcast()
			}
		}
		r.mu.Unlock()
	}
}

func (r *Room) member(id string) *member {
	for _, m := range r.members {
		if m.ID == id {
			return m
		}
	}
	return nil
}

// Join connects a player to the table. A player already there (another tab,
// or back after a lost connection) keeps their place.
func (r *Room) Join(who Who) (*Client, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.banned[who.ID] {
		return nil, ErrBanned
	}
	m := r.member(who.ID)
	if m == nil {
		// During a game a newcomer watches; they play the next one.
		// A room without a limit takes more players than its game: the host
		// may still change game.
		if (r.phase == "lobby" && (len(r.members) >= lobbySeats || (r.limit > 0 && len(r.members) >= r.limit))) || len(r.members) >= maxMembers {
			return nil, Error("Ce salon est complet")
		}
		m = &member{Who: who, seat: -1}
		r.members = append(r.members, m)
	}
	m.Name, m.Avatar, m.Fx = who.Name, who.Avatar, who.Fx
	m.conns++
	r.dirty = true
	c := &Client{room: r, id: who.ID, Send: make(chan []byte, 64)}
	r.clients[c] = true
	// What was said before they arrived.
	c.push(map[string]any{"t": "chats", "list": append([]ChatLine{}, r.chat...)})
	r.broadcast()
	return c, nil
}

// Close ends a connection. In the lobby a player without a connection frees
// their place; during a game they keep it for a while.
func (c *Client) Close() {
	r := c.room
	r.mu.Lock()
	defer r.mu.Unlock()
	if !r.drop(c) {
		return
	}
	if m := r.member(c.id); m != nil {
		if m.conns--; m.conns == 0 {
			m.left = time.Now()
			if r.phase != "playing" {
				r.remove(m)
				r.dirty = true
			}
		}
	}
	if len(r.clients) == 0 {
		r.empty = time.Now()
	}
	r.broadcast()
}

func (r *Room) drop(c *Client) bool {
	if c.gone {
		return false
	}
	c.gone = true
	delete(r.clients, c)
	close(c.Send)
	return true
}

func (r *Room) remove(m *member) {
	r.members = slices.DeleteFunc(r.members, func(o *member) bool { return o == m })
}

// expel takes a player out of the room, and out of the game being played.
// Their connections are told why ("left" or "kicked") and closed.
func (r *Room) expel(m *member, why string, now time.Time) {
	if r.phase == "playing" && m.seat >= 0 {
		r.game.Drop(m.seat, now)
		r.gone[m.seat] = true
		r.finish(true)
	}
	r.remove(m)
	// Their other tabs go with them.
	for o := range r.clients {
		if o.id == m.ID {
			o.push(map[string]string{"t": why})
			r.drop(o)
		}
	}
	if len(r.clients) == 0 {
		r.empty = now
	}
}

func (r *Room) halt() {
	if r.stop != nil {
		close(r.stop)
		r.stop = nil
	}
}

// toLobby ends whatever is being played and keeps the players who are there.
// choose sets the game the room will play next.
func (r *Room) choose(spec games.Spec) {
	if r.phase == "over" {
		r.toLobby()
	}
	if r.spec.ID != spec.ID {
		// Each game has its own settings; the list of words is the host's.
		r.opts = nil
	}
	r.spec = spec
	// The limit follows the game: it never asks for more than it takes.
	if r.limit > 0 {
		r.limit = max(spec.Min, min(r.limit, spec.Max, lobbySeats))
	}
}

// tally counts the votes of those still in the room and, when the game is
// chosen by vote, chooses the one with the most. A tie keeps the game already
// chosen if it is among the leaders, else the first of them by name: the same
// votes always give the same game.
func (r *Room) tally() map[string]int {
	count := map[string]int{}
	for id, game := range r.votes {
		if r.member(id) == nil {
			delete(r.votes, id)
			continue
		}
		count[game]++
	}
	if !r.byVote || r.phase == "playing" || len(count) == 0 {
		return count
	}
	best := r.spec.ID
	for _, game := range slices.Sorted(maps.Keys(count)) {
		if count[game] > count[best] {
			best = game
		}
	}
	if best != r.spec.ID {
		r.choose(games.Specs[best])
	}
	return count
}

func (r *Room) toLobby() {
	r.halt()
	r.phase, r.game, r.winners = "lobby", nil, nil
	r.members = slices.DeleteFunc(r.members, func(m *member) bool { return m.conns == 0 })
	for _, m := range r.members {
		m.seat = -1
	}
}

type message struct {
	T  string          `json:"t"`
	ID string          `json:"id"`
	A  json.RawMessage `json:"a"`
}

// Handle applies a message received from a connection.
func (c *Client) Handle(raw []byte) {
	var msg message
	if json.Unmarshal(raw, &msg) != nil {
		return
	}
	r := c.room
	r.mu.Lock()
	defer r.mu.Unlock()
	if c.gone {
		return
	}
	if err := r.handle(c, msg); err != nil {
		var e Error
		var ge games.Error
		text := "Erreur interne"
		switch {
		case errors.As(err, &e):
			text = string(e)
		case errors.As(err, &ge):
			text = string(ge)
		default:
			r.hub.Log.Error("table", "code", r.Code, "err", err)
		}
		c.push(map[string]string{"t": "error", "msg": text})
		return
	}
	// A line of conversation went to everyone already and changes nothing else.
	if msg.T == "chat" {
		return
	}
	if msg.T != "act" {
		r.dirty = true
	}
	r.broadcast()
}

func (r *Room) handle(c *Client, msg message) error {
	m := r.member(c.id)
	if m == nil {
		return Error("Vous n'êtes plus dans ce salon")
	}
	host := len(r.members) > 0 && r.members[0] == m
	now := time.Now()
	switch msg.T {
	case "game":
		if !host || r.phase == "playing" {
			return Error("Seul l'hôte choisit le jeu, entre deux parties")
		}
		spec, ok := games.Specs[msg.ID]
		if !ok {
			return Error("Jeu inconnu")
		}
		if r.byVote {
			return Error("Le jeu se choisit au vote dans ce salon")
		}
		r.choose(spec)
	case "vote":
		if r.phase == "playing" {
			return Error("On vote entre deux parties")
		}
		if _, ok := games.Specs[msg.ID]; !ok {
			return Error("Jeu inconnu")
		}
		if r.votes == nil {
			r.votes = map[string]string{}
		}
		// Voting again for the same game takes the vote back.
		if r.votes[m.ID] == msg.ID {
			delete(r.votes, m.ID)
		} else {
			r.votes[m.ID] = msg.ID
		}
		r.tally()
	case "mode":
		if !host || r.phase == "playing" {
			return Error("Seul l'hôte règle la partie, entre deux parties")
		}
		r.byVote = string(msg.A) == `"vote"`
		r.tally()
	case "limit":
		if !host || r.phase == "playing" {
			return Error("Seul l'hôte règle la partie, entre deux parties")
		}
		var value int
		if json.Unmarshal(msg.A, &value) != nil {
			return Error("Réglage illisible")
		}
		// 0 takes the limit away. Nobody is sent out by a lower one.
		if r.limit = 0; value > 0 {
			r.limit = max(r.spec.Min, len(r.members), min(value, r.spec.Max, lobbySeats))
		}
	case "opt":
		if !host || r.phase == "playing" {
			return Error("Seul l'hôte règle la partie, entre deux parties")
		}
		var value int
		if json.Unmarshal(msg.A, &value) != nil {
			return Error("Réglage illisible")
		}
		for _, o := range r.spec.Options {
			if o.Key != msg.ID {
				continue
			}
			// 0 gives the choice back to the game, when it has one of its own.
			if value == 0 && o.Def == 0 {
				delete(r.opts, o.Key)
				return nil
			}
			value = max(o.Min, min(o.Max, value))
			value = o.Min + (value-o.Min)/o.Step*o.Step
			if r.opts == nil {
				r.opts = map[string]int{}
			}
			r.opts[o.Key] = value
			return nil
		}
		return Error("Réglage inconnu")
	case "words":
		if !host || r.phase == "playing" {
			return Error("Seul l'hôte règle la partie, entre deux parties")
		}
		if r.spec.Words == 0 {
			return Error("Ce jeu ne tire pas de mots")
		}
		var list []string
		if json.Unmarshal(msg.A, &list) != nil {
			return Error("Liste de mots illisible")
		}
		r.words = nil
		seen := map[string]bool{}
		for _, w := range list {
			w = strings.ToLower(strings.TrimSpace(w))
			if r.hub.Clean != nil {
				w = r.hub.Clean(w)
			}
			if w == "" || utf8.RuneCountInString(w) > wordLength || strings.ContainsAny(w, "*\n\t") || seen[w] {
				continue
			}
			seen[w] = true
			if r.words = append(r.words, w); len(r.words) == wordsMax {
				break
			}
		}
		if len(r.words) > 0 && len(r.words) < r.spec.Words {
			n := len(r.words)
			r.words = nil
			return Error(fmt.Sprintf("Il faut au moins %d mots pour ce jeu : la liste en compte %d", r.spec.Words, n))
		}
	case "public":
		if !host {
			return Error("Seul l'hôte ouvre ou ferme le salon")
		}
		r.public = string(msg.A) == "true"
	case "host":
		if !host {
			return Error("Seul l'hôte passe la main")
		}
		i := slices.IndexFunc(r.members, func(o *member) bool { return o.ID == msg.ID })
		if i <= 0 {
			return Error("Ce joueur n'est plus dans le salon")
		}
		next := r.members[i]
		r.members = slices.Insert(slices.Delete(r.members, i, i+1), 0, next)
	case "chat":
		var text string
		if json.Unmarshal(msg.A, &text) != nil {
			return Error("Message illisible")
		}
		text = strings.TrimSpace(strings.Map(func(c rune) rune {
			if c < ' ' {
				return ' '
			}
			return c
		}, text))
		if text == "" {
			return nil
		}
		if utf8.RuneCountInString(text) > chatMax {
			return Error("Message trop long")
		}
		if r.hub.Clean != nil {
			text = r.hub.Clean(text)
		}
		r.chatID++
		line := ChatLine{ID: r.chatID, From: m.ID, Name: m.Name, Text: text, At: now.UnixMilli()}
		if r.chat = append(r.chat, line); len(r.chat) > chatKept {
			r.chat = r.chat[len(r.chat)-chatKept:]
		}
		for o := range r.clients {
			o.push(map[string]any{"t": "chat", "m": line})
		}
	case "start":
		if !host || r.phase == "playing" {
			return Error("Seul l'hôte lance la partie")
		}
		if r.phase == "over" {
			r.toLobby()
		}
		if len(r.members) < r.spec.Min {
			return Error("Il manque des joueurs pour lancer la partie")
		}
		if len(r.members) > r.spec.Max {
			return Error("Il y a trop de joueurs dans ce salon pour ce jeu")
		}
		for seat, p := range r.members {
			p.seat = seat
		}
		var seed [32]byte
		rand.Read(seed[:])
		r.game = r.spec.New(len(r.members), mrand.New(mrand.NewChaCha8(seed)), now, games.Options{Values: r.opts, Words: r.words})
		r.phase, r.winners = "playing", nil
		r.gone, r.void = map[int]bool{}, false
		r.stop = make(chan struct{})
		go r.run(r.stop)
	case "lobby":
		if !host || r.phase == "lobby" {
			return Error("Seul l'hôte arrête la partie")
		}
		r.toLobby()
	case "leave":
		r.expel(m, "left", now)
	case "kick":
		if !host {
			return Error("Seul l'hôte retire un joueur")
		}
		out := r.member(msg.ID)
		if out == nil || out == m {
			return Error("Ce joueur n'est plus dans le salon")
		}
		if r.banned == nil {
			r.banned = map[string]bool{}
		}
		r.banned[out.ID] = true
		r.expel(out, "kicked", now)
	case "act":
		if r.phase != "playing" {
			return Error("Aucune partie n'est en cours")
		}
		if m.seat < 0 {
			return Error("Vous regardez cette partie : vous jouerez la suivante")
		}
		if err := r.game.Act(m.seat, msg.A, now); err != nil {
			return err
		}
		r.finish(false)
	default:
		return Error("Message inconnu")
	}
	return nil
}

// finish records the result once the game is over. Only a game played to its
// end counts: forfeit says a player just walked out, and a game that ends on
// that is void. A player who left earlier has nothing recorded either.
func (r *Room) finish(forfeit bool) {
	if r.phase != "playing" {
		return
	}
	over, winners := r.game.Winners()
	if !over {
		return
	}
	r.halt()
	r.void = forfeit
	r.phase, r.winners = "over", winners
	if winners == nil {
		r.winners = []int{}
	}
	r.dirty = true
	if r.void {
		return
	}
	r.played++
	// The room keeps its own tally, guests included.
	for _, m := range r.members {
		if m.seat >= 0 && slices.Contains(winners, m.seat) {
			m.wins++
		}
	}
	if r.hub.Record == nil {
		return
	}
	for _, m := range r.members {
		if m.seat >= 0 && m.UserID != "" && !r.gone[m.seat] {
			go r.hub.Record(m.UserID, r.spec.ID, slices.Contains(winners, m.seat))
		}
	}
}

// run lets time pass in the game until it is stopped.
func (r *Room) run(stop chan struct{}) {
	tick := time.NewTicker(r.spec.Rate)
	defer tick.Stop()
	for {
		select {
		case <-stop:
			return
		case now := <-tick.C:
			r.mu.Lock()
			if r.stop != stop {
				r.mu.Unlock()
				return
			}
			changed := r.game.Tick(now)
			// A game the clock ends is played out; one a walk-out ends is not.
			r.finish(false)
			dropped := false
			for _, m := range r.members {
				if r.phase == "playing" && m.seat >= 0 && m.conns == 0 && !m.left.IsZero() && now.Sub(m.left) > awayLife {
					r.game.Drop(m.seat, now)
					r.gone[m.seat] = true
					m.left = time.Time{}
					changed, dropped = true, true
				}
			}
			if dropped {
				r.finish(true)
			}
			if changed || r.phase != "playing" {
				r.broadcast()
			}
			r.mu.Unlock()
		}
	}
}

type memberView struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Avatar  string `json:"avatar"`
	Fx      string `json:"fx,omitempty"`
	Account bool   `json:"account"`
	On      bool   `json:"on"`
	Seat    int    `json:"seat"`
	// Wins is how many games the player has won in this room.
	Wins int `json:"wins"`
}

// optView is a setting as the lobby shows it. Value 0 means the game decides.
type optView struct {
	Key   string `json:"key"`
	Min   int    `json:"min"`
	Max   int    `json:"max"`
	Step  int    `json:"step"`
	Value int    `json:"value"`
}

type state struct {
	T    string `json:"t"`
	Now  int64  `json:"now"`
	Code string `json:"code"`
	Game string `json:"game"`
	// Min and Max are how many players the chosen game takes.
	Min     int          `json:"min"`
	Max     int          `json:"max"`
	Phase   string       `json:"phase"`
	Host    string       `json:"host"`
	You     string       `json:"you"`
	Seat    int          `json:"seat"`
	Members []memberView `json:"members"`
	Winners []int        `json:"winners"`
	// Void says the game ended on a walk-out and counts for nobody.
	Void bool `json:"void"`
	// Public says anyone may find the room; Played counts the games finished
	// in it; Options are the host's settings for the chosen game. WordsMin is
	// how many words a custom list needs (0: the game draws none), Words how
	// many the host's list has, and List that list, for the host alone.
	Public bool `json:"public"`
	// ByVote says the game is chosen by vote; Votes counts the votes for each
	// game, and Vote is the game this player voted for.
	ByVote bool           `json:"byVote"`
	Votes  map[string]int `json:"votes"`
	Vote   string         `json:"vote"`
	// Limit is how many players the host wants at most, 0 for no limit.
	Limit    int       `json:"limit"`
	Played   int       `json:"played"`
	Options  []optView `json:"options"`
	WordsMin int       `json:"wordsMin"`
	Words    int       `json:"words"`
	List     []string  `json:"list,omitempty"`
	View     any       `json:"view"`
}

func (c *Client) push(v any) {
	raw, err := json.Marshal(v)
	if err != nil {
		return
	}
	select {
	case c.Send <- raw:
	default:
		// The connection does not keep up: let it go, the page reconnects.
		c.room.drop(c)
	}
}

// broadcast sends every connection what its player may see.
func (r *Room) broadcast() {
	now := time.Now()
	st := state{T: "state", Now: now.UnixMilli(), Code: r.Code, Game: r.spec.ID, Min: r.spec.Min, Max: r.spec.Max, Phase: r.phase, Winners: r.winners, Void: r.void, Members: []memberView{}}
	if len(r.members) > 0 {
		st.Host = r.members[0].ID
	}
	for _, m := range r.members {
		st.Members = append(st.Members, memberView{ID: m.ID, Name: m.Name, Avatar: m.Avatar, Fx: m.Fx, Account: m.UserID != "", On: m.conns > 0, Seat: m.seat, Wins: m.wins})
	}
	st.ByVote, st.Votes = r.byVote, r.tally()
	st.Public, st.Limit, st.Played, st.WordsMin, st.Words, st.Options = r.public, r.limit, r.played, r.spec.Words, len(r.words), []optView{}
	for _, o := range r.spec.Options {
		st.Options = append(st.Options, optView{Key: o.Key, Min: o.Min, Max: o.Max, Step: o.Step, Value: games.Options{Values: r.opts}.Int(o.Key, o.Def)})
	}
	r.persist()
	views := map[int]any{}
	for c := range r.clients {
		st.You, st.Seat, st.View, st.List, st.Vote = c.id, -1, nil, nil, r.votes[c.id]
		if c.id == st.Host && r.phase != "playing" {
			st.List = r.words
		}
		if m := r.member(c.id); m != nil {
			st.Seat = m.seat
		}
		if r.game != nil {
			if _, ok := views[st.Seat]; !ok {
				views[st.Seat] = r.game.View(st.Seat, now)
			}
			st.View = views[st.Seat]
		}
		c.push(st)
	}
}
