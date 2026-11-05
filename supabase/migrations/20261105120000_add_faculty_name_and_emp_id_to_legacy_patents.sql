-- ============================================================
-- Migration: Add faculty_name and emp_id to legacy_patents
-- Run in Supabase Dashboard → SQL Editor
-- ============================================================

ALTER TABLE public.legacy_patents
  ADD COLUMN IF NOT EXISTS faculty_name TEXT,
  ADD COLUMN IF NOT EXISTS emp_id VARCHAR(50);

CREATE INDEX IF NOT EXISTS idx_legacy_patents_faculty_name ON public.legacy_patents(faculty_name);
CREATE INDEX IF NOT EXISTS idx_legacy_patents_emp_id ON public.legacy_patents(emp_id);
