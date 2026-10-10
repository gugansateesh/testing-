-- 1. Submissions modifications
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS legacy_publication_id UUID REFERENCES legacy_publications(id) UNIQUE;
ALTER TABLE submissions ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'history'));

-- 2. Settings table
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value JSONB,
  updated_by UUID REFERENCES auth.users(id),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
-- Admin only via API usually, but we can allow authenticated to read
DROP POLICY IF EXISTS "Public read app_settings" ON app_settings;
CREATE POLICY "Public read app_settings" ON app_settings FOR SELECT TO authenticated USING (true);

-- 3. RPC to insert both submission and incentive application safely
CREATE OR REPLACE FUNCTION create_history_incentive(
  p_sub_payload JSONB,
  p_inc_payload JSONB
) RETURNS UUID AS $$
DECLARE
  v_sub_id UUID;
  v_inc_id UUID;
BEGIN
  IF LOWER(TRIM(p_sub_payload->>'doc_type_report')) = 'student publication' THEN
    RAISE EXCEPTION 'Student publications are not eligible for incentives';
  END IF;

  -- Insert into submissions
  INSERT INTO submissions (
    title, authors, source_title, volume, issue, year, doi, scopus_link,
    doc_type_scopus, doc_type_report, department, faculty_name,
    submitted_by, status, source, legacy_publication_id,
    doc_type, isbn_no, issn_no, publication_date,
    proof_full_paper_url, proof_scopus_url, proof_published_url
  ) VALUES (
    p_sub_payload->>'title',
    p_sub_payload->>'authors',
    p_sub_payload->>'source_title',
    p_sub_payload->>'volume',
    p_sub_payload->>'issue',
    (p_sub_payload->>'year')::INTEGER,
    p_sub_payload->>'doi',
    p_sub_payload->>'scopus_link',
    p_sub_payload->>'doc_type_scopus',
    p_sub_payload->>'doc_type_report',
    p_sub_payload->>'department',
    p_sub_payload->>'faculty_name',
    (p_sub_payload->>'submitted_by')::UUID,
    'approved',
    'history',
    (p_sub_payload->>'legacy_publication_id')::UUID,
    p_sub_payload->>'doc_type',
    p_sub_payload->>'isbn_no',
    p_sub_payload->>'issn_no',
    (p_sub_payload->>'publication_date')::DATE,
    p_sub_payload->>'proof_full_paper_url',
    p_sub_payload->>'proof_scopus_url',
    p_sub_payload->>'proof_published_url'
  ) RETURNING id INTO v_sub_id;

  -- Insert into incentive_applications
  INSERT INTO incentive_applications (
    submission_id, applicant_id, category, author_count, author_position,
    impact_factor, journal_quartile, h_index, publisher_tier, book_type,
    patent_type, patent_forms_confirmed, citation_count, self_citation_count,
    calculated_amount, status
  ) VALUES (
    v_sub_id,
    (p_inc_payload->>'applicant_id')::UUID,
    p_inc_payload->>'category',
    (p_inc_payload->>'author_count')::INTEGER,
    (p_inc_payload->>'author_position')::INTEGER,
    (p_inc_payload->>'impact_factor')::NUMERIC,
    p_inc_payload->>'journal_quartile',
    (p_inc_payload->>'h_index')::INTEGER,
    p_inc_payload->>'publisher_tier',
    p_inc_payload->>'book_type',
    p_inc_payload->>'patent_type',
    (p_inc_payload->>'patent_forms_confirmed')::BOOLEAN,
    (p_inc_payload->>'citation_count')::INTEGER,
    (p_inc_payload->>'self_citation_count')::INTEGER,
    (p_inc_payload->>'calculated_amount')::NUMERIC,
    'pending'
  ) RETURNING id INTO v_inc_id;

  RETURN v_sub_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
