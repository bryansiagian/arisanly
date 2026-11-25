package groups

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"net/http"
	"strings"
	"time"

	"github.com/bryansiagian/arisanly/apps/api/internal/ledger"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
)

var errArisanState = errors.New("invalid arisan state")

func (h handler) arisanRoutes(r chi.Router) {
	r.Get("/rounds", h.rounds)
	r.Get("/audit", h.auditLog)
	r.Post("/start", h.startCycle)
	r.Post("/rounds/{roundId}/draw", h.draw)
	r.Post("/rounds/{roundId}/payout", h.payout)
	r.Post("/rounds/{roundId}/close", h.closeRound)
	r.Post("/obligations/{obligationId}/claims", h.claim)
	r.Post("/claims/{claimId}/confirm", h.confirm)
	r.Post("/claims/{claimId}/reject", h.reject)
}

type cycleInput struct {
	Amount      int64
	Frequency   string
	OrderMethod string
	StartDate   string
	Order       []string
}

func (h handler) startCycle(w http.ResponseWriter, r *http.Request) {
	var input cycleInput
	if !decode(w, r, &input) {
		return
	}
	start, err := time.Parse("2006-01-02", input.StartDate)
	validFrequency := input.Frequency == "WEEKLY" || input.Frequency == "BIWEEKLY" || input.Frequency == "MONTHLY"
	if err != nil || start.Year() < 1 || start.Year() > 9999 || input.Amount < 1 || !validFrequency ||
		(input.OrderMethod != "DRAW" && input.OrderMethod != "FIXED") ||
		(input.OrderMethod == "DRAW" && len(input.Order) != 0) {
		fail(w, 400, "invalid_input")
		return
	}
	h.change(w, r, func(tx pgx.Tx, group, actor, role string) error {
		if role != "OWNER" {
			return errForbidden
		}
		ctx := r.Context()
		var allowed bool
		err := tx.QueryRow(ctx, `
			SELECT type = 'ARISAN' AND NOT EXISTS (
				SELECT 1 FROM arisanly.cycles WHERE group_id = $1 AND closed_at IS NULL
			) FROM arisanly.groups WHERE id = $1`, group).Scan(&allowed)
		if err != nil {
			return err
		}
		if !allowed {
			return errArisanState
		}
		rows, err := tx.Query(ctx, "SELECT user_id::text FROM arisanly.group_members WHERE group_id = $1 ORDER BY joined_at, user_id", group)
		if err != nil {
			return err
		}
		members, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		if len(members) < 2 || input.Amount > math.MaxInt64/int64(len(members)) {
			return errArisanState
		}
		if input.OrderMethod == "FIXED" {
			if len(input.Order) != len(members) {
				return ledger.ErrInvalid
			}
			remaining := make(map[string]bool, len(members))
			for _, member := range members {
				remaining[member] = true
			}
			for _, member := range input.Order {
				if !remaining[member] {
					return ledger.ErrInvalid
				}
				delete(remaining, member)
			}
			members = input.Order
		}
		var cycle string
		err = tx.QueryRow(ctx, `
			INSERT INTO arisanly.cycles(group_id,amount,frequency,order_method,start_date)
			VALUES ($1,$2,$3,$4,$5) RETURNING id`, group, input.Amount, input.Frequency, input.OrderMethod, start).Scan(&cycle)
		if err != nil {
			return err
		}
		for i, member := range members {
			_, err = tx.Exec(ctx, "INSERT INTO arisanly.cycle_members VALUES ($1,$2,$3)", cycle, member, i+1)
			if err != nil {
				return err
			}
		}
		if err := openRound(r, tx, group, actor, cycle, 1); err != nil {
			return err
		}
		return audit(r, tx, group, actor, "CYCLE_STARTED", map[string]any{"cycleId": cycle})
	})
}

