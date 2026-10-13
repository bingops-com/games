package store

import (
	"context"
	"database/sql"
	"os"
	"testing"
)

func TestSharedAccountsNeverBootstrapAnUnpreparedDatabase(t *testing.T) {
	dsn := os.Getenv("GAMES_TEST_DATABASE_URL")
	if dsn == "" {
		t.Skip("requires an isolated PostgreSQL test database")
	}
	db, err := sql.Open("pgx", dsn)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	var absent bool
	if err := db.QueryRow("SELECT to_regnamespace('identity') IS NULL").Scan(&absent); err != nil {
		t.Fatal(err)
	}
	if !absent {
		t.Fatal("test database already has shared identity data")
	}
	if st, err := OpenShared(context.Background(), dsn); err == nil || st != nil {
		t.Fatal("shared startup accepted an unprepared database")
	}
	if err := db.QueryRow("SELECT to_regnamespace('identity') IS NULL").Scan(&absent); err != nil || !absent {
		t.Fatal("failed startup changed the database")
	}
}
