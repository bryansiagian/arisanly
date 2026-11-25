package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"syscall"
	"time"

	"github.com/bryansiagian/arisanly/apps/api/internal/hardening"
	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/redis/go-redis/v9"

	"github.com/bryansiagian/arisanly/apps/api/internal/auth"
	"github.com/bryansiagian/arisanly/apps/api/internal/groups"
)

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	port := os.Getenv("PORT")
	if port == "" {
		port = "8080"
	}

	if err := serve(port); err != nil {
		slog.Error("API stopped", "error", err)
		os.Exit(1)
	}
}

func serve(port string) error {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		return errors.New("DATABASE_URL is required")
	}
	secureCookies := true
	if setting := os.Getenv("AUTH_COOKIE_SECURE"); setting != "" {
		var err error
		secureCookies, err = strconv.ParseBool(setting)
		if err != nil {
			return errors.New("AUTH_COOKIE_SECURE must be a boolean")
		}
	}
	db, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return errors.New("invalid DATABASE_URL")
	}
	defer db.Close()
	startup, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	if err := db.Ping(startup); err != nil {
		return errors.New("database connection failed")
	}
	var cache *redis.Client
	if redisURL := os.Getenv("REDIS_URL"); redisURL != "" {
		options, err := redis.ParseURL(redisURL)
		if err != nil {
			return errors.New("invalid REDIS_URL")
		}
		options.DialTimeout = 200 * time.Millisecond
		options.ReadTimeout = 200 * time.Millisecond
		options.WriteTimeout = 200 * time.Millisecond
		options.MaxRetries = -1
		cache = redis.NewClient(options)
		defer cache.Close()
	}
	guard := hardening.New(cache)
	authRoutes, err := auth.New(db, os.Getenv("JWT_ACCESS_SECRET"), secureCookies, guard)
	if err != nil {
		return err
	}

	router := chi.NewRouter()
	router.Get("/healthz", health)
	router.Route("/api/v1/auth", authRoutes.Routes)
	router.Route("/api/v1/groups", func(r chi.Router) { groups.Routes(r, db, authRoutes.RequireUser, guard) })
	server := &http.Server{
		Addr:              ":" + port,
		Handler:           http.NewCrossOriginProtection().Handler(router),
		ReadTimeout:       10 * time.Second,
		WriteTimeout:      15 * time.Second,
		IdleTimeout:       60 * time.Second,
		ReadHeaderTimeout: 5 * time.Second,
	}

	serverErrors := make(chan error, 1)
	go func() {
		slog.Info("API listening", "port", port)
		serverErrors <- server.ListenAndServe()
	}()

	select {
	case err := <-serverErrors:
		if !errors.Is(err, http.ErrServerClosed) {
			return err
		}
	case <-ctx.Done():
		shutdown, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		return server.Shutdown(shutdown)
	}
	return nil
}

func health(w http.ResponseWriter, _ *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_, _ = w.Write([]byte("{\"status\":\"ok\"}\n"))
}
