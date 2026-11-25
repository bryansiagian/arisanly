package hardening

import (
	"context"
	"crypto/rand"
	"os"
	"testing"
	"time"

	"github.com/redis/go-redis/v9"
)

func TestRedisGuards(t *testing.T) {
	url := os.Getenv("HARDENING_TEST_REDIS_URL")
	if url == "" {
		t.Skip("set HARDENING_TEST_REDIS_URL to a test Redis server")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	options, err := redis.ParseURL(url)
	if err != nil {
		t.Fatal(err)
	}
	first := redis.NewClient(options)
	defer first.Close()
	second := redis.NewClient(options)
	defer second.Close()
	if err := first.Ping(ctx).Err(); err != nil {
		t.Fatal(err)
	}
	one, two := New(first), New(second)
	group := rand.Text()

	release, ok := one.Acquire(ctx, group, "draw")
	if !ok {
		t.Fatal("initial lease denied")
	}
	if _, ok := two.Acquire(ctx, group, "draw"); ok {
		t.Fatal("second Redis client acquired the same lease")
	}
	release()
	release, ok = two.Acquire(ctx, group, "draw")
	if !ok {
		t.Fatal("lease was not released")
	}
	defer release()

	one.Remember(ctx, group, "actor", "confirm:1", "request")
	if !two.Seen(ctx, group, "actor", "confirm:1", "request") ||
		two.Seen(ctx, group, "other", "confirm:1", "request") ||
		two.Seen(ctx, group, "actor", "confirm:2", "request") {
		t.Fatal("unexpected replay cache scope")
	}
	if one.RetryAfter(ctx, "test", group, 2, time.Minute) != 0 ||
		two.RetryAfter(ctx, "test", group, 2, time.Minute) != 0 ||
		one.RetryAfter(ctx, "test", group, 2, time.Minute) <= 0 {
		t.Fatal("rate limit did not share its counter")
	}
}

func TestClosedRedisFallsBack(t *testing.T) {
	client := redis.NewClient(&redis.Options{Addr: "127.0.0.1:1"})
	_ = client.Close()
	guard := New(client)
	ctx := context.Background()
	release, ok := guard.Acquire(ctx, "group", "confirm")
	defer release()
	if !ok || guard.Seen(ctx, "group", "actor", "confirm", "key") ||
		guard.RetryAfter(ctx, "test", "actor", 1, time.Minute) != 0 {
		t.Fatal("Redis failure should defer to the durable safeguards")
	}
}
