package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

const RecoveryCodeCount = 10

func insertRecoveryCodes(ctx context.Context, tx *sql.Tx, userID string, hashes []string) error {
	if len(hashes) != RecoveryCodeCount {
		return fmt.Errorf("store: expected %d recovery code hashes", RecoveryCodeCount)
	}
	for _, hash := range hashes {
		if _, err := tx.ExecContext(ctx, "INSERT INTO recovery_codes (user_id, token_hash) VALUES ($1, $2)", userID, hash); err != nil {
			return err
		}
	}
	return nil
}

// SetRecoveryCodes replaces the complete set, guarded by the password that
// was just verified. Account-first locking serializes rotation and recovery.
// Other sessions are revoked so a stale device cannot keep account access.
func (s *Store) SetRecoveryCodes(ctx context.Context, userID, passwordHash, keep string, hashes []string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var id string
	err = tx.QueryRowContext(ctx, "UPDATE users SET password = password WHERE id = $1 AND password = $2 RETURNING id", userID, passwordHash).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return ErrNotFound
	}
	if err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM recovery_codes WHERE user_id = $1", id); err != nil {
		return err
	}
	if err := insertRecoveryCodes(ctx, tx, id, hashes); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM sessions WHERE user_id = $1 AND token_hash <> $2", id, keep); err != nil {
		return err
	}
	return tx.Commit()
}

// HasRecoveryCode is a cheap precheck before password hashing. Only the
// transaction in RecoverPassword authorizes and consumes a code.
func (s *Store) HasRecoveryCode(ctx context.Context, name, hash string) (bool, error) {
	var found bool
	err := s.db.QueryRowContext(ctx, "SELECT EXISTS (SELECT 1 FROM recovery_codes c JOIN users u ON u.id = c.user_id WHERE u.name_key = $1 AND c.token_hash = $2)", nameKey(name), hash).Scan(&found)
	return found, err
}

// RecoverPassword consumes exactly one code, changes the password and revokes
// every session atomically. Concurrent uses of a code have just one winner.
func (s *Store) RecoverPassword(ctx context.Context, name, hash, password string) (string, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	var id, consumed string
	err = tx.QueryRowContext(ctx, "SELECT id FROM users WHERE name_key = $1 FOR UPDATE", nameKey(name)).Scan(&id)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	err = tx.QueryRowContext(ctx, "DELETE FROM recovery_codes WHERE user_id = $1 AND token_hash = $2 RETURNING user_id", id, hash).Scan(&consumed)
	if errors.Is(err, sql.ErrNoRows) {
		return "", ErrNotFound
	}
	if err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx, "UPDATE users SET password = $1 WHERE id = $2", password, id); err != nil {
		return "", err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM sessions WHERE user_id = $1", id); err != nil {
		return "", err
	}
	return id, tx.Commit()
}
