-- =========================================================
-- Performance indexes v2 — 2026-11-25
--
-- Adds indexes for columns the API filters on but which had no usable index.
--
-- SAFE ON A LIVE DATABASE:
--   * Additive only: creates indexes, never alters or drops tables, columns,
--     rows, constraints or existing indexes.
--   * Idempotent: IF NOT EXISTS — re-running is a no-op.
--   * Guarded: each index is created only if its table and all of its columns
--     exist, so schema drift between environments cannot make this fail.
--   * Every target table is small (< 5k rows at time of writing), so the brief
--     write lock taken by CREATE INDEX lasts milliseconds.
--     For much larger tables, run the equivalent
--       CREATE INDEX CONCURRENTLY IF NOT EXISTS ...
--     statements one at a time, outside a transaction, instead.
--
-- Rollback (if ever needed): DROP INDEX IF EXISTS <name>; for each name below.
-- =========================================================

DO $$
DECLARE
  spec RECORD;
  missing INT;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      -- faculty target stats + staff profile: .eq('emp_id').eq('year')
      ('idx_legacy_pub_emp_year',          'legacy_publications',         ARRAY['emp_id','year']),
      -- reports / analytics year filters
      ('idx_legacy_incentives_year',       'legacy_incentives',           ARRAY['incentive_year']),
      ('idx_legacy_consultancy_year',      'legacy_consultancy',          ARRAY['academic_year']),
      ('idx_legacy_seed_grants_year',      'legacy_seed_fund_grants',     ARRAY['academic_year']),
      ('idx_legacy_phd_holders_year',      'legacy_phd_holders',          ARRAY['academic_year']),
      ('idx_legacy_supervisors_year',      'legacy_research_supervisors', ARRAY['academic_year']),
      ('idx_legacy_scholars_year',         'legacy_research_scholars',    ARRAY['academic_year']),
      -- UNIQUE(emp_id, academic_year) cannot serve academic_year-only lookups
      ('idx_fpt_academic_year',            'faculty_publication_targets', ARRAY['academic_year']),
      -- admin dashboards filter live applications by status
      ('idx_consultancy_apps_status',      'consultancy_applications',    ARRAY['status', 'created_at']),
      ('idx_project_grant_apps_status',    'project_grant_applications',  ARRAY['status', 'created_at']),
      ('idx_consultancy_apps_applicant',   'consultancy_applications',    ARRAY['applicant_id']),
      ('idx_project_grant_apps_applicant', 'project_grant_applications',  ARRAY['applicant_id']),
      ('idx_profile_edit_req_applicant',   'profile_edit_requests',       ARRAY['applicant_id', 'created_at']),
      -- analytics PhD count: master_faculty.type = 'Doctorate'
      ('idx_master_faculty_type',          'master_faculty',              ARRAY['type'])
    ) AS t(index_name, table_name, cols)
  LOOP
    IF to_regclass('public.' || spec.table_name) IS NULL THEN
      RAISE NOTICE 'skip %: table % not found', spec.index_name, spec.table_name;
      CONTINUE;
    END IF;

    SELECT count(*) INTO missing
    FROM unnest(spec.cols) AS c(col)
    WHERE NOT EXISTS (
      SELECT 1 FROM information_schema.columns ic
      WHERE ic.table_schema = 'public'
        AND ic.table_name = spec.table_name
        AND ic.column_name = c.col
    );

    IF missing > 0 THEN
      RAISE NOTICE 'skip %: column(s) missing on %', spec.index_name, spec.table_name;
      CONTINUE;
    END IF;

    EXECUTE format(
      'CREATE INDEX IF NOT EXISTS %I ON public.%I (%s)',
      spec.index_name,
      spec.table_name,
      (SELECT string_agg(format('%I', c), ', ') FROM unnest(spec.cols) AS c)
    );
    RAISE NOTICE 'ok %', spec.index_name;
  END LOOP;
END
$$;
