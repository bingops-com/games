// Package store keeps accounts, sessions, friendships and what each player
// has played in PostgreSQL.
package store

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgconn"
	_ "github.com/jackc/pgx/v5/stdlib"
)

var (
	ErrNameTaken = errors.New("store: name already taken")
	ErrNotFound  = errors.New("store: not found")
	ErrTooMany   = errors.New("store: too many pending invitations")
	ErrOwned     = errors.New("store: already owned")
	ErrTooPoor   = errors.New("store: not enough credits")
)

// MaxPending is how many invitations an account may have waiting for an
// answer.
const MaxPending = 50

// Each entry runs once, in order; its index + 1 is the schema version. Times
// are milliseconds since 1970, as the interface reads them.
var migrations = []string{`
CREATE TABLE users (
	id         TEXT PRIMARY KEY,
	name       TEXT NOT NULL,
	name_key   TEXT NOT NULL UNIQUE,
	password   TEXT NOT NULL,
	created_at BIGINT NOT NULL
);

CREATE TABLE sessions (
	token_hash TEXT PRIMARY KEY,
	user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	expires_at BIGINT NOT NULL
);
CREATE INDEX sessions_expiry ON sessions (expires_at);

-- An invitation from one player to another; it is a friendship once accepted.
CREATE TABLE friends (
	from_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	to_id       TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	created_at  BIGINT NOT NULL,
	accepted_at BIGINT,
	PRIMARY KEY (from_id, to_id),
	CHECK (from_id <> to_id)
);
CREATE INDEX friends_to ON friends (to_id);
-- Never a row in both directions for the same pair.
CREATE UNIQUE INDEX friends_pair ON friends (LEAST(from_id, to_id), GREATEST(from_id, to_id));

-- What each player did on each game, shown on the public profile.
CREATE TABLE game_stats (
	user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	game    TEXT NOT NULL,
	played  INTEGER NOT NULL DEFAULT 0,
	won     INTEGER NOT NULL DEFAULT 0,
	PRIMARY KEY (user_id, game)
);
`, `
-- The avatar a player chose ("body.eyes.mouth.hat"), and how many days in a
-- row they have finished a game: last_day counts days since 1970.
ALTER TABLE users
	ADD COLUMN avatar      TEXT    NOT NULL DEFAULT '',
	ADD COLUMN streak      INTEGER NOT NULL DEFAULT 0,
	ADD COLUMN streak_best INTEGER NOT NULL DEFAULT 0,
	ADD COLUMN last_day    INTEGER NOT NULL DEFAULT 0;
`, `
-- Avatars gained a body, a beard and glasses: the ones saved before no longer
-- parse, their players choose again.
UPDATE users SET avatar = '';
`, `
-- Credits are earned by playing and spent in the daily shop; what was bought
-- is kept in user_items. name_fx is the animation a player's name wears.
ALTER TABLE users
	ADD COLUMN credits INTEGER NOT NULL DEFAULT 0,
	ADD COLUMN name_fx TEXT    NOT NULL DEFAULT '';

CREATE TABLE user_items (
	user_id   TEXT   NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	item      TEXT   NOT NULL,
	bought_at BIGINT NOT NULL,
	PRIMARY KEY (user_id, item)
);
`, `
-- An address, to get back into an account whose password is lost (empty on
-- accounts created before it was asked for),
-- and the single-use links sent to it.
ALTER TABLE users
	ADD COLUMN email         TEXT    NOT NULL DEFAULT '',
	-- What was earned on credits_day, to cap a day's earnings.
	ADD COLUMN credits_day   INTEGER NOT NULL DEFAULT 0,
	ADD COLUMN credits_today INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX users_email ON users (lower(email)) WHERE email <> '';

CREATE TABLE password_resets (
	token_hash TEXT PRIMARY KEY,
	user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	expires_at BIGINT NOT NULL
);

-- A player who does not want to hear from another.
CREATE TABLE blocks (
	user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	blocked_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	created_at BIGINT NOT NULL,
	PRIMARY KEY (user_id, blocked_id)
);

-- What players reported, for whoever runs the site to read.
CREATE TABLE reports (
	id         BIGSERIAL PRIMARY KEY,
	created_at BIGINT NOT NULL,
	reporter   TEXT NOT NULL,
	target     TEXT NOT NULL,
	room       TEXT NOT NULL,
	reason     TEXT NOT NULL,
	detail     TEXT NOT NULL
);

-- The rooms that are open, so that they outlive a restart of the server.
CREATE TABLE rooms (
	code       TEXT PRIMARY KEY,
	state      JSONB NOT NULL,
	updated_at BIGINT NOT NULL
);
`, `
-- An address counts once its owner has opened the link sent to it: until
-- then no password is recovered through it. Those given before the link
-- existed are taken on trust.
ALTER TABLE users ADD COLUMN email_checked BOOLEAN NOT NULL DEFAULT FALSE;
UPDATE users SET email_checked = TRUE WHERE email <> '';

CREATE TABLE email_checks (
	token_hash TEXT PRIMARY KEY,
	user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
	email      TEXT NOT NULL,
	expires_at BIGINT NOT NULL
);
`, `
-- Recovery codes replace email-based recovery. Legacy columns/tables are kept
-- for data preservation, but the application no longer reads or accepts them.
CREATE TABLE recovery_codes (
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    PRIMARY KEY (user_id, token_hash)
);
`}

