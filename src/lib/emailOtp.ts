import crypto from 'crypto'
import nodemailer from 'nodemailer'
import { createAdminClient } from '@/lib/supabase'

const MAIN_SENDER_EMAIL = process.env.SMTP_USER || 'hamsinikrishna.s@sece.ac.in'
const MAIN_SENDER_NAME = 'QuantumRIMS - Sri Eshwar Research Portal'
const OTP_EXPIRY_MINUTES = 10

interface MemoryOtpRecord {
  otp: string
  expiresAt: number
  attempts: number
  lastRequestedAt: number
}

// In-memory cache on globalThis to ensure instant verification across all Next.js route bundles and workers
const inMemoryOtpStore: Map<string, MemoryOtpRecord> =
  (globalThis as any).__quantumRimsOtpStore ||
  ((globalThis as any).__quantumRimsOtpStore = new Map<string, MemoryOtpRecord>())

function createTransporter() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com'
  const port = Number(process.env.SMTP_PORT) || 465
  const user = process.env.SMTP_USER || 'hamsinikrishna.s@sece.ac.in'
  const pass = (process.env.SMTP_PASS || '').replace(/\s+/g, '')

  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: {
      user,
      pass,
    },
    connectionTimeout: 5000,
    greetingTimeout: 5000,
    socketTimeout: 8000,
  })
}

/**
 * Generates a secure 6-digit numeric OTP.
 */
export function generateOtp(): string {
  return crypto.randomInt(100000, 999999).toString()
}

/**
 * Saves generated OTP to both in-memory store and database (if table exists).
 */
export async function saveOtp(email: string, otp: string): Promise<void> {
  const cleanEmail = email.trim().toLowerCase()
  const expiresAt = Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000

  // 1. Update in-memory cache
  inMemoryOtpStore.set(cleanEmail, {
    otp,
    expiresAt,
    attempts: 0,
    lastRequestedAt: Date.now(),
  })

  // 2. Try persisting in auth_otps table
  try {
    const admin = createAdminClient()
    await admin.from('auth_otps').delete().ilike('email', cleanEmail)
    await admin.from('auth_otps').insert({
      email: cleanEmail,
      otp,
      expires_at: new Date(expiresAt).toISOString(),
      attempts: 0,
    })
  } catch (err) {
    // If auth_otps table is not yet created, inMemoryOtpStore handles it
  }
}

/**
 * Checks rate limits (prevents requesting OTP too rapidly).
 */
export function checkOtpRateLimit(email: string): { allowed: boolean; waitSeconds?: number } {
  const cleanEmail = email.trim().toLowerCase()
  const existing = inMemoryOtpStore.get(cleanEmail)
  if (!existing) return { allowed: true }

  const elapsed = (Date.now() - existing.lastRequestedAt) / 1000
  const MIN_INTERVAL = 30 // 30 seconds cooldown between resends

  if (elapsed < MIN_INTERVAL) {
    return {
      allowed: false,
      waitSeconds: Math.ceil(MIN_INTERVAL - elapsed),
    }
  }

  return { allowed: true }
}

/**
 * Verifies the OTP provided by the user.
 */
export async function verifyOtp(email: string, inputOtp: string): Promise<{ valid: boolean; reason?: string }> {
  const cleanEmail = email.trim().toLowerCase()
  const trimmedOtp = inputOtp.trim()

  // 1. Check in-memory store first
  const memoryRecord = inMemoryOtpStore.get(cleanEmail)
  if (memoryRecord) {
    if (Date.now() > memoryRecord.expiresAt) {
      inMemoryOtpStore.delete(cleanEmail)
      return { valid: false, reason: 'Verification code has expired. Please request a new one.' }
    }

    if (memoryRecord.attempts >= 5) {
      inMemoryOtpStore.delete(cleanEmail)
      return { valid: false, reason: 'Too many incorrect attempts. Please request a new code.' }
    }

    if (memoryRecord.otp !== trimmedOtp) {
      memoryRecord.attempts++
      return { valid: false, reason: 'Invalid verification code. Please check and try again.' }
    }

    // Success! Invalidate OTP (single-use)
    inMemoryOtpStore.delete(cleanEmail)
    try {
      const admin = createAdminClient()
      await admin.from('auth_otps').delete().ilike('email', cleanEmail)
    } catch {}

    return { valid: true }
  }

  // 2. Check database auth_otps table as fallback
  try {
    const admin = createAdminClient()
    const { data, error } = await admin
      .from('auth_otps')
      .select('*')
      .ilike('email', cleanEmail)
      .gt('expires_at', new Date().toISOString())
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle()

    if (error || !data) {
      return { valid: false, reason: 'No active verification code found or it has expired.' }
    }

    if (data.attempts >= 5) {
      await admin.from('auth_otps').delete().ilike('email', cleanEmail)
      return { valid: false, reason: 'Too many incorrect attempts. Please request a new code.' }
    }

    if (data.otp !== trimmedOtp) {
      await admin.from('auth_otps').update({ attempts: data.attempts + 1 }).eq('id', data.id)
      return { valid: false, reason: 'Invalid verification code. Please check and try again.' }
    }

    // Success! Delete OTP
    await admin.from('auth_otps').delete().ilike('email', cleanEmail)
    return { valid: true }
  } catch (err: any) {
    return { valid: false, reason: 'Failed to verify code. Please try again.' }
  }
}

