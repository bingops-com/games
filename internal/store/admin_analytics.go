package store

import (
	"context"
	"database/sql"
	"time"
)

type AdminDay struct {
	Date          string `json:"date"`
	Registrations int64  `json:"registrations"`
	Reports       int64  `json:"reports"`
}
type AdminGame struct {
	Game    string `json:"game"`
	Played  int64  `json:"played"`
	Won     int64  `json:"won"`
	Players int64  `json:"players"`
}
type AdminAnalytics struct {
	Days             int         `json:"days"`
	GeneratedAt      int64       `json:"generatedAt"`
	Users            int64       `json:"users"`
	NewUsers         int64       `json:"newUsers"`
	PreviousNewUsers int64       `json:"previousNewUsers"`
	ActiveAccounts   int64       `json:"activeAccounts"`
	SessionAccounts  int64       `json:"sessionAccounts"`
	Participations   int64       `json:"participations"`
	OpenReports      int64       `json:"openReports"`
	ResolvedReports  int64       `json:"resolvedReports"`
	DismissedReports int64       `json:"dismissedReports"`
	PeriodReports    int64       `json:"periodReports"`
	DaysSeries       []AdminDay  `json:"series"`
	Games            []AdminGame `json:"games"`
}

// AdminAnalytics reads one consistent snapshot. Dates are UTC calendar days,
// including today; game totals are account participations, not unique matches.
// No historical daily game activity is inferred from cumulative game_stats.
func (s *Store) AdminAnalytics(ctx context.Context, days int, at time.Time) (AdminAnalytics, error) {
	out := AdminAnalytics{Days: days, GeneratedAt: at.UnixMilli(), DaysSeries: []AdminDay{}, Games: []AdminGame{}}
	today := at.UTC().Truncate(24 * time.Hour)
	start := today.AddDate(0, 0, 1-days)
	previous := start.AddDate(0, 0, -days)
	tx, err := s.db.BeginTx(ctx, &sql.TxOptions{ReadOnly: true, Isolation: sql.LevelRepeatableRead})
	if err != nil {
		return out, err
	}
	defer tx.Rollback()
	err = tx.QueryRowContext(ctx, `SELECT count(*),
		count(*) FILTER (WHERE created_at >= $1 AND created_at <= $2),
		count(*) FILTER (WHERE created_at >= $3 AND created_at < $1),
		count(*) FILTER (WHERE last_day >= $4 AND last_day <= $5)
		FROM users`, start.UnixMilli(), at.UnixMilli(), previous.UnixMilli(), start.Unix()/86400, today.Unix()/86400).Scan(&out.Users, &out.NewUsers, &out.PreviousNewUsers, &out.ActiveAccounts)
	if err != nil {
		return out, err
	}
	if err = tx.QueryRowContext(ctx, `SELECT count(DISTINCT user_id) FROM sessions WHERE expires_at > $1`, at.UnixMilli()).Scan(&out.SessionAccounts); err != nil {
		return out, err
	}
	if err = tx.QueryRowContext(ctx, `SELECT count(*) FILTER (WHERE status='open'), count(*) FILTER (WHERE status='resolved'), count(*) FILTER (WHERE status='dismissed'), count(*) FILTER (WHERE created_at >= $1 AND created_at <= $2) FROM reports`, start.UnixMilli(), at.UnixMilli()).Scan(&out.OpenReports, &out.ResolvedReports, &out.DismissedReports, &out.PeriodReports); err != nil {
		return out, err
	}
	rows, err := tx.QueryContext(ctx, `WITH registrations AS (
		SELECT created_at / 86400000 AS day, count(*) AS total FROM users WHERE created_at >= $1 AND created_at <= $2 GROUP BY 1
	), reported AS (
		SELECT created_at / 86400000 AS day, count(*) AS total FROM reports WHERE created_at >= $1 AND created_at <= $2 GROUP BY 1
	)
	SELECT d.day, COALESCE(u.total,0), COALESCE(r.total,0)
	FROM generate_series($3::bigint,$4::bigint) AS d(day)
	LEFT JOIN registrations u USING(day) LEFT JOIN reported r USING(day) ORDER BY day`, start.UnixMilli(), at.UnixMilli(), start.Unix()/86400, today.Unix()/86400)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var day int64
		var item AdminDay
		if err = rows.Scan(&day, &item.Registrations, &item.Reports); err != nil {
			rows.Close()
			return out, err
		}
		item.Date = time.Unix(day*86400, 0).UTC().Format("2006-01-02")
		out.DaysSeries = append(out.DaysSeries, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	rows, err = tx.QueryContext(ctx, `SELECT game, sum(played)::bigint, sum(won)::bigint, count(*) FILTER (WHERE played > 0) FROM game_stats GROUP BY game ORDER BY sum(played) DESC, game`)
	if err != nil {
		return out, err
	}
	for rows.Next() {
		var item AdminGame
		if err = rows.Scan(&item.Game, &item.Played, &item.Won, &item.Players); err != nil {
			rows.Close()
			return out, err
		}
		out.Games = append(out.Games, item)
		out.Participations += item.Played
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return out, err
	}
	return out, tx.Commit()
}
