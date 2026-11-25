// Package reminders generates and displays reminders for unpaid group dues.
package reminders

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

const Task = "payments:remind"

var WIB = time.FixedZone("WIB", 7*60*60)

// Generate records at most one reminder per obligation per stage. It can be
// called repeatedly by independent workers without producing duplicates.
func Generate(ctx context.Context, db *pgxpool.Pool, now time.Time) (int64, error) {
	today := now.In(WIB).Format(time.DateOnly)
	tag, err := db.Exec(ctx, `
		WITH candidates AS (
			SELECT c.group_id, o.member_user_id AS user_id, o.id AS obligation_id,
			       NULL::uuid AS kas_due_id, r.due_date, o.amount_due AS amount
			FROM arisanly.obligations o
			JOIN arisanly.rounds r ON r.id=o.round_id AND r.status='OPEN'
			JOIN arisanly.cycles c ON c.id=r.cycle_id
			WHERE r.due_date <= $1::text::date + 3
			AND NOT EXISTS (
				SELECT 1 FROM arisanly.payment_claims p
				WHERE p.obligation_id=o.id AND p.status IN ('PENDING','CONFIRMED')
			)
			UNION ALL
			SELECT d.group_id,d.member_user_id,NULL::uuid,d.id,d.due_date,d.amount
			FROM arisanly.kas_dues d
			WHERE d.payment_transaction_id IS NULL AND d.due_date <= $1::text::date + 3
		)
		INSERT INTO arisanly.payment_reminders(group_id,user_id,arisan_obligation_id,kas_due_id,due_date,amount,stage)
		SELECT c.group_id,c.user_id,c.obligation_id,c.kas_due_id,c.due_date,c.amount,
		    CASE WHEN c.due_date > $1::text::date THEN 'UPCOMING'
		         WHEN c.due_date = $1::text::date THEN 'TODAY' ELSE 'OVERDUE' END
		FROM candidates c JOIN arisanly.group_members m ON m.group_id=c.group_id AND m.user_id=c.user_id
		ON CONFLICT (arisan_obligation_id,kas_due_id,stage) DO NOTHING`, today)
	return tag.RowsAffected(), err
}
