CREATE TABLE arisanly.payment_reminders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id uuid NOT NULL REFERENCES arisanly.groups(id),
    user_id uuid NOT NULL REFERENCES arisanly.users(id),
    arisan_obligation_id uuid REFERENCES arisanly.obligations(id),
    kas_due_id uuid REFERENCES arisanly.kas_dues(id),
    due_date date NOT NULL,
    amount bigint NOT NULL CHECK (amount > 0),
    stage text NOT NULL CHECK (stage IN ('UPCOMING','TODAY','OVERDUE')),
    created_at timestamptz NOT NULL DEFAULT now(),
    read_at timestamptz,
    CHECK (num_nonnulls(arisan_obligation_id,kas_due_id) = 1),
    UNIQUE NULLS NOT DISTINCT (arisan_obligation_id,kas_due_id,stage)
);
CREATE INDEX payment_reminders_inbox ON arisanly.payment_reminders(user_id,created_at DESC,id DESC);
