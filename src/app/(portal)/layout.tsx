'use client'

import { useEffect, useState, useCallback } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { supabase } from '@/lib/supabase'
import { FacultyContext } from '@/context/FacultyContext'
import type { FacultyProfile } from '@/lib/types'
import { ThemeToggle } from '@/components/ThemeToggle'

import {
  LayoutDashboard,
  FileText,
  LogOut,
  Menu,
  X,
  Loader2,
  User,
  Wallet,
  FlaskConical,
  Briefcase,
  Megaphone,
  ChevronDown,
  FolderKanban
} from 'lucide-react'

const NAV_ITEMS = [
  { href: '/', label: 'Home', icon: LayoutDashboard, exact: true },
  { href: '/incentive', label: 'Incentive', icon: Wallet, exact: false },
  { href: '/seed-fund', label: 'Seed Fund', icon: FlaskConical, exact: false },
  { href: '/announcements', label: 'Announcements', icon: Megaphone, exact: false },
]

export default function PortalLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [faculty, setFaculty] = useState<FacultyProfile | null>(null)
  const [loading, setLoading] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [session, setSession] = useState<any>(null)
  const [unreadCount, setUnreadCount] = useState(0)

  useEffect(() => {
    let mounted = true
    const init = async () => {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.replace('/login'); return }
      setSession(session)
      const { data, error } = await supabase
        .from('master_faculty')
        .select('emp_id, name, dept, designation, type, user_id, is_registered')
        .eq('user_id', session.user.id)
        .single()
      if (error || !data) { await supabase.auth.signOut(); router.replace('/login'); return }
      
      // Fetch unread count
      try {
        const res = await fetch('/api/announcements', { headers: { Authorization: `Bearer ${session.access_token}` } })
        if (res.ok) {
          const { data: anns } = await res.json()
          if (anns && anns.length > 0) {
            const { data: readRow } = await supabase.from('announcement_reads').select('last_seen_at').eq('user_id', session.user.id).single()
            if (!readRow) setUnreadCount(anns.length)
            else {
              const lastSeen = new Date(readRow.last_seen_at)
              setUnreadCount(anns.filter((a: any) => new Date(a.created_at) > lastSeen).length)
            }
          }
        }
      } catch(e) {}

      if (mounted) { setFaculty(data as FacultyProfile); setLoading(false) }
    }
    init()
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) router.replace('/login')
    })
    return () => { mounted = false; subscription.unsubscribe() }
  }, [router])

  const handleLogout = useCallback(async () => {
    await supabase.auth.signOut()
    router.replace('/login')
  }, [router])

  const isActive = (item: (typeof NAV_ITEMS)[0]) =>
    item.exact ? pathname === item.href : pathname.startsWith(item.href)

  if (loading || !faculty) {
    return (
      <div className="min-h-screen bg-blue-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-16 h-16 rounded-2xl bg-white border border-slate-200 flex items-center justify-center mx-auto mb-4 shadow-xl">
            <Loader2 className="w-8 h-8 text-blue-600 animate-spin" />
          </div>
          <p className="text-slate-500 font-medium text-sm">Loading portal...</p>
        </div>
      </div>
    )
  }

  return (
    <FacultyContext.Provider value={{ faculty }}>
      <div className="min-h-screen bg-blue-50 flex flex-col font-sans">
        
        {/* Top Navbar */}
        <header className="bg-[#0A3D8F] text-white shadow-md sticky top-0 z-30">
          <div className="w-full mx-auto px-4 sm:px-8 h-[88px] flex items-center justify-between">
            
            {/* Left: Logo & Nav */}
            <div className="flex items-center gap-4 xl:gap-8 h-full">
              {/* Logo */}
              <Link href="/" className="flex items-center gap-3">
                <div className="bg-white rounded-lg p-1.5 inline-flex items-center justify-center">
                  <Image src="/images/quantumrims-logo.svg" alt="QuantumRIMS logo" width={373} height={85} className="h-11 w-auto object-contain" priority />
                </div>
              </Link>

              {/* Desktop Nav */}
              <nav className="hidden lg:flex items-center h-full space-x-0 xl:space-x-1">
                {NAV_ITEMS.slice(0, 1).map(item => {
                  const active = isActive(item)
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`relative flex items-center gap-1.5 xl:gap-2 px-2 xl:px-4 h-full text-xs xl:text-[13px] font-bold tracking-wide transition-colors ${
                        active 
                          ? 'text-[#FDB813]' 
                          : 'text-blue-100 hover:text-white'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {item.label}
                      {item.label === 'Announcements' && unreadCount > 0 && (
                        <span className="ml-1.5 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold shadow-sm">
                          {unreadCount}
                        </span>
                      )}
                      
                      {/* Active Indicator (Underline) */}
                      {active && (
                        <div className="absolute bottom-0 left-0 w-full h-[4px] bg-[#FDB813] rounded-t-full shadow-[0_-2px_10px_rgba(253,184,19,0.5)]" />
                      )}
                    </Link>
                  )
                })}


                {NAV_ITEMS.slice(1, 3).map(item => {
                  const active = isActive(item)
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`relative flex items-center gap-1.5 xl:gap-2 px-2 xl:px-4 h-full text-xs xl:text-[13px] font-bold tracking-wide transition-colors ${
                        active 
                          ? 'text-[#FDB813]' 
                          : 'text-blue-100 hover:text-white'
                      }`}
                    >
                      <Icon className="w-4 h-4" />
                      {item.label}
                      {item.label === 'Announcements' && unreadCount > 0 && (
                        <span className="ml-1.5 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold shadow-sm">
                          {unreadCount}
                        </span>
                      )}
                      
                      {/* Active Indicator (Underline) */}
                      {active && (
                        <div className="absolute bottom-0 left-0 w-full h-[4px] bg-[#FDB813] rounded-t-full shadow-[0_-2px_10px_rgba(253,184,19,0.5)]" />
                      )}
                    </Link>
                  )
                })}

                {/* Consultancy Dropdown (Desktop) */}
                <div className="relative group h-full flex items-center">
                  <button
                    className={`relative flex items-center gap-1.5 xl:gap-2 px-2 xl:px-4 h-full text-xs xl:text-[13px] font-bold tracking-wide transition-colors ${
                      pathname.startsWith('/consultancy') ? 'text-[#FDB813]' : 'text-blue-100 hover:text-white'
                    }`}
                  >
                    <Briefcase className="w-4 h-4" />
                    Consultancy
                    <ChevronDown className="w-3 h-3 ml-1 opacity-70 group-hover:opacity-100" />
                    {pathname.startsWith('/consultancy') && (
                      <div className="absolute bottom-0 left-0 w-full h-[4px] bg-[#FDB813] rounded-t-full shadow-[0_-2px_10px_rgba(253,184,19,0.5)]" />
                    )}
                  </button>

                  <div className="absolute top-full left-0 w-56 pt-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                    <div className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden py-2 flex flex-col">
                      <Link href="/consultancy"
                        className={`w-full flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-colors text-left ${
                          pathname === '/consultancy' ? 'text-[#0A3D8F] bg-blue-50' : 'text-slate-600 hover:bg-blue-50 hover:text-[#0A3D8F]'
                        }`}>
                        Apply for Consultancy
                      </Link>
                      <Link href="/consultancy/history"
                        className={`w-full flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-colors text-left ${
                          pathname === '/consultancy/history' ? 'text-[#0A3D8F] bg-blue-50' : 'text-slate-600 hover:bg-blue-50 hover:text-[#0A3D8F]'
                        }`}>
                        Submission History
                      </Link>
                    </div>
                  </div>
                </div>

                {/* Project Grants Dropdown (Desktop) */}
                <div className="relative group h-full flex items-center">
                  <button
                    className={`relative flex items-center gap-1.5 xl:gap-2 px-2 xl:px-4 h-full text-xs xl:text-[13px] font-bold tracking-wide transition-colors ${
                      pathname.startsWith('/project-grants') ? 'text-[#FDB813]' : 'text-blue-100 hover:text-white'
                    }`}
                  >
                    <FolderKanban className="w-4 h-4" />
                    Project Grants
                    <ChevronDown className="w-3 h-3 ml-1 opacity-70 group-hover:opacity-100" />
                    {pathname.startsWith('/project-grants') && (
                      <div className="absolute bottom-0 left-0 w-full h-[4px] bg-[#FDB813] rounded-t-full shadow-[0_-2px_10px_rgba(253,184,19,0.5)]" />
                    )}
                  </button>

                  <div className="absolute top-full left-0 w-56 pt-2 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 z-50">
                    <div className="bg-white rounded-xl shadow-xl border border-slate-200 overflow-hidden py-2 flex flex-col">
                      <Link href="/project-grants"
                        className={`w-full flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-colors text-left ${
                          pathname === '/project-grants' ? 'text-[#0A3D8F] bg-blue-50' : 'text-slate-600 hover:bg-blue-50 hover:text-[#0A3D8F]'
                        }`}>
                        Apply for Project Grant
                      </Link>
                      <Link href="/project-grants/history"
                        className={`w-full flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-colors text-left ${
                          pathname === '/project-grants/history' ? 'text-[#0A3D8F] bg-blue-50' : 'text-slate-600 hover:bg-blue-50 hover:text-[#0A3D8F]'
                        }`}>
                        Submission History
                      </Link>
                    </div>
                  </div>
                </div>

                {NAV_ITEMS.slice(3).map(item => {
                  const active = isActive(item)
                  const Icon = item.icon
                  const isAnnouncements = item.href === '/announcements'
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      title={isAnnouncements ? 'Announcements' : undefined}
                      className={`relative flex items-center gap-1.5 xl:gap-2 text-xs xl:text-[13px] font-bold tracking-wide transition-colors ${
                        !isAnnouncements ? 'h-full px-2 xl:px-4' : 'rounded-full p-2.5 justify-center'
                      } ${
                        active 
                          ? 'text-[#FDB813]' 
                          : 'text-blue-100 hover:text-white'
                      } ${isAnnouncements ? 'animate-announcement-glow' : ''}`}
                    >
                      <Icon className="w-4 h-4" />
                      {!isAnnouncements && <span>{item.label}</span>}
                      {item.label === 'Announcements' && unreadCount > 0 && (
                        <span className="ml-1.5 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold shadow-sm">
                          {unreadCount}
                        </span>
                      )}
                      
                      {/* Active Indicator (Underline) */}
                      {active && (
                        <div className="absolute bottom-0 left-0 w-full h-[4px] bg-[#FDB813] rounded-t-full shadow-[0_-2px_10px_rgba(253,184,19,0.5)]" />
                      )}
                    </Link>
                  )
                })}
              </nav>
            </div>

            {/* Right: User Profile & Actions */}
            <div className="flex items-center gap-3">

              <Link
                href="/profile"
                className={`hidden sm:flex items-center gap-3 rounded-full pl-2 pr-4 py-1.5 border transition-colors ${
                  pathname === '/profile'
                    ? 'bg-white/20 border-white/40'
                    : 'bg-white/10 border-white/20 hover:bg-white/20 hover:border-white/30'
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-white text-[#0A3D8F] flex items-center justify-center shadow-sm">
                  <span className="text-xs font-black">{faculty.name.charAt(0).toUpperCase()}</span>
                </div>
                <div className="flex flex-col justify-center">
                  <p className="text-xs font-bold leading-none mb-0.5">{faculty.name}</p>
                  <p className="text-[10px] text-blue-200 font-semibold leading-none">{faculty.dept}</p>
                </div>
              </Link>
              
              <ThemeToggle />

              <button 
                onClick={handleLogout}
                className="hidden sm:flex items-center gap-1.5 px-4 py-2 rounded-full text-sm font-bold bg-[#FDB813] text-[#0A3D8F] hover:bg-yellow-400 transition-colors shadow-sm"
              >
                <LogOut className="w-4 h-4" />
                <span>Logout</span>
              </button>

              {/* Mobile Menu Toggle */}
              <button 
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="lg:hidden p-2 rounded-lg bg-white/10 hover:bg-white/20 transition-colors text-white"
              >
                {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
              </button>
            </div>
          </div>
        </header>

        {/* Mobile Navigation Menu */}
        {mobileMenuOpen && (
          <div className="lg:hidden fixed inset-0 z-20 bg-slate-900/50 backdrop-blur-sm" onClick={() => setMobileMenuOpen(false)}>
            <div 
              className="absolute top-[88px] left-0 w-full bg-white shadow-2xl border-b border-slate-200" 
              onClick={e => e.stopPropagation()}
            >
              <nav className="flex flex-col p-4 space-y-2">
                {NAV_ITEMS.slice(0, 1).map(item => {
                  const active = isActive(item)
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-colors ${
                        active 
                          ? 'bg-[#0A3D8F] text-white' 
                          : 'text-slate-600 hover:bg-blue-50'
                      }`}
                    >
                      <Icon className={`w-5 h-5 ${active ? 'text-[#FDB813]' : 'text-slate-400'}`} />
                      {item.label}
                      {item.label === 'Announcements' && unreadCount > 0 && (
                        <span className="ml-2 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold shadow-sm">
                          {unreadCount} New
                        </span>
                      )}
                    </Link>
                  )
                })}

                <Link
                  href="/profile"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-colors ${
                    pathname.startsWith('/profile')
                      ? 'bg-[#0A3D8F] text-white' 
                      : 'text-slate-600 hover:bg-blue-50'
                  }`}
                >
                  <User className={`w-5 h-5 ${pathname.startsWith('/profile') ? 'text-[#FDB813]' : 'text-slate-400'}`} />
                  My Profile
                </Link>


                {NAV_ITEMS.slice(1, 3).map(item => {
                  const active = isActive(item)
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-3 px-4 py-3 rounded-xl font-bold text-sm transition-colors ${
                        active 
                          ? 'bg-[#0A3D8F] text-white' 
                          : 'text-slate-600 hover:bg-blue-50'
                      }`}
                    >
                      <Icon className={`w-5 h-5 ${active ? 'text-[#FDB813]' : 'text-slate-400'}`} />
                      {item.label}
                      {item.label === 'Announcements' && unreadCount > 0 && (
                        <span className="ml-2 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold shadow-sm">
                          {unreadCount} New
                        </span>
                      )}
                    </Link>
                  )
                })}

                <div className="px-4 py-2">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Consultancy</p>
                  <div className="flex flex-col gap-1 pl-2 border-l-2 border-slate-100">
                    <Link href="/consultancy" onClick={() => setMobileMenuOpen(false)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg font-bold text-sm transition-colors text-left ${
                        pathname === '/consultancy' ? 'text-[#0A3D8F] bg-blue-50' : 'text-slate-500 hover:text-slate-800 hover:bg-blue-50'
                      }`}>
                      Apply for Consultancy
                    </Link>
                    <Link href="/consultancy/history" onClick={() => setMobileMenuOpen(false)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg font-bold text-sm transition-colors text-left ${
                        pathname === '/consultancy/history' ? 'text-[#0A3D8F] bg-blue-50' : 'text-slate-500 hover:text-slate-800 hover:bg-blue-50'
                      }`}>
                      Submission History
                    </Link>
                  </div>
                </div>

                <div className="px-4 py-2">
                  <p className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Project Grants</p>
                  <div className="flex flex-col gap-1 pl-2 border-l-2 border-slate-100">
                    <Link href="/project-grants" onClick={() => setMobileMenuOpen(false)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg font-bold text-sm transition-colors text-left ${
                        pathname === '/project-grants' ? 'text-[#0A3D8F] bg-blue-50' : 'text-slate-500 hover:text-slate-800 hover:bg-blue-50'
                      }`}>
                      Apply for Project Grant
                    </Link>
                    <Link href="/project-grants/history" onClick={() => setMobileMenuOpen(false)}
                      className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg font-bold text-sm transition-colors text-left ${
                        pathname === '/project-grants/history' ? 'text-[#0A3D8F] bg-blue-50' : 'text-slate-500 hover:text-slate-800 hover:bg-blue-50'
                      }`}>
                      Submission History
                    </Link>
                  </div>
                </div>

                {NAV_ITEMS.slice(3).map(item => {
                  const active = isActive(item)
                  const Icon = item.icon
                  const isAnnouncements = item.href === '/announcements'
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setMobileMenuOpen(false)}
                      className={`flex items-center gap-3 px-4 py-3 font-bold text-sm transition-colors ${
                        active 
                          ? 'bg-[#0A3D8F] text-white' 
                          : 'text-slate-600 hover:bg-blue-50'
                      } ${isAnnouncements ? 'rounded-full animate-announcement-glow' : 'rounded-xl'}`}
                    >
                      <Icon className={`w-5 h-5 ${active ? 'text-[#FDB813]' : 'text-slate-400'}`} />
                      {item.label}
                      {item.label === 'Announcements' && unreadCount > 0 && (
                        <span className="ml-2 bg-red-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold shadow-sm">
                          {unreadCount} New
                        </span>
                      )}
                    </Link>
                  )
                })}
                <div className="pt-4 mt-2 border-t border-slate-100 flex flex-col gap-4">
                  <Link href="/profile" onClick={() => setMobileMenuOpen(false)} className="flex items-center gap-3 px-4 hover:bg-slate-50 py-2 rounded-xl transition-colors">
                     <div className="w-10 h-10 rounded-full bg-[#0A3D8F] text-white flex items-center justify-center shadow-sm">
                      <span className="text-sm font-black">{faculty.name.charAt(0).toUpperCase()}</span>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-800">{faculty.name}</p>
                      <p className="text-xs text-slate-500 font-semibold">{faculty.dept}</p>
                    </div>
                  </Link>
                  <button 
                    onClick={handleLogout}
                    className="flex items-center justify-center gap-2 w-full px-4 py-3 rounded-xl font-bold bg-red-50 text-red-600 hover:bg-red-100"
                  >
                    <LogOut className="w-5 h-5" />
                    Secure Logout
                  </button>
                </div>
              </nav>
            </div>
          </div>
        )}

        {/* Main Content */}
        <main className="flex-1 w-full w-full mx-auto pb-16">
          {children}
        </main>


      </div>
    </FacultyContext.Provider>
  )
}
