'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import {
  LogOut, Menu, X, BarChart3, FileText, IndianRupee, FlaskConical,
  ChevronDown, Briefcase, FolderKanban, Megaphone, Loader2, UserCog
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { AdminAuthContext } from '@/context/AdminAuthContext'
import type { Session } from '@supabase/supabase-js'
import ChatWidget from '@/components/ChatWidget'
import { ThemeToggle } from '@/components/ThemeToggle'


const ADMIN_NAV = [
  { href: '/admin/incentive', label: 'Incentive Applications', icon: IndianRupee },
  { 
    href: '/admin/seed-fund', 
    label: 'Seed Fund', 
    icon: FlaskConical,
    dropdown: [
      { href: '/admin/seed-fund/applications', label: 'Applications' },
      { href: '/admin/seed-fund/ppts', label: 'PPT Submissions' },
      { href: '/admin/seed-fund/project-docs', label: 'Final Project Documents' },
    ]
  },
  { href: '/admin/consultancy', label: 'Consultancy', icon: Briefcase },
  { href: '/admin/project-grants', label: 'Project Grants', icon: FolderKanban },
  { href: '/admin/reports', label: 'Reports', icon: BarChart3 },
  { href: '/admin/announcements', label: 'Announcements', icon: Megaphone, isRound: true },
]

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // Login page bypasses the whole layout — no nav, no auth redirect
  const isLoginPage = pathname === '/login'

  useEffect(() => {
    if (isLoginPage) { setLoading(false); return }

    let mounted = true
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!mounted) return
      if (!session) { router.replace('/login'); return }
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      if (!sess && !isLoginPage) router.replace('/login')
      else setSession(sess)
    })

    return () => { mounted = false; subscription.unsubscribe() }
  }, [router, isLoginPage])

  const handleLogout = useCallback(async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }) } catch {}
    await supabase.auth.signOut()
    router.replace('/login')
  }, [router])

  const isActive = (href: string) =>
    href === '/admin' ? pathname === '/admin' : pathname.startsWith(href)

  // Login page: render children directly, no nav, no auth gate
  if (isLoginPage) {
    return <>{children}</>
  }

  // Auth loading spinner
  if (loading) {
    return (
      <div className="min-h-screen bg-blue-50 dark:bg-[#0F172A] flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-600 flex items-center justify-center mx-auto mb-4 shadow-xl">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          </div>
          <p className="text-slate-500 dark:text-slate-400 font-medium text-sm">Loading admin portal...</p>
        </div>
      </div>
    )
  }

  const token = session?.access_token ?? null

  return (
    <AdminAuthContext.Provider value={{ session, token, loading }}>
      <div className="min-h-screen bg-blue-50 dark:bg-[#0F172A] flex flex-col font-sans">
        {/* ─── Persistent Admin Nav ─── */}
        <header className="bg-[#0A3D8F] text-white shadow-md sticky top-0 z-30">
          <div className="w-full mx-auto px-4 sm:px-8 h-[88px] flex items-center justify-between">
            {/* Left: Logo + Nav */}
            <div className="flex items-center gap-8 h-full">
              <Link href="/admin/analytics" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
                <div className="bg-white rounded-lg p-1.5 inline-flex items-center justify-center shadow-sm">
                  <Image src="/images/quantumrims-logo.svg" alt="QuantumRIMS logo" width={373} height={85} className="h-11 w-auto object-contain" priority />
                </div>
                <p className="text-xs font-bold text-blue-100 uppercase tracking-widest hidden sm:block hover:text-white transition-colors">Admin Portal</p>
              </Link>

              {/* Desktop Nav */}
              <nav className="hidden lg:flex items-center h-full space-x-1">
                {ADMIN_NAV.map(item => {
                  const active = isActive(item.href)
                  const Icon = item.icon
                  
                  if (item.dropdown) {
                    return (
                      <div key={item.href} className="relative group h-full flex items-center">
                        <button className={`relative flex items-center gap-2 px-4 h-full text-[13px] font-bold tracking-wide transition-colors ${
                          active ? 'text-[#FDB813]' : 'text-blue-100 hover:text-white'
                        }`}>
                          <Icon className="w-4 h-4" /> {item.label}
                          <ChevronDown className="w-3 h-3 ml-1 opacity-70 group-hover:opacity-100" />
                          {active && <div className="absolute bottom-0 left-0 w-full h-[4px] bg-[#FDB813] rounded-t-full shadow-[0_-2px_10px_rgba(253,184,19,0.5)]" />}
                        </button>
                        <div className="absolute top-full left-0 w-56 pt-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                          <div className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden py-2 flex flex-col">
                            {item.dropdown.map(dropItem => (
                              <Link key={dropItem.label} href={dropItem.href} className="w-full flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-colors text-left text-slate-600 hover:bg-blue-50 hover:text-[#0A3D8F]">
                                {dropItem.label}
                              </Link>
                            ))}
                          </div>
                        </div>
                      </div>
                    )
                  }

                  if (item.isRound) {
                    return (
                      <Link key={item.href} href={item.href} className={`relative flex items-center justify-center w-10 h-10 rounded-full text-[13px] font-bold tracking-wide transition-colors animate-announcement-glow ${
                        active ? 'text-[#FDB813]' : 'text-blue-100 hover:text-white'
                      }`}>
                        <Icon className="w-5 h-5" />
                      </Link>
                    )
                  }

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`relative flex items-center gap-2 px-4 h-full text-[13px] font-bold tracking-wide transition-colors ${
                        active ? 'text-[#FDB813]' : 'text-blue-100 hover:text-white'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {item.label}
                      {active && <div className="absolute bottom-0 left-0 w-full h-[4px] bg-[#FDB813] rounded-t-full shadow-[0_-2px_10px_rgba(253,184,19,0.5)]" />}
                    </Link>
                  )
                })}
              </nav>
            </div>

            {/* Right: Profile chip + Logout + Mobile Toggle */}
            <div className="flex items-center gap-4">
              {/* Admin profile chip */}
              <div className="hidden sm:flex items-center gap-3 bg-white/10 border border-white/20 rounded-full pl-2 pr-4 py-1.5">
                <div className="w-8 h-8 rounded-full bg-white text-[#0A3D8F] flex items-center justify-center shadow-sm">
                  <span className="text-xs font-black">A</span>
                </div>
                <div className="flex flex-col justify-center">
                  <p className="text-xs font-bold leading-none mb-0.5 text-white">Admin</p>
                  <p className="text-[10px] text-blue-200 font-semibold leading-none">Research Portal</p>
                </div>
              </div>
              <ThemeToggle />
              <button
                onClick={handleLogout}
                className="hidden sm:flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold bg-[#FDB813] text-[#0A3D8F] hover:bg-yellow-400 transition-colors shadow-sm"
              >
                <LogOut className="w-4 h-4" /> Logout
              </button>
              <button
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-white"
              >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </header>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden fixed inset-0 z-20 bg-slate-900/50 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)}>
            <div className="absolute top-[88px] left-0 w-full bg-white shadow-2xl border-b border-slate-200" onClick={e => e.stopPropagation()}>
              <nav className="flex flex-col p-4 space-y-2 overflow-y-auto max-h-[calc(100vh-88px)]">
                {ADMIN_NAV.map(item => {
                  const active = isActive(item.href)
                  const Icon = item.icon
                  
                  if (item.dropdown) {
                    return (
                      <div key={item.href} className="flex flex-col space-y-1">
                        <div className={`flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-colors ${active ? 'bg-[#0A3D8F] text-white' : 'text-slate-600'}`}>
                          <Icon className={`w-5 h-5 ${active ? 'text-[#FDB813]' : 'text-slate-400'}`} />
                          {item.label}
                        </div>
                        <div className="flex flex-col pl-12 space-y-1 border-l-2 border-slate-100 ml-6 pb-2">
                           {item.dropdown.map(dropItem => (
                             <Link key={dropItem.label} href={dropItem.href} onClick={() => setMobileMenuOpen(false)} className="py-2 text-sm text-slate-500 font-semibold hover:text-[#0A3D8F]">
                               {dropItem.label}
                             </Link>
                           ))}
                        </div>
                      </div>
                    )
                  }

                  return (
                    <Link key={item.href} href={item.href} onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-colors ${active ? 'bg-[#0A3D8F] text-white' : 'text-slate-600 hover:bg-blue-50'}`}
                    >
                      <Icon className={`w-5 h-5 ${active ? 'text-[#FDB813]' : 'text-slate-400'}`} />
                      {item.label}
                    </Link>
                  )
                })}
                <div className="pt-4 mt-2 border-t border-slate-100">
                  <button onClick={handleLogout} className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl font-bold bg-red-50 text-red-600 hover:bg-red-100">
                    <LogOut className="w-5 h-5" /> Secure Logout
                  </button>
                </div>
              </nav>
            </div>
          </div>
        )}

        {/* Page Content */}
        <main className="flex-1 w-full">
          {children}
        </main>

        <ChatWidget endpoint="/api/chat/admin" title="Admin Assistant" />
      </div>
    </AdminAuthContext.Provider>
  )
}
