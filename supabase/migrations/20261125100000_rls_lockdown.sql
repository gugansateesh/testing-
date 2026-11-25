-- =========================================================
-- RLS lockdown — 2026-11-25
--
-- The browser holds the public anon key, so every RLS policy below was
-- reachable by anyone with the site open (or, for `{public}` policies,
-- by anyone at all). The app performs ALL writes through the Next.js API
-- with the service-role key (which bypasses RLS), and never reads the
-- legacy_* tables or writes to storage from the browser. These policies
-- are therefore unused by the app and only widen access.
--
-- Holes closed:
--   1. legacy_consultancy: "Allow admin all access" was USING (true) /
--      WITH CHECK (true) for role public — anyone could insert, edit or
--      delete every consultancy record without logging in.
--   2. legacy_consultancy / legacy_incentives / legacy_research_scholars /
--      legacy_research_supervisors: public SELECT USING (true) exposed
--      faculty names and amounts to unauthenticated callers.
--   3. Direct INSERT/UPDATE policies on application tables only checked
--      ownership, not status — a user could insert or update their own row
--      with status = 'approved' (and any calculated_amount), skipping the
--      admin approval flow entirely. submissions INSERT was WITH CHECK (true).
--   4. Storage: any signed-in user could upload to / overwrite objects in
--      the public `proofs` and `seed-fund-scans` buckets.
--
-- Kept: own-row SELECT policies, announcement_reads (the only table the
-- browser writes), announcements/master_faculty/document_templates SELECT,
-- public read of storage objects.
--
-- SAFE ON A LIVE DATABASE: only DROP POLICY IF EXISTS — no tables, columns
-- or rows are touched. Runs in one transaction. Rollback SQL is at the end.
-- =========================================================

BEGIN;

-- 1 + 2. legacy tables
DROP POLICY IF EXISTS "Allow admin all access for legacy_consultancy"    ON public.legacy_consultancy;
DROP POLICY IF EXISTS "Allow public read access for legacy_consultancy"  ON public.legacy_consultancy;
DROP POLICY IF EXISTS "Allow public read access for legacy_incentives"   ON public.legacy_incentives;
DROP POLICY IF EXISTS "Allow public read access for legacy_research_scholars"    ON public.legacy_research_scholars;
DROP POLICY IF EXISTS "Allow public read access for legacy_research_supervisors" ON public.legacy_research_supervisors;

-- 3. direct writes to application tables (the API writes with the service role)
DROP POLICY IF EXISTS "Authenticated insert for submissions"   ON public.submissions;
DROP POLICY IF EXISTS "own_update_rejected_submissions"        ON public.submissions;
DROP POLICY IF EXISTS "own_insert_incentive"                   ON public.incentive_applications;
DROP POLICY IF EXISTS "own_update_rejected_incentive"          ON public.incentive_applications;
DROP POLICY IF EXISTS "own_insert_consultancy"                 ON public.consultancy_applications;
DROP POLICY IF EXISTS "own_update_rejected_consultancy"        ON public.consultancy_applications;
DROP POLICY IF EXISTS "own_insert_project_grants"              ON public.project_grant_applications;
DROP POLICY IF EXISTS "own_update_rejected_project_grants"     ON public.project_grant_applications;
DROP POLICY IF EXISTS "Users can insert their own seed fund applications" ON public.seed_fund_applications;
DROP POLICY IF EXISTS "Users can update their own rejected applications"  ON public.seed_fund_applications;
DROP POLICY IF EXISTS "Staff can insert own PPT submissions"              ON public.seed_fund_ppt_submissions;
DROP POLICY IF EXISTS "Staff can update own rejected PPT submissions"     ON public.seed_fund_ppt_submissions;
DROP POLICY IF EXISTS "Staff can insert own seed fund project documents"  ON public.seed_fund_project_documents;
DROP POLICY IF EXISTS "Staff can update own rejected seed fund project documents" ON public.seed_fund_project_documents;
DROP POLICY IF EXISTS "own_insert_phd_request"                 ON public.profile_edit_requests;

COMMIT;

-- 4. storage (separate block: storage.objects may be owned by another role;
--    if so this is skipped with a notice instead of failing the migration)
DO $$
BEGIN
  DROP POLICY IF EXISTS "Authenticated insert access for proofs"          ON storage.objects;
  DROP POLICY IF EXISTS "Authenticated users can upload seed fund scans"  ON storage.objects;
  DROP POLICY IF EXISTS "Authenticated users can update seed fund scans"  ON storage.objects;
