package groups

import (
	"net/http"
	"strings"
	"unicode/utf8"

	"github.com/bryansiagian/arisanly/apps/api/internal/ledger"
	"github.com/jackc/pgx/v5"
)

func (h handler) claim(w http.ResponseWriter, r *http.Request) {
	obligation, ok := uuidParam(w, r, "obligationId")
	if !ok {
		return
	}
	var input struct{ Note string }
	if !decode(w, r, &input) {
		return
	}
	input.Note = strings.TrimSpace(input.Note)
	if utf8.RuneCountInString(input.Note) > 500 || strings.ContainsRune(input.Note, 0) {
		fail(w, 400, "invalid_input")
		return
	}
	h.change(w, r, func(tx pgx.Tx, group, actor, role string) error {
		ctx := r.Context()
		var member, status string
		err := tx.QueryRow(ctx, `
			SELECT o.member_user_id,r.status FROM arisanly.obligations o
			JOIN arisanly.rounds r ON r.id=o.round_id JOIN arisanly.cycles c ON c.id=r.cycle_id
			WHERE o.id=$1 AND c.group_id=$2`, obligation, group).Scan(&member, &status)
		if err != nil {
			return err
		}
		if member != actor {
			return errForbidden
		}
		if status != "OPEN" {
			return errArisanState
		}
		var id string
		err = tx.QueryRow(ctx, `
			INSERT INTO arisanly.payment_claims(obligation_id,note,status)
			VALUES ($1,$2,'PENDING') ON CONFLICT DO NOTHING RETURNING id`, obligation, input.Note).Scan(&id)
		if err == pgx.ErrNoRows {
			return errArisanState
		}
		if err != nil {
			return err
		}
		return audit(r, tx, group, actor, "CLAIM_SUBMITTED", map[string]any{"claimId": id, "obligationId": obligation})
	})
}

func (h handler) confirm(w http.ResponseWriter, r *http.Request) { h.decideClaim(w, r, true) }
func (h handler) reject(w http.ResponseWriter, r *http.Request)  { h.decideClaim(w, r, false) }

func (h handler) decideClaim(w http.ResponseWriter, r *http.Request, confirm bool) {
	claim, ok := uuidParam(w, r, "claimId")
	if !ok {
		return
	}
	var key string
	if confirm {
		var err error
		key, err = moneyKey(r)
		if err != nil {
			queryError(w, err)
			return
		}
	}
	target := ""
	if confirm {
		target = "confirm:" + strings.ToLower(claim)
	}
	h.changeGuarded(w, r, target, key, func(tx pgx.Tx, group, actor, role string) error {
		if !treasurer(role) {
			return errForbidden
		}
		ctx := r.Context()
		var status, roundStatus, member, round string
		var amount int64
		var previous *string
		err := tx.QueryRow(ctx, `
			SELECT p.status,p.payment_transaction_id,r.status,o.member_user_id,o.amount_due,r.id
			FROM arisanly.payment_claims p JOIN arisanly.obligations o ON o.id=p.obligation_id
			JOIN arisanly.rounds r ON r.id=o.round_id JOIN arisanly.cycles c ON c.id=r.cycle_id
			WHERE p.id=$1 AND c.group_id=$2`, claim, group).Scan(&status, &previous, &roundStatus, &member, &amount, &round)
		if err != nil {
			return err
		}
		if confirm && status == "CONFIRMED" {
			return replayMoney(r, tx, previous, actor, key)
		}
		if status != "PENDING" || roundStatus != "OPEN" {
			return errArisanState
		}
		if !confirm {
			if _, err = tx.Exec(ctx, "UPDATE arisanly.payment_claims SET status='REJECTED' WHERE id=$1", claim); err != nil {
				return err
			}
			return audit(r, tx, group, actor, "CLAIM_REJECTED", map[string]any{"claimId": claim})
		}
		receipt, err := ledger.Post(ctx, tx, ledger.Posting{GroupID: group, ActorID: actor, Key: key, Event: ledger.Payment, MemberID: member, Amount: amount})
		if err != nil {
			return err
		}
		if receipt.Replay {
			return ledger.ErrConflict
		}
		_, err = tx.Exec(ctx, "UPDATE arisanly.payment_claims SET status='CONFIRMED',payment_transaction_id=$2 WHERE id=$1", claim, receipt.ID)
		if err != nil {
			return err
		}
		_, err = tx.Exec(ctx, `
			UPDATE arisanly.rounds SET status='COLLECTED' WHERE id=$1 AND NOT EXISTS (
				SELECT 1 FROM arisanly.obligations o WHERE o.round_id=$1 AND NOT EXISTS (
					SELECT 1 FROM arisanly.payment_claims WHERE obligation_id=o.id AND status='CONFIRMED'
				)
			)`, round)
		if err != nil {
			return err
		}
		return audit(r, tx, group, actor, "CLAIM_CONFIRMED", map[string]any{"claimId": claim, "transactionId": receipt.ID})
	})
}
