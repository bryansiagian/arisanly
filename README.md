# Arisanly

**Arisan dan kas kelompok, tercatat rapi dan transparan.**

Arisanly is a web app for managing **arisan** (rotating savings groups) and **kas kelompok** (shared group cash funds). It keeps a correct, auditable record of who has paid, whose turn it is, and where every rupiah went. Mobile-first and in Indonesian.

> 🚧 **Status: in development.** The local app includes the API health endpoint, a landing page, and account authentication. See the [roadmap](#roadmap) for planned features.
>
> ⚠️ **Arisanly never holds or moves money.** Members pay outside the app (cash, transfer, QRIS). Arisanly only records and verifies.

- 🔗 **Live demo:** coming soon
- 📄 **Product spec:** [PRD.md](./PRD.md)

---

## Tentang Arisanly

Arisan, iuran kelas, dan kas organisasi biasanya dicatat lewat grup WhatsApp, buku, atau spreadsheet. Akibatnya "siapa yang sudah bayar?" harus dicari di riwayat chat, angka sering tidak cocok, bendahara kewalahan merekap, dan urusan giliran penerima mudah jadi perdebatan.

Arisanly memberi semua anggota **satu catatan yang sama dan selalu benar**: siapa sudah bayar, siapa belum, giliran siapa, dan saldo kelompok saat ini, lengkap dengan undian yang adil dan riwayat yang tidak bisa diubah diam-diam.

## The Problem

Group savings and dues in Indonesia are usually tracked in chat threads and spreadsheets, which leads to:

- Payment status buried in chat history
- Numbers that drift out of sync and cause disputes
- Treasurers doing manual recaps and reminders
- No transparent shared view, which hurts trust
- Informal, easily disputed turn order

## Features

**Core (MVP): Arisan mode**
- Email and password authentication with refresh-token rotation
- Groups with roles: Owner, Treasurer (*Bendahara*), Member (*Anggota*)
- Join via shareable invite link (WhatsApp-friendly)
- Rounds with due dates, per-member dues, and a pot per round
- Fair draw (cryptographically secure randomness) with a public audit trail, or a fixed order
- "Saya sudah bayar" claims confirmed or rejected by the treasurer
- Payout recording, blocked until the pot is complete
- Append-only double-entry ledger and an audit log visible to members
- Idempotent, concurrency-safe money endpoints

**Planned**
- Kas (group cash) mode with income, expenses, and monthly recap
- Scheduled reminders and a one-tap WhatsApp reminder message
- Reports, CSV export, and a read-only public share link
- Payment proof upload
- Corrections through reversing transactions

The full list with priorities is in [PRD.md](./PRD.md).

## The Hard Problems

This project is deliberately built around problems where correctness matters:

1. **A ledger that never lies.** Amounts are whole rupiah in `BIGINT` (no floats). Every transaction is double-entry and sums to zero, enforced by a deferred constraint trigger. Ledger rows cannot be updated or deleted; mistakes are fixed with reversing transactions.
2. **Concurrent requests.** Two treasurers confirming at once, or a double tap on a flaky mobile connection, must not double-count. Money operations take row locks inside a single PostgreSQL transaction so balance checks cannot race.
3. **Idempotent APIs.** Money-affecting endpoints require an `Idempotency-Key`. Redis provides the fast path (in-flight lock and cached response); a unique constraint in PostgreSQL is the durable guarantee, so a Redis outage cannot cause duplicates.
4. **Trustworthy draws.** The draw uses server-side secure randomness, and candidates, result, and timestamp are stored and visible to everyone.
5. **Reconciliation.** A background job recomputes balances from ledger entries and compares them with cached balances, alerting on any mismatch.

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js (App Router), React, TypeScript, Tailwind CSS, TanStack Query, next-intl |
| Backend | Go, chi, pgx, sqlc, golang-migrate, slog |
| Database | PostgreSQL |
| Cache, rate limiting, locks | Redis |
| Background jobs | asynq (reminders, reconciliation) |
| Auth | JWT access token + httpOnly refresh cookie, argon2id |
| Testing | Go `testing` with testcontainers-go (real PostgreSQL and Redis), Vitest, Testing Library, Playwright |
| DevOps | Docker, Docker Compose, GitHub Actions |
| Cloud | AWS (ECR, App Runner, RDS, Redis) |

## Architecture

```
Browser (Next.js, mobile-first)
        │ REST (JSON)
        ▼
   Go API (chi) ──────────────► Redis
        │   ├─ idempotency keys, rate limits, locks
        │   └─ enqueue jobs
        ▼                          │
   PostgreSQL ◄──── Go worker (asynq): reminders, reconciliation
   (ledger, groups, audit log)
```

PostgreSQL is the source of truth. Redis accelerates and protects, but the system stays correct without it.

### Ledger at a glance

| Event | Debit | Credit |
|---|---|---|
| Charge dues to member | `MEMBER:{id}` | `DUES_INCOME` |
| Confirm member payment | `FUND` | `MEMBER:{id}` |
| Arisan payout to recipient | `PAYOUT` | `FUND` |
| Record expense | `EXPENSE` | `FUND` |

Invariants: each transaction sums to zero; `FUND` and `MEMBER` balances never go negative; ledger rows are immutable. Details are in [PRD.md](./PRD.md#7-money-and-ledger-design-the-core).

## Getting Started

### Prerequisites

- Docker and Docker Compose v2 for the full stack.
- Go 1.26, Node.js 24, pnpm 11.25.0, and Make for host development.

### Run the full stack with Docker

```bash
git clone https://github.com/bryansiagian/arisanly.git
cd arisanly
cp .env.example .env
docker compose up --build
```

Then open the web app at `http://localhost:3000`. Check the API with `curl http://localhost:8080/healthz`. Compose runs the versioned PostgreSQL migrations before starting the API and worker. Open /daftar to create an account, /masuk to sign in, and /dasbor to view the protected dashboard. In PowerShell, use `Copy-Item .env.example .env` to copy the example configuration.

### Run in development mode

```bash
cp .env.example .env
docker compose up -d db redis        # PostgreSQL and Redis only
make migrate-up                      # apply database migrations

# API terminal (default local database and ports)
export DATABASE_URL='postgres://arisanly:arisanly_local@localhost:5432/arisanly?sslmode=disable'
export JWT_ACCESS_SECRET='arisanly-local-dev-key-change-before-production'
export AUTH_COOKIE_SECURE=false
export REDIS_URL='redis://127.0.0.1:6379/0'
make dev-api

# Worker terminal (default local database and Redis ports)
export DATABASE_URL='postgres://arisanly:arisanly_local@localhost:5432/arisanly?sslmode=disable'
export REDIS_URL='redis://127.0.0.1:6379/0'
make dev-worker

# Web terminal
cd apps/web && pnpm install --frozen-lockfile && pnpm dev
```

### Useful commands

| Task | Command |
|---|---|
| Compile and run Go tests | `make test` |
| Go static checks | `make lint` |
| Web lint and type checks | `cd apps/web && pnpm lint && pnpm typecheck` |
| Web production build | `cd apps/web && pnpm build` |
| Auth smoke test against the running stack | `node scripts/auth-smoke.mjs` |

### Environment variables

Copy `.env.example` to `.env` for local Compose. The example database credentials are intended for local development. Keep real environment files out of Git.

| Variable | Purpose |
|---|---|
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Local database and migration credentials |
| `API_PORT`, `WEB_PORT`, `POSTGRES_PORT`, `REDIS_PORT` | Ports published to the host by Compose |
| `JWT_ACCESS_SECRET` | JWT signing key, at least 32 bytes |
| `AUTH_COOKIE_SECURE` | Keep `true` for HTTPS. Use `false` for local HTTP development. |
| `DATABASE_URL` | PostgreSQL URL for the Go API. Compose constructs it from the local database settings. |
| `API_INTERNAL_URL` | Backend URL used by Next.js. Compose sets the service URL, and host development defaults to `http://127.0.0.1:8080`. |

## Authentication

The browser uses same-origin routes under `/api/v1/auth` served by Next.js. Go issues a 15-minute JWT and a refresh cookie backed by a PostgreSQL session with a seven-day absolute lifetime. Refresh replaces the stored token hash atomically, and logout revokes the session. Both cookies are HttpOnly. For HTTPS deployment, supply a unique random signing secret and keep secure cookies enabled.

## Groups and invitations

From `/dasbor`, create an Arisan or Kas group and open it to see the member list. The owner can rename the group, manage member roles, and issue an invitation. Members can leave, and the owner can remove other members. Ownership cannot be transferred in this milestone. In the arisan and cash workflows, the owner will also have treasurer permissions.

Invitations expire after seven days. The owner sets a quota from 1 to 100 uses. The share link and code appear when the invite is issued. The database stores its hash, so save the link before closing the group. Recipients can use the link or enter the code at `/gabung`. If signed out, they can sign in in a separate tab and return to the invitation.

Run `node scripts/groups-smoke.mjs` against the running local stack to verify group permissions and concurrent invite redemption.

## Ledger core

The Go package in `apps/api/internal/ledger` records dues, payments, payouts, expenses, and corrections inside the caller's PostgreSQL transaction. Amounts are whole rupiah. Debits are positive and credits are negative. PostgreSQL rejects unbalanced postings, changes to posted history, and negative fund or member receivable balances.

Postings take a group lock before reading the idempotency record and updating accounts. A retry with the same group, key, and request returns the original transaction ID. A different request under the same key is rejected. A correction requires a reason, mirrors the original amounts, and is rejected if it would violate a balance constraint. Reconciliation reports any difference between cached balances and the sum of entries.

The core has no new UI or write endpoints. Arisan handlers connect these postings to authorized claims and rounds. The worker schedules reconciliation hourly.

Run the integration suite with `go test -race -count=1 -v ./internal/ledger` from `apps/api`. Set `LEDGER_TEST_DATABASE_URL` to a disposable PostgreSQL database with the migrations applied. The tests add ledger history to that database.

## Arisan cycle

Open an Arisan group in `/dasbor`. The owner sets the contribution, first due date, interval, and either a fixed recipient order or a draw. A cycle requires at least two members. Members who join after a cycle starts can participate in the next cycle. Active participants stay on the roster until the cycle ends.

The first round opens immediately. The owner or treasurer can reject a claim so the participant can submit it again. Once all contributions are confirmed and the recipient is assigned, the owner or treasurer records the payout. Closing the paid round immediately opens the next round or completes the cycle. Monthly due dates are calculated from the first due date and clamp to the last day of shorter months.

The dashboard shows the latest cycle and the group's audit history, including draw candidates and the selected recipient. Payment confirmations and payouts require an `Idempotency-Key`. Run `node scripts/arisan-smoke.mjs` against the local stack to exercise a full two-round cycle.

## API hardening and reconciliation

The API uses Redis for rate limits, short-lived leases, and a five-minute cache of committed confirmation and payout responses. Cache hits still require an active session and current owner or treasurer permissions. PostgreSQL group locks, stored transaction keys, and claim and round state remain authoritative for financial writes. If Redis is unavailable, the API falls back to PostgreSQL and the existing local password-hashing concurrency guard. Redis-backed rate limits and the worker queue resume when Redis returns.

Registration and login are limited to 5 and 10 attempts per normalized email per minute respectively. Arisan operations that draw a recipient or post ledger entries are limited to 180 per user per minute. A limited request returns HTTP 429 and `Retry-After`.

The Asynq worker schedules ledger reconciliation at the top of every UTC hour. It compares stored balances with the ledger, logs discrepancies, and retries query failures. `/healthz` reports liveness and `/readyz` checks PostgreSQL connectivity. API responses include an `X-Request-ID` for tracing.

CI runs 100 concurrent retries of a single payment confirmation and exercises a full arisan cycle while Redis is stopped.

## Kas and reports

Open a Kas group on the dashboard and load the report. The owner or treasurer can record categorized income and expenses, configure weekly or monthly dues, issue the next period, and mark a due as paid after receiving the money. The schedule determines the next date. The treasurer opens each period explicitly. The amount and frequency are fixed after initial setup. Members with unpaid dues remain in the group until those dues are resolved.

Members of Arisan or Kas groups can view monthly balances, transaction history, and a CSV export. Monthly reports use WIB. The dashboard shows all outstanding Kas dues so older debts remain actionable regardless of the selected month. The group owner can publish one summary link for seven days, rotate it, or revoke it. The public page displays the group type and balance only.

Run `node scripts/kas-smoke.mjs` against the running stack to test postings, report access, and share revocation.

## Payment reminders

The worker checks unpaid Arisan and Kas dues once an hour, at minute 15. It uses the WIB calendar and records one reminder per due for each stage: within three days before the due date, on the due date, and after it. It does not backfill earlier stages after downtime. A pending or confirmed Arisan claim suppresses new reminders. A rejected claim becomes eligible again.

Each member can open the reminder inbox on their dashboard, refresh it, and mark messages as read. The inbox displays the most recent 50 reminders from groups the user still belongs to. Owners and treasurers can open WhatsApp with a prepared message for an overdue member. The sender selects the contact and sends the message in WhatsApp.

## Project Structure

```
.
├── apps/
│   ├── api/
│   │   ├── cmd/api/         # HTTP server
│   │   ├── cmd/worker/      # background worker
│   │   ├── internal/        # auth, groups, arisan, ledger, reminders
│   │   └── db/              # migrations and sqlc queries
│   └── web/                 # Next.js frontend
├── docker-compose.yml
├── Makefile
├── PRD.md
└── README.md
```

## Roadmap

- [x] **M0** Repository setup: Go API, Next.js, Docker Compose, CI skeleton, health check
- [x] **M1** Authentication
- [x] **M2** Groups, members, invite link
- [x] **M3** Ledger core with invariants and tests
- [x] **M4** Arisan flow: rounds, draw, claims, confirmation, payout
- [x] **M5** Hardening: idempotency, rate limiting, locks, reconciliation, concurrency tests
- [x] **M6** Kas mode, reports, CSV export, public share link
- [x] **M7** Reminders and UX polish
- [ ] **M8** Public deployment and pilot with a real group

## Screenshots

Coming soon.

## Pilot Results

To be filled in after a real group completes at least two rounds.

## Disclaimer

Arisanly is a record-keeping tool. It does not hold, transfer, or process money, and it is not a financial service.

## License

MIT. Add a `LICENSE` file to the repository (change the license here if you prefer a different one).

## Author

Built by [@bryansiagian](https://github.com/bryansiagian) as a portfolio project.
