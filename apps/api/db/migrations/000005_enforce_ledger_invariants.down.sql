DROP TRIGGER validate_ledger_transaction ON arisanly.transactions;
DROP TRIGGER apply_ledger_entry ON arisanly.ledger_entries;
DROP TRIGGER ledger_entries_immutable ON arisanly.ledger_entries;
DROP TRIGGER transactions_immutable ON arisanly.transactions;
DROP FUNCTION arisanly.validate_ledger_transaction();
DROP FUNCTION arisanly.apply_ledger_entry();
DROP FUNCTION arisanly.reject_ledger_mutation();
