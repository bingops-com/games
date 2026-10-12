package server

import (
	"context"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/bingops-com/games/internal/store"
)

func TestRecoveryCodeCredentials(t *testing.T) {
	codes, hashes, err := newRecoveryCodes()
	if err != nil || len(codes) != store.RecoveryCodeCount || len(hashes) != len(codes) {
		t.Fatal("failed to generate a complete recovery set")
	}
	seen := map[string]bool{}
	for i, code := range codes {
		plain, valid := normalizeRecoveryCode(code)
		if !valid || len(code) != 35 || seen[plain] {
			t.Fatal("malformed or duplicate credential")
		}
		seen[plain] = true
		formatted, valid := normalizeRecoveryCode("\t" + strings.ToUpper(code) + "\r\n")
		if !valid || formatted != plain || recoveryHash(formatted) != hashes[i] || hashes[i] == tokenHash(plain) {
			t.Fatal("formatting changed the credential or hash domain separation was lost")
		}
		if raw, err := hex.DecodeString(hashes[i]); err != nil || len(raw) != 32 {
			t.Fatal("invalid stored hash")
		}
	}
	for _, bad := range []string{"", strings.Repeat("0", 31), strings.Repeat("0", 33), strings.Repeat("g", 32), strings.Repeat("0", 31) + "é", strings.Repeat(" ", 129) + codes[0]} {
		if _, valid := normalizeRecoveryCode(bad); valid {
			t.Fatal("accepted a malformed or oversized credential")
		}
	}
}

func registerCodes(t *testing.T, owner *client, name string) []string {
	t.Helper()
	out := owner.want(200, "POST", "/api/register", fmt.Sprintf(`{"name":%q,"password":"long enough"}`, name))
	values := out["recoveryCodes"].([]any)
	codes := make([]string, len(values))
	for i, v := range values {
		codes[i] = v.(string)
	}
	return codes
}

func TestRecoveryWithoutEmail(t *testing.T) {
	ts, st := start(t)
	owner, guest := player(t, ts, ""), player(t, ts, "")
	codes := registerCodes(t, owner, "CodeOwner")
	if len(codes) != 10 {
		t.Fatal("expected ten recovery codes")
	}
	seen := map[string]bool{}
	for _, code := range codes {
		plain, valid := normalizeRecoveryCode(code)
		if !valid || seen[plain] {
			t.Fatal("malformed or duplicate code")
		}
		seen[plain] = true
		if found, err := st.HasRecoveryCode(context.Background(), "codeowner", plain); err != nil || found {
			t.Fatal("plaintext recovery code was stored")
		}
		if found, err := st.HasRecoveryCode(context.Background(), "codeowner", recoveryHash(plain)); err != nil || !found {
			t.Fatal("recovery hash was not persisted")
		}
	}
	for _, path := range []string{"/api/me", "/api/profile/CodeOwner"} {
		out := owner.want(200, "GET", path, "")
		raw, _ := json.Marshal(out)
		for _, code := range codes {
			if strings.Contains(string(raw), code) {
				t.Fatal("code reappeared in a normal API response")
			}
		}
	}
	guest.want(400, "POST", "/api/reset", fmt.Sprintf(`{"name":"Nobody","code":%q,"password":"new password"}`, codes[0]))
	guest.want(400, "POST", "/api/reset", `{"name":"CodeOwner","code":"invalid","password":"new password"}`)
	guest.want(400, "POST", "/api/reset", fmt.Sprintf(`{"name":"CodeOwner","code":%q,"password":"short"}`, codes[0]))
	// Case and optional separators do not change the credential.
	out := guest.want(200, "POST", "/api/reset", fmt.Sprintf(`{"name":"codeowner","code":%q,"password":"new password"}`, " "+strings.ToUpper(codes[0])+" "))
	if out["user"].(map[string]any)["recoveryCodesRemaining"] != 9.0 || !guest.signedIn() || owner.signedIn() {
		t.Fatal("recovery did not consume one code, sign in or revoke the old session")
	}
	guest.want(400, "POST", "/api/reset", fmt.Sprintf(`{"name":"CodeOwner","code":%q,"password":"other password"}`, codes[0]))
	owner.want(401, "POST", "/api/login", `{"name":"CodeOwner","password":"long enough"}`)
	owner.want(200, "POST", "/api/login", `{"name":"CodeOwner","password":"new password"}`)
	// Remaining codes remain usable, including after a normal password change.
	owner.want(200, "POST", "/api/account/password", `{"old":"new password","new":"changed again"}`)
	guest.want(200, "POST", "/api/reset", fmt.Sprintf(`{"name":"CodeOwner","code":%q,"password":"last password"}`, codes[1]))
	for _, path := range []string{"/api/forgot", "/api/confirm", "/api/account/email", "/api/account/email/check"} {
		guest.want(404, "POST", path, `{}`)
	}
}