func openRound(r *http.Request, tx pgx.Tx, group, actor, cycle string, number int) error {
	ctx := r.Context()
	var round string
	err := tx.QueryRow(ctx, `
		INSERT INTO arisanly.rounds(cycle_id,number,due_date,recipient_user_id,status)
		SELECT c.id,$2,c.start_date + CASE c.frequency
		    WHEN 'WEEKLY' THEN ($2 - 1) * interval '7 days'
		    WHEN 'BIWEEKLY' THEN ($2 - 1) * interval '14 days'
		    ELSE ($2 - 1) * interval '1 month' END,
		    CASE WHEN c.order_method = 'FIXED' THEN m.user_id END,'OPEN'
		FROM arisanly.cycles c JOIN arisanly.cycle_members m ON m.cycle_id=c.id AND m.position=$2
		WHERE c.id=$1 RETURNING id`, cycle, number).Scan(&round)
	if err != nil {
		return err
	}
	rows, err := tx.Query(ctx, `
		INSERT INTO arisanly.obligations(round_id,member_user_id,amount_due)
		SELECT $2,m.user_id,c.amount FROM arisanly.cycle_members m JOIN arisanly.cycles c ON c.id=m.cycle_id
		WHERE c.id=$1 RETURNING id,member_user_id,amount_due`, cycle, round)
	if err != nil {
		return err
	}
	type due struct {
		ID, Member string
		Amount     int64
	}
	items, err := pgx.CollectRows(rows, pgx.RowToStructByPos[due])
	if err != nil {
		return err
	}
	for _, item := range items {
		_, err = ledger.Post(ctx, tx, ledger.Posting{GroupID: group, ActorID: actor, Event: ledger.Charge,
			Key: "arisan-charge:" + item.ID, MemberID: item.Member, Amount: item.Amount})
		if err != nil {
			return err
		}
	}
	return audit(r, tx, group, actor, "ROUND_OPENED", map[string]any{"roundId": round, "number": number})
}

func audit(r *http.Request, tx pgx.Tx, group, actor, action string, details map[string]any) error {
	payload, err := json.Marshal(details)
	if err != nil {
		return err
	}
	_, err = tx.Exec(r.Context(), "INSERT INTO arisanly.audit_log(group_id,actor_user_id,action,details) VALUES ($1,$2,$3,$4)", group, actor, action, payload)
	return err
}

func treasurer(role string) bool { return role == "OWNER" || role == "TREASURER" }

type roundState struct {
	Cycle, Status, Method string
	Recipient             *string
	Number                int
	Payout                *string
}

func findRound(r *http.Request, tx pgx.Tx, group, round string) (roundState, error) {
	var state roundState
	err := tx.QueryRow(r.Context(), `
		SELECT c.id,r.status,c.order_method,r.recipient_user_id,r.number,r.payout_transaction_id
		FROM arisanly.rounds r JOIN arisanly.cycles c ON c.id=r.cycle_id
		WHERE r.id=$1 AND c.group_id=$2`, round, group).
		Scan(&state.Cycle, &state.Status, &state.Method, &state.Recipient, &state.Number, &state.Payout)
	return state, err
}

func (h handler) draw(w http.ResponseWriter, r *http.Request) {
	round, ok := uuidParam(w, r, "roundId")
	if !ok {
		return
	}
	h.change(w, r, func(tx pgx.Tx, group, actor, role string) error {
		if !treasurer(role) {
			return errForbidden
		}
		state, err := findRound(r, tx, group, round)
		if err != nil {
			return err
		}
		if state.Method != "DRAW" || state.Recipient != nil || (state.Status != "OPEN" && state.Status != "COLLECTED") {
			return errArisanState
		}
		rows, err := tx.Query(r.Context(), `
			SELECT m.user_id::text FROM arisanly.cycle_members m WHERE m.cycle_id=$1 AND NOT EXISTS (
				SELECT 1 FROM arisanly.rounds WHERE cycle_id=$1 AND recipient_user_id=m.user_id
			) ORDER BY m.position`, state.Cycle)
		if err != nil {
			return err
		}
		candidates, err := pgx.CollectRows(rows, pgx.RowTo[string])
		if err != nil {
			return err
		}
		if len(candidates) == 0 {
			return errArisanState
		}
		index, err := rand.Int(rand.Reader, big.NewInt(int64(len(candidates))))
		if err != nil {
			return err
		}
		chosen := candidates[index.Int64()]
		_, err = tx.Exec(r.Context(), "UPDATE arisanly.rounds SET recipient_user_id=$2 WHERE id=$1", round, chosen)
		if err != nil {
			return err
		}
		return audit(r, tx, group, actor, "ROUND_DRAWN", map[string]any{"roundId": round, "candidates": candidates, "recipientId": chosen})
	})
}

