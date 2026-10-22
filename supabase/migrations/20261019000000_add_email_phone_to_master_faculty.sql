-- ============================================================
-- Migration: Add Email, Phone, and OTP Authentication Support
-- Run in Supabase Dashboard → SQL Editor
-- ============================================================

-- 1. Add email, phone, and original_dept columns to master_faculty
ALTER TABLE public.master_faculty
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS original_dept TEXT;

-- Index for fast case-insensitive email lookup
CREATE INDEX IF NOT EXISTS idx_master_faculty_email_lower
  ON public.master_faculty(LOWER(email))
  WHERE email IS NOT NULL;

-- 2. Create auth_otps table for storing one-time passwords
CREATE TABLE IF NOT EXISTS public.auth_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  otp TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Index for active OTP lookups
CREATE INDEX IF NOT EXISTS idx_auth_otps_email_expires
  ON public.auth_otps(LOWER(email), expires_at);

-- RLS: Only service role can access auth_otps table
ALTER TABLE public.auth_otps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role access for auth_otps" ON public.auth_otps;
CREATE POLICY "Service role access for auth_otps"
  ON public.auth_otps
  TO service_role
  USING (true)
  WITH CHECK (true);
