import { createAdminClient } from '@/lib/supabase'
import staffDirectoryRaw from '@/data/staff_directory.json'

export interface StaffRecord {
  emp_id: string
  name: string
  dept: string
  designation: string
  type: string
  email: string | null
  phone: string | null
  user_id?: string | null
  is_registered?: boolean
}

const staffDirectory: StaffRecord[] = staffDirectoryRaw as StaffRecord[]

/**
 * Finds staff member by college email address.
 * First checks database `master_faculty`.
 * If email column doesn't exist yet or row isn't found, falls back to the staff directory cache.
 */
export async function getStaffByEmail(email: string): Promise<StaffRecord | null> {
  const cleanEmail = email.trim().toLowerCase()
  if (!cleanEmail) return null

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('master_faculty')
      .select('*')
      .ilike('email', cleanEmail)
      .limit(1)
      .maybeSingle()

    if (!error && data) {
      return {
        emp_id: data.emp_id,
        name: data.name,
        dept: data.dept,
        designation: data.designation,
        type: data.type || 'Non-Doctorate',
        email: data.email || cleanEmail,
        phone: data.phone || null,
        user_id: data.user_id || null,
        is_registered: data.is_registered || false,
      }
    }
  } catch (err) {
    // If column doesn't exist or DB error occurs, proceed to directory fallback
  }

  // Fallback to local staff directory cache
  const match = staffDirectory.find(s => (s.email || '').toLowerCase() === cleanEmail)
  if (match) {
    // Enrich with DB info if available (e.g. user_id, is_registered)
    try {
      const admin = createAdminClient()
      const { data: dbFac } = await admin
        .from('master_faculty')
        .select('emp_id, user_id, is_registered')
        .eq('emp_id', match.emp_id)
        .maybeSingle()

      return {
        ...match,
        user_id: dbFac?.user_id || null,
        is_registered: dbFac?.is_registered || false,
      }
    } catch {
      return match
    }
  }

  return null
}

/**
 * Finds staff member by employee ID.
 */
export async function getStaffByEmpId(empId: string): Promise<StaffRecord | null> {
  const cleanId = empId.trim().toUpperCase()
  if (!cleanId) return null

  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('master_faculty')
      .select('*')
      .eq('emp_id', cleanId)
      .maybeSingle()

    if (!error && data) {
      // Cross-reference directory cache to fill missing email or phone
      const cached = staffDirectory.find(s => s.emp_id.toUpperCase() === cleanId)
      return {
        emp_id: data.emp_id,
        name: data.name,
        dept: data.dept,
        designation: data.designation,
        type: data.type || 'Non-Doctorate',
        email: data.email || cached?.email || null,
        phone: data.phone || cached?.phone || null,
        user_id: data.user_id || null,
        is_registered: data.is_registered || false,
      }
    }
  } catch {}

  const cached = staffDirectory.find(s => s.emp_id.toUpperCase() === cleanId)
  return cached || null
}