// Held while the schema is upgraded, so that two instances starting together
// do not both run a migration.
const migrationLock = 7781_4263

type Store struct {
	db *sql.DB
}

// Open connects to the database at url (postgres://user:password@host/name)
// and creates or upgrades its schema.
func Open(ctx context.Context, url string) (*Store, error) {
	db, err := sql.Open("pgx", url)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(10)
	db.SetConnMaxIdleTime(5 * time.Minute)
	s := &Store{db: db}
	if err := s.migrate(ctx); err != nil {
		db.Close()
		return nil, fmt.Errorf("store: migrate: %w", err)
	}
	return s, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) Ping(ctx context.Context) error { return s.db.PingContext(ctx) }

func (s *Store) migrate(ctx context.Context) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock($1)", migrationLock); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)"); err != nil {
		return err
	}
	var version int
	if err := tx.QueryRowContext(ctx, "SELECT COALESCE(MAX(version), 0) FROM schema_version").Scan(&version); err != nil {
		return err
	}
	if version > len(migrations) {
		return fmt.Errorf("database is at version %d, this binary knows %d", version, len(migrations))
	}
	for i := version; i < len(migrations); i++ {
		if _, err := tx.ExecContext(ctx, migrations[i]); err != nil {
			return fmt.Errorf("version %d: %w", i+1, err)
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO schema_version (version) VALUES ($1)", i+1); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func now() int64 { return time.Now().UnixMilli() }

// ---------- accounts ----------

type User struct {
	ID   string
	Name string
	// Since is when the account was created, in milliseconds.
	Since int64
	// Avatar is "color.body.eyes.mouth.beard.glasses.hat", empty until the
	// player chooses one.
	Avatar string
	// Credits are what the player may spend in the shop; Fx is the animation
	// their name wears, or empty.
	Credits int
	Fx      string
	// Only the count is exposed; plaintext codes are never stored.
	RecoveryCodesRemaining int
	// EarnedToday is how many credits today's games have paid so far.
	EarnedToday int
}

func newID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic(err)
	}
	return hex.EncodeToString(b[:])
}

// Names are unique whatever their case: "Bing" and "bing" are one player.
func nameKey(name string) string { return strings.ToLower(name) }

// CreateUser stores the account and its initial recovery hashes atomically.
// A nil set is only used to reconstruct legacy accounts without codes.
func (s *Store) CreateUser(ctx context.Context, name, password string, hashes []string) (*User, error) {
	u := &User{ID: newID(), Name: name, Since: now(), RecoveryCodesRemaining: len(hashes)}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	_, err = tx.ExecContext(ctx, "INSERT INTO users (id, name, name_key, password, created_at) VALUES ($1, $2, $3, $4, $5)", u.ID, name, nameKey(name), password, u.Since)
	if err != nil {
		var pg *pgconn.PgError
		if errors.As(err, &pg) && pg.Code == "23505" {
			return nil, ErrNameTaken
		}
		return nil, err
	}
	if hashes != nil {
		if err := insertRecoveryCodes(ctx, tx, u.ID, hashes); err != nil {
			return nil, err
		}
	}
	return u, tx.Commit()
}

