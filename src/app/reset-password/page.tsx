'use client'

import { useState, useCallback } from 'react'
import { KeyRound, Eye, EyeOff, Loader2, CheckCircle2, Copy, Check, ArrowLeft } from 'lucide-react'
import Link from 'next/link'
import Image from 'next/image'
import { LoginStatsPanel } from '@/components/LoginStatsPanel'

export default function ResetPasswordPage() {
  const [empId, setEmpId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<{ name: string; dept: string; temp_password: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [showPass, setShowPass] = useState(false)

  const handleReset = useCallback(async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setResult(null)
    setLoading(true)
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ emp_id: empId.trim() }),
      })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Reset failed. Please try again.'); return }
      setResult(json)
    } catch {
      setError('Network error. Please try again.')
    } finally {
      setLoading(false)
    }
  }, [empId])

  const copyPassword = () => {
    if (result) {
      navigator.clipboard.writeText(result.temp_password)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div className="min-h-screen flex flex-col lg:flex-row font-sans bg-gradient-to-br from-slate-50 to-slate-100 dark:from-[#0F172A] dark:to-[#1E293B]">
      {/* Left Column */}
      <div className="hidden lg:flex lg:w-1/2 shadow-[10px_0_40px_rgba(0,0,0,0.1)] z-10">
        <LoginStatsPanel />
      </div>

      {/* Right Column */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 lg:p-12 relative">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-100/40 dark:from-blue-900/20 via-transparent to-transparent opacity-50 pointer-events-none" />
        <div className="w-full max-w-md relative z-10">
          <div className="bg-white dark:bg-[#1E293B] rounded-[2rem] border border-white dark:border-slate-600/50 shadow-[0_8px_40px_rgb(0,0,0,0.06)] dark:shadow-[0_8px_40px_rgb(0,0,0,0.3)] overflow-hidden ring-1 ring-slate-900/5 dark:ring-slate-700/50">
            <div className="px-10 pt-12 pb-6 text-center">
              <div className="flex justify-center mb-8">
                <Image src="/images/quantumrims-logo.svg" alt="QuantumRIMS logo" width={373} height={85} className="object-contain h-14 w-auto dark:brightness-110" priority />
              </div>
              <div className="flex justify-center mb-4">
                <div className="w-16 h-16 rounded-2xl bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700/50 flex items-center justify-center">
                  <KeyRound className="w-8 h-8 text-amber-600 dark:text-amber-400" />
                </div>
              </div>
              <h1 className="text-2xl font-bold text-slate-800 dark:text-slate-100">Reset Password</h1>
              <p className="text-slate-500 dark:text-slate-400 text-sm mt-1">Enter the staff Employee ID to generate a new temporary password</p>
            </div>

            <div className="px-10 pb-12 space-y-6">
              {error && (
                <div className="p-4 rounded-2xl bg-red-50 dark:bg-red-900/20 border border-red-100 dark:border-red-800/50 text-red-700 dark:text-red-400 text-sm font-medium">
                  {error}
                </div>
              )}

              {result ? (
                <div className="space-y-5">
                  {/* Success card */}
                  <div className="p-5 rounded-2xl bg-emerald-50 dark:bg-emerald-900/20 border border-emerald-200 dark:border-emerald-700/50">
                    <div className="flex items-center gap-3 mb-4">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 flex-shrink-0" />
                      <p className="font-bold text-emerald-700 dark:text-emerald-400 text-sm">Password Reset Successfully!</p>
                    </div>
                    <div className="space-y-1 text-sm">
                      <p className="text-slate-600 dark:text-slate-300"><span className="font-bold">Name:</span> {result.name}</p>
                      <p className="text-slate-600 dark:text-slate-300"><span className="font-bold">Department:</span> {result.dept}</p>
                    </div>
                  </div>

                  {/* Temp password */}
                  <div className="space-y-2">
                    <label className="block text-sm font-bold text-slate-700 dark:text-slate-300">Temporary Password</label>
                    <p className="text-xs text-slate-500 dark:text-slate-400">Share this with the staff member. Ask them to change it after logging in.</p>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 relative">
                        <input
                          type={showPass ? 'text' : 'password'}
                          readOnly
                          value={result.temp_password}
                          className="w-full px-5 py-4 pr-12 rounded-2xl border border-slate-200 dark:border-slate-600 bg-slate-50 dark:bg-slate-700/50 text-slate-900 dark:text-slate-100 font-mono text-sm focus:outline-none"
                        />
                        <button
                          type="button"
                          onClick={() => setShowPass(v => !v)}
                          className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                        >
                          {showPass ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                        </button>
                      </div>
                      <button
                        type="button"
                        onClick={copyPassword}
                        className={`flex-shrink-0 flex items-center gap-1.5 px-4 py-4 rounded-2xl font-bold text-sm transition-all ${copied ? 'bg-emerald-500 text-white' : 'bg-slate-100 dark:bg-slate-700 hover:bg-slate-200 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200'}`}
                      >
                        {copied ? <><Check className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy</>}
                      </button>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() => { setResult(null); setEmpId(''); setError('') }}
                    className="w-full flex items-center justify-center gap-2 py-3 px-6 rounded-2xl border-2 border-slate-200 dark:border-slate-600 text-slate-700 dark:text-slate-300 font-bold text-sm hover:border-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-all"
                  >
                    Reset Another Account
                  </button>
                </div>
              ) : (
                <form onSubmit={handleReset} className="space-y-5">
                  <div>
                    <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-2">Employee ID</label>
                    <input
                      id="reset-emp-id"
                      type="text"
                      required
                      value={empId}
                      onChange={(e) => setEmpId(e.target.value)}
                      className="w-full px-5 py-4 rounded-2xl border border-slate-200 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-700/50 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-4 focus:ring-amber-500/10 focus:border-amber-500 dark:focus:border-amber-400 focus:bg-white dark:focus:bg-slate-700 transition-all shadow-sm"
                      placeholder="e.g. SECETCS063"
                      autoComplete="off"
                    />
                  </div>

                  <button
                    id="reset-submit"
                    type="submit"
                    disabled={loading}
                    className="w-full flex items-center justify-center gap-2 py-4 px-6 rounded-2xl bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600 disabled:opacity-70 disabled:cursor-not-allowed text-white font-bold text-lg transition-all duration-300 mt-2 shadow-[0_4px_14px_0_rgba(245,158,11,0.35)] hover:shadow-[0_6px_20px_rgba(245,158,11,0.25)] hover:-translate-y-0.5"
                  >
                    {loading ? <><Loader2 className="w-5 h-5 animate-spin" /> Resetting...</> : <><KeyRound className="w-5 h-5" /> Generate Temporary Password</>}
                  </button>
                </form>
              )}

              <div className="pt-6 text-center border-t border-slate-100 dark:border-slate-700 mt-4">
                <Link href="/login" className="inline-flex items-center gap-1.5 text-sm text-slate-500 dark:text-slate-400 font-medium hover:text-[#0A3D8F] dark:hover:text-blue-400 transition-colors">
                  <ArrowLeft className="w-4 h-4" />
                  Back to Sign in
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
