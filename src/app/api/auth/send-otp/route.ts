import { NextResponse } from 'next/server'
import { getStaffByEmail } from '@/lib/staffService'
import { generateOtp, saveOtp, sendOtpEmail, checkOtpRateLimit } from '@/lib/emailOtp'

export const dynamic = 'force-dynamic'

function maskEmail(email: string): string {
  const [local, domain] = email.split('@')
  if (!domain) return email
  if (local.length <= 2) return `${local[0]}*@${domain}`
  return `${local[0]}${'*'.repeat(Math.min(local.length - 2, 5))}${local[local.length - 1]}@${domain}`
}

export async function POST(request: Request) {
  try {
    const body = await request.json()
    const email = (body.email || '').trim().toLowerCase()

    if (!email) {
      return NextResponse.json({ error: 'Email address is required' }, { status: 400 })
    }

    if (!email.includes('@') || !email.includes('.')) {
      return NextResponse.json({ error: 'Please enter a valid email address' }, { status: 400 })
    }

    // Rate limiting check (e.g. 30s between resends)
    const rateCheck = checkOtpRateLimit(email)
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: `Please wait ${rateCheck.waitSeconds}s before requesting a new code.` },
        { status: 429 }
      )
    }

    // Verify staff exists in directory / database
    const staff = await getStaffByEmail(email)
    if (!staff) {
      return NextResponse.json(
        { error: 'Email not registered with college staff roster. Please check spelling or contact admin.' },
        { status: 404 }
      )
    }

    // Generate and store OTP
    const otp = generateOtp()
    await saveOtp(email, otp)

    // Send email from hamsinikrishna.s@sece.ac.in
    const emailResult = await sendOtpEmail(email, otp, staff.name)
    if (!emailResult.success) {
      return NextResponse.json(
        { error: `Unable to deliver email: ${emailResult.error || 'Server error'}. Please try again later.` },
        { status: 500 }
      )
    }

    return NextResponse.json({
      success: true,
      name: staff.name,
      maskedEmail: maskEmail(email),
      message: emailResult.devMode
        ? `Local Wi-Fi blocked SMTP port 465. Development verification code: ${otp}`
        : `A 6-digit verification code has been sent to ${maskEmail(email)}.`,
      devOtp: emailResult.devMode ? otp : undefined,
    })
  } catch (err: any) {
    console.error('send-otp API error:', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
