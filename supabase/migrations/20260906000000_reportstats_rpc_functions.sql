CREATE OR REPLACE FUNCTION get_distinct_column_values(p_table_name text, p_column_name text)
RETURNS TABLE (val text)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
    -- 1. STRICT ALLOWLIST: Reject any unauthorized tables
    IF p_table_name NOT IN (
        'legacy_consultancy',
        'submissions',
        'legacy_publications',
        'incentive_applications',
        'legacy_incentives',
        'legacy_patents',
        'seed_fund_applications',
        'legacy_seed_fund_grants',
        'project_grant_applications',
        'research_grants',
        'legacy_research_scholars',
        'legacy_research_supervisors',
        'master_faculty'
    ) THEN
        RAISE EXCEPTION 'Security Exception: Table % is not authorized for dynamic queries.', p_table_name;
    END IF;

    -- 2. STRICT ALLOWLIST: Reject any unauthorized columns
    IF p_column_name NOT IN (
        'department',
        'dept',
        'research_centre',
        'academic_year',
        'incentive_year',
        'year',
        'publication_month',
        'patent_status',
        'status',
        'category'
    ) THEN
        RAISE EXCEPTION 'Security Exception: Column % is not authorized for dynamic queries.', p_column_name;
    END IF;

    -- 3. SAFE EXECUTION: Use format() with %I to escape identifiers natively
    RETURN QUERY EXECUTE format(
        'SELECT DISTINCT %I::text FROM %I WHERE %I IS NOT NULL AND %I::text != ''''', 
        p_column_name, p_table_name, p_column_name, p_column_name
    );
END;
$$;


CREATE OR REPLACE FUNCTION get_report_stats_aggregates()
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    live_incentives_total numeric;
    legacy_incentives_total numeric;
    live_seed_total numeric;
    legacy_seed_total numeric;
    live_grants_total numeric;
    live_grants_count int;
    legacy_grants_total numeric;
    legacy_grants_count int;
    consultancy_total numeric;
BEGIN
    SELECT COALESCE(SUM(calculated_amount::numeric), 0) INTO live_incentives_total
    FROM incentive_applications WHERE status = 'approved';

    SELECT COALESCE(SUM(received_amount::numeric), 0) INTO legacy_incentives_total
    FROM legacy_incentives;

    SELECT COALESCE(SUM(amount_requested::numeric), 0) INTO live_seed_total
    FROM seed_fund_applications WHERE status = 'approved';

    SELECT COALESCE(SUM(amount_sanctioned::numeric), 0) INTO legacy_seed_total
    FROM legacy_seed_fund_grants;

    SELECT COALESCE(SUM(total_proposed_budget::numeric), 0), COUNT(*) INTO live_grants_total, live_grants_count
    FROM project_grant_applications WHERE status = 'approved';

    SELECT COALESCE(SUM(grant_amount::numeric), 0), COUNT(*) INTO legacy_grants_total, legacy_grants_count
    FROM research_grants;

    SELECT COALESCE(SUM(amount::numeric), 0) INTO consultancy_total
    FROM legacy_consultancy;

    RETURN json_build_object(
        'live_incentives_total', live_incentives_total,
        'legacy_incentives_total', legacy_incentives_total,
        'live_seed_total', live_seed_total,
        'legacy_seed_total', legacy_seed_total,
        'live_grants_total', live_grants_total,
        'live_grants_count', live_grants_count,
        'legacy_grants_total', legacy_grants_total,
        'legacy_grants_count', legacy_grants_count,
        'consultancy_total', consultancy_total
    );
END;
$$;
