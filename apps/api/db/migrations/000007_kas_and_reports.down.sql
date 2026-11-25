-- Refuse rollback after Kas activity so report and dues history stays intact.
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM arisanly.cash_records)
        OR EXISTS (SELECT 1 FROM arisanly.kas_dues)
        OR EXISTS (SELECT 1 FROM arisanly.kas_schedules) THEN
        RAISE EXCEPTION 'cannot roll back active Kas records';
    END IF;
END;
$$;
ALTER TABLE arisanly.transactions DROP CONSTRAINT transactions_type_check;
ALTER TABLE arisanly.transactions ADD CONSTRAINT transactions_type_check
    CHECK (type IN ('CHARGE','PAYMENT','PAYOUT','EXPENSE','REVERSAL'));
ALTER TABLE arisanly.accounts DROP CONSTRAINT accounts_kind_check;
ALTER TABLE arisanly.accounts ADD CONSTRAINT accounts_kind_check
    CHECK (kind IN ('FUND','MEMBER','DUES_INCOME','PAYOUT','EXPENSE'));
DROP TABLE arisanly.report_shares;
DROP TABLE arisanly.kas_dues;
DROP TABLE arisanly.kas_schedules;
DROP TABLE arisanly.cash_records;
