package reminders

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/bryansiagian/arisanly/apps/api/internal/auth"
	"github.com/bryansiagian/arisanly/apps/api/internal/hardening"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func TestReminderLifecycle(t *testing.T) {
	url := os.Getenv("LEDGER_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set LEDGER_TEST_DATABASE_URL to a migrated PostgreSQL test database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	db, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	accounts, err := auth.New(db, "test-only-jwt-secret-at-least-32-characters", false, hardening.New(nil))
	if err != nil {
		t.Fatal(err)
	}
	router := chi.NewRouter()
	router.Route("/auth", accounts.Routes)
	router.Route("/reminders", func(r chi.Router) { Routes(r, db, accounts.RequireUser) })
	call := func(method, path, body string, cookies ...*http.Cookie) *httptest.ResponseRecorder {
		req := httptest.NewRequest(method, path, strings.NewReader(body)).WithContext(ctx)
		if body != "" {
			req.Header.Set("Content-Type", "application/json")
		}
		for _, cookie := range cookies {
			req.AddCookie(cookie)
		}
		result := httptest.NewRecorder()
		router.ServeHTTP(result, req)
		return result
	}
	check := func(result *httptest.ResponseRecorder, status int) {
		t.Helper()
		if result.Code != status {
			t.Fatalf("got %d want %d: %s", result.Code, status, result.Body.String())
		}
	}
	createUser := func(name string) (string, []*http.Cookie) {
		t.Helper()
		var email string
		if err := db.QueryRow(ctx, "SELECT gen_random_uuid()::text || '@example.com'").Scan(&email); err != nil {
			t.Fatal(err)
		}
		body, _ := json.Marshal(map[string]string{"name": name, "email": email, "password": "Test reminder password 123"})
		registered := call("POST", "/auth/register", string(body))
		check(registered, 201)
		var result struct{ ID string }
		if err := json.Unmarshal(registered.Body.Bytes(), &result); err != nil {
			t.Fatal(err)
		}
		login, _ := json.Marshal(map[string]string{"email": email, "password": "Test reminder password 123"})
		logged := call("POST", "/auth/login", string(login))
		check(logged, 204)
		return result.ID, logged.Result().Cookies()
	}
	owner, cookies := createUser("First recipient")
	member, other := createUser("Other account")
	queryID := func(statement string, args ...any) string {
		t.Helper()
		var id string
		if err := db.QueryRow(ctx, statement, args...).Scan(&id); err != nil {
			t.Fatal(err)
		}
		return id
	}
	exec := func(statement string, args ...any) {
		t.Helper()
		if _, err := db.Exec(ctx, statement, args...); err != nil {
			t.Fatal(err)
		}
	}
	newGroup := func(kind string) string {
		group := queryID("INSERT INTO arisanly.groups(name,type,created_by) VALUES ('Test group',$1,$2) RETURNING id", kind, owner)
		exec("INSERT INTO arisanly.group_members(group_id,user_id,role) VALUES ($1,$2,'OWNER'),($1,$3,'MEMBER')", group, owner, member)
		return group
	}

	due := time.Date(2040, 6, 4, 0, 0, 0, 0, WIB)
	kas := newGroup("KAS")
	exec("INSERT INTO arisanly.kas_dues(group_id,member_user_id,due_date,amount) VALUES ($1,$2,$3,5000)", kas, owner, due)
	arisan := newGroup("ARISAN")
	cycle := queryID(`INSERT INTO arisanly.cycles(group_id,amount,frequency,order_method,start_date)
		VALUES ($1,5000,'MONTHLY','DRAW',$2) RETURNING id`, arisan, due)
	round := queryID(`INSERT INTO arisanly.rounds(cycle_id,number,due_date,status) VALUES ($1,1,$2,'OPEN') RETURNING id`, cycle, due)
	obligation := queryID(`INSERT INTO arisanly.obligations(round_id,member_user_id,amount_due) VALUES ($1,$2,5000) RETURNING id`, round, member)
	exec("INSERT INTO arisanly.payment_claims(obligation_id,note,status) VALUES ($1,'','PENDING')", obligation)
	// Scope counts to the fixture because CI has other groups from earlier smoke tests.
	runStage := func(at time.Time, want string) {
		t.Helper()
		if _, err := Generate(ctx, db, at); err != nil {
			t.Fatal(err)
		}
		var n int
		if err := db.QueryRow(ctx, `SELECT count(*) FROM arisanly.payment_reminders
			WHERE group_id=$1 AND user_id=$2 AND stage=$3`, kas, owner, want).Scan(&n); err != nil || n != 1 {
			t.Fatalf("stage %s: count %d, %v", want, n, err)
		}
	}
	runStage(due.AddDate(0, 0, -3), "UPCOMING")
	runStage(due.AddDate(0, 0, -3), "UPCOMING")
	runStage(due.UTC(), "TODAY")
	runStage(due.AddDate(0, 0, 1), "OVERDUE")
	check(call("GET", "/reminders", ""), 401)
	inbox := call("GET", "/reminders", "", cookies...)
	check(inbox, 200)
	var items []struct {
		ID, Stage string
		Read      bool
	}
	if err := json.Unmarshal(inbox.Body.Bytes(), &items); err != nil || len(items) != 3 {
		t.Fatalf("unexpected inbox: %s (%v)", inbox.Body.String(), err)
	}
	empty := call("GET", "/reminders", "", other...)
	check(empty, 200)
	if strings.TrimSpace(empty.Body.String()) != "[]" {
		t.Fatalf("pending claims should suppress reminders: %s", empty.Body.String())
	}
	readPath := "/reminders/" + items[0].ID + "/read"
	check(call("PATCH", readPath, "", other...), 404)
	check(call("PATCH", readPath, "", cookies...), 204)
	check(call("PATCH", readPath, "", cookies...), 204)
	updated := call("GET", "/reminders", "", cookies...)
	check(updated, 200)
	if err := json.Unmarshal(updated.Body.Bytes(), &items); err != nil || !items[0].Read {
		t.Fatalf("updated inbox: %s (%v)", updated.Body.String(), err)
	}
	exec("UPDATE arisanly.payment_claims SET status='REJECTED' WHERE obligation_id=$1", obligation)
	if _, err := Generate(ctx, db, due.AddDate(0, 0, 1)); err != nil {
		t.Fatal(err)
	}
	if refreshed := call("GET", "/reminders", "", other...); !strings.Contains(refreshed.Body.String(), "OVERDUE") {
		t.Fatalf("rejected claim did not resume reminders: %s", refreshed.Body.String())
	}
}