// Credentials returns the id and the password hash of an account.
func (s *Store) Credentials(ctx context.Context, name string) (id, password string, err error) {
	err = s.db.QueryRowContext(ctx, "SELECT id, password FROM users WHERE name_key = $1", nameKey(name)).Scan(&id, &password)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return
}

func (s *Store) user(ctx context.Context, where string, args ...any) (*User, error) {
	u := &User{}
	err := s.db.QueryRowContext(ctx, "SELECT u.id, u.name, u.created_at, u.avatar, u.credits, u.name_fx, (SELECT COUNT(*) FROM recovery_codes c WHERE c.user_id = u.id), CASE WHEN u.credits_day = $"+fmt.Sprint(len(args)+1)+" THEN u.credits_today ELSE 0 END FROM users u "+where, append(args, today())...).Scan(&u.ID, &u.Name, &u.Since, &u.Avatar, &u.Credits, &u.Fx, &u.RecoveryCodesRemaining, &u.EarnedToday)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, ErrNotFound
	}
	return u, err
}

func (s *Store) User(ctx context.Context, id string) (*User, error) {
	return s.user(ctx, "WHERE u.id = $1", id)
}

func (s *Store) UserByName(ctx context.Context, name string) (*User, error) {
	return s.user(ctx, "WHERE u.name_key = $1", nameKey(name))
}

// UserBySession returns the account a live session belongs to.
func (s *Store) UserBySession(ctx context.Context, tokenHash string) (*User, error) {
	return s.user(ctx, "JOIN sessions s ON s.user_id = u.id WHERE s.token_hash = $1 AND s.expires_at > $2", tokenHash, now())
}

func (s *Store) SetAvatar(ctx context.Context, userID, avatar string) error {
	_, err := s.db.ExecContext(ctx, "UPDATE users SET avatar = $1 WHERE id = $2", avatar, userID)
	return err
}

// SetPassword changes the password of an account and closes every session
// but the one named by keep (none when it is empty).
func (s *Store) SetPassword(ctx context.Context, userID, password, keep, passwordHash string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, "UPDATE users SET password = $1 WHERE id = $2 AND password = $3", password, userID, passwordHash)
	if err != nil {
		return err
	}
	if n, err := res.RowsAffected(); err != nil {
		return err
	} else if n != 1 {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", userID, keep); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM password_resets WHERE user_id = $1", userID); err != nil {
		return err
	}
	return tx.Commit()
}

// ---------- blocks and reports ----------

func (s *Store) Block(ctx context.Context, me, other string) error {
	_, err := s.db.ExecContext(ctx, "INSERT INTO blocks (user_id, blocked_id, created_at) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", me, other, now())
	return err
}

func (s *Store) Unblock(ctx context.Context, me, other string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM blocks WHERE user_id = $1 AND blocked_id = $2", me, other)
	return err
}

// Blocked lists the names a player blocked.
func (s *Store) Blocked(ctx context.Context, me string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT u.name FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.user_id = $1 ORDER BY u.name_key", me)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	names := []string{}
	for rows.Next() {
		var n string
		if err := rows.Scan(&n); err != nil {
			return nil, err
		}
		names = append(names, n)
	}
	return names, rows.Err()
}

// Blocks says whether one of the two players blocked the other.
func (s *Store) Blocks(ctx context.Context, a, b string) (bool, error) {
	var yes bool
	err := s.db.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM blocks WHERE (user_id = $1 AND blocked_id = $2) OR (user_id = $2 AND blocked_id = $1))", a, b).Scan(&yes)
	return yes, err
}

func (s *Store) Report(ctx context.Context, reporter, target, room, reason, detail string) error {
	_, err := s.db.ExecContext(ctx, "INSERT INTO reports (created_at, reporter, target, room, reason, detail) VALUES ($1, $2, $3, $4, $5, $6)", now(), reporter, target, room, reason, detail)
	return err
}

// ---------- rooms ----------

