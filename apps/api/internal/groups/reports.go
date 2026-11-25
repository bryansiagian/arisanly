package groups

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/csv"
	"encoding/json"
	"net/http"
	"strings"
	"time"

	"github.com/bryansiagian/arisanly/apps/api/internal/auth"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
)

func (h handler) reportRoutes(r chi.Router) {
	r.Get("/summary", h.report)
	r.Get("/ledger", h.report)
	r.Get("/export.csv", h.export)
	r.Post("/share", h.share)
	r.Delete("/share", h.revokeShare)
}

func reportPeriod(w http.ResponseWriter, r *http.Request) (time.Time, time.Time, bool) {
	jakarta := time.FixedZone("WIB", 7*60*60)
	value := r.URL.Query().Get("month")
	if value == "" {
		value = time.Now().In(jakarta).Format("2006-01")
	}
	start, err := time.ParseInLocation("2006-01", value, jakarta)
	if err != nil || start.Year() < 1 {
		fail(w, 400, "invalid_month")
		return time.Time{}, time.Time{}, false
	}
	return start, start.AddDate(0, 1, 0), true
}

type reportRow struct {
	At       time.Time `json:"at"`
	Type     string    `json:"type"`
	Category string    `json:"category"`
	Note     string    `json:"note"`
	Member   string    `json:"member"`
	Delta    string    `json:"delta"`
}

func (h handler) reportData(r *http.Request, group string, start, end time.Time) (json.RawMessage, []reportRow, error) {
	ctx := r.Context()
	tx, err := h.db.BeginTx(ctx, pgx.TxOptions{IsoLevel: pgx.RepeatableRead, AccessMode: pgx.ReadOnly})
	if err != nil {
		return nil, nil, err
	}
	defer tx.Rollback(ctx)
	var summary json.RawMessage
	err = tx.QueryRow(ctx, `
		WITH movements AS (
			SELECT e.amount,t.created_at FROM arisanly.ledger_entries e
			JOIN arisanly.accounts a ON a.id=e.account_id AND a.kind='FUND'
			JOIN arisanly.transactions t ON t.id=e.transaction_id WHERE e.group_id=$1
		)
		SELECT jsonb_build_object(
			'balance', coalesce((SELECT balance::text FROM arisanly.accounts WHERE group_id=$1 AND kind='FUND'),'0'),
			'opening',coalesce((SELECT sum(amount)::text FROM movements WHERE created_at<$3),'0'),
			'income',coalesce((SELECT sum(amount)::text FROM movements WHERE created_at >= $3 AND created_at < $4 AND amount>0),'0'),
			'expenses',coalesce((SELECT sum(-amount)::text FROM movements WHERE created_at >= $3 AND created_at < $4 AND amount<0),'0'),
			'schedule',(SELECT jsonb_build_object('amount',amount::text,'frequency',frequency,'nextNumber',next_number,
			    'nextDue',(first_due + next_number * CASE frequency WHEN 'WEEKLY' THEN interval '7 days' ELSE interval '1 month' END)::date)
			    FROM arisanly.kas_schedules WHERE group_id=$1),
			'dues',coalesce((SELECT jsonb_agg(jsonb_build_object('id',d.id,'name',u.name,'amount',d.amount::text,'dueDate',d.due_date,
			    'status',CASE WHEN d.payment_transaction_id IS NOT NULL THEN 'PAID'
			        WHEN d.due_date < (now() AT TIME ZONE 'Asia/Jakarta')::date THEN 'LATE' ELSE 'OWED' END)
			    ORDER BY d.due_date,u.name,d.id)
			    FROM arisanly.kas_dues d JOIN arisanly.users u ON u.id=d.member_user_id WHERE d.group_id=$1
			    AND (d.payment_transaction_id IS NULL OR (d.due_date >= $5::text::date AND d.due_date < $6::text::date))),'[]'::jsonb)
		)
		FROM arisanly.group_members WHERE group_id=$1 AND user_id=$2`,
		group, auth.UserID(ctx), start, end, start.Format(time.DateOnly), end.Format(time.DateOnly)).Scan(&summary)
	if err != nil {
		return nil, nil, err
	}
	rows, err := tx.Query(ctx, `
		SELECT t.created_at,t.type,coalesce(c.category,''),coalesce(c.note,''),
		       coalesce(m.name,''),coalesce(e.amount::text,'0')
		FROM arisanly.transactions t
		LEFT JOIN arisanly.cash_records c ON c.transaction_id=t.id
		LEFT JOIN LATERAL (
		    SELECT u.name FROM arisanly.ledger_entries le JOIN arisanly.accounts a ON a.id=le.account_id
		    JOIN arisanly.users u ON u.id=a.member_user_id WHERE le.transaction_id=t.id
		    ORDER BY a.id LIMIT 1
		) m ON true
		LEFT JOIN LATERAL (
		    SELECT le.amount FROM arisanly.ledger_entries le JOIN arisanly.accounts a ON a.id=le.account_id
		    WHERE le.transaction_id=t.id AND a.kind='FUND'
		) e ON true
		WHERE t.group_id=$1 AND t.created_at >= $2 AND t.created_at < $3
		ORDER BY t.created_at DESC,t.id`, group, start, end)
	if err != nil {
		return nil, nil, err
	}
	items, err := pgx.CollectRows(rows, pgx.RowToStructByPos[reportRow])
	if err != nil {
		return nil, nil, err
	}
	if err = tx.Commit(ctx); err != nil {
		return nil, nil, err
	}
	return summary, items, nil
}

