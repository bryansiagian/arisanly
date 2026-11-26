package auth

import (
	"context"
	"encoding/json"
	"errors"
	"github.com/bryansiagian/arisanly/apps/api/internal/hardening"
	"io"
	"log/slog"
	"mime"
	"net/http"
	"net/mail"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

const (
	accessCookie  = "arisanly_access"
	refreshCookie = "arisanly_refresh"
	authPath      = "/api/v1/auth"
)

type user struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
}

type credentials struct {
	Name     string `json:"name"`
	Email    string `json:"email"`
	Password string `json:"password"`
}

type Handler struct {
	guard     hardening.Guard
	db        *pgxpool.Pool
	secret    []byte
	secure    bool
	dummyHash string
	hashSlots chan struct{}
}

func New(db *pgxpool.Pool, signingSecret string, secureCookies bool, guard hardening.Guard) (*Handler, error) {
	if len(signingSecret) < 32 {
		return nil, errors.New("JWT_ACCESS_SECRET must contain at least 32 bytes")
	}
	dummyHash, err := hashPassword("Arisanly dummy credentials")
	if err != nil {
		return nil, err
	}
	return &Handler{
		db: db, secret: []byte(signingSecret), secure: secureCookies,
		guard: guard, dummyHash: dummyHash, hashSlots: make(chan struct{}, 4),
	}, nil
}

func (h *Handler) Routes(r chi.Router) {
	r.Use(func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Cache-Control", "no-store")
			if r.Method == http.MethodPost || r.Method == http.MethodPatch {
				mediaType, _, _ := mime.ParseMediaType(r.Header.Get("Content-Type"))
				if mediaType != "application/json" {
					fail(w, http.StatusUnsupportedMediaType, "invalid_content_type")
					return
				}
			}
			next.ServeHTTP(w, r)
		})
	})
	r.Post("/register", h.limitHashing(h.register))
	r.Post("/login", h.limitHashing(h.login))
	r.Post("/refresh", h.refresh)
	r.Post("/logout", h.logout)
	r.With(h.RequireUser).Get("/me", h.me)
	r.With(h.RequireUser).Patch("/me", h.limitHashing(h.updateProfile))
}

func (h *Handler) limitHashing(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		select {
		case h.hashSlots <- struct{}{}:
			defer func() { <-h.hashSlots }()
			next(w, r)
		default:
			w.Header().Set("Retry-After", "1")
			fail(w, http.StatusTooManyRequests, "try_again")
		}
	}
}

func readCredentials(w http.ResponseWriter, r *http.Request) (credentials, bool) {
	var data credentials
	decoder := json.NewDecoder(http.MaxBytesReader(w, r.Body, 4096))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&data); err != nil || decoder.Decode(new(any)) != io.EOF {
		fail(w, http.StatusBadRequest, "invalid_input")
		return credentials{}, false
	}
	data.Email = strings.ToLower(strings.TrimSpace(data.Email))
	data.Name = strings.TrimSpace(data.Name)
	address, err := mail.ParseAddress(data.Email)
	if err != nil || address.Address != data.Email || len(data.Email) > 254 ||
		len(data.Password) < 12 || len(data.Password) > 128 {
		fail(w, http.StatusBadRequest, "invalid_input")
		return credentials{}, false
	}
	return data, true
}

func (h *Handler) register(w http.ResponseWriter, r *http.Request) {
	data, ok := readCredentials(w, r)
	if !ok {
		return
	}
	if retry := h.guard.RetryAfter(r.Context(), "register", data.Email, 5, time.Minute); retry > 0 {
		w.Header().Set("Retry-After", strconv.FormatInt(retry, 10))
		fail(w, http.StatusTooManyRequests, "try_again")
		return
	}
	if data.Name == "" || utf8.RuneCountInString(data.Name) > 100 {
		fail(w, http.StatusBadRequest, "invalid_input")
		return
	}
	hash, err := hashPassword(data.Password)
	if err != nil {
		internal(w, err)
		return
	}
	var account user
	err = h.db.QueryRow(r.Context(), `
		INSERT INTO arisanly.users (name, email, password_hash)
		VALUES ($1, $2, $3)
		ON CONFLICT (email) DO NOTHING
		RETURNING id, name, email`, data.Name, data.Email, hash).
		Scan(&account.ID, &account.Name, &account.Email)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, http.StatusConflict, "email_already_registered")
		return
	}
	if err != nil {
		internal(w, err)
		return
	}
	respond(w, http.StatusCreated, account)
}

func (h *Handler) login(w http.ResponseWriter, r *http.Request) {
	data, ok := readCredentials(w, r)
	if !ok {
		return
	}
	if retry := h.guard.RetryAfter(r.Context(), "login", data.Email, 10, time.Minute); retry > 0 {
		w.Header().Set("Retry-After", strconv.FormatInt(retry, 10))
		fail(w, http.StatusTooManyRequests, "try_again")
		return
	}
	var account user
	var hash string
	err := h.db.QueryRow(r.Context(), `
		SELECT id, name, email, password_hash FROM arisanly.users WHERE email = $1`, data.Email).
		Scan(&account.ID, &account.Name, &account.Email, &hash)
	if errors.Is(err, pgx.ErrNoRows) {
		hash = h.dummyHash
	} else if err != nil {
		internal(w, err)
		return
	}
	matches, verifyErr := verifyPassword(data.Password, hash)
	if verifyErr != nil {
		internal(w, verifyErr)
		return
	}
	if err != nil || !matches {
		fail(w, http.StatusUnauthorized, "invalid_credentials")
		return
	}

	raw, digest, err := newRefresh()
	if err != nil {
		internal(w, err)
		return
	}
	expires := time.Now().Add(refreshTTL)
	var sessionID string
	err = h.db.QueryRow(r.Context(), `
		INSERT INTO arisanly.refresh_tokens (user_id, token_hash, expires_at)
		VALUES ($1, $2, $3) RETURNING id`, account.ID, digest, expires).Scan(&sessionID)
	if err != nil {
		internal(w, err)
		return
	}
	h.sendSession(w, account.ID, sessionID, raw, expires)
}

