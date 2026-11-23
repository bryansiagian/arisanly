# PRD: Arisanly

> Product Requirements Document. Describes **what** we are building and **why**.
> Keep this file updated when scope or design decisions change.

## 1. Overview

Arisanly is a web app for managing **arisan** (rotating savings groups) and **kas kelompok** (shared group cash funds such as class dues or organization funds). It tracks who has paid, whose turn it is to receive the pot, and keeps a correct, auditable record of every rupiah in and out. Mobile-first and in Indonesian.

**Arisanly never holds or moves money.** Members pay each other or the treasurer outside the app (cash, bank transfer, QRIS). The app is the **record keeper**: it records claims of payment, lets the treasurer confirm them, and maintains the ledger. This keeps the product simple and avoids operating as a regulated payment service.

**Purpose of this project:** a portfolio project that demonstrates backend engineering depth: a correct financial ledger, concurrency control, idempotent APIs, background jobs, and a clean frontend, built with Go, PostgreSQL, Redis, and Next.js.

## 1.1 Problem and Context

Arisan and group dues are everywhere in Indonesia (families, neighborhoods, offices, classes, communities), and they are usually tracked in a WhatsApp group, a notebook, or a spreadsheet. This causes:
- "Siapa yang sudah bayar?" is answered by scrolling through chat history.
- Numbers get out of sync; disputes arise over who paid what and when.
- The treasurer carries the burden of manual recaps and reminders.
- Members cannot see transparent, up-to-date totals, which hurts trust.
- Whose turn it is to receive the pot is decided informally and is easy to dispute.

**Core insight:** the value is **trust through transparency and correctness**. Every member should be able to see the same numbers, and those numbers must never be wrong.

## 2. Goals and Non-Goals

### Goals
- A treasurer can set up an arisan in under 3 minutes and invite members through a WhatsApp-friendly link.
- Members always see accurate, shared numbers: who paid, who has not, whose turn it is, current balance.
- **Financial correctness:** an append-only ledger where the books always balance, even under concurrent and duplicate requests.
- A fair, auditable draw for arisan turns.
- A publicly deployed demo and at least one real group using it (pilot).

### Non-Goals (MVP)
- Holding, transferring, or processing money (no payment gateway, no wallet, no payouts through the app).
- Storing bank account or card numbers.
- Loans, interest, investment, or any financial product.
- Native mobile app, multi-currency, multi-language (Indonesian only for now).
- Complex accounting beyond what groups need.

## 3. Target Users

| Persona | Need |
|---|---|
| Treasurer (*bendahara*) / arisan organizer | Set up the group, confirm payments, run the draw, record payouts and expenses, send reminders with little effort |
| Member (*anggota*) | See what they owe and when, tell the treasurer "I have paid", see transparent totals and whose turn it is |
| Recruiter / reviewer | Quickly evaluate engineering quality (README, demo, tests, design decisions) |

## 4. Core Concepts

- **Group:** a set of members with a type: `ARISAN` or `KAS`.
- **Arisan cycle:** every member pays a fixed amount each round; one member receives the whole pot per round; the cycle ends when everyone has received once.
- **Round:** one period of an arisan with a due date, a recipient, and a pot (`amount x number of members`).
- **Dues / obligation:** an amount a member owes for a round (arisan) or a period (kas).
- **Payment claim:** a member's statement "I have paid", confirmed or rejected by the treasurer.
- **Ledger:** the append-only record of all confirmed money events (see section 7).

## 5. Functional Requirements

Priority: **P0** = MVP must-have, **P1** = should-have, **P2** = nice-to-have.

### 5.1 Authentication (P0)
- Register, login, logout with email and password.
- Short-lived access token plus rotating refresh token (httpOnly cookie). Passwords hashed with argon2id.

### 5.2 Groups and Members (P0)
- Create a group (`ARISAN` or `KAS`), join via shareable invite link or code (works well pasted into WhatsApp).
- Roles: `OWNER` (creator), `TREASURER` (can confirm payments, record payouts and expenses), `MEMBER`. The owner is also a treasurer by default.
- A person can be in many groups. Members can see all group numbers (transparency by design).