// SaveRoom keeps what a room needs to come back after a restart.
func (s *Store) SaveRoom(ctx context.Context, code string, state []byte) error {
	_, err := s.db.ExecContext(ctx, "INSERT INTO rooms (code, state, updated_at) VALUES ($1, $2, $3) ON CONFLICT (code) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at", code, state, now())
	return err
}

func (s *Store) DeleteRoom(ctx context.Context, code string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM rooms WHERE code = $1", code)
	return err
}

// Rooms expires only rooms saved as empty. A connected lobby may go hours
// without a configuration change and must still survive a restart.
func (s *Store) Rooms(ctx context.Context, since time.Time) (map[string][]byte, error) {
	if _, err := s.db.ExecContext(ctx, "DELETE FROM rooms WHERE updated_at < $1 AND NOT COALESCE((state->>'occupied')::boolean, false)", since.UnixMilli()); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, "SELECT code, state FROM rooms")
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string][]byte{}
	for rows.Next() {
		var code string
		var state []byte
		if err := rows.Scan(&code, &state); err != nil {
			return nil, err
		}
		out[code] = state
	}
	return out, rows.Err()
}

func (s *Store) SetFx(ctx context.Context, userID, fx string) error {
	_, err := s.db.ExecContext(ctx, "UPDATE users SET name_fx = $1 WHERE id = $2", fx, userID)
	return err
}

// Items lists what a player bought in the shop.
func (s *Store) Items(ctx context.Context, userID string) ([]string, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT item FROM user_items WHERE user_id = $1 ORDER BY bought_at, item", userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []string{}
	for rows.Next() {
		var item string
		if err := rows.Scan(&item); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

// Buy takes price credits from a player and gives them item. It returns the
// credits left.
func (s *Store) Buy(ctx context.Context, userID, item string, price int) (int, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	var credits int
	if err := tx.QueryRowContext(ctx, "SELECT credits FROM users WHERE id = $1 FOR UPDATE", userID).Scan(&credits); err != nil {
		return 0, err
	}
	var owned bool
	if err := tx.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM user_items WHERE user_id = $1 AND item = $2)", userID, item).Scan(&owned); err != nil {
		return 0, err
	}
	switch {
	case owned:
		return credits, ErrOwned
	case credits < price:
		return credits, ErrTooPoor
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO user_items (user_id, item, bought_at) VALUES ($1, $2, $3)", userID, item, now()); err != nil {
		return 0, err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE users SET credits = credits - $1 WHERE id = $2", price, userID); err != nil {
		return 0, err
	}
	return credits - price, tx.Commit()
}

func (s *Store) CreateSession(ctx context.Context, userID, tokenHash string, expires time.Time) error {
	_, err := s.db.ExecContext(ctx, "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", tokenHash, userID, expires.UnixMilli())
	return err
}

// CreateSessionForPassword serializes session creation with password changes.
// Hashing happens outside the transaction: a stale successful password check
// must not create a new session after reset has revoked the old sessions.
func (s *Store) CreateSessionForPassword(ctx context.Context, userID, tokenHash, passwordHash string, expires time.Time) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var current string
	if err := tx.QueryRowContext(ctx, "SELECT password FROM users WHERE id = $1 FOR UPDATE", userID).Scan(&current); err != nil {
		return err
	}
	if current != passwordHash {
		return ErrNotFound
	}
	if _, err := tx.ExecContext(ctx, "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, $3)", tokenHash, userID, expires.UnixMilli()); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) DeleteSession(ctx context.Context, tokenHash string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM sessions WHERE token_hash = $1", tokenHash)
	return err
}

// SessionExpires is checked after registering a socket, closing the admission
// race with logout/password changes; expiry also closes idle sockets.
func (s *Store) SessionExpires(ctx context.Context, tokenHash, userID string) (time.Time, error) {
	var expires int64
	err := s.db.QueryRowContext(ctx, "SELECT expires_at FROM sessions WHERE token_hash = $1 AND user_id = $2 AND expires_at > $3", tokenHash, userID, now()).Scan(&expires)
	if errors.Is(err, sql.ErrNoRows) {
		err = ErrNotFound
	}
	return time.UnixMilli(expires), err
}

// PurgeSessions forgets the sessions that have expired.
func (s *Store) PurgeSessions(ctx context.Context) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM sessions WHERE expires_at < $1", now())
	return err
}