func (h handler) report(w http.ResponseWriter, r *http.Request) {
	group, ok := uuidParam(w, r, "id")
	if !ok {
		return
	}
	start, end, ok := reportPeriod(w, r)
	if !ok {
		return
	}
	summary, rows, err := h.reportData(r, group, start, end)
	if err != nil {
		queryError(w, err)
		return
	}
	reply(w, 200, map[string]any{"month": start.Format("2006-01"), "summary": summary, "rows": rows})
}

// Treat user input as text when the CSV is opened in a spreadsheet.
func csvText(value string) string {
	clean := strings.TrimLeft(value, " \t\r\n\v\f")
	if strings.HasPrefix(value, "\t") || strings.HasPrefix(value, "\r") || strings.HasPrefix(value, "\n") ||
		(clean != "" && strings.ContainsRune("=+-@＝＋－＠", []rune(clean)[0])) {
		return "'" + value
	}
	return value
}

func (h handler) export(w http.ResponseWriter, r *http.Request) {
	group, ok := uuidParam(w, r, "id")
	if !ok {
		return
	}
	start, end, ok := reportPeriod(w, r)
	if !ok {
		return
	}
	_, rows, err := h.reportData(r, group, start, end)
	if err != nil {
		queryError(w, err)
		return
	}
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", `attachment; filename="arisanly-`+start.Format("2006-01")+`.csv"`)
	writer := csv.NewWriter(w)
	_ = writer.Write([]string{"Waktu WIB", "Jenis", "Kategori", "Catatan", "Anggota", "Perubahan dana (Rp)"})
	for _, row := range rows {
		_ = writer.Write([]string{row.At.In(start.Location()).Format(time.RFC3339), row.Type,
			csvText(row.Category), csvText(row.Note), csvText(row.Member), row.Delta})
	}
	writer.Flush()
}

func (h handler) share(w http.ResponseWriter, r *http.Request) {
	group, ok := uuidParam(w, r, "id")
	if !ok {
		return
	}
	var random [24]byte
	_, _ = rand.Read(random[:])
	code := base64.RawURLEncoding.EncodeToString(random[:])
	digest := sha256.Sum256([]byte(code))
	var expires time.Time
	err := h.db.QueryRow(r.Context(), `
		INSERT INTO arisanly.report_shares(group_id,code_hash,expires_at)
		SELECT group_id,$3,now()+interval '7 days' FROM arisanly.group_members
		WHERE group_id=$1 AND user_id=$2 AND role='OWNER'
		ON CONFLICT(group_id) DO UPDATE SET code_hash=excluded.code_hash,expires_at=excluded.expires_at
		RETURNING expires_at`, group, auth.UserID(r.Context()), digest[:]).Scan(&expires)
	if err != nil {
		queryError(w, err)
		return
	}
	reply(w, 201, map[string]any{"code": code, "expiresAt": expires})
}

func (h handler) revokeShare(w http.ResponseWriter, r *http.Request) {
	h.change(w, r, func(tx pgx.Tx, group, actor, role string) error {
		if role != "OWNER" {
			return errForbidden
		}
		_, err := tx.Exec(r.Context(), "DELETE FROM arisanly.report_shares WHERE group_id=$1", group)
		return err
	})
}

func PublicReport(db *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("X-Robots-Tag", "noindex, nofollow")
		code := chi.URLParam(r, "code")
		if len(code) != 32 {
			fail(w, 404, "not_found")
			return
		}
		if _, err := base64.RawURLEncoding.Strict().DecodeString(code); err != nil {
			fail(w, 404, "not_found")
			return
		}
		digest := sha256.Sum256([]byte(code))
		var result json.RawMessage
		err := db.QueryRow(r.Context(), `
			SELECT jsonb_build_object('type',g.type,'balance',coalesce(a.balance::text,'0'))
			FROM arisanly.report_shares s JOIN arisanly.groups g ON g.id=s.group_id
			LEFT JOIN arisanly.accounts a ON a.group_id=g.id AND a.kind='FUND'
			WHERE s.code_hash=$1 AND s.expires_at>now()`, digest[:]).Scan(&result)
		if err != nil {
			queryError(w, err)
			return
		}
		reply(w, 200, result)
	}
}
