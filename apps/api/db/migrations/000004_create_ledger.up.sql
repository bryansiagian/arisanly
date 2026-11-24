CREATE TABLE arisanly.accounts (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id uuid NOT NULL REFERENCES arisanly.groups(id),
    kind text NOT NULL CHECK (kind IN ('FUND', 'MEMBER', 'DUES_INCOME', 'PAYOUT', 'EXPENSE')),
    member_user_id uuid REFERENCES arisanly.users(id),
    balance bigint NOT NULL DEFAULT 0,
    UNIQUE (group_id, id),
    UNIQUE NULLS NOT DISTINCT (group_id, kind, member_user_id),
    CHECK ((kind = 'MEMBER') = (member_user_id IS NOT NULL)),
    CONSTRAINT account_nonnegative CHECK (kind NOT IN ('FUND', 'MEMBER') OR balance >= 0)
);

CREATE TABLE arisanly.transactions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id uuid NOT NULL REFERENCES arisanly.groups(id),
    type text NOT NULL CHECK (type IN ('CHARGE', 'PAYMENT', 'PAYOUT', 'EXPENSE', 'REVERSAL')),
    idempotency_key text NOT NULL CHECK (char_length(idempotency_key) BETWEEN 1 AND 128),
    request_hash bytea NOT NULL CHECK (octet_length(request_hash) = 32),
    reverses_transaction_id uuid UNIQUE,
    reversal_reason text,
    created_by uuid NOT NULL REFERENCES arisanly.users(id),
    created_at timestamptz NOT NULL DEFAULT now(),
    posting_xid xid8 NOT NULL DEFAULT pg_current_xact_id(),
    UNIQUE (group_id, id),
    UNIQUE (group_id, idempotency_key),
    FOREIGN KEY (group_id, reverses_transaction_id) REFERENCES arisanly.transactions(group_id, id),
    CHECK (reverses_transaction_id IS DISTINCT FROM id),
    CHECK (
        (type = 'REVERSAL' AND reverses_transaction_id IS NOT NULL AND
         reversal_reason IS NOT NULL AND char_length(btrim(reversal_reason)) BETWEEN 1 AND 500)
        OR (type <> 'REVERSAL' AND reverses_transaction_id IS NULL AND reversal_reason IS NULL)
    )
);

CREATE TABLE arisanly.ledger_entries (
    group_id uuid NOT NULL,
    transaction_id uuid NOT NULL,
    account_id uuid NOT NULL,
    amount bigint NOT NULL CHECK (amount <> 0 AND amount <> '-9223372036854775808'::bigint),
    PRIMARY KEY (transaction_id, account_id),
    FOREIGN KEY (group_id, transaction_id) REFERENCES arisanly.transactions(group_id, id),
    FOREIGN KEY (group_id, account_id) REFERENCES arisanly.accounts(group_id, id)
);

CREATE INDEX ledger_entries_account_idx ON arisanly.ledger_entries(account_id);
