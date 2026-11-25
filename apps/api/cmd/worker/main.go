package main

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/bryansiagian/arisanly/apps/api/internal/ledger"
	"github.com/hibiken/asynq"
	"github.com/jackc/pgx/v5/pgxpool"
)

const reconcileTask = "ledger:reconcile"

func main() {
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, nil)))
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx); err != nil {
		slog.Error("worker stopped", "error", err)
		os.Exit(1)
	}
}

func run(ctx context.Context) error {
	if os.Getenv("DATABASE_URL") == "" || os.Getenv("REDIS_URL") == "" {
		return errors.New("DATABASE_URL and REDIS_URL are required")
	}
	db, err := pgxpool.New(ctx, os.Getenv("DATABASE_URL"))
	if err != nil {
		return errors.New("invalid DATABASE_URL")
	}
	defer db.Close()
	redisOptions, err := asynq.ParseRedisURI(os.Getenv("REDIS_URL"))
	if err != nil {
		return errors.New("invalid REDIS_URL")
	}

	scheduler := asynq.NewScheduler(redisOptions, &asynq.SchedulerOpts{
		Location: time.UTC,
	})
	_, err = scheduler.Register("0 * * * *", asynq.NewTask(reconcileTask, nil),
		asynq.Unique(30*time.Minute), asynq.Timeout(2*time.Minute), asynq.MaxRetry(3))
	if err != nil {
		return fmt.Errorf("register ledger reconciliation: %w", err)
	}

	server := asynq.NewServer(redisOptions, asynq.Config{Concurrency: 1})
	mux := asynq.NewServeMux()
	mux.HandleFunc(reconcileTask, func(ctx context.Context, _ *asynq.Task) error {
		diffs, err := ledger.Reconcile(ctx, db)
		if err != nil {
			return fmt.Errorf("reconcile ledger: %w", err)
		}
		for _, diff := range diffs {
			slog.Error("ledger balance mismatch", "group_id", diff.GroupID, "account_id", diff.AccountID,
				"cached", diff.Cached, "calculated", diff.Calculated)
		}
		slog.Info("ledger reconciliation finished", "mismatches", len(diffs))
		return nil
	})
	if err := server.Start(mux); err != nil {
		return fmt.Errorf("start task runner: %w", err)
	}
	defer server.Shutdown()
	if err := scheduler.Start(); err != nil {
		return fmt.Errorf("start task scheduler: %w", err)
	}
	defer scheduler.Shutdown()
	slog.Info("ledger reconciliation scheduled", "interval", "hourly", "timezone", "UTC")
	<-ctx.Done()
	return nil
}
