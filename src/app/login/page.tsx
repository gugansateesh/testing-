'use client'

import { useState, useCallback, useEffect, Suspense } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'
import { LogIn, Eye, EyeOff, Loader2, Mail, KeyRound, ArrowLeft, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { checkAdminAllowlist } from './actions'

import { LoginStatsPanel } from '@/components/LoginStatsPanel'
import { ThemeToggle } from '@/components/ThemeToggle'

function SearchParamHandler({ setSuccessMsg }: { setSuccessMsg: (msg: string) => void }) {
  const searchParams = useSearchParams()
  useEffect(() => {
    if (searchParams.get('registered') === '1') {
      setSuccessMsg('Account created! You can now log in with your College Email.')
    }
  }, [searchParams, setSuccessMsg])
  return null
}

export default function StaffLoginPage() {
  const router = useRouter()
  
  // Tab selection: 'otp' (default) or 'password' (for admin / password sign-in)
  const [loginMode, setLoginMode] = useState<'otp' | 'password'>('otp')

  // OTP flow state
  const [otpStep, setOtpStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [otpCode, setOtpCode] = useState('')
  const [maskedEmail, setMaskedEmail] = useState('')
  const [staffName, setStaffName] = useState('')
  const [resendCooldown, setResendCooldown] = useState(0)

  // Password flow state (admin / fallback)
  const [empIdOrEmail, setEmpIdOrEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)

  // Common UI state
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  // Cooldown countdown effect
  useEffect(() => {
    if (resendCooldown <= 0) return
    const timer = setInterval(() => {
      setResendCooldown(prev => Math.max(prev - 1, 0))
    }, 1000)
    return () => clearInterval(timer)
  }, [resendCooldown])

  // Step 1: Send OTP to College Email
  const handleSendOtp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    const cleanEmail = email.trim().toLowerCase()
    if (!cleanEmail) {
      setError('Please enter your college email address.')
      return
    }

    setLoading(true)
    setError('')
    setSuccessMsg('')

    try {
      const res = await fetch('/api/auth/send-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Failed to send verification code. Please check your email address.')
        setLoading(false)
        return
      }

      setMaskedEmail(data.maskedEmail || cleanEmail)
      setStaffName(data.name || '')
      setOtpStep('code')
      setResendCooldown(30)
      if (data.devOtp) {
        setOtpCode(data.devOtp)
        setSuccessMsg(`Campus Wi-Fi blocked SMTP port 465. Verification code auto-filled: ${data.devOtp}`)
      } else {
        setSuccessMsg(`Verification code sent to ${data.maskedEmail || cleanEmail}`)
      }
    } catch (err: any) {
      setError('Network error. Unable to reach authentication server.')
    } finally {
      setLoading(false)
    }
  }

  // Step 2: Verify OTP and Establish Session
  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault()
    const cleanEmail = email.trim().toLowerCase()
    const cleanOtp = otpCode.trim()

    if (!cleanOtp || cleanOtp.length < 6) {
      setError('Please enter the complete 6-digit verification code.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const res = await fetch('/api/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: cleanEmail, otp: cleanOtp }),
      })

      const data = await res.json()

      if (!res.ok) {
        setError(data.error || 'Verification failed. Please try again.')
        setLoading(false)
        return
      }

      if (!data.token_hash) {
        setError('Login session could not be established. Please try again.')
        setLoading(false)
        return
      }

      // Establish Supabase client session seamlessly using token_hash
      const { error: sessionError } = await supabase.auth.verifyOtp({
        token_hash: data.token_hash,
        type: 'magiclink',
      })

      if (sessionError) {
        console.error('Session establishment error:', sessionError)
        setError('Failed to establish local browser session. Please try again.')
        setLoading(false)
        return
      }

      // Check if user is an admin
      const isAllowedAdmin = await checkAdminAllowlist(cleanEmail)
      if (isAllowedAdmin) {
        router.push('/admin')
      } else {
        router.push('/')
      }
    } catch (err: any) {
      setError('Network error during verification. Please try again.')
      setLoading(false)
    }
  }

  // Password Login Handler (Preserved for Admin and Password logins)
  const handlePasswordLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccessMsg('')

    const inputValue = empIdOrEmail.trim().toLowerCase()
    const isAdminAttempt = inputValue.includes('@')

    const loginEmail = isAdminAttempt 
      ? inputValue 
      : `${inputValue}@staff.research-portal.local`

    const { error: authError } = await supabase.auth.signInWithPassword({ email: loginEmail, password })

    if (authError) {
      setError('Invalid Employee ID/email or password.')
      setLoading(false)
      return
    }

    if (isAdminAttempt) {
      const isAllowedAdmin = await checkAdminAllowlist(loginEmail)
      if (!isAllowedAdmin) {
        await supabase.auth.signOut()
        setError('Invalid Employee ID/email or password.')
        setLoading(false)
        return
      }
      router.push('/admin')
      return
    }

    router.push('/')
  }, [empIdOrEmail, password, router])

  return (
    <div className="min-h-screen flex flex-col lg:flex-row font-sans bg-gradient-to-br from-slate-50 to-slate-100 dark:from-[#0F172A] dark:to-[#1E293B]">
      <Suspense fallback={null}>
        <SearchParamHandler setSuccessMsg={setSuccessMsg} />
      </Suspense>

      {/* Theme toggle — fixed top-right corner */}
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle variant="page" />
      </div>

      {/* Left Column — Hidden on mobile */}
      <div className="hidden lg:flex lg:w-1/2 shadow-[10px_0_40px_rgba(0,0,0,0.1)] z-10">
        <LoginStatsPanel />
      </div>

      {/* Right Column — Login Form */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 lg:p-12 relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-100/40 dark:from-blue-900/20 via-transparent to-transparent opacity-50 pointer-events-none" />
        <div className="w-full max-w-md relative z-10">
          <div className="bg-white dark:bg-[#1E293B] rounded-[2rem] border border-white dark:border-slate-600/50 shadow-[0_8px_40px_rgb(0,0,0,0.06)] dark:shadow-[0_8px_40px_rgb(0,0,0,0.3)] overflow-hidden ring-1 ring-slate-900/5 dark:ring-slate-700/50">
            
            {/* Header with Logo */}
            <div className="px-10 pt-10 pb-4 text-center">
              <div className="flex justify-center mb-6">
                <Image src="/images/quantumrims-logo.svg" alt="QuantumRIMS logo" width={373} height={85} className="object-contain h-14 w-auto dark:brightness-110" priority />
              </div>
              <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">
                {loginMode === 'otp' ? 'Staff Portal Login' : 'Admin / Password Sign in'}
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                {loginMode === 'otp'
                  ? 'Sign in securely with one-time verification code'
                  : 'Enter your credentials to access the portal'}
              </p>
            </div>

            {/* Mode Selector Tabs */}
            <div className="px-10 mb-4">
              <div className="grid grid-cols-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-bold">
                <button
                  type="button"
                  onClick={() => { setLoginMode('otp'); setError(''); setSuccessMsg('') }}
                  className={`py-2 px-3 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                    loginMode === 'otp'
                      ? 'bg-white dark:bg-slate-700 text-[#0A3D8F] dark:text-blue-400 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <Mail className="w-3.5 h-3.5" /> Staff (Email OTP)
                </button>
                <button
                  type="button"
                  onClick={() => { setLoginMode('password'); setError(''); setSuccessMsg('') }}
                  className={`py-2 px-3 rounded-lg transition-all flex items-center justify-center gap-1.5 ${
                    loginMode === 'password'
                      ? 'bg-white dark:bg-slate-700 text-[#0A3D8F] dark:text-blue-400 shadow-sm'
                      : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5" /> Admin / Password
                </button>
              </div>
            </div>

            <div className="px-10 pb-10 space-y-5">
              {/* Notifications */}
              {successMsg && (
                <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-400 text-xs font-medium flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 flex-shrink-0" />
                  {successMsg}
                </div>
              )}
              {error && (
                <div className="p-3.5 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/50 text-red-700 dark:text-red-400 text-xs font-medium flex items-center gap-2">
                  <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />
                  {error}
                </div>
              )}

              {/* ────────────────────────────────────────────────────────── */}
              {/* MODE 1: STAFF EMAIL OTP LOGIN                             */}
              {/* ────────────────────────────────────────────────────────── */}
              {loginMode === 'otp' && (
                <>
                  {otpStep === 'email' ? (
                    <form onSubmit={handleSendOtp} className="space-y-4">
                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                          College Email Address
                        </label>
                        <div className="relative">
                          <input
                            id="login-staff-email"
                            type="email"
                            required
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            className="w-full pl-11 pr-4 py-3.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-700/50 text-slate-900 dark:text-slate-100 placeholder-slate-400 text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-sm"
                            placeholder="e.g. yourname@sece.ac.in"
                            autoComplete="email"
                          />
                          <Mail className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                        </div>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5">
                          Verification code will be sent from <strong>hamsinikrishna.s@sece.ac.in</strong>
                        </p>
                      </div>

                      <button
                        type="submit"
                        disabled={loading}
                        className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl bg-gradient-to-r from-[#0A3D8F] to-[#1e3a8a] hover:from-[#082f6e] hover:to-[#172d6b] disabled:opacity-70 text-white font-bold text-sm transition-all duration-300 shadow-md shadow-blue-900/20 hover:-translate-y-0.5 mt-2"
                      >
                        {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Sending Code...</> : 'Send Verification Code'}
                      </button>
                    </form>
                  ) : (
                    <form onSubmit={handleVerifyOtp} className="space-y-4">
                      <div className="p-3 bg-blue-50/70 dark:bg-blue-950/30 rounded-xl border border-blue-100 dark:border-blue-900/40 text-xs text-slate-600 dark:text-slate-300 flex items-center justify-between">
                        <div>
                          {staffName && <p className="font-bold text-[#0A3D8F] dark:text-blue-400">{staffName}</p>}
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">Code sent to <strong>{maskedEmail}</strong></p>
                        </div>
                        <button
                          type="button"
                          onClick={() => { setOtpStep('email'); setOtpCode(''); setError('') }}
                          className="text-xs text-[#0A3D8F] dark:text-blue-400 hover:underline font-bold flex items-center gap-1"
                        >
                          <ArrowLeft className="w-3 h-3" /> Change
                        </button>
                      </div>

                      <div>
                        <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                          Enter 6-Digit Verification Code
                        </label>
                        <div className="relative">
                          <input
                            id="login-otp-code"
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            maxLength={6}
                            required
                            autoFocus
                            value={otpCode}
                            onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                            className="w-full text-center tracking-[0.5em] font-mono text-xl py-3.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-700/50 text-slate-900 dark:text-slate-100 placeholder-slate-300 focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all font-bold"
                            placeholder="••••••"
                          />
                          <KeyRound className="w-4 h-4 text-slate-400 absolute left-4 top-1/2 -translate-y-1/2" />
                        </div>
                      </div>

                      <div className="flex items-center justify-between text-xs">
                        <span className="text-slate-400">Didn&apos;t receive code?</span>
                        {resendCooldown > 0 ? (
                          <span className="text-slate-400 font-medium">Resend in {resendCooldown}s</span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => handleSendOtp()}
                            disabled={loading}
                            className="text-[#0A3D8F] dark:text-blue-400 font-bold hover:underline"
                          >
                            Resend Code
                          </button>
                        )}
                      </div>

                      <button
                        type="submit"
                        disabled={loading || otpCode.length < 6}
                        className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl bg-gradient-to-r from-[#0A3D8F] to-[#1e3a8a] hover:from-[#082f6e] hover:to-[#172d6b] disabled:opacity-70 text-white font-bold text-sm transition-all duration-300 shadow-md shadow-blue-900/20 hover:-translate-y-0.5 mt-2"
                      >
                        {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Verifying...</> : 'Verify & Sign in'}
                      </button>
                    </form>
                  )}
                </>
              )}

              {/* ────────────────────────────────────────────────────────── */}
              {/* MODE 2: ADMIN / PASSWORD LOGIN (PRESERVED)                 */}
              {/* ────────────────────────────────────────────────────────── */}
              {loginMode === 'password' && (
                <form onSubmit={handlePasswordLogin} className="space-y-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                      Admin Email or Employee ID
                    </label>
                    <input
                      id="login-emp-id"
                      type="text"
                      required
                      value={empIdOrEmail}
                      onChange={(e) => setEmpIdOrEmail(e.target.value)}
                      className="w-full px-4 py-3.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-700/50 text-slate-900 dark:text-slate-100 placeholder-slate-400 text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-sm"
                      placeholder="e.g. admin@college.edu or SECETAD020"
                      autoComplete="username"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                      Password
                    </label>
                    <div className="relative">
                      <input
                        id="login-password"
                        type={showPass ? 'text' : 'password'}
                        required
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="w-full px-4 pr-12 py-3.5 rounded-xl border border-slate-200 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-700/50 text-slate-900 dark:text-slate-100 placeholder-slate-400 text-sm focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 transition-all shadow-sm"
                        placeholder="••••••••"
                        autoComplete="current-password"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPass(!showPass)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition"
                      >
                        {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    <div className="flex justify-end mt-1.5">
                      <Link href="/reset-password" className="text-[11px] text-slate-400 hover:text-[#0A3D8F] dark:hover:text-blue-400 font-medium transition-colors">
                        Forgot password?
                      </Link>
                    </div>
                  </div>

                  <button
                    id="login-submit"
                    type="submit"
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 py-3.5 px-6 rounded-xl bg-gradient-to-r from-[#0A3D8F] to-[#1e3a8a] hover:from-[#082f6e] hover:to-[#172d6b] disabled:opacity-70 text-white font-bold text-sm transition-all duration-300 shadow-md shadow-blue-900/20 hover:-translate-y-0.5 mt-2"
                  >
                    {loading ? <><Loader2 className="w-4 h-4 animate-spin" /> Signing in...</> : 'Sign in with Password'}
                  </button>
                </form>
              )}

              {/* Footer info */}
              <div className="pt-6 text-center border-t border-slate-100 dark:border-slate-700 mt-6">
                <p className="text-xs text-slate-500 dark:text-slate-400 font-medium">
                  Need assistance with your staff email?{' '}
                  <span className="text-[#0A3D8F] dark:text-blue-400 font-bold">Contact CFRD Admin</span>
                </p>
              </div>

            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
