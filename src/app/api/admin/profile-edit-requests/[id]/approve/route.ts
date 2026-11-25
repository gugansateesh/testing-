import { NextResponse } from 'next/server'
import { verifyToken, extractToken, adminGuard } from '@/lib/verifyAuth'
import { createAdminClient } from '@/lib/supabase'

export async function POST(request: Request, props: { params: Promise<{ id: string }> }) {
  const denied = await adminGuard(request)
  if (denied) return denied

  const params = await props.params;
  try {
    const token = extractToken(request)
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    
    const auth = await verifyToken(token)
    if (!auth) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

    const admin = createAdminClient()

    // Get the request to find the emp_id and requested changes
    const { data: reqData, error: reqError } = await admin
      .from('profile_edit_requests')
      .select('*')
      .eq('id', params.id)
      .single()

    if (reqError || !reqData) {
      return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    }

    if (reqData.status !== 'pending') {
      return NextResponse.json({ error: 'Request is not pending' }, { status: 400 })
    }

    // Build the partial update payload for master_faculty
    const updatePayload: any = {}
    if (reqData.requested_name) updatePayload.name = reqData.requested_name
    if (reqData.requested_designation) updatePayload.designation = reqData.requested_designation
    if (reqData.requested_dept) updatePayload.dept = reqData.requested_dept
    if (reqData.requested_type) updatePayload.type = reqData.requested_type

    if (Object.keys(updatePayload).length > 0) {
      // Update master_faculty FIRST
      const { error: facUpdateError } = await admin
        .from('master_faculty')
        .update(updatePayload)
        .eq('emp_id', reqData.emp_id)

      if (facUpdateError) {
        console.error('Failed to update faculty record:', facUpdateError)
        return NextResponse.json({ error: 'Failed to update faculty record' }, { status: 500 })
      }
    }

    // Now update request
    const { error: reqUpdateError } = await admin
      .from('profile_edit_requests')
      .update({ 
        status: 'approved',
        reviewed_at: new Date().toISOString()
      })
      .eq('id', params.id)

    if (reqUpdateError) {
      console.error('Failed to mark request as approved:', reqUpdateError)
      return NextResponse.json({ error: 'Partially succeeded: updated faculty but failed to mark request as approved' }, { status: 500 })
    }

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Approve error:', error)
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
