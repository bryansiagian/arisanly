package hardening

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"time"

	"github.com/redis/go-redis/v9"
)

type Guard struct {
	client *redis.Client
}

func New(client *redis.Client) Guard { return Guard{client: client} }

func key(scope string, parts ...string) string {
	hash := sha256.New()
	for _, part := range parts {
		hash.Write([]byte{0})
		hash.Write([]byte(part))
	}
	return "arisanly:" + scope + ":" + hex.EncodeToString(hash.Sum(nil))
}

func (g Guard) Seen(ctx context.Context, group, actor, target, token string) bool {
	return g.client != nil && g.client.Exists(ctx, key("posted", group, actor, target, token)).Val() == 1
}

func (g Guard) Remember(ctx context.Context, group, actor, target, token string) {
	if g.client != nil {
		_ = g.client.Set(ctx, key("posted", group, actor, target, token), "1", 5*time.Minute).Err()
	}
}

var unlock = redis.NewScript(`
	if redis.call("GET", KEYS[1]) == ARGV[1] then
		return redis.call("DEL", KEYS[1])
	end
	return 0
`)

// Acquire leases an operation across API instances. If Redis is unavailable,
// the caller still takes its PostgreSQL lock and checks the durable state.
func (g Guard) Acquire(ctx context.Context, group, target string) (release func(), ok bool) {
	noop := func() {}
	if g.client == nil {
		return noop, true
	}
	lock := key("lease", group, target)
	token := rand.Text()
	acquired, err := g.client.SetNX(ctx, lock, token, 20*time.Second).Result()
	if err != nil {
		return noop, true
	}
	if !acquired {
		return noop, false
	}
	return func() {
		ctx, cancel := context.WithTimeout(context.Background(), 300*time.Millisecond)
		defer cancel()
		_ = unlock.Run(ctx, g.client, []string{lock}, token).Err()
	}, true
}

var rateLimit = redis.NewScript(`
	local count = redis.call("INCR", KEYS[1])
	if count == 1 then redis.call("PEXPIRE", KEYS[1], ARGV[1]) end
	if count <= tonumber(ARGV[2]) then return 0 end
	return math.max(1, redis.call("PTTL", KEYS[1]))
`)

// RetryAfter uses an atomic window and returns zero when a request can proceed.
// Redis failures leave the existing database and hashing guards in effect.
func (g Guard) RetryAfter(ctx context.Context, scope, identity string, limit int, window time.Duration) int64 {
	if g.client == nil {
		return 0
	}
	ms, err := rateLimit.Run(ctx, g.client, []string{key("rate:"+scope, identity)}, window.Milliseconds(), limit).Int64()
	if err != nil {
		return 0
	}
	return (ms + 999) / 1000
}
