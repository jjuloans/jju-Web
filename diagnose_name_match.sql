-- Breaks the remaining NULL rows into three buckets, per table:
--   unique_name_match   = customer_name matches exactly ONE customers row
--                          (normalized, case/whitespace-insensitive) — safe to backfill
--   ambiguous_name_match = matches MORE than one customers row — needs a
--                          tie-breaker (or manual pick) before linking
--   no_name_match        = doesn't match any customers row at all — either the
--                          customer was never created in `customers`, or the
--                          name differs enough (typo, word order, OCR error)
--                          that an exact match misses it

WITH name_counts AS (
  SELECT UPPER(TRIM(name)) AS norm_name, COUNT(*) AS cnt, MIN(id) AS only_id
  FROM customers
  WHERE name IS NOT NULL
  GROUP BY UPPER(TRIM(name))
)
SELECT
  'gold_loans' AS tbl,
  count(*) FILTER (WHERE nc.cnt = 1)        AS unique_name_match,
  count(*) FILTER (WHERE nc.cnt > 1)        AS ambiguous_name_match,
  count(*) FILTER (WHERE nc.cnt IS NULL)    AS no_name_match,
  count(*)                                  AS total_still_null
FROM gold_loans gl
LEFT JOIN name_counts nc ON nc.norm_name = UPPER(TRIM(gl.customer_name))
WHERE gl.customer_id IS NULL

UNION ALL

SELECT
  'saving_accounts',
  count(*) FILTER (WHERE nc.cnt = 1),
  count(*) FILTER (WHERE nc.cnt > 1),
  count(*) FILTER (WHERE nc.cnt IS NULL),
  count(*)
FROM saving_accounts sa
LEFT JOIN name_counts nc ON nc.norm_name = UPPER(TRIM(sa.customer_name))
WHERE sa.customer_id IS NULL

UNION ALL

SELECT
  'memberships',
  count(*) FILTER (WHERE nc.cnt = 1),
  count(*) FILTER (WHERE nc.cnt > 1),
  count(*) FILTER (WHERE nc.cnt IS NULL),
  count(*)
FROM memberships m
LEFT JOIN name_counts nc ON nc.norm_name = UPPER(TRIM(m.customer_name))
WHERE m.customer_id IS NULL;
