ALTER TABLE arisanly.accounts DROP CONSTRAINT accounts_kind_check;
ALTER TABLE arisanly.accounts ADD CONSTRAINT accounts_kind_check
    CHECK (kind IN ('FUND','MEMBER','DUES_INCOME','PAYOUT','EXPENSE','OTHER_INCOME'));
ALTER TABLE arisanly.transactions DROP CONSTRAINT transactions_type_check;
ALTER TABLE arisanly.transactions ADD CONSTRAINT transactions_type_check
    CHECK (type IN ('CHARGE','PAYMENT','PAYOUT','EXPENSE','REVERSAL','INCOME'));

CREATE TABLE arisanly.cash_records (
    transaction_id uuid PRIMARY KEY REFERENCES arisanly.transactions(id),
    category text NOT NULL CHECK (char_length(category) BETWEEN 1 AND 80),
    note text NOT NULL CHECK (char_length(note) <= 500)
);
CREATE TABLE arisanly.kas_schedules (
    group_id uuid PRIMARY KEY REFERENCES arisanly.groups(id),
    amount bigint NOT NULL CHECK (amount > 0),
    frequency text NOT NULL CHECK (frequency IN ('WEEKLY','MONTHLY')),
    first_due date NOT NULL,
    next_number integer NOT NULL DEFAULT 0 CHECK (next_number >= 0)
);
CREATE TABLE arisanly.kas_dues (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id uuid NOT NULL REFERENCES arisanly.groups(id),
    member_user_id uuid NOT NULL REFERENCES arisanly.users(id),
    due_date date NOT NULL,
    amount bigint NOT NULL CHECK (amount > 0),
    payment_transaction_id uuid UNIQUE REFERENCES arisanly.transactions(id),
    UNIQUE (group_id,due_date,member_user_id)
);
CREATE INDEX kas_unpaid_member ON arisanly.kas_dues(group_id,member_user_id)
    WHERE payment_transaction_id IS NULL;
CREATE TABLE arisanly.report_shares (
    group_id uuid PRIMARY KEY REFERENCES arisanly.groups(id),
    code_hash bytea NOT NULL UNIQUE CHECK (octet_length(code_hash) = 32),
    expires_at timestamptz NOT NULL
);