func (h *Handler) refresh(w http.ResponseWriter, r *http.Request) {
	cookie, err := r.Cookie(refreshCookie)
	if err != nil {
		fail(w, http.StatusUnauthorized, "session_expired")
		return
	}
	raw, digest, err := newRefresh()
	if err != nil {
		internal(w, err)
		return
	}
	var userID, sessionID string
	var expires time.Time
	// With concurrent use of the same token, PostgreSQL rechecks the old hash
	// after taking the row lock. Exactly one request can rotate it.
	err = h.db.QueryRow(r.Context(), `
		UPDATE arisanly.refresh_tokens SET token_hash = $1
		WHERE token_hash = $2 AND revoked_at IS NULL AND expires_at > now()
		RETURNING user_id, id, expires_at`, digest, refreshHash(cookie.Value)).
		Scan(&userID, &sessionID, &expires)
	if errors.Is(err, pgx.ErrNoRows) {
		fail(w, http.StatusUnauthorized, "session_expired")
		return
	}
	if err != nil {
		internal(w, err)
		return
	}
	h.sendSession(w, userID, sessionID, raw, expires)
}

func (h *Handler) logout(w http.ResponseWriter, r *http.Request) {
	var digest []byte
	if cookie, err := r.Cookie(refreshCookie); err == nil {
		digest = refreshHash(cookie.Value)
	}
	var sessionID *string
	if claims, err := h.access(r); err == nil {
		sessionID = &claims.SessionID
	}
	_, err := h.db.Exec(r.Context(), `
		UPDATE arisanly.refresh_tokens SET revoked_at = now()
		WHERE revoked_at IS NULL AND (token_hash = $1 OR id = $2)`, digest, sessionID)
	if err != nil {
		internal(w, err)
		return
	}
	h.setCookie(w, accessCookie, "", -1)
	h.setCookie(w, refreshCookie, "", -1)
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) access(r *http.Request) (*accessClaims, error) {
	if raw, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer "); ok {
		return parseAccess(h.secret, raw)
	}
	cookie, err := r.Cookie(accessCookie)
	if err != nil {
		return nil, err
	}
	return parseAccess(h.secret, cookie.Value)
}

type actorKey struct{}

func UserID(ctx context.Context) string {
	account, _ := ctx.Value(actorKey{}).(user)
	return account.ID
}

func (h *Handler) RequireUser(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		claims, err := h.access(r)
		if err != nil {
			fail(w, http.StatusUnauthorized, "session_expired")
			return
		}
		var account user
		err = h.db.QueryRow(r.Context(), `
		SELECT u.id, u.name, u.email FROM arisanly.users u
		JOIN arisanly.refresh_tokens s ON s.user_id = u.id
		WHERE u.id = $1 AND s.id = $2 AND s.revoked_at IS NULL AND s.expires_at > now()`,
			claims.Subject, claims.SessionID).Scan(&account.ID, &account.Name, &account.Email)
		if errors.Is(err, pgx.ErrNoRows) {
			fail(w, http.StatusUnauthorized, "session_expired")
			return
		}
		if err != nil {
			internal(w, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(context.WithValue(r.Context(), actorKey{}, account)))
	})
}

func (h *Handler) me(w http.ResponseWriter, r *http.Request) {
	respond(w, http.StatusOK, r.Context().Value(actorKey{}).(user))
}

func (h *Handler) sendSession(w http.ResponseWriter, userID, sessionID, refresh string, expires time.Time) {
	access, err := signAccess(h.secret, userID, sessionID)
	if err != nil {
		internal(w, err)
		return
	}
	h.setCookie(w, accessCookie, access, int(accessTTL.Seconds()))
	h.setCookie(w, refreshCookie, refresh, max(1, int(time.Until(expires).Seconds())))
	w.WriteHeader(http.StatusNoContent)
}

func (h *Handler) setCookie(w http.ResponseWriter, name, value string, maxAge int) {
	path := "/"
	if name == refreshCookie {
		path = authPath
	}
	http.SetCookie(w, &http.Cookie{
		Name: name, Value: value, Path: path, HttpOnly: true, Secure: h.secure,
		SameSite: http.SameSiteStrictMode, MaxAge: maxAge,
	})
}

func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func fail(w http.ResponseWriter, status int, code string) {
	respond(w, status, map[string]string{"error": code})
}

func internal(w http.ResponseWriter, err error) {
	var pgErr *pgconn.PgError
	switch {
	case errors.As(err, &pgErr):
		slog.Error("auth query failed", "sqlstate", pgErr.Code)
	case errors.Is(err, context.Canceled):
		slog.Debug("auth request canceled")
	default:
		slog.Error("auth request failed", "type", slog.AnyValue(err).Kind())
	}
	fail(w, http.StatusInternalServerError, "internal_error")
}