// ---------- friends ----------

// How one player stands towards another.
const (
	None     = "none"
	Sent     = "sent"     // I invited them, they have not answered
	Received = "received" // they invited me, I have not answered
	Friends  = "friends"
)

type queryer interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

func relation(ctx context.Context, q queryer, me, other string) (string, error) {
	var from string
	var accepted sql.NullInt64
	err := q.QueryRowContext(ctx,
		"SELECT from_id, accepted_at FROM friends WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)", me, other).Scan(&from, &accepted)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return None, nil
	case err != nil:
		return "", err
	case accepted.Valid:
		return Friends, nil
	case from == me:
		return Sent, nil
	}
	return Received, nil
}

func (s *Store) Relation(ctx context.Context, me, other string) (string, error) {
	return relation(ctx, s.db, me, other)
}

// Invite sends an invitation, or accepts the one the other player had already
// sent. It returns how the two stand afterwards.
func (s *Store) Invite(ctx context.Context, me, other string) (string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	// One at a time per pair: two invitations that cross must not both read
	// "nothing yet".
	if _, err := tx.ExecContext(ctx, "SELECT pg_advisory_xact_lock(hashtextextended(LEAST($1::text, $2::text) || '/' || GREATEST($1::text, $2::text), 0))", me, other); err != nil {
		return "", err
	}
	rel, err := relation(ctx, tx, me, other)
	if err != nil {
		return "", err
	}
	switch rel {
	case None:
		var pending int
		if err := tx.QueryRowContext(ctx, "SELECT COUNT(*) FROM friends WHERE from_id = $1 AND accepted_at IS NULL", me).Scan(&pending); err != nil {
			return "", err
		}
		if pending >= MaxPending {
			return "", ErrTooMany
		}
		if _, err := tx.ExecContext(ctx, "INSERT INTO friends (from_id, to_id, created_at) VALUES ($1, $2, $3)", me, other, now()); err != nil {
			return "", err
		}
		rel = Sent
	case Received:
		if _, err := tx.ExecContext(ctx, "UPDATE friends SET accepted_at = $1 WHERE from_id = $2 AND to_id = $3", now(), other, me); err != nil {
			return "", err
		}
		rel = Friends
	}
	return rel, tx.Commit()
}

// Accept turns an invitation received from other into a friendship.
func (s *Store) Accept(ctx context.Context, me, other string) error {
	res, err := s.db.ExecContext(ctx, "UPDATE friends SET accepted_at = $1 WHERE from_id = $2 AND to_id = $3 AND accepted_at IS NULL", now(), other, me)
	if err != nil {
		return err
	}
	if n, _ := res.RowsAffected(); n == 0 {
		return ErrNotFound
	}
	return nil
}

// Unlink removes whatever ties two players: an invitation either way, or the
// friendship.
func (s *Store) Unlink(ctx context.Context, me, other string) error {
	_, err := s.db.ExecContext(ctx, "DELETE FROM friends WHERE (from_id = $1 AND to_id = $2) OR (from_id = $2 AND to_id = $1)", me, other)
	return err
}

type Friend struct {
	// ID is the friend's account, for the server only.
	ID     string `json:"-"`
	Name   string `json:"name"`
	Avatar string `json:"avatar"`
	// Online and Room are filled by the server: whether the friend is on the
	// site right now, and the room they are in, if any.
	Online bool   `json:"online"`
	Room   string `json:"room,omitempty"`
	Game   string `json:"game,omitempty"`
	// Since is when the friendship, or the invitation, dates from.
	Since int64 `json:"since"`
}

type FriendList struct {
	Friends  []Friend `json:"friends"`
	Received []Friend `json:"received"`
	Sent     []Friend `json:"sent"`
}