/**
 * Sends branded OTP email to staff member using Gmail SMTP.
 */
export async function sendOtpEmail(toEmail: string, otp: string, recipientName: string): Promise<{ success: boolean; devMode?: boolean; error?: string }> {
  const cleanEmail = toEmail.trim().toLowerCase()

  console.log(`\n======================================================`)
  console.log(`🔑 [STAFF OTP GENERATED]`)
  console.log(`   To: ${recipientName} <${cleanEmail}>`)
  console.log(`   Code: ${otp}`)
  console.log(`   Valid for: ${OTP_EXPIRY_MINUTES} minutes`)
  console.log(`======================================================\n`)

  try {
    const transporter = createTransporter()

    const subject = `${otp} is your QuantumRIMS verification code`
    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Your QuantumRIMS Verification Code</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background-color: #f8fafc; padding: 40px 15px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" style="max-width: 520px; background-color: #ffffff; border-radius: 20px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05); border: 1px solid #e2e8f0; overflow: hidden;" cellspacing="0" cellpadding="0">
          
          <!-- Header -->
          <tr>
            <td style="background: linear-gradient(135deg, #0A3D8F 0%, #1e40af 100%); padding: 32px 30px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">QuantumRIMS</h1>
              <p style="margin: 6px 0 0; color: #93c5fd; font-size: 13px; font-weight: 500;">Sri Eshwar Research Portal - Staff Access</p>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td style="padding: 36px 32px;">
              <p style="margin: 0 0 16px; font-size: 15px; color: #334155;">Hello <strong>${recipientName || 'Faculty Member'}</strong>,</p>
              <p style="margin: 0 0 24px; font-size: 14px; color: #64748b; line-height: 1.5;">
                We received a sign-in request for your college email account. Use the one-time verification code below to access the Staff Portal:
              </p>

              <!-- OTP Code Display -->
              <div style="background-color: #eff6ff; border: 2px dashed #3b82f6; border-radius: 14px; padding: 20px; text-align: center; margin: 0 0 24px;">
                <span style="font-family: 'SF Mono', Consolas, 'Liberation Mono', Menlo, Courier, monospace; font-size: 36px; font-weight: 800; letter-spacing: 8px; color: #1d4ed8; display: inline-block;">
                  ${otp}
                </span>
                <p style="margin: 8px 0 0; font-size: 12px; color: #64748b; font-weight: 600;">
                  Valid for 10 minutes (single-use)
                </p>
              </div>

              <p style="margin: 0 0 8px; font-size: 13px; color: #64748b; line-height: 1.5;">
                • Never share this verification code with anyone.<br>
                • If you did not request this code, you can safely ignore this email.
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f1f5f9; padding: 20px 32px; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0; font-size: 12px; color: #94a3b8;">
                Sri Eshwar College of Engineering, Coimbatore<br>
                Centre for Academic Research &amp; Development (CARD)
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
`

    await transporter.sendMail({
      from: `"${MAIN_SENDER_NAME}" <${MAIN_SENDER_EMAIL}>`,
      to: cleanEmail,
      subject,
      text: `Hello ${recipientName || 'Faculty'},\n\nYour QuantumRIMS verification code is: ${otp}\n\nThis code expires in 10 minutes.\n\nSri Eshwar College of Engineering`,
      html: htmlContent,
    })

    console.log(`📧 [EMAIL DELIVERED TO GMAIL SMTP INBOX]`)
    console.log(`   To: ${cleanEmail}`)

    return { success: true }
  } catch (error: any) {
    console.error('Failed to send OTP via Gmail SMTP:', error?.message || error)

    const isLocalDev = process.env.NODE_ENV !== 'production' || process.env.ALLOW_DEV_FALLBACK === 'true'
    const isNetworkBlock = error?.code === 'ETIMEDOUT' || error?.code === 'ECONNREFUSED' || error?.code === 'ENETUNREACH' || error?.timeoutType === 'CONNECT_TIMEOUT'

    // If local development and network firewall blocks SMTP port 465, gracefully allow testing
    if (isLocalDev && isNetworkBlock) {
      console.warn(`\n⚠️  [CAMPUS NETWORK FIREWALL BLOCKED SMTP PORT 465]`)
      console.warn(`   The campus Wi-Fi network blocks outbound SMTP connections to smtp.gmail.com:465.`)
      console.warn(`   For local testing, use verification code: 👉 ${otp} 👈`)
      console.warn(`======================================================\n`)

      return {
        success: true,
        devMode: true,
        error: `Local campus network blocked port 465. Development verification code: ${otp}`,
      }
    }

    return { success: false, error: error.message || 'Failed to send email' }
  }
}


