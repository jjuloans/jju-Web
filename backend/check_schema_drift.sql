-- Run this against your live DB and compare the output to the column types
-- declared in migrations.js (CREATE TABLE / ADD COLUMN statements).
-- Any mismatch here is a future "COALESCE types X and Y cannot be matched"
-- (or similar 42804) waiting to happen.

SELECT table_name, column_name, data_type
FROM information_schema.columns
WHERE table_name IN (
  'records', 'gold_loans', 'fd_accounts', 'saving_accounts',
  'od_loans', 'memberships', 'share_accounts', 'customers',
  'cashbook_entries'
)
ORDER BY table_name, column_name;