### 5.3 Arisan Mode (P0)
- Setup: contribution amount per member per round (whole rupiah), frequency (weekly, biweekly, monthly), start date, order method.
- **Order method:** `FIXED` (owner sets the order) or `DRAW` (per-round draw among members who have not yet received).
- **Draw:** server-side cryptographically secure randomness; the candidates, result, and timestamp are stored in the audit log and visible to all members.
- Each round generates dues for every member, including the recipient (they also contribute, as is customary).
- Member taps "Saya sudah bayar" (optional note); treasurer confirms or rejects. Confirming creates a ledger transaction.
- **Payout:** when all dues of a round are confirmed, the treasurer records the payout to the recipient (the app records, it does not move money). Payout is blocked while the pot is incomplete.
- Round status: `OPEN` -> `COLLECTED` -> `PAID_OUT` -> `CLOSED`. Cycle completes after the last round.

### 5.4 Kas Mode (P1)
- Recurring dues (weekly or monthly amount per member), plus additional income and expenses recorded by the treasurer with a category and note.
- Running balance, per-member status (paid, late, owed), and a monthly recap.

### 5.5 Reminders and Notifications (P1)
- Scheduled background reminders: before due date, on due date, when overdue.
- In-app notifications; a ready-to-send WhatsApp message (`wa.me` link with prefilled text) for the treasurer to nudge late members with one tap.
- Email notifications (P2).

### 5.6 Reports and Transparency (P1)
- Per-round and per-cycle recap, per-member payment history, group balance.
- CSV export. Optional **read-only public share link** for a group summary (no login, no sensitive member data).
- Payment proof upload (image) attached to a claim (P1).

### 5.7 Audit Log (P0)
- Every sensitive action (confirm, reject, payout, expense, role change, draw, reversal) is recorded with actor, time, and details, and is visible to group members.

### 5.8 Corrections (P1)
- Mistakes are fixed by a **reversing transaction** (never by editing or deleting history), with a required reason.

## 6. Non-Functional Requirements

| Area | Requirement |
|---|---|
| Correctness | Ledger invariants hold under concurrency: no double-counting, no negative fund, every transaction balances to zero |
| Idempotency | Every money-affecting `POST` accepts an `Idempotency-Key`; retries never create duplicate effects |
| Performance | Typical API reads p95 under 200ms; group dashboard loads under 1.5s on mobile networks |
| Security | OWASP basics, input validation, rate limiting (auth and money endpoints), role checks on every endpoint, CORS allowlist, secure cookies, no secrets in repo |
| Privacy | Collect minimum data; never store bank or card numbers; members see only groups they belong to |
| Reliability | Versioned migrations; Redis outage must not corrupt data (PostgreSQL is the source of truth) |
| Observability | Structured logs with request IDs, `/healthz` and `/readyz` endpoints |
| Mobile and i18n | Mobile-first (360px), touch targets at least 44px, Indonesian UI copy in message files |
| Maintainability | Linting, formatting, CI must pass before merge |

## 7. Money and Ledger Design (the core)

### Rules
- Amounts are `BIGINT` whole rupiah. **Never floats.** A single currency (IDR).
- The ledger is **append-only** and **double-entry**: each transaction has two or more entries that sum to zero (debits positive, credits negative).
- Balances are derived from entries. A cached `accounts.balance` is updated in the **same database transaction** and verified by a periodic reconciliation job.
- Corrections are new reversing transactions linked to the original.

### Chart of accounts (per group)
| Account | Meaning |
|---|---|
| `FUND` | Money the group holds (tracked, not held by the app). Must never go below zero |
| `MEMBER:{id}` | What that member currently owes (receivable). Never negative (no overpayment) |
| `DUES_INCOME` | Contributions charged |
| `PAYOUT` | Arisan payouts to recipients |
| `EXPENSE` | Group expenses (kas mode) |

### Events
| Event | Debit | Credit |
|---|---|---|
| Charge dues to member | `MEMBER:{id}` | `DUES_INCOME` |
| Confirm member payment | `FUND` | `MEMBER:{id}` |
| Arisan payout to recipient | `PAYOUT` | `FUND` |
| Record expense | `EXPENSE` | `FUND` |

