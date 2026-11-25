CREATE TABLE arisanly.cycles (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id uuid NOT NULL REFERENCES arisanly.groups(id),
    amount bigint NOT NULL CHECK (amount > 0),
    frequency text NOT NULL CHECK (frequency IN ('WEEKLY','BIWEEKLY','MONTHLY')),
    order_method text NOT NULL CHECK (order_method IN ('FIXED','DRAW')),
    start_date date NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz
);
CREATE UNIQUE INDEX one_active_cycle ON arisanly.cycles(group_id) WHERE closed_at IS NULL;

CREATE TABLE arisanly.cycle_members (
    cycle_id uuid NOT NULL REFERENCES arisanly.cycles(id),
    user_id uuid NOT NULL REFERENCES arisanly.users(id),
    position int NOT NULL CHECK (position > 0),
    PRIMARY KEY (cycle_id,user_id),
    UNIQUE (cycle_id,position)
);
CREATE TABLE arisanly.rounds (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    cycle_id uuid NOT NULL REFERENCES arisanly.cycles(id),
    number int NOT NULL CHECK (number > 0),
    due_date date NOT NULL,
    recipient_user_id uuid,
    status text NOT NULL CHECK (status IN ('OPEN','COLLECTED','PAID_OUT','CLOSED')),
    payout_transaction_id uuid UNIQUE REFERENCES arisanly.transactions(id),
    UNIQUE (cycle_id,number),
    UNIQUE (cycle_id,recipient_user_id),
    FOREIGN KEY (cycle_id,recipient_user_id) REFERENCES arisanly.cycle_members(cycle_id,user_id)
);
CREATE UNIQUE INDEX one_open_round ON arisanly.rounds(cycle_id) WHERE status <> 'CLOSED';

CREATE TABLE arisanly.obligations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    round_id uuid NOT NULL REFERENCES arisanly.rounds(id),
    member_user_id uuid NOT NULL REFERENCES arisanly.users(id),
    amount_due bigint NOT NULL CHECK (amount_due > 0),
    UNIQUE (round_id,member_user_id)
);
CREATE TABLE arisanly.payment_claims (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    obligation_id uuid NOT NULL REFERENCES arisanly.obligations(id),
    note text NOT NULL CHECK (char_length(note) <= 500),
    status text NOT NULL CHECK (status IN ('PENDING','CONFIRMED','REJECTED')),
    payment_transaction_id uuid UNIQUE REFERENCES arisanly.transactions(id),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_live_claim ON arisanly.payment_claims(obligation_id)
WHERE status IN ('PENDING','CONFIRMED');

CREATE TABLE arisanly.audit_log (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    group_id uuid NOT NULL REFERENCES arisanly.groups(id),
    actor_user_id uuid NOT NULL REFERENCES arisanly.users(id),
    action text NOT NULL,
    details jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_group_id_idx ON arisanly.audit_log(group_id,id DESC);
