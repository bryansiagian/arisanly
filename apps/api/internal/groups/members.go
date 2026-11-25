package groups

import (
	"errors"
	"net/http"
	"strings"

	"github.com/bryansiagian/arisanly/apps/api/internal/auth"
	"github.com/jackc/pgx/v5"
)

var errForbidden = errors.New("forbidden")

// Serialize membership and invite mutations for one group. Read the acting
// membership after taking the lock so concurrent changes cannot grant stale rights.
func (h handler) change(w http.ResponseWriter, r *http.Request, apply func(pgx.Tx, string, string, string) error) {
	h.changeGuarded(w, r, "", "", apply)
}

func (h handler) changeGuarded(w http.ResponseWriter, r *http.Request, target, token string, apply func(pgx.Tx, string, string, string) error) {
	id, ok := uuidParam(w, r, "id")
	if !ok {
		return
	}
	ctx := r.Context()
	id = strings.ToLower(id)
	if target != "" {
		release, acquired := h.guard.Acquire(ctx, id, target)
		if !acquired && token == "" {
			fail(w, 409, "arisan_conflict")
			return
		}
		defer release()
	}
	tx, err := h.db.Begin(ctx)
	if err != nil {
		queryError(w, err)
		return
	}
	defer tx.Rollback(ctx)
	var found string
	if err = tx.QueryRow(ctx, "SELECT id FROM arisanly.groups WHERE id = $1 FOR UPDATE", id).Scan(&found); err != nil {
		queryError(w, err)
		return
	}
	actor := auth.UserID(ctx)
	var role string
	if err = tx.QueryRow(ctx, "SELECT role FROM arisanly.group_members WHERE group_id = $1 AND user_id = $2", id, actor).Scan(&role); err != nil {
		queryError(w, err)
		return
	}
	if token != "" && treasurer(role) && h.guard.Seen(ctx, id, actor, target, token) {
		w.WriteHeader(204)
		return
	}
	err = apply(tx, id, actor, role)
	if errors.Is(err, errForbidden) {
		fail(w, 403, "forbidden")
		return
	}
	if err != nil {
		queryError(w, err)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		queryError(w, err)
		return
	}
	if token != "" {
		h.guard.Remember(ctx, id, actor, target, token)
	}
	w.WriteHeader(204)
}

func (h handler) members(w http.ResponseWriter, r *http.Request) {
	id, ok := uuidParam(w, r, "id")
	if !ok {
		return
	}
	rows, err := h.db.Query(r.Context(), `
		SELECT u.id, u.name, m.role FROM arisanly.group_members m
		JOIN arisanly.users u ON u.id = m.user_id
		WHERE m.group_id = $1 AND EXISTS (
			SELECT 1 FROM arisanly.group_members WHERE group_id = $1 AND user_id = $2
		)
		ORDER BY m.joined_at, u.id`, id, auth.UserID(r.Context()))
	if err != nil {
		queryError(w, err)
		return
	}
	items, err := pgx.CollectRows(rows, pgx.RowToStructByPos[member])
	if err != nil {
		queryError(w, err)
		return
	}
	if len(items) == 0 {
		fail(w, 404, "not_found")
		return
	}
	reply(w, 200, items)
}

func (h handler) memberRole(w http.ResponseWriter, r *http.Request) {
	target, ok := uuidParam(w, r, "userId")
	if !ok {
		return
	}
	var input struct{ Role string }
	if !decode(w, r, &input) {
		return
	}
	if input.Role != "MEMBER" && input.Role != "TREASURER" {
		fail(w, 400, "invalid_input")
		return
	}
	h.change(w, r, func(tx pgx.Tx, id, actor string, role string) error {
		if role != "OWNER" {
			return errForbidden
		}
		tag, err := tx.Exec(r.Context(), `
			UPDATE arisanly.group_members SET role = $3
			WHERE group_id = $1 AND user_id = $2 AND role <> 'OWNER'`, id, target, input.Role)
		if err == nil && tag.RowsAffected() == 0 {
			return pgx.ErrNoRows
		}
		if err != nil {
			return err
		}
		return audit(r, tx, id, actor, "MEMBER_ROLE_CHANGED", map[string]any{"userId": target, "role": input.Role})
	})
}

func (h handler) remove(w http.ResponseWriter, r *http.Request) {
	target, ok := uuidParam(w, r, "userId")
	if !ok {
		return
	}
	h.change(w, r, func(tx pgx.Tx, id, actor, role string) error {
		if role != "OWNER" && actor != target {
			return errForbidden
		}
		var active bool
		err := tx.QueryRow(r.Context(), `SELECT EXISTS (
			SELECT 1 FROM arisanly.cycle_members m JOIN arisanly.cycles c ON c.id=m.cycle_id
			WHERE c.group_id=$1 AND m.user_id=$2 AND c.closed_at IS NULL
		)`, id, target).Scan(&active)
		if err != nil {
			return err
		}
		if active {
			return errArisanState
		}
		tag, err := tx.Exec(r.Context(), `
			DELETE FROM arisanly.group_members
			WHERE group_id = $1 AND user_id = $2 AND role <> 'OWNER'`, id, target)
		if err == nil && tag.RowsAffected() == 0 {
			return pgx.ErrNoRows
		}
		return err
	})
}
