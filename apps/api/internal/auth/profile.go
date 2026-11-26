package auth

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
)

func (h *Handler) updateProfile(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name            string `json:"name"`
		Email           string `json:"email"`
		CurrentPassword string `json:"currentPassword"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&input); err != nil || decoder.Decode(new(any)) != io.EOF {
		fail(w, http.StatusBadRequest, "invalid_input")
		return
	}

	input.Name = strings.TrimSpace(input.Name)
	input.Email = strings.ToLower(strings.TrimSpace(input.Email))
	address, err := mail.ParseAddress(input.Email)
	if err != nil || address.Address != input.Email || len(input.Email) > 254 ||
		input.Name == "" || utf8.RuneCountInString(input.Name) > 100 || strings.ContainsRune(input.Name, 0) {
		fail(w, http.StatusBadRequest, "invalid_input")
		return
	}

	ctx := r.Context()
	actor := ctx.Value(actorKey{}).(user)
	if input.Email != actor.Email {
		if len(input.CurrentPassword) < 12 || len(input.CurrentPassword) > 128 {
			fail(w, http.StatusBadRequest, "password_required")
			return
		}
		if retry := h.guard.RetryAfter(ctx, "profile_email", actor.ID, 10, time.Minute); retry > 0 {
			w.Header().Set("Retry-After", strconv.FormatInt(retry, 10))
			fail(w, http.StatusTooManyRequests, "try_again")
			return
		}
		var hash string
		if err := h.db.QueryRow(ctx, "SELECT password_hash FROM arisanly.users WHERE id=$1", actor.ID).Scan(&hash); err != nil {
			internal(w, err)
			return
		}
		matches, err := verifyPassword(input.CurrentPassword, hash)
		if err != nil {
			internal(w, err)
			return
		}
		if !matches {
			fail(w, http.StatusForbidden, "incorrect_password")
			return
		}
	}

	var account user
	err = h.db.QueryRow(ctx, `
		UPDATE arisanly.users SET name=$1, email=$2 WHERE id=$3 AND email=$4
		RETURNING id,name,email`, input.Name, input.Email, actor.ID, actor.Email).
		Scan(&account.ID, &account.Name, &account.Email)
	var dbErr *pgconn.PgError
	switch {
	case errors.Is(err, pgx.ErrNoRows):
		fail(w, http.StatusConflict, "profile_changed")
	case errors.As(err, &dbErr) && dbErr.Code == "23505":
		fail(w, http.StatusConflict, "email_already_registered")
	case err != nil:
		internal(w, err)
	default:
		respond(w, http.StatusOK, account)
	}
}
