'use client'

import { useState, useCallback, useEffect, Suspense } from 'react'
import { supabase } from '@/lib/supabase'
import { useRouter, useSearchParams } from 'next/navigation'
import { LogIn, Eye, EyeOff, Loader2 } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { checkAdminAllowlist } from './actions'

import { LoginStatsPanel } from '@/components/LoginStatsPanel'
import { ThemeToggle } from '@/components/ThemeToggle'

function SearchParamHandler({ setSuccessMsg }: { setSuccessMsg: (msg: string) => void }) {
  const searchParams = useSearchParams()
  useEffect(() => {
    if (searchParams.get('registered') === '1') {
      setSuccessMsg('Account created! You can now log in with your Employee ID.')
    }
  }, [searchParams, setSuccessMsg])
  return null
}

export default function StaffLoginPage() {
  const router = useRouter()
  const [empId, setEmpId] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [successMsg, setSuccessMsg] = useState('')

  const handleLogin = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setSuccessMsg('')

    const inputValue = empId.trim().toLowerCase()
    const isAdminAttempt = inputValue.includes('@')

    // If it's not an admin attempt, we append the synthetic domain for staff
    const loginEmail = isAdminAttempt 
      ? inputValue 
      : `${inputValue}@staff.research-portal.local`

    const { error } = await supabase.auth.signInWithPassword({ email: loginEmail, password })

    if (error) {
      setError('Invalid Employee ID/email or password.')
      setLoading(false)
      return
    }

    if (isAdminAttempt) {
      // Verify they are actually in the admin allowlist
      const isAllowedAdmin = await checkAdminAllowlist(loginEmail)
      if (!isAllowedAdmin) {
        // Sign them back out immediately so they aren't stuck in a non-admin session
        await supabase.auth.signOut()
        setError('Invalid Employee ID/email or password.')
        setLoading(false)
        return
      }
      
      router.push('/admin')
      return
    }

    router.push('/')
  }, [empId, password, router])

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
            <div className="px-10 pt-12 pb-6 text-center">
              <div className="flex justify-center mb-8">
                <Image src="/images/quantumrims-logo.svg" alt="QuantumRIMS logo" width={373} height={85} className="object-contain h-14 w-auto dark:brightness-110" priority />
              </div>
              <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Sign in</h1>
            </div>

            <div className="px-10 pb-12 space-y-6">
              {successMsg && (
                <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-100 dark:border-emerald-800/50 text-emerald-700 dark:text-emerald-400 text-sm font-medium flex items-center">{successMsg}</div>
              )}
              {error && (
                <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/50 text-red-700 dark:text-red-400 text-sm font-medium flex items-center">{error}</div>
              )}

              <form onSubmit={handleLogin} className="space-y-5">
                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Employee ID</label>
                  <input id="login-emp-id" type="text" required value={empId}
                    onChange={(e) => setEmpId(e.target.value)}
                    className="w-full px-5 py-4 rounded-2xl border border-slate-200 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-700/50 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 dark:focus:border-blue-400 focus:bg-white dark:focus:bg-slate-700 transition-all shadow-sm"
                    placeholder="e.g. SECETAD020" autoComplete="username" />
                </div>
                <div>
                  <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Password</label>
                  <div className="relative">
                    <input id="login-password" type={showPass ? 'text' : 'password'} required
                      value={password} onChange={(e) => setPassword(e.target.value)}
                      className="w-full px-5 py-4 pr-12 rounded-2xl border border-slate-200 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-700/50 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-4 focus:ring-blue-500/10 focus:border-blue-500 dark:focus:border-blue-400 focus:bg-white dark:focus:bg-slate-700 transition-all shadow-sm"
                      placeholder="••••••••" autoComplete="current-password" />
                    <button type="button" onClick={() => setShowPass(!showPass)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition">
                      {showPass ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                  <div className="flex justify-end">
                    <Link href="/reset-password" className="text-xs text-slate-400 dark:text-slate-500 hover:text-[#0A3D8F] dark:hover:text-blue-400 font-medium transition-colors">
                      Forgot password?
                    </Link>
                  </div>
                </div>

                <button id="login-submit" type="submit" disabled={loading}
                  className="w-full flex items-center justify-center gap-2 py-4 px-6 rounded-2xl bg-gradient-to-r from-[#0A3D8F] to-[#1e3a8a] hover:from-[#082f6e] hover:to-[#172d6b] disabled:opacity-70 disabled:cursor-not-allowed text-white font-bold text-lg transition-all duration-300 mt-6 shadow-[0_4px_14px_0_rgb(10,61,143,0.39)] hover:shadow-[0_6px_20px_rgba(10,61,143,0.23)] hover:-translate-y-0.5">
                  {loading ? <><Loader2 className="w-5 h-5 animate-spin" /> Signing in...</> : 'Sign in to Portal'}
                </button>
              </form>

              <div className="pt-8 text-center border-t border-slate-100 dark:border-slate-700 mt-8">
                <p className="text-sm text-slate-500 dark:text-slate-400 font-medium">
                  First time? You&apos;ll need to{' '}
                  <Link href="/signup" className="text-[#0A3D8F] dark:text-blue-400 font-bold hover:text-blue-700 dark:hover:text-blue-300 hover:underline transition-colors">Request access</Link>
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
