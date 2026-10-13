import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

function generateTempPassword(empId: string): string {
  // Generate a predictable-but-unique temp password: Emp@ID + last4digits of timestamp
  const suffix = Date.now().toString().slice(-4)
  return `Reset@${empId}${suffix}`
}

export async function POST(request: Request) {
  let body: { emp_id?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }

  const empId = (body.emp_id ?? '').trim().toUpperCase()

  if (!empId) {
    return NextResponse.json({ error: 'Employee ID is required' }, { status: 400 })
  }

  const admin = createAdminClient()

  // Verify employee exists and is registered
  const { data: faculty, error: lookupError } = await admin
    .from('master_faculty')
    .select('emp_id, name, dept, user_id, is_registered')
    .eq('emp_id', empId)
    .single()

  if (lookupError || !faculty) {
    return NextResponse.json({ error: 'Employee ID not found. Please check with admin.' }, { status: 404 })
  }

  if (!faculty.is_registered || !faculty.user_id) {
    return NextResponse.json(
      { error: 'This Employee ID has not been registered yet. Please sign up first.' },
      { status: 400 }
    )
  }

  const tempPassword = generateTempPassword(empId)

  // Reset the password using admin SDK
  const { error: resetError } = await admin.auth.admin.updateUserById(faculty.user_id, {
    password: tempPassword,
  })

  if (resetError) {
    return NextResponse.json({ error: `Password reset failed: ${resetError.message}` }, { status: 500 })
  }

  return NextResponse.json({
    success: true,
    name: faculty.name,
    dept: faculty.dept,
    temp_password: tempPassword,
  })
}
