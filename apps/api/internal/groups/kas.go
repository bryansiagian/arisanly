package groups

import (
	"fmt"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/bryansiagian/arisanly/apps/api/internal/ledger"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

func (h handler) kasRoutes(r chi.Router) {
	r.Post("/income", h.limitOperations(h.cashRecord(ledger.Income)))
	r.Post("/expenses", h.limitOperations(h.cashRecord(ledger.Expense)))
	r.Post("/kas/schedule", h.scheduleKas)
	r.Post("/kas/periods", h.limitOperations(h.openKasPeriod))
	r.Post("/kas/dues/{dueId}/pay", h.limitOperations(h.payKas))
}

func requireKas(r *http.Request, tx pgx.Tx, group, role string) error {
	if !treasurer(role) {
		return errForbidden
	}
	var kind string
	if err := tx.QueryRow(r.Context(), "SELECT type FROM arisanly.groups WHERE id=$1", group).Scan(&kind); err != nil {
		return err
	}
	if kind != "KAS" {
		return errArisanState
	}
	return nil
}

func (h handler) cashRecord(event ledger.Event) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Amount   int64
			Category string
			Note     string
		}
		if !decode(w, r, &input) {
			return
		}
		input.Category, input.Note = strings.TrimSpace(input.Category), strings.TrimSpace(input.Note)
		if input.Amount <= 0 || input.Category == "" || utf8.RuneCountInString(input.Category) > 80 ||
			utf8.RuneCountInString(input.Note) > 500 || strings.ContainsRune(input.Category+input.Note, 0) {
			fail(w, 400, "invalid_input")
			return
		}
		key, err := moneyKey(r)
		if err != nil {
			queryError(w, err)
			return
		}
		h.change(w, r, func(tx pgx.Tx, group, actor, role string) error {
			if err := requireKas(r, tx, group, role); err != nil {
				return err
			}
			ctx := r.Context()
			receipt, err := ledger.Post(ctx, tx, ledger.Posting{GroupID: group, ActorID: actor, Key: key, Event: event, Amount: input.Amount})
			if err != nil {
				return err
			}
			if receipt.Replay {
				var same bool
				err = tx.QueryRow(ctx, `SELECT category=$2 AND note=$3 FROM arisanly.cash_records WHERE transaction_id=$1`,
					receipt.ID, input.Category, input.Note).Scan(&same)
				if err != nil {
					return err
				}
				if !same {
					return ledger.ErrConflict
				}
				return nil
			}
			_, err = tx.Exec(ctx, "INSERT INTO arisanly.cash_records VALUES ($1,$2,$3)", receipt.ID, input.Category, input.Note)
			if err != nil {
				return err
			}
			return audit(r, tx, group, actor, "KAS_"+string(event), map[string]any{"transactionId": receipt.ID, "category": input.Category, "amount": fmt.Sprint(input.Amount)})
		})
	}
}

func (h handler) scheduleKas(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Amount              int64
		Frequency, FirstDue string
	}
	if !decode(w, r, &input) {
		return
	}
	due, err := time.Parse("2006-01-02", input.FirstDue)
	if err != nil || due.Year() < 1 || input.Amount <= 0 || (input.Frequency != "WEEKLY" && input.Frequency != "MONTHLY") {
		fail(w, 400, "invalid_input")
		return
	}
	h.change(w, r, func(tx pgx.Tx, group, actor, role string) error {
		if err := requireKas(r, tx, group, role); err != nil {
			return err
		}
		tag, err := tx.Exec(r.Context(), `INSERT INTO arisanly.kas_schedules(group_id,amount,frequency,first_due)
			VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`, group, input.Amount, input.Frequency, due)
		if err != nil {
			return err
		}
		if tag.RowsAffected() != 1 {
			return errArisanState
		}
		return audit(r, tx, group, actor, "KAS_SCHEDULE_CREATED", map[string]any{"firstDue": input.FirstDue, "frequency": input.Frequency})
	})
}

func (h handler) openKasPeriod(w http.ResponseWriter, r *http.Request) {
	var input struct{ Number int }
	if !decode(w, r, &input) {
		return
	}
	if input.Number < 0 {
		fail(w, 400, "invalid_input")
		return
	}
	h.change(w, r, func(tx pgx.Tx, group, actor, role string) error {
		if err := requireKas(r, tx, group, role); err != nil {
			return err
		}
		ctx := r.Context()
		var due time.Time
		var amount int64
		var next int
		err := tx.QueryRow(ctx, `
			SELECT (first_due + next_number * CASE frequency WHEN 'WEEKLY' THEN interval '7 days' ELSE interval '1 month' END)::date,
			       amount,next_number FROM arisanly.kas_schedules WHERE group_id=$1`, group).Scan(&due, &amount, &next)
		if err != nil {
			return err
		}
		if input.Number < next {
			return nil
		}
		if input.Number != next {
			return errArisanState
		}
		rows, err := tx.Query(ctx, `INSERT INTO arisanly.kas_dues(group_id,member_user_id,due_date,amount)
			SELECT group_id,user_id,$2,$3 FROM arisanly.group_members WHERE group_id=$1
			RETURNING id,member_user_id`, group, due, amount)
		if err != nil {
			return err
		}
		type obligation struct{ ID, Member string }
		dues, err := pgx.CollectRows(rows, pgx.RowToStructByPos[obligation])
		if err != nil {
			return err
		}
		for _, item := range dues {
			_, err = ledger.Post(ctx, tx, ledger.Posting{GroupID: group, ActorID: actor, Key: "kas-charge:" + item.ID, Event: ledger.Charge, MemberID: item.Member, Amount: amount})
			if err != nil {
				return err
			}
		}
		if _, err = tx.Exec(ctx, "UPDATE arisanly.kas_schedules SET next_number=next_number+1 WHERE group_id=$1", group); err != nil {
			return err
		}
		return audit(r, tx, group, actor, "KAS_PERIOD_OPENED", map[string]any{"dueDate": due.Format(time.DateOnly), "members": len(dues)})
	})
}

func (h handler) payKas(w http.ResponseWriter, r *http.Request) {
	due, ok := uuidParam(w, r, "dueId")
	if !ok {
		return
	}
	key, err := moneyKey(r)
	if err != nil {
		queryError(w, err)
		return
	}
	h.change(w, r, func(tx pgx.Tx, group, actor, role string) error {
		if err := requireKas(r, tx, group, role); err != nil {
			return err
		}
		ctx := r.Context()
		var member string
		var amount int64
		var previous *string
		err := tx.QueryRow(ctx, `SELECT member_user_id,amount,payment_transaction_id
			FROM arisanly.kas_dues WHERE group_id=$1 AND id=$2`, group, due).Scan(&member, &amount, &previous)
		if err != nil {
			return err
		}
		if previous != nil {
			return replayMoney(r, tx, previous, actor, key)
		}
		entry, err := ledger.Post(ctx, tx, ledger.Posting{GroupID: group, ActorID: actor, Key: key, Event: ledger.Payment, MemberID: member, Amount: amount})
		if err != nil {
			return err
		}
		if entry.Replay {
			return ledger.ErrConflict
		}
		if _, err = tx.Exec(ctx, "UPDATE arisanly.kas_dues SET payment_transaction_id=$2 WHERE id=$1", due, entry.ID); err != nil {
			return err
		}
		return audit(r, tx, group, actor, "KAS_DUE_PAID", map[string]any{"dueId": due, "transactionId": entry.ID})
	})
}
