package ledger

import (
	"context"
	"errors"
	"fmt"
	"math/rand"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

type fixture struct {
	ctx   context.Context
	db    *pgxpool.Pool
	group string
	actor string
}

func setup(t *testing.T) fixture {
	t.Helper()
	url := os.Getenv("LEDGER_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("set LEDGER_TEST_DATABASE_URL to a disposable migrated PostgreSQL database")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	t.Cleanup(cancel)
	db, err := pgxpool.New(ctx, url)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(db.Close)
	f := fixture{ctx: ctx, db: db}
	err = db.QueryRow(ctx, `
		INSERT INTO arisanly.users(email, name, password_hash)
		VALUES (gen_random_uuid()::text || '@example.com', 'Ledger test', 'disabled') RETURNING id`).Scan(&f.actor)
	if err != nil {
		t.Fatal(err)
	}
	f.group = f.newGroup(t)
	return f
}

func (f fixture) newGroup(t *testing.T) string {
	t.Helper()
	var group string
	err := f.db.QueryRow(f.ctx, `
		WITH created AS (
			INSERT INTO arisanly.groups(name, type, created_by)
			VALUES ('Ledger test', 'ARISAN', $1) RETURNING id
		)
		INSERT INTO arisanly.group_members(group_id,user_id,role)
		SELECT id,$1,'OWNER' FROM created RETURNING group_id`, f.actor).Scan(&group)
	if err != nil {
		t.Fatal(err)
	}
	return group
}

func (f fixture) perform(run func(pgx.Tx) (Receipt, error)) (Receipt, error) {
	tx, err := f.db.Begin(f.ctx)
	if err != nil {
		return Receipt{}, err
	}
	defer tx.Rollback(f.ctx)
	r, err := run(tx)
	if err != nil {
		return Receipt{}, err
	}
	if err := tx.Commit(f.ctx); err != nil {
		return Receipt{}, err
	}
	return r, nil
}

func (f fixture) post(key string, event Event, amount int64) (Receipt, error) {
	member := ""
	if event == Charge || event == Payment {
		member = f.actor
	}
	return f.perform(func(tx pgx.Tx) (Receipt, error) {
		return Post(f.ctx, tx, Posting{GroupID: f.group, ActorID: f.actor, Key: key, Event: event, MemberID: member, Amount: amount})
	})
}

func (f fixture) reverse(key, original string) (Receipt, error) {
	return f.perform(func(tx pgx.Tx) (Receipt, error) {
		return Reverse(f.ctx, tx, Reversal{GroupID: f.group, ActorID: f.actor, Key: key, OriginalID: original, Reason: "Test correction"})
	})
}

func (f fixture) balances(t *testing.T, fund, member int64) {
	t.Helper()
	var gotFund, gotMember int64
	err := f.db.QueryRow(f.ctx, `
		SELECT coalesce(max(balance) FILTER (WHERE kind = 'FUND'), 0),
		       coalesce(max(balance) FILTER (WHERE kind = 'MEMBER'), 0)
		FROM arisanly.accounts WHERE group_id = $1`, f.group).Scan(&gotFund, &gotMember)
	if err != nil {
		t.Fatal(err)
	}
	if gotFund != fund || gotMember != member {
		t.Fatalf("fund/member = %d/%d, want %d/%d", gotFund, gotMember, fund, member)
	}
}

func (f fixture) check(t *testing.T) {
	t.Helper()
	diffs, err := Reconcile(f.ctx, f.db)
	if err != nil {
		t.Fatal(err)
	}
	if len(diffs) != 0 {
		t.Fatalf("balance discrepancies: %+v", diffs)
	}
	var invalid int
	err = f.db.QueryRow(f.ctx, `
		SELECT count(*) FROM (
		    SELECT t.id FROM arisanly.transactions t
		    LEFT JOIN arisanly.ledger_entries e ON e.transaction_id = t.id
		    WHERE t.group_id = $1 GROUP BY t.id
		    HAVING count(e.account_id) < 2 OR coalesce(sum(e.amount), 0) <> 0
		) invalid`, f.group).Scan(&invalid)
	if err != nil {
		t.Fatal(err)
	}
	if invalid != 0 {
		t.Fatalf("found %d invalid postings", invalid)
	}
}

func TestPostingProperties(t *testing.T) {
	f := setup(t)
	rng := rand.New(rand.NewSource(2411))
	var fund, owed int64
	for i := 0; i < 100; i++ {
		amount := rng.Int63n(50) + 1
		event := []Event{Charge, Payment, Payout, Expense}[rng.Intn(4)]
		var want error
		switch event {
		case Charge:
			owed += amount
		case Payment:
			if amount > owed {
				want = ErrInsufficientBalance
			} else {
				owed -= amount
				fund += amount
			}
		case Payout, Expense:
			if amount > fund {
				want = ErrInsufficientBalance
			} else {
				fund -= amount
			}
		}
		key := fmt.Sprintf("random-%d", i)
		receipt, err := f.post(key, event, amount)
		if !errors.Is(err, want) {
			t.Fatalf("step %d %s: got %v, want %v", i, event, err, want)
		}
		if err == nil {
			replay, err := f.post(key, event, amount)
			if err != nil || replay.ID != receipt.ID || !replay.Replay {
				t.Fatalf("bad replay: %+v %v", replay, err)
			}
		}
		f.balances(t, fund, owed)
	}
	f.check(t)
}

func TestReversalAndRollback(t *testing.T) {
	f := setup(t)
	if _, err := f.post("charge", Charge, 100); err != nil {
		t.Fatal(err)
	}
	paid, err := f.post("payment", Payment, 100)
	if err != nil {
		t.Fatal(err)
	}
	out, err := f.post("payout", Payout, 70)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := f.reverse("reverse-payment", paid.ID); !errors.Is(err, ErrInsufficientBalance) {
		t.Fatalf("reversing spent funds: %v", err)
	}
	f.balances(t, 30, 0)
	if _, err := f.reverse("reverse-payout", out.ID); err != nil {
		t.Fatal(err)
	}
	reversed, err := f.reverse("reverse-payment", paid.ID)
	if err != nil {
		t.Fatal(err)
	}
	again, err := f.reverse("reverse-payment", paid.ID)
	if err != nil || again.ID != reversed.ID || !again.Replay {
		t.Fatalf("bad reversal replay: %+v %v", again, err)
	}
	if _, err := f.reverse("other-key", paid.ID); !errors.Is(err, ErrAlreadyReversed) {
		t.Fatalf("duplicate reversal: %v", err)
	}
	if _, err := f.reverse("of-reversal", reversed.ID); !errors.Is(err, ErrInvalid) {
		t.Fatalf("reversal of reversal: %v", err)
	}
	if _, err := f.post("charge", Charge, 101); !errors.Is(err, ErrConflict) {
		t.Fatalf("key reuse: %v", err)
	}
	f.balances(t, 0, 100)
	f.check(t)
}

func TestConcurrentDuplicateAndOverspend(t *testing.T) {
	f := setup(t)
	if _, err := f.post("charge", Charge, 100); err != nil {
		t.Fatal(err)
	}
	type result struct {
		receipt Receipt
		err     error
	}
	results := make(chan result, 100)
	var writers sync.WaitGroup
	for range cap(results) {
		writers.Go(func() {
			r, err := f.post("same-payment", Payment, 100)
			results <- result{r, err}
		})
	}
	writers.Wait()
	close(results)
	var actual int
	var id string
	for item := range results {
		if item.err != nil {
			t.Fatal(item.err)
		}
		if id == "" {
			id = item.receipt.ID
		}
		if item.receipt.ID != id {
			t.Fatal("retry returned a different transaction")
		}
		if !item.receipt.Replay {
			actual++
		}
	}
	if actual != 1 {
		t.Fatalf("new postings = %d, want 1", actual)
	}
	spends := make(chan error, 2)
	for _, key := range []string{"spend-1", "spend-2"} {
		writers.Go(func() {
			_, err := f.post(key, Payout, 75)
			spends <- err
		})
	}
	writers.Wait()
	close(spends)
	var failed int
	for err := range spends {
		if errors.Is(err, ErrInsufficientBalance) {
			failed++
		} else if err != nil {
			t.Fatal(err)
		}
	}
	if failed != 1 {
		t.Fatalf("rejected competing payouts = %d, want 1", failed)
	}
	f.balances(t, 25, 0)
	f.check(t)
}

func TestPostgresRejectsInvalidHistory(t *testing.T) {
	f := setup(t)
	posted, err := f.post("charge", Charge, 100)
	if err != nil {
		t.Fatal(err)
	}

	// Direct SQL attempts must fail even without the Go implementation.
	check := func(expected string, err error) {
		t.Helper()
		var dbErr *pgconn.PgError
		if !errors.As(err, &dbErr) || dbErr.Code != expected {
			t.Fatalf("wanted SQLSTATE %s, got %v", expected, err)
		}
	}
	_, err = f.db.Exec(f.ctx, "UPDATE arisanly.transactions SET idempotency_key = 'edited' WHERE id = $1", posted.ID)
	check("23514", err)
	_, err = f.db.Exec(f.ctx, "DELETE FROM arisanly.ledger_entries WHERE transaction_id = $1", posted.ID)
	check("23514", err)
	truncateTx, err := f.db.Begin(f.ctx)
	if err != nil {
		t.Fatal(err)
	}
	_, err = truncateTx.Exec(f.ctx, "TRUNCATE arisanly.ledger_entries")
	_ = truncateTx.Rollback(f.ctx)
	check("23514", err)

	var expenseID string
	err = f.db.QueryRow(f.ctx, "INSERT INTO arisanly.accounts(group_id, kind) VALUES ($1, 'EXPENSE') RETURNING id", f.group).Scan(&expenseID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = f.db.Exec(f.ctx, "INSERT INTO arisanly.ledger_entries VALUES ($1, $2, $3, 1)", f.group, posted.ID, expenseID)
	check("23514", err)

	_, err = f.perform(func(tx pgx.Tx) (Receipt, error) {
		var id string
		err := tx.QueryRow(f.ctx, `
			INSERT INTO arisanly.transactions(group_id, type, idempotency_key, request_hash, created_by)
			VALUES ($1,'CHARGE','unbalanced',decode(repeat('00',32),'hex'),$2) RETURNING id`,
			f.group, f.actor).Scan(&id)
		if err != nil {
			return Receipt{}, err
		}
		_, err = tx.Exec(f.ctx, "INSERT INTO arisanly.ledger_entries VALUES ($1,$2,$3,1)", f.group, id, expenseID)
		return Receipt{ID: id}, err
	})
	check("23514", err)
	f.balances(t, 0, 100)
	f.check(t)
}

func TestReconcileReportsDrift(t *testing.T) {
	f := setup(t)
	if _, err := f.post("charge", Charge, 100); err != nil {
		t.Fatal(err)
	}
	var accountID string
	err := f.db.QueryRow(f.ctx, `
		UPDATE arisanly.accounts SET balance = 101
		WHERE group_id = $1 AND kind = 'MEMBER' RETURNING id`, f.group).Scan(&accountID)
	if err != nil {
		t.Fatal(err)
	}
	defer func() {
		if _, err := f.db.Exec(f.ctx, "UPDATE arisanly.accounts SET balance = 100 WHERE id = $1", accountID); err != nil {
			t.Error(err)
		}
	}()
	diffs, err := Reconcile(f.ctx, f.db)
	if err != nil {
		t.Fatal(err)
	}
	if len(diffs) != 1 || diffs[0] != (Difference{GroupID: f.group, AccountID: accountID, Cached: 101, Calculated: "100"}) {
		t.Fatalf("unexpected discrepancies: %+v", diffs)
	}
}