### Invariants (tested)
1. Every transaction sums to zero (enforced by a deferred constraint trigger at commit).
2. `ledger_entries` and `transactions` can never be updated or deleted (trigger raises an error).
3. `FUND` balance >= 0 and `MEMBER` balance >= 0 (check constraints).
4. Sum of all entries per account equals the cached balance (reconciliation job).
5. A claim can be confirmed at most once; a round can be paid out at most once.

### Concurrency and idempotency
- **Row locks:** money-affecting operations lock the relevant account rows (`SELECT ... FOR UPDATE`) inside one PostgreSQL transaction, so two simultaneous confirmations or payouts cannot both pass the balance check.
- **Idempotency:** clients send `Idempotency-Key`. Redis provides a fast path (in-flight lock and cached response), while a **unique constraint on (group_id, idempotency_key)** in PostgreSQL is the durable guard. If Redis is down, the database still prevents duplicates.
- **Distributed lock** (Redis) around draws and payouts as an extra guard against double execution across API instances.

## 8. Tech Stack

| Layer | Choice |
|---|---|
| Frontend | Next.js (App Router), React, TypeScript, Tailwind CSS, TanStack Query, next-intl |
| Backend | Go, chi (router), pgx (PostgreSQL driver), sqlc (typed queries), golang-migrate, slog |
| Database | PostgreSQL |
| Cache, rate limit, locks | Redis (go-redis) |
| Background jobs | asynq (Redis-backed queue and scheduler) in a separate `worker` binary |
| Auth | JWT access token + httpOnly refresh cookie, argon2id |
| Testing | Go `testing` + testcontainers-go (real PostgreSQL and Redis), Vitest + Testing Library, Playwright (one happy path) |
| DevOps | Docker, Docker Compose, GitHub Actions |
| Cloud | AWS: ECR, App Runner (or EC2), RDS PostgreSQL, Redis via ElastiCache or a container for the demo |

## 9. Architecture

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

Repository layout (planned):
```
.
├── apps/
│   ├── api/                 # Go module
│   │   ├── cmd/api/         # HTTP server entrypoint
│   │   ├── cmd/worker/      # background worker entrypoint
│   │   ├── internal/        # domain: auth, groups, arisan, ledger, reminders, ...
│   │   ├── db/migrations/   # SQL migrations
│   │   └── db/queries/      # sqlc queries
│   └── web/                 # Next.js app
├── docker-compose.yml
├── Makefile
├── PRD.md
└── README.md
```

## 10. Data Model (summary)

```
users(id, email, name, password_hash, created_at)
refresh_tokens(id, user_id, token_hash, expires_at, revoked_at)

groups(id, type[ARISAN|KAS], name, contribution_amount, frequency, order_method, start_date, status, created_by)
group_members(group_id, user_id, role[OWNER|TREASURER|MEMBER], joined_at)   -- PK (group_id, user_id)
invites(id, group_id, code, expires_at, max_uses, used_count)

rounds(id, group_id, number, due_date, recipient_user_id?, pot_amount, status)
obligations(id, group_id, round_id?, period?, member_user_id, amount_due, status)
payment_claims(id, obligation_id, member_user_id, note, proof_url?, status[PENDING|CONFIRMED|REJECTED],
               confirmed_by?, decided_at?)
draws(id, round_id, candidates JSON, result_user_id, seed_info, created_at)

accounts(id, group_id, kind, member_user_id?, balance)                       -- cached, reconciled
transactions(id, group_id, type, idempotency_key, reverses_transaction_id?, created_by, created_at, metadata JSON)
ledger_entries(id, transaction_id, account_id, amount)                      -- append-only, sums to 0 per transaction
expenses(id, group_id, transaction_id, category, note, created_by)          -- kas mode
audit_log(id, group_id, actor_user_id, action, details JSON, created_at)
```

Key constraints: `UNIQUE(group_id, idempotency_key)` on `transactions`; `UNIQUE(round_id)` on payout transaction type; check constraints for non-negative `FUND` and `MEMBER` balances.

## 11. API Surface (REST, prefix `/api/v1`)

