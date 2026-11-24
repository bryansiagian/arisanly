CREATE FUNCTION arisanly.reject_ledger_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'ledger history is append-only' USING ERRCODE = '23514';
END;
$$;

CREATE TRIGGER transactions_immutable
BEFORE UPDATE OR DELETE OR TRUNCATE ON arisanly.transactions
FOR EACH STATEMENT EXECUTE FUNCTION arisanly.reject_ledger_mutation();

CREATE TRIGGER ledger_entries_immutable
BEFORE UPDATE OR DELETE OR TRUNCATE ON arisanly.ledger_entries
FOR EACH STATEMENT EXECUTE FUNCTION arisanly.reject_ledger_mutation();

CREATE FUNCTION arisanly.set_posting_xid() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    NEW.posting_xid := pg_current_xact_id();
    RETURN NEW;
END;
$$;

CREATE TRIGGER set_posting_xid
BEFORE INSERT ON arisanly.transactions
FOR EACH ROW EXECUTE FUNCTION arisanly.set_posting_xid();

CREATE FUNCTION arisanly.apply_ledger_entry() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM arisanly.transactions
        WHERE id = NEW.transaction_id AND group_id = NEW.group_id
          AND posting_xid = pg_current_xact_id()
    ) THEN
        RAISE EXCEPTION 'entries must be posted with their transaction' USING ERRCODE = '23514';
    END IF;
    UPDATE arisanly.accounts
    SET balance = balance + NEW.amount
    WHERE id = NEW.account_id AND group_id = NEW.group_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'ledger account must belong to the transaction group' USING ERRCODE = '23503';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER apply_ledger_entry
AFTER INSERT ON arisanly.ledger_entries
FOR EACH ROW EXECUTE FUNCTION arisanly.apply_ledger_entry();

CREATE FUNCTION arisanly.validate_ledger_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    entry_count bigint;
    total numeric;
BEGIN
    SELECT count(*), coalesce(sum(amount), 0) INTO entry_count, total
    FROM arisanly.ledger_entries WHERE transaction_id = NEW.id;
    IF entry_count < 2 OR total <> 0 THEN
        RAISE EXCEPTION 'ledger transaction must balance with at least two entries' USING ERRCODE = '23514';
    END IF;

    IF NEW.type = 'REVERSAL' THEN
        IF NOT EXISTS (
            SELECT 1 FROM arisanly.transactions
            WHERE id = NEW.reverses_transaction_id AND type <> 'REVERSAL'
        ) OR EXISTS (
            (SELECT account_id, amount FROM arisanly.ledger_entries WHERE transaction_id = NEW.id
             EXCEPT
             SELECT account_id, -amount FROM arisanly.ledger_entries WHERE transaction_id = NEW.reverses_transaction_id)
            UNION ALL
            (SELECT account_id, -amount FROM arisanly.ledger_entries WHERE transaction_id = NEW.reverses_transaction_id
             EXCEPT
             SELECT account_id, amount FROM arisanly.ledger_entries WHERE transaction_id = NEW.id)
        ) THEN
            RAISE EXCEPTION 'reversal must mirror the original transaction' USING ERRCODE = '23514';
        END IF;
    END IF;
    RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER validate_ledger_transaction
AFTER INSERT ON arisanly.transactions
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW EXECUTE FUNCTION arisanly.validate_ledger_transaction();
