// Package ledger posts balanced, immutable entries in the caller's database transaction.
package ledger

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
)

type Event string

const (
	Charge   Event = "CHARGE"
	Payment  Event = "PAYMENT"
	Payout   Event = "PAYOUT"
	Expense  Event = "EXPENSE"
	Income   Event = "INCOME"
	reversal Event = "REVERSAL"
)

var (
	ErrInvalid             = errors.New("invalid ledger request")
	ErrConflict            = errors.New("idempotency key already used for a different request")
	ErrInsufficientBalance = errors.New("insufficient ledger balance")
	ErrUnavailable         = errors.New("ledger group, member, or transaction not found")
	ErrAlreadyReversed     = errors.New("ledger transaction has already been reversed")
)

type Posting struct {
	GroupID  string
	ActorID  string
	Key      string
	Event    Event
	MemberID string
	Amount   int64
}

type Receipt struct {
	ID     string
	Replay bool
}

type entry struct {
	account string
	amount  int64
}

type request struct {
	Actor    string
	Event    Event
	Member   string
	Amount   int64
	Original string
	Reason   string
}

func uuid(value string) bool {
	var id pgtype.UUID
	return len(value) == 36 && id.Scan(value) == nil && id.Valid
}

func validText(value string, limit int) bool {
	return strings.TrimSpace(value) != "" && utf8.ValidString(value) &&
		utf8.RuneCountInString(value) <= limit && !strings.ContainsRune(value, 0)
}

func validContext(group, actor, key string) bool {
	return uuid(group) && uuid(actor) && validText(key, 128)
}

// Post records an accounting event. The caller must commit on success or roll
// back on error. The caller owns business-state validation and authorization.
func Post(ctx context.Context, tx pgx.Tx, posting Posting) (Receipt, error) {
	if !validContext(posting.GroupID, posting.ActorID, posting.Key) || posting.Amount <= 0 {
		return Receipt{}, ErrInvalid
	}

	var debit, credit string
	switch posting.Event {
	case Charge:
		debit, credit = "MEMBER", "DUES_INCOME"
	case Payment:
		debit, credit = "FUND", "MEMBER"
	case Payout:
		debit, credit = "PAYOUT", "FUND"
	case Income:
		debit, credit = "FUND", "OTHER_INCOME"
	case Expense:
		debit, credit = "EXPENSE", "FUND"
	default:
		return Receipt{}, ErrInvalid
	}
	usesMember := debit == "MEMBER" || credit == "MEMBER"
	if (usesMember && !uuid(posting.MemberID)) || (!usesMember && posting.MemberID != "") {
		return Receipt{}, ErrInvalid
	}

	member := strings.ToLower(posting.MemberID)
	data := request{Actor: strings.ToLower(posting.ActorID), Event: posting.Event, Member: member, Amount: posting.Amount}
	receipt, err := reserve(ctx, tx, posting.GroupID, posting.Key, data)
	if err != nil || receipt.Replay {
		return receipt, err
	}
	if usesMember {
		var role string
		err := tx.QueryRow(ctx, `
			SELECT role FROM arisanly.group_members WHERE group_id = $1 AND user_id = $2`,
			posting.GroupID, member).Scan(&role)
		if err != nil {
			return Receipt{}, unavailable(err)
		}
	}
	debitID, err := account(ctx, tx, posting.GroupID, debit, member)
	if err != nil {
		return Receipt{}, err
	}
	creditID, err := account(ctx, tx, posting.GroupID, credit, member)
	if err != nil {
		return Receipt{}, err
	}
	err = insertEntries(ctx, tx, posting.GroupID, receipt.ID, []entry{
		{account: debitID, amount: posting.Amount},
		{account: creditID, amount: -posting.Amount},
	})
	if err != nil {
		return Receipt{}, err
	}
	return receipt, nil
}

func reserve(ctx context.Context, tx pgx.Tx, group, key string, data request) (Receipt, error) {
	payload, err := json.Marshal(data)
	if err != nil {
		return Receipt{}, err
	}
	hash := sha256.Sum256(payload)
	// Share the group lock with membership changes and other ledger writers.
	// Keep it until commit so retries observe the committed idempotency record.
	var groupID string
	err = tx.QueryRow(ctx, "SELECT id FROM arisanly.groups WHERE id = $1 FOR UPDATE", group).Scan(&groupID)
	if err != nil {
		return Receipt{}, unavailable(err)
	}
	var receipt Receipt
	var existingHash []byte
	err = tx.QueryRow(ctx, `
		SELECT id, request_hash FROM arisanly.transactions WHERE group_id = $1 AND idempotency_key = $2`,
		group, key).Scan(&receipt.ID, &existingHash)
	if err == nil {
		if !bytes.Equal(existingHash, hash[:]) {
			return Receipt{}, ErrConflict
		}
		receipt.Replay = true
		return receipt, nil
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		return Receipt{}, err
	}

	var original, reason *string
	if data.Event == reversal {
		var originalType Event
		err := tx.QueryRow(ctx, `
			SELECT type FROM arisanly.transactions WHERE group_id = $1 AND id = $2`,
			group, data.Original).Scan(&originalType)
		if err != nil {
			return Receipt{}, unavailable(err)
		}
		if originalType == reversal {
			return Receipt{}, ErrInvalid
		}
		original, reason = &data.Original, &data.Reason
	}
	err = tx.QueryRow(ctx, `
		INSERT INTO arisanly.transactions
		    (group_id, type, idempotency_key, request_hash, created_by, reverses_transaction_id, reversal_reason)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		ON CONFLICT (reverses_transaction_id) DO NOTHING RETURNING id`,
		group, data.Event, key, hash[:], data.Actor, original, reason).Scan(&receipt.ID)
	if errors.Is(err, pgx.ErrNoRows) {
		return Receipt{}, ErrAlreadyReversed
	}
	return receipt, err
}

func account(ctx context.Context, tx pgx.Tx, group, kind, member string) (string, error) {
	var memberID *string
	if kind == "MEMBER" {
		memberID = &member
	}
	_, err := tx.Exec(ctx, `
		INSERT INTO arisanly.accounts(group_id, kind, member_user_id)
		VALUES ($1, $2, $3) ON CONFLICT (group_id, kind, member_user_id) DO NOTHING`, group, kind, memberID)
	if err != nil {
		return "", err
	}
	var id string
	err = tx.QueryRow(ctx, `
		SELECT id FROM arisanly.accounts
		WHERE group_id = $1 AND kind = $2 AND member_user_id IS NOT DISTINCT FROM $3
		FOR UPDATE`, group, kind, memberID).Scan(&id)
	return id, err
}

func insertEntries(ctx context.Context, tx pgx.Tx, group, transaction string, entries []entry) error {
	for _, item := range entries {
		_, err := tx.Exec(ctx, `
			INSERT INTO arisanly.ledger_entries(group_id, transaction_id, account_id, amount)
			VALUES ($1, $2, $3, $4)`, group, transaction, item.account, item.amount)
		if err != nil {
			var pgErr *pgconn.PgError
			if errors.As(err, &pgErr) && pgErr.ConstraintName == "account_nonnegative" {
				return ErrInsufficientBalance
			}
			return err
		}
	}
	return nil
}

func unavailable(err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return ErrUnavailable
	}
	return err
}
