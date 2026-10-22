import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { getStaffByEmail } from '@/lib/staffService'
import { verifyOtp } from '@/lib/emailOtp'
import crypto from 'crypto'

export const dynamic = 'force-dynamic'

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const email = (body.email || '').trim().toLowerCase()
    const otp = (body.otp || '').trim()

    if (!email || !otp) {
      return NextResponse.json({ error: 'Email and verification code are required' }, { status: 400 })
    }

    // 1. Verify OTP code against our local / DB store (NO Supabase email OTP)
    const verification = await verifyOtp(email, otp)
    if (!verification.valid) {
      return NextResponse.json(
        { error: verification.reason || 'Invalid verification code' },
        { status: 401 }
      )
    }

    // 2. Look up staff record
    const staff = await getStaffByEmail(email)
    if (!staff) {
      return NextResponse.json(
        { error: 'Staff member record not found' },
        { status: 404 }
      )
    }

    const admin = createAdminClient()
    const syntheticEmail = `${staff.emp_id.toLowerCase()}@staff.research-portal.local`

    // 3. Ensure auth.users account exists and is linked to master_faculty
    let authUserEmail = syntheticEmail
    let userId = staff.user_id

    // Check if user already exists in auth.users by synthetic email
    if (!userId) {
      const { data: existingUser } = await admin.auth.admin.listUsers()
      const found = existingUser?.users?.find(
        u => u.email?.toLowerCase() === syntheticEmail.toLowerCase() || u.email?.toLowerCase() === email.toLowerCase()
      )

      if (found) {
        userId = found.id
        authUserEmail = found.email || syntheticEmail
      } else {
        // Create auth user automatically
        const randomPass = crypto.randomBytes(24).toString('hex') + 'Aa1!'
        const { data: newUser, error: createErr } = await admin.auth.admin.createUser({
          email: syntheticEmail,
          password: randomPass,
          email_confirm: true,
          user_metadata: {
            emp_id: staff.emp_id,
            name: staff.name,
            dept: staff.dept,
          },
        })

        if (createErr || !newUser.user) {
          console.error('Failed to auto-create auth user:', createErr)
          return NextResponse.json(
            { error: 'Failed to initialize staff session. Please contact administrator.' },
            { status: 500 }
          )
        }

        userId = newUser.user.id
        authUserEmail = newUser.user.email || syntheticEmail
      }

      // Link user_id in master_faculty
      try {
        await admin
          .from('master_faculty')
          .update({ user_id: userId, is_registered: true })
          .eq('emp_id', staff.emp_id)
      } catch (err: any) {
        console.warn('Warning linking master_faculty user_id:', err.message)
      }
    } else {
      // Find the user's email in auth.users
      try {
        const { data: userRecord } = await admin.auth.admin.getUserById(userId)
        if (userRecord?.user?.email) {
          authUserEmail = userRecord.user.email
        }
      } catch {}
    }

    // 4. Generate login link / session token for instant client authentication
    const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: authUserEmail,
    })

    if (linkErr || !linkData?.properties?.hashed_token) {
      console.error('Failed to generate session link:', linkErr)
      return NextResponse.json(
        { error: 'Failed to establish login session. Please try again.' },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      token_hash: linkData.properties.hashed_token,
      staff: {
        emp_id: staff.emp_id,
        name: staff.name,
        dept: staff.dept,
      },
    })
  } catch (err: any) {
    console.error('verify-otp API error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
