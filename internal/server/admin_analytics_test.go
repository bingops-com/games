package server

import (
	"context"
	"database/sql"
	"fmt"
	"testing"
	"time"
)

func TestAdminAnalyticsRealAggregates(t *testing.T) {
	st, dsn := testStoreURL(t)
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	ctx := context.Background()
	at := time.Date(2026, 10, 12, 12, 0, 0, 0, time.UTC)
	start := time.Date(2026, 10, 6, 0, 0, 0, 0, time.UTC)
	empty, err := st.AdminAnalytics(ctx, 7, at)
	if err != nil {
		t.Fatal(err)
	}
	if empty.Users != 0 || empty.Participations != 0 || len(empty.DaysSeries) != 7 || len(empty.Games) != 0 || empty.DaysSeries[0].Date != "2026-10-06" || empty.DaysSeries[6].Date != "2026-10-12" {
		t.Fatalf("empty snapshot: %+v", empty)
	}
	created := []time.Time{start, at, start.Add(-time.Millisecond), start.AddDate(0, 0, -7), start.AddDate(0, 0, -8), at.Add(time.Millisecond)}
	for i, date := range created {
		lastDay := int64(0)
		if i < 2 {
			lastDay = date.Unix() / 86400
		}
		if i == 5 {
			lastDay = at.AddDate(0, 0, 1).Unix() / 86400
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO users(id,name,name_key,password,created_at,last_day) VALUES($1,$2,$2,'synthetic hash',$3,$4)`, fmt.Sprintf("%032d", i), fmt.Sprintf("Synthetic%d", i), date.UnixMilli(), lastDay); err != nil {
			t.Fatal(err)
		}
	}
	for i, expiry := range []int64{at.UnixMilli() + 1, at.UnixMilli() + 1000, at.UnixMilli(), at.UnixMilli() - 1} {
		if _, err := db.ExecContext(ctx, `INSERT INTO sessions(token_hash,user_id,expires_at) VALUES($1,$2,$3)`, fmt.Sprint(i), fmt.Sprintf("%032d", 0), expiry); err != nil {
			t.Fatal(err)
		}
	}
	for _, item := range []struct {
		user        int
		game        string
		played, won int
	}{{0, "terre", 3, 1}, {1, "terre", 2, 1}, {2, "meche", 1, 0}} {
		if _, err := db.ExecContext(ctx, `INSERT INTO game_stats(user_id,game,played,won) VALUES($1,$2,$3,$4)`, fmt.Sprintf("%032d", item.user), item.game, item.played, item.won); err != nil {
			t.Fatal(err)
		}
	}
	for i, date := range []time.Time{start.Add(-time.Millisecond), at, start} {
		status := "open"
		if i == 2 {
			status = "resolved"
		}
		if _, err := db.ExecContext(ctx, `INSERT INTO reports(created_at,reporter,target,room,reason,detail,status) VALUES($1,'Synthetic reporter','Synthetic target','ABCDEFGH','autre','Synthetic context',$2)`, date.UnixMilli(), status); err != nil {
			t.Fatal(err)
		}
	}
	got, err := st.AdminAnalytics(ctx, 7, at)
	if err != nil {
		t.Fatal(err)
	}
	if got.Users != 6 || got.NewUsers != 2 || got.PreviousNewUsers != 2 || got.ActiveAccounts != 2 || got.SessionAccounts != 1 || got.Participations != 6 || got.OpenReports != 2 || got.ResolvedReports != 1 || got.DismissedReports != 0 || got.PeriodReports != 2 {
		t.Fatalf("wrong aggregate: %+v", got)
	}
	if len(got.Games) != 2 || got.Games[0].Game != "terre" || got.Games[0].Players != 2 || got.Games[0].Played != 5 || got.Games[0].Won != 2 {
		t.Fatalf("wrong game participation totals: %+v", got.Games)
	}
	var registrations, reports int64
	for i, day := range got.DaysSeries {
		registrations += day.Registrations
		reports += day.Reports
		if i > 0 && i < 6 && (day.Registrations != 0 || day.Reports != 0) {
			t.Fatal("invented daily data")
		}
	}
	if registrations != got.NewUsers || reports != got.PeriodReports || got.GeneratedAt != at.UnixMilli() {
		t.Fatal("series and summary disagree")
	}
}

func TestAdminAnalyticsAuthorizationAndPeriods(t *testing.T) {
	_, c, f := startAdmin(t)
	c.want(401, "GET", "/api/admin/analytics?days=90", "")
	finishAdmin(t, c, beginAdmin(t, c, f))
	for _, days := range []string{"7", "30", "90"} {
		data := c.want(200, "GET", "/api/admin/analytics?days="+days, "")
		if len(data["series"].([]any)) != int(data["days"].(float64)) {
			t.Fatal("incomplete series")
		}
		for _, field := range []string{"password", "email", "token", "recoveryCodes"} {
			if _, ok := data[field]; ok {
				t.Fatal("sensitive analytics field")
			}
		}
	}
	for _, days := range []string{"0", "-1", "365", "1%20OR%201=1", "hello"} {
		c.want(400, "GET", "/api/admin/analytics?days="+days, "")
	}
	f.mu.Lock()
	f.group = false
	f.mu.Unlock()
	c.want(403, "GET", "/api/admin/analytics", "")
}
