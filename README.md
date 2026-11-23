# Arisanly

**Arisan dan kas kelompok, tercatat rapi dan transparan.**

Arisanly is a web app for managing **arisan** (rotating savings groups) and **kas kelompok** (shared group cash funds). It keeps a correct, auditable record of who has paid, whose turn it is, and where every rupiah went. Mobile-first and in Indonesian.

> 🚧 **Status: in development.** The local scaffold includes the API health endpoint and a web landing page. See the [roadmap](#roadmap) for planned features.
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

Then open the web app at `http://localhost:3000`. Check the API with `curl http://localhost:8080/healthz`. Compose runs the versioned PostgreSQL migration before starting the API and worker. In PowerShell, use `Copy-Item .env.example .env` to copy the example configuration.

### Run in development mode

```bash
cp .env.example .env
docker compose up -d db redis        # PostgreSQL and Redis only
make migrate-up                      # apply database migrations

# Run each of the following in a separate terminal at the repo root.
make dev-api
make dev-worker
cd apps/web && pnpm install --frozen-lockfile && pnpm dev
```

### Useful commands

| Task | Command |
|---|---|
| Compile and run Go tests | `make test` |
| Go static checks | `make lint` |
| Web lint and type checks | `cd apps/web && pnpm lint && pnpm typecheck` |
| Web production build | `cd apps/web && pnpm build` |

### Environment variables

Copy `.env.example` to `.env` for local Compose. The example database credentials are intended for local development. Keep real environment files out of Git.

| Variable | Purpose |
|---|---|
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Local database and migration credentials |
| `API_PORT`, `WEB_PORT`, `POSTGRES_PORT`, `REDIS_PORT` | Ports published to the host by Compose |

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
- [ ] **M1** Authentication
- [ ] **M2** Groups, members, invite link
- [ ] **M3** Ledger core with invariants and tests
- [ ] **M4** Arisan flow: rounds, draw, claims, confirmation, payout
- [ ] **M5** Hardening: idempotency, rate limiting, locks, reconciliation, concurrency tests
- [ ] **M6** Kas mode, reports, CSV export, public share link
- [ ] **M7** Reminders and UX polish
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
