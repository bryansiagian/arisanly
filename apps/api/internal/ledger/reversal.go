package ledger

import (
	"context"
	"strings"

	"github.com/jackc/pgx/v5"
)

type Reversal struct {
	GroupID    string
	ActorID    string
	Key        string
	OriginalID string
	Reason     string
}

// Reverse mirrors the original entries and preserves the original posting.
// The same balance constraints apply to a reversal as to any other posting.
func Reverse(ctx context.Context, tx pgx.Tx, input Reversal) (Receipt, error) {
	reason := strings.TrimSpace(input.Reason)
	if !validContext(input.GroupID, input.ActorID, input.Key) || !uuid(input.OriginalID) || !validText(reason, 500) {
		return Receipt{}, ErrInvalid
	}
	data := request{
		Actor: strings.ToLower(input.ActorID), Event: reversal,
		Original: strings.ToLower(input.OriginalID), Reason: reason,
	}
	receipt, err := reserve(ctx, tx, input.GroupID, input.Key, data)
	if err != nil || receipt.Replay {
		return receipt, err
	}
	rows, err := tx.Query(ctx, `
		SELECT e.account_id, -e.amount FROM arisanly.ledger_entries e
		JOIN arisanly.accounts a ON a.id = e.account_id AND a.group_id = e.group_id
		WHERE e.group_id = $1 AND e.transaction_id = $2
		ORDER BY a.kind, a.id FOR UPDATE OF a`, input.GroupID, data.Original)
	if err != nil {
		return Receipt{}, err
	}
	entries, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (entry, error) {
		var item entry
		err := row.Scan(&item.account, &item.amount)
		return item, err
	})
	if err != nil {
		return Receipt{}, err
	}
	if err := insertEntries(ctx, tx, input.GroupID, receipt.ID, entries); err != nil {
		return Receipt{}, err
	}
	return receipt, nil
}