func TestRecoveryCodeRotation(t *testing.T) {
	ts, st := start(t)
	owner, guest := player(t, ts, ""), player(t, ts, "")
	codes := registerCodes(t, owner, "RotationOwner")
	guest.want(401, "POST", "/api/account/recovery-codes", `{"password":"long enough"}`)
	owner.want(403, "POST", "/api/account/recovery-codes", `{"password":"wrong password"}`)
	guest.want(200, "POST", "/api/login", `{"name":"RotationOwner","password":"long enough"}`)
	out := owner.want(200, "POST", "/api/account/recovery-codes", `{"password":"long enough"}`)
	if guest.signedIn() || !owner.signedIn() {
		t.Fatal("rotation failed to revoke other sessions or revoked its own session")
	}
	for _, code := range codes {
		plain, _ := normalizeRecoveryCode(code)
		if found, err := st.HasRecoveryCode(context.Background(), "RotationOwner", recoveryHash(plain)); err != nil || found {
			t.Fatal("old code survived rotation")
		}
	}
	guest.want(400, "POST", "/api/reset", fmt.Sprintf(`{"name":"RotationOwner","code":%q,"password":"new password"}`, codes[0]))
	newCode := out["recoveryCodes"].([]any)[0].(string)
	guest.want(200, "POST", "/api/reset", fmt.Sprintf(`{"name":"RotationOwner","code":%q,"password":"new password"}`, newCode))
}

func TestConcurrentRecoveryCodeSingleUse(t *testing.T) {
	ts, _ := start(t)
	owner := player(t, ts, "")
	code := registerCodes(t, owner, "ConcurrentOwner")[0]
	// Both requests pass the cheap lookup while password hashing is blocked.
	for range cap(hashing) {
		hashing <- struct{}{}
	}
	release := sync.OnceFunc(func() {
		for range cap(hashing) {
			<-hashing
		}
	})
	defer release()
	statuses := make(chan int, 2)
	for i := range 2 {
		go func(i int) {
			body := fmt.Sprintf(`{"name":"ConcurrentOwner","code":%q,"password":"synthetic password %d"}`, code, i)
			res, err := http.Post(ts.URL+"/api/reset", "application/json", strings.NewReader(body))
			if err != nil {
				statuses <- 0
				return
			}
			res.Body.Close()
			statuses <- res.StatusCode
		}(i)
	}
	time.Sleep(100 * time.Millisecond)
	release()
	a, b := <-statuses, <-statuses
	if !((a == 200 && b == 400) || (a == 400 && b == 200)) {
		t.Fatalf("expected just one successful recovery, got %d and %d", a, b)
	}
}

