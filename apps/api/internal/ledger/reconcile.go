package ledger

import (
	"context"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

type Difference struct {
	GroupID    string
	AccountID  string
	Cached     int64
	Calculated string
}

// Reconcile checks all accounts using one database snapshot. It reports
// discrepancies for investigation and leaves the ledger and cache untouched.
func Reconcile(ctx context.Context, db *pgxpool.Pool) ([]Difference, error) {
	rows, err := db.Query(ctx, `
		SELECT a.group_id, a.id, a.balance, coalesce(sum(e.amount), 0)::text
		FROM arisanly.accounts a
		LEFT JOIN arisanly.ledger_entries e ON e.account_id = a.id
		GROUP BY a.id
		HAVING a.balance <> coalesce(sum(e.amount), 0)
		ORDER BY a.group_id, a.id`)
	if err != nil {
		return nil, err
	}
	return pgx.CollectRows(rows, pgx.RowToStructByPos[Difference])
}
