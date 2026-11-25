package reminders

import (
	"encoding/json"
	"log/slog"
	"net/http"

	"github.com/bryansiagian/arisanly/apps/api/internal/auth"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

func Routes(router chi.Router, db *pgxpool.Pool, authenticate func(http.Handler) http.Handler) {
	router.Use(authenticate)
	router.Get("/", func(w http.ResponseWriter, r *http.Request) {
		var data json.RawMessage
		err := db.QueryRow(r.Context(), `
			SELECT coalesce(jsonb_agg(jsonb_build_object(
			    'id',n.id,'groupName',n.name,'dueDate',n.due_date,'amount',n.amount::text,
			    'stage',n.stage,'read',n.read_at IS NOT NULL,'createdAt',n.created_at
			) ORDER BY n.created_at DESC,n.id DESC),'[]'::jsonb)
			FROM (
			    SELECT n.*,g.name FROM arisanly.payment_reminders n
			    JOIN arisanly.group_members m ON m.group_id=n.group_id AND m.user_id=n.user_id
			    JOIN arisanly.groups g ON g.id=n.group_id
			    WHERE n.user_id=$1 ORDER BY n.created_at DESC,n.id DESC LIMIT 50
			) n`, auth.UserID(r.Context())).Scan(&data)
		if err != nil {
			slog.Error("could not read reminders", "error", err)
			http.Error(w, "could not read reminders", http.StatusInternalServerError)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write(data)
	})
	router.Patch("/{id}/read", func(w http.ResponseWriter, r *http.Request) {
		var id pgtype.UUID
		raw := chi.URLParam(r, "id")
		if len(raw) != 36 || id.Scan(raw) != nil || !id.Valid {
			http.NotFound(w, r)
			return
		}
		tag, err := db.Exec(r.Context(), `
			UPDATE arisanly.payment_reminders n SET read_at=coalesce(read_at,now())
			FROM arisanly.group_members m
			WHERE n.id=$1 AND n.user_id=$2 AND m.group_id=n.group_id AND m.user_id=n.user_id`,
			id, auth.UserID(r.Context()))
		if err != nil {
			slog.Error("could not mark reminder read", "error", err)
			http.Error(w, "could not mark reminder read", http.StatusInternalServerError)
			return
		}
		if tag.RowsAffected() == 0 {
			http.NotFound(w, r)
			return
		}
		w.WriteHeader(http.StatusNoContent)
	})
}