func TestRecoveryCodeRotationRollback(t *testing.T) {
	ts, st := start(t)
	owner := player(t, ts, "")
	code := registerCodes(t, owner, "RollbackOwner")[0]
	id, hash, err := st.Credentials(context.Background(), "RollbackOwner")
	if err != nil {
		t.Fatal(err)
	}
	// A failing replacement must not delete the old codes.
	if err := st.SetRecoveryCodes(context.Background(), id, hash, "", []string{"invalid"}); err == nil {
		t.Fatal("accepted incomplete code set")
	}
	plain, _ := normalizeRecoveryCode(code)
	if found, err := st.HasRecoveryCode(context.Background(), "RollbackOwner", recoveryHash(plain)); err != nil || !found {
		t.Fatal("failed rotation destroyed valid codes")
	}
	if !owner.signedIn() {
		t.Fatal("failed rotation revoked sessions")
	}
	// Rotation with a stale password check cannot replace the current set.
	if err := st.SetRecoveryCodes(context.Background(), id, "stale hash", "", nil); !errors.Is(err, store.ErrNotFound) {
		t.Fatal("stale check was accepted")
	}
}

func TestLegacyAccountCanCreateRecoveryCodes(t *testing.T) {
	ts, st := start(t)
	if _, err := st.CreateUser(context.Background(), "LegacyOwner", hashPassword("old password"), nil); err != nil {
		t.Fatal(err)
	}
	owner := player(t, ts, "")
	out := owner.want(200, "POST", "/api/login", `{"name":"LegacyOwner","password":"old password"}`)
	if out["user"].(map[string]any)["recoveryCodesRemaining"] != 0.0 {
		t.Fatal("legacy account falsely claims recovery codes")
	}
	owner.want(200, "POST", "/api/account/recovery-codes", `{"password":"old password"}`)
}

func TestRecoveryMigrationPreservesLegacyAccounts(t *testing.T) {
	st, databaseURL := testStoreURL(t)
	ctx := context.Background()
	u, err := st.CreateUser(ctx, "MigrationOwner", hashPassword("old password"), nil)
	if err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	// Reconstruct the prior schema in this test's private PostgreSQL schema.
	if _, err := db.ExecContext(ctx, "UPDATE users SET email = 'legacy@example.invalid', email_checked = TRUE WHERE id = $1", u.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := db.ExecContext(ctx, "DROP TABLE admin_audit; ALTER TABLE reports DROP COLUMN status, DROP COLUMN resolved_at; DROP TABLE recovery_codes; DELETE FROM schema_version WHERE version >= 7"); err != nil {
		t.Fatal(err)
	}
	st.Close()
	reopened, err := store.Open(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer reopened.Close()
	fresh, err := reopened.User(ctx, u.ID)
	if err != nil || fresh.Name != u.Name || fresh.RecoveryCodesRemaining != 0 {
		t.Fatal("migration lost an existing account or invented recovery codes")
	}
	var legacyEmail string
	if err := db.QueryRowContext(ctx, "SELECT email FROM users WHERE id = $1", u.ID).Scan(&legacyEmail); err != nil || legacyEmail != "legacy@example.invalid" {
		t.Fatal("migration unexpectedly deleted historical data")
	}
	owner := player(t, startOn(t, reopened), "")
	owner.want(200, "POST", "/api/login", `{"name":"MigrationOwner","password":"old password"}`)
	owner.want(200, "POST", "/api/account/recovery-codes", `{"password":"old password"}`)
}

func TestRecoveryAttemptsShareUsernameLimit(t *testing.T) {
	ts, _ := start(t)
	for i := range 6 {
		name := "SameOwner"
		if i%2 != 0 {
			name = "sameowner"
		}
		guest := player(t, ts, "")
		status, _ := guest.do("POST", "/api/reset", fmt.Sprintf(`{"name":%q,"code":%q,"password":"new password"}`, name, strings.Repeat("0", 32)), "X-Forwarded-For", fmt.Sprintf("192.0.2.%d", i+1))
		want := 400
		if i == 5 {
			want = 429
		}
		if status != want {
			t.Fatalf("recovery attempt %d returned %d, want %d", i+1, status, want)
		}
	}
}