func (h handler) closeRound(w http.ResponseWriter, r *http.Request) {
	round, ok := uuidParam(w, r, "roundId")
	if !ok {
		return
	}
	h.change(w, r, func(tx pgx.Tx, group, actor, role string) error {
		if !treasurer(role) {
			return errForbidden
		}
		state, err := findRound(r, tx, group, round)
		if err != nil {
			return err
		}
		if state.Status != "PAID_OUT" {
			return errArisanState
		}
		ctx := r.Context()
		if _, err = tx.Exec(ctx, "UPDATE arisanly.rounds SET status='CLOSED' WHERE id=$1", round); err != nil {
			return err
		}
		if err = audit(r, tx, group, actor, "ROUND_CLOSED", map[string]any{"roundId": round}); err != nil {
			return err
		}
		var count int
		if err = tx.QueryRow(ctx, "SELECT count(*) FROM arisanly.cycle_members WHERE cycle_id=$1", state.Cycle).Scan(&count); err != nil {
			return err
		}
		if state.Number < count {
			return openRound(r, tx, group, actor, state.Cycle, state.Number+1)
		}
		if _, err = tx.Exec(ctx, "UPDATE arisanly.cycles SET closed_at=now() WHERE id=$1", state.Cycle); err != nil {
			return err
		}
		return audit(r, tx, group, actor, "CYCLE_CLOSED", map[string]any{"cycleId": state.Cycle})
	})
}

func moneyKey(r *http.Request) (string, error) {
	key := strings.TrimSpace(r.Header.Get("Idempotency-Key"))
	if len(key) == 0 || len(key) > 100 {
		return "", ledger.ErrInvalid
	}
	return "arisan-http:" + key, nil
}

func replayMoney(r *http.Request, tx pgx.Tx, transaction *string, actor, key string) error {
	if transaction == nil {
		return errArisanState
	}
	var matches bool
	err := tx.QueryRow(r.Context(), "SELECT idempotency_key=$2 AND created_by=$3 FROM arisanly.transactions WHERE id=$1",
		*transaction, key, actor).Scan(&matches)
	if err != nil {
		return err
	}
	if !matches {
		return errArisanState
	}
	return nil
}

func (h handler) payout(w http.ResponseWriter, r *http.Request) {
	round, ok := uuidParam(w, r, "roundId")
	if !ok {
		return
	}
	key, err := moneyKey(r)
	if err != nil {
		queryError(w, err)
		return
	}
	h.change(w, r, func(tx pgx.Tx, group, actor, role string) error {
		if !treasurer(role) {
			return errForbidden
		}
		state, err := findRound(r, tx, group, round)
		if err != nil {
			return err
		}
		if state.Payout != nil {
			return replayMoney(r, tx, state.Payout, actor, key)
		}
		if state.Status != "COLLECTED" || state.Recipient == nil {
			return errArisanState
		}
		var total int64
		if err = tx.QueryRow(r.Context(), "SELECT sum(amount_due)::bigint FROM arisanly.obligations WHERE round_id=$1", round).Scan(&total); err != nil {
			return err
		}
		receipt, err := ledger.Post(r.Context(), tx, ledger.Posting{GroupID: group, ActorID: actor, Key: key, Event: ledger.Payout, Amount: total})
		if err != nil {
			return err
		}
		if receipt.Replay {
			return ledger.ErrConflict
		}
		_, err = tx.Exec(r.Context(), "UPDATE arisanly.rounds SET status='PAID_OUT',payout_transaction_id=$2 WHERE id=$1", round, receipt.ID)
		if err != nil {
			return err
		}
		return audit(r, tx, group, actor, "ROUND_PAID_OUT", map[string]any{"roundId": round, "transactionId": receipt.ID, "amount": fmt.Sprint(total)})
	})
}
