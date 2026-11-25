package groups

import (
	"encoding/json"
	"errors"
	"github.com/bryansiagian/arisanly/apps/api/internal/hardening"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/bryansiagian/arisanly/apps/api/internal/auth"
	"github.com/bryansiagian/arisanly/apps/api/internal/ledger"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
)

type group struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Type string `json:"type"`
	Role string `json:"role"`
}

type member struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Role string `json:"role"`
}

type handler struct {
	db    *pgxpool.Pool
	guard hardening.Guard
}

func Routes(r chi.Router, db *pgxpool.Pool, authenticate func(http.Handler) http.Handler, guard hardening.Guard) {
	h := handler{db: db, guard: guard}
	r.Use(authenticate)
	r.Get("/", h.list)
	r.Post("/", h.create)
	r.Post("/join", h.join)
	r.Route("/{id}", func(r chi.Router) {
		r.Get("/", h.detail)
		r.Patch("/", h.rename)
		r.Get("/members", h.members)
		r.Patch("/members/{userId}", h.memberRole)
		r.Delete("/members/{userId}", h.remove)
		r.Get("/invites", h.invites)
		r.Post("/invites", h.invite)
		h.arisanRoutes(r)
		h.kasRoutes(r)
		h.reportRoutes(r)
	})
}

func reply(w http.ResponseWriter, status int, data any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(data)
}

func fail(w http.ResponseWriter, status int, code string) {
	reply(w, status, map[string]string{"error": code})
}

func queryError(w http.ResponseWriter, err error) {
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, 404, "not_found")
		return
	}
	switch {
	case errors.Is(err, ledger.ErrInvalid):
		fail(w, 400, "invalid_input")
		return
	case errors.Is(err, errArisanState), errors.Is(err, ledger.ErrConflict), errors.Is(err, ledger.ErrInsufficientBalance):
		fail(w, 409, "arisan_conflict")
		return
	}
	slog.Error("group operation failed", "error", err)
	fail(w, 500, "internal_error")
}

func decode(w http.ResponseWriter, r *http.Request, data any) bool {
	kind, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
	if kind != "application/json" {
		fail(w, 415, "invalid_content_type")
		return false
	}
	d := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	d.DisallowUnknownFields()
	if err := d.Decode(data); err != nil || d.Decode(new(any)) != io.EOF {
		fail(w, 400, "invalid_input")
		return false
	}
	return true
}

func uuidParam(w http.ResponseWriter, r *http.Request, key string) (string, bool) {
	value := chi.URLParam(r, key)
	var id pgtype.UUID
	if len(value) != 36 || id.Scan(value) != nil || !id.Valid {
		fail(w, 404, "not_found")
		return "", false
	}
	return value, true
}

func validName(name string) bool {
	return name != "" && utf8.RuneCountInString(name) <= 100 && !strings.ContainsRune(name, 0)
}

func (h handler) list(w http.ResponseWriter, r *http.Request) {
	rows, err := h.db.Query(r.Context(), `
		SELECT g.id, g.name, g.type, m.role FROM arisanly.groups g
		JOIN arisanly.group_members m ON m.group_id = g.id
		WHERE m.user_id = $1 ORDER BY g.created_at DESC, g.id`, auth.UserID(r.Context()))
	if err != nil {
		queryError(w, err)
		return
	}
	items, err := pgx.CollectRows(rows, pgx.RowToStructByPos[group])
	if err != nil {
		queryError(w, err)
		return
	}
	reply(w, 200, items)
}

func (h handler) create(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name string
		Type string
	}
	if !decode(w, r, &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if !validName(input.Name) || (input.Type != "ARISAN" && input.Type != "KAS") {
		fail(w, 400, "invalid_input")
		return
	}
	var id string
	err := h.db.QueryRow(r.Context(), `
		WITH created AS (
			INSERT INTO arisanly.groups(name, type, created_by) VALUES ($1, $2, $3) RETURNING id
		)
		INSERT INTO arisanly.group_members(group_id, user_id, role)
		SELECT id, $3, 'OWNER' FROM created RETURNING group_id`,
		input.Name, input.Type, auth.UserID(r.Context())).Scan(&id)
	if err != nil {
		queryError(w, err)
		return
	}
	reply(w, 201, group{id, input.Name, input.Type, "OWNER"})
}

func (h handler) detail(w http.ResponseWriter, r *http.Request) {
	id, ok := uuidParam(w, r, "id")
	if !ok {
		return
	}
	var g group
	err := h.db.QueryRow(r.Context(), `
		SELECT g.id, g.name, g.type, m.role FROM arisanly.groups g
		JOIN arisanly.group_members m ON m.group_id = g.id
		WHERE g.id = $1 AND m.user_id = $2`, id, auth.UserID(r.Context())).
		Scan(&g.ID, &g.Name, &g.Type, &g.Role)
	if err != nil {
		queryError(w, err)
		return
	}
	reply(w, 200, g)
}

func (h handler) rename(w http.ResponseWriter, r *http.Request) {
	var input struct{ Name string }
	if !decode(w, r, &input) {
		return
	}
	input.Name = strings.TrimSpace(input.Name)
	if !validName(input.Name) {
		fail(w, 400, "invalid_input")
		return
	}
	h.change(w, r, func(tx pgx.Tx, id, actor, role string) error {
		if role != "OWNER" {
			return errForbidden
		}
		_, err := tx.Exec(r.Context(), "UPDATE arisanly.groups SET name = $2 WHERE id = $1", id, input.Name)
		return err
	})
}

func (h handler) limitOperations(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		if retry := h.guard.RetryAfter(r.Context(), "operations", auth.UserID(r.Context()), 180, time.Minute); retry > 0 {
			w.Header().Set("Retry-After", strconv.FormatInt(retry, 10))
			fail(w, http.StatusTooManyRequests, "try_again")
			return
		}
		next(w, r)
	}
}
