package store

import (
	"context"
	"database/sql"
	"errors"
	"strconv"
)

// Explicit projections never include credentials, email or recovery hashes.
type AdminUser struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Since   int64  `json:"since"`
	Credits int    `json:"credits"`
}
type AdminReport struct {
	ID        int64  `json:"id"`
	CreatedAt int64  `json:"createdAt"`
	Reporter  string `json:"reporter"`
	Target    string `json:"target"`
	Room      string `json:"room"`
	Reason    string `json:"reason"`
	Detail    string `json:"detail"`
	Status    string `json:"status"`
}
type AdminAudit struct {
	ID        int64  `json:"id"`
	CreatedAt int64  `json:"createdAt"`
	Actor     string `json:"actor"`
	Action    string `json:"action"`
	Target    string `json:"target"`
	Reason    string `json:"reason"`
}
type AdminCounts struct {
	Users       int64 `json:"users"`
	OpenReports int64 `json:"openReports"`
}

func (s *Store) AdminCounts(ctx context.Context) (AdminCounts, error) {
	var out AdminCounts
	err := s.db.QueryRowContext(ctx, "SELECT (SELECT count(*) FROM users), (SELECT count(*) FROM reports WHERE status='open')").Scan(&out.Users, &out.OpenReports)
	return out, err
}
func (s *Store) AdminUsers(ctx context.Context, search string, before int64, beforeID string) ([]AdminUser, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id,name,created_at,credits FROM users WHERE ($1='' OR position(lower($1) in name_key)>0) AND (created_at,id) < ($2,$3) ORDER BY created_at DESC,id DESC LIMIT 50", search, before, beforeID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AdminUser{}
	for rows.Next() {
		var row AdminUser
		if err := rows.Scan(&row.ID, &row.Name, &row.Since, &row.Credits); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
func (s *Store) AdminReports(ctx context.Context, status string, before int64) ([]AdminReport, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id,created_at,reporter,target,room,reason,detail,status FROM reports WHERE ($1='' OR status=$1) AND id < $2 ORDER BY id DESC LIMIT 50", status, before)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AdminReport{}
	for rows.Next() {
		var row AdminReport
		if err := rows.Scan(&row.ID, &row.CreatedAt, &row.Reporter, &row.Target, &row.Room, &row.Reason, &row.Detail, &row.Status); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
func (s *Store) AdminAudit(ctx context.Context, before int64) ([]AdminAudit, error) {
	rows, err := s.db.QueryContext(ctx, "SELECT id,created_at,actor_name,action,target,reason FROM admin_audit WHERE id < $1 ORDER BY id DESC LIMIT 50", before)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AdminAudit{}
	for rows.Next() {
		var row AdminAudit
		if err := rows.Scan(&row.ID, &row.CreatedAt, &row.Actor, &row.Action, &row.Target, &row.Reason); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}
func auditAdmin(ctx context.Context, tx *sql.Tx, sub, name, action, target, reason string) error {
	_, err := tx.ExecContext(ctx, "INSERT INTO admin_audit (created_at,actor_sub,actor_name,action,target,reason) VALUES ($1,$2,$3,$4,$5,$6)", now(), sub, name, action, target, reason)
	return err
}
func (s *Store) AdminResolveReport(ctx context.Context, id int64, status, sub, name, reason string) error {
	if status != "resolved" && status != "dismissed" {
		return ErrNotFound
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.ExecContext(ctx, "UPDATE reports SET status=$1,resolved_at=$2 WHERE id=$3 AND status='open'", status, now(), id)
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n != 1 {
		return ErrNotFound
	}
	if err := auditAdmin(ctx, tx, sub, name, "report."+status, strconv.FormatInt(id, 10), reason); err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) AdminRevokeSessions(ctx context.Context, id, sub, name, reason string) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var target string
	if err := tx.QueryRowContext(ctx, "SELECT name FROM users WHERE id=$1 FOR UPDATE", id).Scan(&target); err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ErrNotFound
		}
		return err
	}
	if _, err := tx.ExecContext(ctx, "DELETE FROM sessions WHERE user_id=$1", id); err != nil {
		return err
	}
	if err := auditAdmin(ctx, tx, sub, name, "sessions.revoked", target, reason); err != nil {
		return err
	}
	return tx.Commit()
}