EXCEPTION WHEN insufficient_privilege OR undefined_table THEN
  RAISE NOTICE 'storage policies not changed (%): drop them in Dashboard > Storage > Policies', SQLERRM;
END
$$;

-- =========================================================
-- ROLLBACK (restores the exact previous policies):
--
-- CREATE POLICY "Allow admin all access for legacy_consultancy" ON public.legacy_consultancy FOR ALL TO public USING (true) WITH CHECK (true);
-- CREATE POLICY "Allow public read access for legacy_consultancy" ON public.legacy_consultancy FOR SELECT TO public USING (true);
-- CREATE POLICY "Allow public read access for legacy_incentives" ON public.legacy_incentives FOR SELECT TO public USING (true);
-- CREATE POLICY "Allow public read access for legacy_research_scholars" ON public.legacy_research_scholars FOR SELECT TO public USING (true);
-- CREATE POLICY "Allow public read access for legacy_research_supervisors" ON public.legacy_research_supervisors FOR SELECT TO public USING (true);
-- CREATE POLICY "Authenticated insert for submissions" ON public.submissions FOR INSERT TO authenticated WITH CHECK (true);
-- CREATE POLICY "own_update_rejected_submissions" ON public.submissions FOR UPDATE TO authenticated USING ((submitted_by = auth.uid()) AND (status = 'rejected')) WITH CHECK (submitted_by = auth.uid());
-- CREATE POLICY "own_insert_incentive" ON public.incentive_applications FOR INSERT TO authenticated WITH CHECK (applicant_id = auth.uid());
-- CREATE POLICY "own_update_rejected_incentive" ON public.incentive_applications FOR UPDATE TO authenticated USING ((applicant_id = auth.uid()) AND (status = 'rejected')) WITH CHECK (applicant_id = auth.uid());
-- CREATE POLICY "own_insert_consultancy" ON public.consultancy_applications FOR INSERT TO public WITH CHECK (auth.uid() = applicant_id);
-- CREATE POLICY "own_update_rejected_consultancy" ON public.consultancy_applications FOR UPDATE TO public USING ((auth.uid() = applicant_id) AND (status = 'rejected')) WITH CHECK ((auth.uid() = applicant_id) AND (status = 'pending'));
-- CREATE POLICY "own_insert_project_grants" ON public.project_grant_applications FOR INSERT TO public WITH CHECK (auth.uid() = applicant_id);
-- CREATE POLICY "own_update_rejected_project_grants" ON public.project_grant_applications FOR UPDATE TO public USING ((auth.uid() = applicant_id) AND (status = 'rejected')) WITH CHECK ((auth.uid() = applicant_id) AND (status = 'pending'));
-- CREATE POLICY "Users can insert their own seed fund applications" ON public.seed_fund_applications FOR INSERT TO public WITH CHECK (auth.uid() = applicant_id);
-- CREATE POLICY "Users can update their own rejected applications" ON public.seed_fund_applications FOR UPDATE TO public USING ((auth.uid() = applicant_id) AND (status = 'rejected')) WITH CHECK ((auth.uid() = applicant_id) AND (status = 'pending'));
-- CREATE POLICY "Staff can insert own PPT submissions" ON public.seed_fund_ppt_submissions FOR INSERT TO public WITH CHECK (applicant_id = auth.uid());
-- CREATE POLICY "Staff can update own rejected PPT submissions" ON public.seed_fund_ppt_submissions FOR UPDATE TO public USING ((applicant_id = auth.uid()) AND (status = 'rejected')) WITH CHECK ((applicant_id = auth.uid()) AND (status = 'pending'));
-- CREATE POLICY "Staff can insert own seed fund project documents" ON public.seed_fund_project_documents FOR INSERT TO public WITH CHECK (applicant_id = auth.uid());
-- CREATE POLICY "Staff can update own rejected seed fund project documents" ON public.seed_fund_project_documents FOR UPDATE TO public USING ((applicant_id = auth.uid()) AND (status = 'rejected')) WITH CHECK ((applicant_id = auth.uid()) AND (status = 'pending'));
-- CREATE POLICY "own_insert_phd_request" ON public.profile_edit_requests FOR INSERT TO public WITH CHECK (auth.uid() = applicant_id);
-- CREATE POLICY "Authenticated insert access for proofs" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'proofs');
-- CREATE POLICY "Authenticated users can upload seed fund scans" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'seed-fund-scans');
-- CREATE POLICY "Authenticated users can update seed fund scans" ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = 'seed-fund-scans');
-- =========================================================
