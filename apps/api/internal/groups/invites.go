package groups

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/bryansiagian/arisanly/apps/api/internal/auth"
	"github.com/jackc/pgx/v5"
)

type invitation struct {
	ID        string    `json:"id"`
	ExpiresAt time.Time `json:"expiresAt"`
	MaxUses   int       `json:"maxUses"`
	UsedCount int       `json:"usedCount"`
	Code      string    `json:"code,omitempty"`
}

func (h handler) invites(w http.ResponseWriter, r *http.Request) {
	id, ok := uuidParam(w, r, "id")
	if !ok {
		return
	}
	ctx := r.Context()
	var role string
	err := h.db.QueryRow(ctx, "SELECT role FROM arisanly.group_members WHERE group_id = $1 AND user_id = $2", id, auth.UserID(ctx)).Scan(&role)
	if err != nil {
		queryError(w, err)
		return
	}
	if role != "OWNER" {
		fail(w, 403, "forbidden")
		return
	}
	rows, err := h.db.Query(ctx, `
		SELECT id, expires_at, max_uses, used_count FROM arisanly.invites
		WHERE group_id = $1 ORDER BY expires_at DESC, id`, id)
	if err != nil {
		queryError(w, err)
		return
	}
	items, err := pgx.CollectRows(rows, func(row pgx.CollectableRow) (invitation, error) {
		var invite invitation
		err := row.Scan(&invite.ID, &invite.ExpiresAt, &invite.MaxUses, &invite.UsedCount)
		return invite, err
	})
	if err != nil {
		queryError(w, err)
		return
	}
	reply(w, 200, items)
}

func (h handler) invite(w http.ResponseWriter, r *http.Request) {
	var input struct{ MaxUses int }
	if !decode(w, r, &input) {
		return
	}
	if input.MaxUses < 1 || input.MaxUses > 100 {
		fail(w, 400, "invalid_input")
		return
	}
	id, ok := uuidParam(w, r, "id")
	if !ok {
		return
	}
	var random [24]byte
	_, _ = rand.Read(random[:])
	code := base64.RawURLEncoding.EncodeToString(random[:])
	digest := sha256.Sum256([]byte(code))
	var invite invitation
	err := h.db.QueryRow(r.Context(), `
		INSERT INTO arisanly.invites(group_id, code_hash, expires_at, max_uses)
		SELECT group_id, $3, now() + interval '7 days', $4 FROM arisanly.group_members
		WHERE group_id = $1 AND user_id = $2 AND role = 'OWNER'
		RETURNING id, expires_at, max_uses, used_count`, id, auth.UserID(r.Context()), digest[:], input.MaxUses).
		Scan(&invite.ID, &invite.ExpiresAt, &invite.MaxUses, &invite.UsedCount)
	if err != nil {
		queryError(w, err)
		return
	}
	invite.Code = code
	reply(w, 201, invite)
}

func (h handler) join(w http.ResponseWriter, r *http.Request) {
	var input struct{ Code string }
	if !decode(w, r, &input) {
		return
	}
	input.Code = strings.TrimSpace(input.Code)
	code, err := base64.RawURLEncoding.Strict().DecodeString(input.Code)
	if err != nil || len(code) != 24 {
		fail(w, 400, "invalid_input")
		return
	}
	digest := sha256.Sum256([]byte(input.Code))
	ctx := r.Context()
	tx, err := h.db.Begin(ctx)
	if err != nil {
		queryError(w, err)
		return
	}
	defer tx.Rollback(ctx)
	var g group
	err = tx.QueryRow(ctx, `
		SELECT g.id, g.name, g.type FROM arisanly.groups g JOIN arisanly.invites i ON i.group_id = g.id
		WHERE i.code_hash = $1 FOR UPDATE OF g`, digest[:]).Scan(&g.ID, &g.Name, &g.Type)
	if err != nil {
		queryError(w, err)
		return
	}
	actor := auth.UserID(ctx)
	err = tx.QueryRow(ctx, "SELECT role FROM arisanly.group_members WHERE group_id = $1 AND user_id = $2", g.ID, actor).Scan(&g.Role)
	if err == nil {
		reply(w, 200, g)
		return
	}
	if !errors.Is(err, pgx.ErrNoRows) {
		queryError(w, err)
		return
	}
	tag, err := tx.Exec(ctx, `
		UPDATE arisanly.invites SET used_count = used_count + 1
		WHERE code_hash = $1 AND expires_at > clock_timestamp() AND used_count < max_uses`, digest[:])
	if err != nil {
		queryError(w, err)
		return
	}
	if tag.RowsAffected() == 0 {
		fail(w, 410, "invitation_unavailable")
		return
	}
	_, err = tx.Exec(ctx, "INSERT INTO arisanly.group_members(group_id, user_id, role) VALUES ($1, $2, 'MEMBER')", g.ID, actor)
	if err != nil {
		queryError(w, err)
		return
	}
	if err = tx.Commit(ctx); err != nil {
		queryError(w, err)
		return
	}
	g.Role = "MEMBER"
	reply(w, 200, g)
}