func (s *Store) Friends(ctx context.Context, me string) (*FriendList, error) {
	rows, err := s.db.QueryContext(ctx, `
SELECT u.id, u.name, u.avatar, f.from_id = $1, f.created_at, f.accepted_at
FROM friends f JOIN users u ON u.id = CASE WHEN f.from_id = $1 THEN f.to_id ELSE f.from_id END
WHERE f.from_id = $1 OR f.to_id = $1
ORDER BY u.name_key`, me)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	list := &FriendList{Friends: []Friend{}, Received: []Friend{}, Sent: []Friend{}}
	for rows.Next() {
		var f Friend
		var mine bool
		var accepted sql.NullInt64
		if err := rows.Scan(&f.ID, &f.Name, &f.Avatar, &mine, &f.Since, &accepted); err != nil {
			return nil, err
		}
		switch {
		case accepted.Valid:
			f.Since = accepted.Int64
			list.Friends = append(list.Friends, f)
		case mine:
			list.Sent = append(list.Sent, f)
		default:
			list.Received = append(list.Received, f)
		}
	}
	return list, rows.Err()
}

// Counts returns how many friends a player has and how many invitations wait
// for their answer.
func (s *Store) Counts(ctx context.Context, id string) (friends, received int, err error) {
	err = s.db.QueryRowContext(ctx, `
SELECT COUNT(*) FILTER (WHERE accepted_at IS NOT NULL), COUNT(*) FILTER (WHERE accepted_at IS NULL AND to_id = $1)
FROM friends WHERE from_id = $1 OR to_id = $1`, id).Scan(&friends, &received)
	return
}

// ---------- what was played ----------

type GameStat struct {
	Game   string `json:"game"`
	Played int    `json:"played"`
	Won    int    `json:"won"`
}

func today() int { return int(time.Now().Unix() / 86400) }

// What a finished game pays, in credits, and the most a day of play may pay:
// two accounts feeding each other wins stop earning after a dozen games.
const (
	CreditsPlayed = 2
	CreditsWon    = 10
	CreditsPerDay = 150
)

// RecordGame counts one finished game for a player, pays its credits, and
// notes the day it was played on: a game on the day after the last one
// extends the streak, a later one starts it again.
func (s *Store) RecordGame(ctx context.Context, userID, game string, won bool) error {
	w := 0
	if won {
		w = 1
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `
INSERT INTO game_stats (user_id, game, played, won) VALUES ($1, $2, 1, $3)
ON CONFLICT (user_id, game) DO UPDATE SET played = game_stats.played + 1, won = game_stats.won + excluded.won`, userID, game, w); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, `
WITH next AS (
	SELECT id, CASE WHEN last_day = $2 THEN streak WHEN last_day = $2 - 1 THEN streak + 1 ELSE 1 END AS streak,
		CASE WHEN credits_day = $2 THEN credits_today ELSE 0 END AS earned
	FROM users WHERE id = $1 FOR UPDATE
)
UPDATE users u SET streak = next.streak, streak_best = GREATEST(u.streak_best, next.streak), last_day = $2,
	credits_day = $2,
	credits_today = next.earned + LEAST($3, GREATEST(0, $4 - next.earned)),
	credits = u.credits + LEAST($3, GREATEST(0, $4 - next.earned))
FROM next WHERE u.id = next.id`, userID, today(), CreditsPlayed+w*CreditsWon, CreditsPerDay); err != nil {
		return err
	}
	return tx.Commit()
}

// Streak is how many days in a row a player has finished a game.
type Streak struct {
	// Days is the running streak, 0 once a day was missed.
	Days int `json:"days"`
	Best int `json:"best"`
	// Today says a game was already finished today.
	Today bool `json:"today"`
}

func (s *Store) Streak(ctx context.Context, userID string) (Streak, error) {
	var st Streak
	var last int
	if err := s.db.QueryRowContext(ctx, "SELECT streak, streak_best, last_day FROM users WHERE id = $1", userID).Scan(&st.Days, &st.Best, &last); err != nil {
		return st, err
	}
	day := today()
	st.Today = last == day
	if last < day-1 {
		st.Days = 0
	}
	return st, nil
}

func (s *Store) Stats(ctx context.Context, userID string) ([]GameStat, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT game, played, won FROM game_stats WHERE user_id = $1 ORDER BY game", userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	stats := []GameStat{}
	for rows.Next() {
		var g GameStat
		if err := rows.Scan(&g.Game, &g.Played, &g.Won); err != nil {
			return nil, err
		}
		stats = append(stats, g)
	}
	return stats, rows.Err()
}