| Area | Endpoints |
|---|---|
| Auth | `POST /auth/register`, `/auth/login`, `/auth/refresh`, `/auth/logout`, `GET /auth/me` |
| Groups | `GET/POST /groups`, `GET/PATCH /groups/:id`, `POST /groups/join` (invite code), `GET/POST /groups/:id/invites` |
| Members | `GET /groups/:id/members`, `PATCH /groups/:id/members/:userId` (role), `DELETE` (leave/remove) |
| Arisan | `POST /groups/:id/start`, `GET /groups/:id/rounds`, `POST /rounds/:id/draw`, `POST /rounds/:id/payout` |
| Payments | `GET /groups/:id/obligations`, `POST /obligations/:id/claims`, `POST /claims/:id/confirm`, `POST /claims/:id/reject` |
| Kas (P1) | `POST /groups/:id/expenses`, `POST /groups/:id/income`, `GET /groups/:id/summary` |
| Ledger and audit | `GET /groups/:id/ledger`, `GET /groups/:id/audit`, `POST /transactions/:id/reverse` |
| Reports (P1) | `GET /groups/:id/export.csv`, `GET /public/g/:shareCode` |
| System | `GET /healthz`, `GET /readyz` |

Money-affecting `POST` endpoints (`confirm`, `payout`, `expenses`, `income`, `reverse`) require the `Idempotency-Key` header.

## 12. Milestones

| # | Milestone | Done when |
|---|---|---|
| M0 | Repo setup | Go API and Next.js skeletons, Docker Compose (db, redis), migrations, CI skeleton, `/healthz` |
| M1 | Auth | Register/login/refresh/logout with tests; protected routes in web |
| M2 | Groups and members | Create group, invite link and join flow, roles and permission checks |
| M3 | **Ledger core** | Accounts, transactions, invariants and triggers, reversal, with property-style tests. No UI needed yet |
| M4 | Arisan flow | Setup, rounds, draw, obligations, claim and confirm, payout, audit log; mobile-first UI |
| M5 | Hardening | Idempotency (Redis plus DB), rate limiting, locks, reconciliation job, concurrency tests |
| M6 | Kas mode and reports | Expenses and income, recap, CSV export, public share link |
| M7 | Reminders and polish | asynq reminders, WhatsApp message helper, UX polish, accessibility pass |
| M8 | Ship and pilot | Public deploy, demo data, README with diagrams, **real group uses it for 2+ rounds**, feedback in README |

Suggested pace: M0 to M5 already makes a strong backend portfolio piece; M3 and M5 are the heart of the project.

## 13. Success Criteria

- `docker compose up` starts API, worker, web, PostgreSQL, and Redis with no manual steps beyond copying `.env`.
- **Concurrency test:** 100 parallel duplicate "confirm payment" requests with the same idempotency key produce exactly one ledger transaction.
- **Race test:** two simultaneous payouts or confirmations competing for the same funds never push `FUND` below zero.
- **Invariant tests:** every transaction sums to zero; reconciliation matches cached balances after randomized operation sequences.
- A first-time treasurer sets up an arisan in under 3 minutes (tested with at least 5 people).
- At least one real group completes 2 or more rounds on the app (pilot), with feedback summarized in the README.
- CI is green: lint, unit and integration tests (real PostgreSQL and Redis), build, Docker images.

## 14. Risks and Mitigations

| Risk | Mitigation |
|---|---|
| Looks like a financial service (regulation) | App never holds or moves money; clear disclaimers; no payment gateway, wallets, or interest; record-keeping only |
| Sensitive financial data of members | Minimum data, role checks everywhere, no bank/card numbers, HTTPS, audit log |
| Trust: members dispute records | Transparent shared view, immutable ledger, audit log, reversing entries with reasons |
| Concurrency or idempotency bugs | Design in M3 and M5 with real-database integration tests and race tests |
| Scope creep (kas, reminders, reports) | Ship Arisan mode end to end first; Kas mode and reports are P1 |
| Adoption (people stay on WhatsApp) | WhatsApp-friendly invite and reminder helpers; mobile-first; pilot early |
| Stalling or burnout | Vertical slices; every milestone leaves the app working |

## 15. Open Questions

- Branding for Arisanly: logo, color palette, and domain.
- Payment proof storage: S3-compatible bucket vs local volume for the demo.
- Redis hosting for the public demo (ElastiCache vs a container on EC2).
- Whether to allow partial payouts or an owner override when a member is late (P2, requires explicit reason and audit entry).
