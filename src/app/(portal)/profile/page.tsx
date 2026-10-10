'use client'

import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { checkIncentiveEligibility } from '@/lib/incentiveEligibility'
import { useFaculty } from '@/context/FacultyContext'
import {
  User, FileText, Wallet, FlaskConical, TrendingUp, GraduationCap,
  CheckCircle2, AlertCircle, Loader2, Edit3, X, Target, Trophy,
  BookOpen, Award, Banknote, Briefcase, FolderKanban, ChevronDown, ChevronUp, ExternalLink
} from 'lucide-react'
import Link from 'next/link'

const DEPARTMENTS = [
  "CSE", "IT", "AIDS", "CSBS", "ECE", "EEE", "MECH",
  "CYS", "MCT", "S&H", "MBA"
]
const DESIGNATIONS = [
  "Assistant Professor",
  "Associate Professor",
  "Professor"
]

const steps = [
  { n: '01', title: 'Submit Paper', desc: 'Fill in all publication details from your Scopus record.' },
  { n: '02', title: 'Upload Proofs', desc: 'Attach full paper PDF, Scopus screenshot, and published proof.' },
  { n: '03', title: 'Await Approval', desc: 'Admin reviews your submission — usually within 2–3 working days.' },
  { n: '04', title: 'Apply for Incentive', desc: 'Once approved, apply for your financial incentive from the Incentive module.' },
]

const seedFundSteps = [
  { n: '01', title: 'Fill Application', desc: 'Provide Screening and Requisition details.' },
  { n: '02', title: 'Upload Docs', desc: 'Attach Screening/Requisition forms and Project Proposal.' },
  { n: '03', title: 'Await Approval', desc: 'Admin reviews your application.' },
  { n: '04', title: 'Submit PPT', desc: 'Once approved, submit your presentation.' },
  { n: '05', title: 'Final Docs', desc: 'After presentation approval, upload project docs.' },
]

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    approved: 'bg-green-100 text-green-700',
    pending: 'bg-yellow-100 text-yellow-700',
    rejected: 'bg-red-100 text-red-700',
    granted: 'bg-blue-100 text-blue-700',
    published: 'bg-indigo-100 text-indigo-700',
  }
  const cls = map[(status || '').toLowerCase()] || 'bg-slate-100 text-slate-600'
  return (
    <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold capitalize ${cls}`}>
      {status || '—'}
    </span>
  )
}

function HistorySection({
  icon: Icon,
  title,
  count,
  color,
  children,
  defaultOpen = false,
}: {
  icon: any
  title: string
  count: number
  color: string
  children: React.ReactNode
  defaultOpen?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className="bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden animate-slide-up">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full px-8 py-5 border-b border-slate-100 flex items-center justify-between gap-4 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shadow-md ${color}`}>
            <Icon className="w-6 h-6 text-white" />
          </div>
          <div className="text-left">
            <h2 className="font-black text-slate-800 text-lg">{title}</h2>
            <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-0.5">
              {count} record{count !== 1 ? 's' : ''} found
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className={`text-2xl font-black ${color.replace('bg-', 'text-').split(' ')[0]}`}>{count}</span>
          {open ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
        </div>
      </button>

      {open && (
        <div className="p-6">
          {count === 0 ? (
            <div className="text-center py-10 text-slate-400">
              <div className="w-14 h-14 mx-auto mb-3 rounded-full bg-slate-100 flex items-center justify-center">
                <Icon className="w-7 h-7 text-slate-300" />
              </div>
              <p className="font-semibold text-sm">No records found yet</p>
            </div>
          ) : (
            children
          )}
        </div>
      )}
    </div>
  )
}

export default function ProfilePage() {
  const faculty = useFaculty()
  const [stats, setStats] = useState({ papers: '-', incentives: '-', projects: '-' })
  const [profileReq, setProfileReq] = useState<any>(null)
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', designation: '', dept: '', type: '' })
  const [submittingProfile, setSubmittingProfile] = useState(false)
  const [targetData, setTargetData] = useState<any>(null)
  const [targetLoading, setTargetLoading] = useState(true)
  const [cutoffYear, setCutoffYear] = useState<number | undefined>(undefined)
  const [history, setHistory] = useState<any>(null)
  const [historyLoading, setHistoryLoading] = useState(true)

  useEffect(() => {
    async function fetchStats() {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      try {
        const { count: paperCount } = await supabase
          .from('submissions')
          .select('*', { count: 'exact', head: true })
          .eq('submitted_by', session.user.id)
          .eq('status', 'approved')

        const { data: incData } = await supabase
          .from('incentive_applications')
          .select('calculated_amount')
          .eq('applicant_id', session.user.id)
          .eq('status', 'approved')

        const incSum = incData?.reduce((sum, item) => sum + (Number(item.calculated_amount) || 0), 0) || 0
        const formatIndianCurrency = (num: number) => {
          if (num >= 100000) return `₹${(num / 100000).toFixed(1)}L`
          return `₹${num.toLocaleString('en-IN')}`
        }
        const formattedInc = formatIndianCurrency(incSum)

        const { count: seedCount } = await supabase
          .from('seed_fund_applications')
          .select('*', { count: 'exact', head: true })
          .eq('applicant_id', session.user.id)

        setStats({
          papers: `${paperCount || 0}`,
          incentives: formattedInc,
          projects: `${seedCount || 0}`
        })

        const { data: reqData } = await supabase
          .from('profile_edit_requests')
          .select('*')
          .eq('applicant_id', session.user.id)
          .order('created_at', { ascending: false })
          .limit(1)
          .maybeSingle()

        if (reqData) setProfileReq(reqData)

        // Fetch publication target
        fetch('/api/profile/publication-target?academic_year=2026')
          .then(res => res.json())
          .then(data => {
            if (!data.error) setTargetData(data)
            setTargetLoading(false)
          })
          .catch(() => setTargetLoading(false))

        // Fetch history using emp_id
        if (faculty.emp_id) {
          fetch(`/api/profile/history?emp_id=${faculty.emp_id}`, {
            headers: { Authorization: `Bearer ${session.access_token}` }
          })
            .then(res => res.json())
                        .then(data => {
              if (!data.error) {
                setHistory(data)
                if (data.cutoff_year) setCutoffYear(data.cutoff_year)
              }
              setHistoryLoading(false)
            })
            .catch(() => setHistoryLoading(false))
        } else {
          setHistoryLoading(false)
        }

      } catch (err) {
        console.error('Failed to fetch dashboard stats', err)
      }
    }
    fetchStats()
  }, [faculty.emp_id])

  const modules = [
    {
      href: '/incentive',
      icon: Wallet,
      title: 'Incentive Application',
      description: 'Apply for financial incentives on your approved SCI, ESCI, Conference, Book, Patent or Citation publications.',
      buttonText: 'Apply for incentive →',
      stat: stats.incentives,
      statLabel: 'EARNED',
    },
    {
      href: '/seed-fund',
      icon: FlaskConical,
      title: 'Seed Fund Application',
      description: 'Apply for research seed funding — from initial screening through final project documentation.',
      buttonText: 'Open Seed Fund →',
      stat: stats.projects,
      statLabel: 'TOTAL PROJECTS',
    },
  ]

  const handleOpenEdit = () => {
    setEditForm({
      name: faculty.name,
      designation: faculty.designation,
      dept: faculty.dept,
      type: faculty.type || ''
    })
    setIsEditing(true)
  }

  const handleProfileSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSubmittingProfile(true)
    try {
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return

      const payload: any = {}
      if (editForm.name !== faculty.name) payload.requested_name = editForm.name
      if (editForm.designation !== faculty.designation) payload.requested_designation = editForm.designation
      if (editForm.dept !== faculty.dept) payload.requested_dept = editForm.dept
      if (editForm.type !== faculty.type) payload.requested_type = editForm.type

      const res = await fetch('/api/profile/edit-request', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${session.access_token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      if (res.ok) {
        const data = await res.json()
        setProfileReq(data)
        setIsEditing(false)
      } else {
        const err = await res.json()
        alert(err.error || 'Failed to submit request')
      }
    } catch (err) {
      alert('Failed to submit request')
    } finally {
      setSubmittingProfile(false)
    }
  }

  const showPhdToggle = faculty.type === 'Doing Ph.D in SECE' || faculty.type === 'Doing Ph.D in Other Institute'
  const hasChanges = editForm.name !== faculty.name || editForm.designation !== faculty.designation || editForm.dept !== faculty.dept || editForm.type !== faculty.type

  const docTypeColor: Record<string, string> = {
    'SCI': 'bg-purple-100 text-purple-700',
    'Scopus/WoS Journals': 'bg-blue-100 text-blue-700',
    'Scopus/WoS Conference/Book Chapter/Others': 'bg-cyan-100 text-cyan-700',
    'Student Publication': 'bg-amber-100 text-amber-700',
  }

  return (
    <div className="bg-blue-50 min-h-full pb-16 selection:bg-indigo-500/30">
      <div className="relative overflow-hidden pt-12 pb-16 px-6 sm:px-12 shadow-inner"
        style={{ background: 'linear-gradient(135deg, #1d4ed8 0%, #1e40af 50%, #1e3a8a 100%)' }}>

        {/* Dynamic Animated Orbs */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden z-0 opacity-60">
          <div className="absolute top-[20%] right-[10%] w-[40%] h-[40%] bg-indigo-500/40 mix-blend-screen filter blur-[80px] animate-blob" />
          <div className="absolute bottom-[-10%] left-[10%] w-[50%] h-[50%] bg-cyan-500/30 mix-blend-screen filter blur-[80px] animate-blob animation-delay-2000" />
          <div className="absolute inset-0 bg-slate-900/30 backdrop-blur-[1px]" />
          <div className="absolute inset-0" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />
        </div>

        <div className="relative z-10 w-full mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 border border-white/20 text-white text-xs font-bold tracking-widest uppercase mb-6 backdrop-blur-md shadow-lg shadow-black/10 animate-fade-in">
            <User className="w-4 h-4 text-cyan-300 drop-shadow-md" /> My Profile
          </div>
          <h1 className="text-4xl sm:text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-white via-indigo-100 to-cyan-200 tracking-tight leading-tight animate-slide-up" style={{ animationDelay: '0.1s' }}>
            {faculty.name}
          </h1>
          <p className="text-indigo-200 mt-4 font-medium text-sm flex items-center justify-center gap-2 max-w-xl mx-auto animate-slide-up" style={{ animationDelay: '0.2s' }}>
            <span>{faculty.designation}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            <span>{faculty.dept}</span>
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
            <span className="font-mono bg-white/10 px-2 py-0.5 rounded">{faculty.emp_id}</span>
          </p>

          <div className="mt-8 flex items-center justify-center animate-slide-up" style={{ animationDelay: '0.3s' }}>
            {profileReq?.status === 'pending' ? (
              <div className="inline-flex items-center gap-2 px-5 py-2.5 bg-white/10 border border-white/20 text-white rounded-full text-sm font-medium backdrop-blur-md">
                <Loader2 className="w-4 h-4 animate-spin text-cyan-300" />
                Profile edit request pending approval
              </div>
            ) : (
              <button onClick={handleOpenEdit} className="inline-flex items-center gap-2 px-6 py-2.5 bg-white text-indigo-900 rounded-full text-sm font-bold shadow-lg hover:shadow-xl hover:bg-blue-50 transition-all group">
                <Edit3 className="w-4 h-4 group-hover:scale-110 transition-transform" />
                {profileReq?.status === 'rejected' ? 'Review Rejected Request' : 'Edit Profile'}
              </button>
            )}
          </div>
        </div>
      </div>

      {isEditing && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/40 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
            <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-slate-50/50">
              <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2">
                <Edit3 className="w-5 h-5 text-indigo-500" /> Edit Profile Request
              </h2>
              <button onClick={() => setIsEditing(false)} className="p-2 rounded-full hover:bg-slate-200 text-slate-500 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleProfileSubmit} className="p-6">
              {profileReq?.status === 'rejected' && (
                <div className="mb-6 p-4 bg-red-50 text-red-700 rounded-2xl text-sm border border-red-100 flex gap-3 items-start">
                  <AlertCircle className="w-5 h-5 shrink-0 text-red-500 mt-0.5" />
                  <div>
                    <p className="font-bold mb-1 text-red-800">Previous Request Rejected</p>
                    <p>{profileReq.rejection_remark}</p>
                  </div>
                </div>
              )}

              <div className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Full Name</label>
                  <input type="text" value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all" required />
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Designation</label>
                  <select value={editForm.designation} onChange={e => setEditForm({ ...editForm, designation: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all bg-white" required>
                    {DESIGNATIONS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-500 uppercase tracking-wider mb-2">Department</label>
                  <select value={editForm.dept} onChange={e => setEditForm({ ...editForm, dept: e.target.value })} className="w-full px-4 py-3 rounded-xl border border-slate-200 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 outline-none transition-all bg-white" required>
                    {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
                  </select>
                </div>

                {showPhdToggle && (
                  <div className="pt-2">
                    <label className="flex items-center gap-3 p-4 border border-slate-200 rounded-xl cursor-pointer hover:border-indigo-300 transition-colors bg-slate-50/50">
                      <input
                        type="checkbox"
                        checked={editForm.type === 'Doctorate'}
                        onChange={e => setEditForm({ ...editForm, type: e.target.checked ? 'Doctorate' : (faculty.type || '') })}
                        className="w-5 h-5 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                      />
                      <div>
                        <span className="block font-bold text-slate-800 text-sm">I have completed my PhD</span>
                        <span className="block text-xs text-slate-500 mt-0.5">Request update to Doctorate status</span>
                      </div>
                    </label>
                  </div>
                )}
              </div>

              <div className="mt-8 flex gap-3">
                <button type="button" onClick={() => setIsEditing(false)} className="flex-1 px-4 py-3 rounded-xl font-bold text-slate-600 bg-slate-100 hover:bg-slate-200 transition-colors">
                  Cancel
                </button>
                <button type="submit" disabled={!hasChanges || submittingProfile} className="flex-1 px-4 py-3 rounded-xl font-bold text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2 shadow-lg shadow-indigo-200">
                  {submittingProfile ? <Loader2 className="w-5 h-5 animate-spin" /> : <CheckCircle2 className="w-5 h-5" />}
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <div className="relative z-20 w-full mx-auto px-4 sm:px-6 pt-10">

        {/* Target Banner */}
        {!targetLoading && targetData && !targetData.no_target && (
          <div className="mb-8 bg-white rounded-3xl border border-slate-200 shadow-sm overflow-hidden animate-slide-up">
            <div className="px-8 py-6 border-b border-slate-100 bg-gradient-to-r from-blue-50 to-indigo-50 flex items-center justify-between gap-4 flex-wrap">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-2xl bg-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20">
                  <Target className="w-6 h-6 text-white" />
                </div>
                <div>
                  <h2 className="font-black text-slate-800 text-lg">Publication Target ({targetData.target.academic_year})</h2>
                  <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-1">Track your annual research goals</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {targetData.met_target ? (
                  <div className="flex items-center gap-2 px-4 py-2 bg-green-100 text-green-800 rounded-full font-bold text-sm">
                    <Trophy className="w-4 h-4" /> Target Achieved!
                  </div>
                ) : (
                  <div className="flex items-center gap-2 px-4 py-2 bg-blue-100 text-blue-800 rounded-full font-bold text-sm">
                    <TrendingUp className="w-4 h-4" /> In Progress
                  </div>
                )}
              </div>
            </div>

            <div className="p-8 grid grid-cols-1 md:grid-cols-4 gap-6">
              {[
                { label: 'SCI / SCIE', t: targetData.target.sci_target, a: targetData.achievement.sci_achieved },
                { label: 'Scopus/WoS Journals', t: targetData.target.scopus_journal_target, a: targetData.achievement.scopus_journal_achieved },
                { label: 'Scopus/WoS Conference', t: targetData.target.scopus_conference_target, a: targetData.achievement.scopus_conference_achieved },
                { label: 'Total Target', t: targetData.target.total_target, a: targetData.achievement.total_achieved, isTotal: true },
              ].map((m, i) => (
                <div key={i} className={`p-4 rounded-2xl ${m.isTotal ? 'bg-indigo-50 border border-indigo-100' : 'bg-slate-50 border border-slate-100'}`}>
                  <div className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">{m.label}</div>
                  <div className="flex items-end gap-2">
                    <span className={`text-4xl font-black ${m.a >= m.t && m.t > 0 ? 'text-green-600' : 'text-slate-800'}`}>
                      {m.a}
                    </span>
                    <span className="text-xl text-slate-400 font-medium mb-1">/ {m.t}</span>
                  </div>
                  {m.a >= m.t && m.t > 0 && <div className="text-xs font-bold text-green-600 mt-2">Met Target</div>}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action Modules */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-12">
          {modules.map((mod, i) => {
            const Icon = mod.icon
            return (
              <div
                key={mod.href}
                className="group bg-gradient-to-br from-[var(--brand-blue-start)] to-[var(--brand-blue-end)] rounded-2xl p-6 lg:p-8 text-white flex flex-col h-full hover:-translate-y-1 transition-transform duration-300 shadow-md hover:shadow-xl animate-slide-up"
                style={{ animationDelay: `${0.1 + i * 0.1}s` }}
              >
                <div className="flex justify-between items-start mb-8">
                  <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center backdrop-blur-md border border-white/10 group-hover:bg-white/20 transition-colors duration-300">
                    <Icon className="w-6 h-6 text-[var(--brand-yellow)] drop-shadow-sm" />
                  </div>
                  <div className="text-right">
                    <div className="text-3xl lg:text-4xl font-black tracking-tight">{mod.stat}</div>
                    <div className="text-[10px] lg:text-xs uppercase tracking-widest text-blue-200/90 font-bold mt-1">{mod.statLabel}</div>
                  </div>
                </div>

                <div className="flex-grow">
                  <h3 className="text-xl lg:text-2xl font-bold mb-3">{mod.title}</h3>
                  <p className="text-blue-100/90 text-sm leading-relaxed mb-8 pr-2">
                    {mod.description}
                  </p>
                </div>

                <div className="mt-auto">
                  <Link href={mod.href} className="inline-flex items-center justify-center gap-2 bg-[var(--brand-yellow)] hover:bg-[#eab308] text-[var(--brand-yellow-text)] font-bold text-sm px-6 py-2.5 rounded-full transition-colors shadow-sm">
                    {mod.buttonText}
                  </Link>
                </div>
              </div>
            )
          })}
        </div>

        {/* ── Research History Section ─────────────────────────────────── */}
        <div className="mb-6 flex items-center gap-3">
          <div className="flex-1 h-px bg-slate-200" />
          <span className="text-xs font-black text-slate-400 uppercase tracking-widest px-2">Research History</span>
          <div className="flex-1 h-px bg-slate-200" />
        </div>

        {historyLoading ? (
          <div className="flex items-center justify-center py-16 gap-3 text-slate-400">
            <Loader2 className="w-6 h-6 animate-spin" />
            <span className="font-semibold text-sm">Loading your research history...</span>
          </div>
        ) : !faculty.emp_id ? (
          <div className="bg-amber-50 border border-amber-200 rounded-2xl p-6 text-amber-700 font-semibold text-sm text-center mb-8">
            Your Employee ID has not been assigned yet. History will appear once your profile is linked by the admin.
          </div>
        ) : (
          <div className="space-y-4 mb-12">

            {/* Publications History */}
            <HistorySection
              icon={BookOpen}
              title="Publication History"
              count={history?.publications?.length || 0}
              color="bg-indigo-600"
              defaultOpen={true}
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">#</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Title</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Journal / Source</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Year</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Type</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">DOI</th>
                      <th className="text-right py-2 px-3 text-xs font-bold text-slate-400 uppercase">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {history?.publications?.map((pub: any, i: number) => (
                      <tr key={pub.id} className="hover:bg-blue-50 transition-colors">
                        <td className="py-3 px-3 text-slate-400 font-medium">{i + 1}</td>
                        <td className="py-3 px-3 font-medium text-slate-800 max-w-xs">
                          <div className="line-clamp-2 leading-snug">{pub.title || '—'}</div>
                        </td>
                        <td className="py-3 px-3 text-slate-600 max-w-[180px]">
                          <div className="line-clamp-2 text-xs">{pub.source_title || '—'}</div>
                        </td>
                        <td className="py-3 px-3 text-slate-700 font-bold">{pub.year || '—'}</td>
                        <td className="py-3 px-3">
                          <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${docTypeColor[pub.document_type_report] || 'bg-slate-100 text-slate-500'}`}>
                            {pub.document_type_report || '—'}
                          </span>
                        </td>
                        <td className="py-3 px-3">
                          {pub.doi ? (
                            <a href={`https://doi.org/${pub.doi}`} target="_blank" rel="noreferrer"
                              className="text-blue-500 hover:text-blue-700 flex items-center gap-1 text-xs font-mono">
                              <ExternalLink className="w-3 h-3" />
                              {pub.doi.substring(0, 20)}{pub.doi.length > 20 ? '…' : ''}
                            </a>
                          ) : <span className="text-slate-300">—</span>}
                        </td>
                                                <td className="py-3 px-3 text-right">
                          {(() => {
                            const existingApp = history?.incentives?.find((app: any) => 
                              (pub.doi && app.submissions?.doi === pub.doi) || 
                              (pub.title && app.submissions?.title === pub.title) ||
                              (pub._source === 'live' && app.submissions?.id === pub.id)
                            )
                            const hasPendingOrApprovedApp = existingApp && ['pending', 'approved'].includes(existingApp.status)
                            const existingStatus = existingApp ? existingApp.status : null

                            const { eligible, reason } = checkIncentiveEligibility(pub, cutoffYear, hasPendingOrApprovedApp)

                            if (hasPendingOrApprovedApp) {
                              return <StatusBadge status={existingStatus} />
                            }

                            if (!eligible) {
                              return (
                                <div className="group relative inline-block text-right">
                                  <button disabled className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-100 text-slate-400 rounded-lg text-xs font-bold cursor-not-allowed whitespace-nowrap">
                                    <Wallet className="w-3.5 h-3.5 opacity-50" /> Apply Incentive
                                  </button>
                                  <div className="absolute hidden group-hover:block bottom-full right-0 mb-2 w-48 p-2 bg-slate-800 text-white text-[10px] rounded shadow-xl z-10 whitespace-normal text-left">
                                    {reason}
                                  </div>
                                  <div className="block sm:hidden text-[10px] text-red-500 mt-1 whitespace-normal">
                                    {reason}
                                  </div>
                                </div>
                              )
                            }

                            return (
                              <Link href={`/incentive/apply?${pub._source === 'live' ? 'submission' : 'publication'}=${pub.id}`} className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 rounded-lg text-xs font-bold transition-colors whitespace-nowrap">
                                <Wallet className="w-3.5 h-3.5" /> Apply Incentive
                              </Link>
                            )
                          })()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </HistorySection>

            {/* Patents History */}
            <HistorySection
              icon={Award}
              title="Patent History"
              count={history?.patents?.length || 0}
              color="bg-purple-600"
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">#</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Title</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Application No.</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Status</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Filed Date</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Dept</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {history?.patents?.map((pat: any, i: number) => (
                      <tr key={pat.id} className="hover:bg-purple-50 transition-colors">
                        <td className="py-3 px-3 text-slate-400 font-medium">{i + 1}</td>
                        <td className="py-3 px-3 font-medium text-slate-800 max-w-xs">
                          <div className="line-clamp-2 leading-snug">{pat.title || '—'}</div>
                        </td>
                        <td className="py-3 px-3 font-mono text-xs text-slate-600">{pat.publication_or_grant_number || '—'}</td>
                        <td className="py-3 px-3"><StatusBadge status={pat.status} /></td>
                        <td className="py-3 px-3 text-slate-600 text-xs">
                          {pat.filed_date ? new Date(pat.filed_date).toLocaleDateString('en-IN') : '—'}
                        </td>
                        <td className="py-3 px-3 text-slate-700 font-bold text-xs">{pat.department || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </HistorySection>

            {/* Incentive History */}
            <HistorySection
              icon={Banknote}
              title="Incentive History"
              count={history?.incentives?.length || 0}
              color="bg-green-600"
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">#</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Category</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Amount</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Status</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Applied On</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {history?.incentives?.map((inc: any, i: number) => (
                      <tr key={inc.id} className="hover:bg-green-50 transition-colors">
                        <td className="py-3 px-3 text-slate-400 font-medium">{i + 1}</td>
                        <td className="py-3 px-3 font-medium text-slate-800">{inc.category || '—'}</td>
                        <td className="py-3 px-3 font-bold text-green-700">
                          {inc.calculated_amount ? `₹${Number(inc.calculated_amount).toLocaleString('en-IN')}` : '—'}
                        </td>
                        <td className="py-3 px-3"><StatusBadge status={inc.status} /></td>
                        <td className="py-3 px-3 text-slate-500 text-xs">
                          {inc.created_at ? new Date(inc.created_at).toLocaleDateString('en-IN') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </HistorySection>

            {/* Seed Fund History */}
            <HistorySection
              icon={FlaskConical}
              title="Seed Fund History"
              count={history?.seed_funds?.length || 0}
              color="bg-sky-600"
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">#</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Project Title</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Phase</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Status</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Applied On</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {history?.seed_funds?.map((sf: any, i: number) => (
                      <tr key={sf.id} className="hover:bg-sky-50 transition-colors">
                        <td className="py-3 px-3 text-slate-400 font-medium">{i + 1}</td>
                        <td className="py-3 px-3 font-medium text-slate-800 max-w-xs">
                          <div className="line-clamp-2">{sf.project_title || '—'}</div>
                        </td>
                        <td className="py-3 px-3 text-slate-600 capitalize text-xs">{sf.phase || '—'}</td>
                        <td className="py-3 px-3"><StatusBadge status={sf.status} /></td>
                        <td className="py-3 px-3 text-slate-500 text-xs">
                          {sf.created_at ? new Date(sf.created_at).toLocaleDateString('en-IN') : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </HistorySection>

            {/* Consultancy Projects History */}
            <HistorySection
              icon={Briefcase}
              title="Consultancy Projects History"
              count={history?.consultancy?.length || 0}
              color="bg-orange-600"
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">#</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Title</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Client</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Amount</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {history?.consultancy?.map((c: any, i: number) => (
                      <tr key={c.id} className="hover:bg-orange-50 transition-colors">
                        <td className="py-3 px-3 text-slate-400 font-medium">{i + 1}</td>
                        <td className="py-3 px-3 font-medium text-slate-800 max-w-xs">
                          <div className="line-clamp-2">{c.title || '—'}</div>
                        </td>
                        <td className="py-3 px-3 text-slate-600 text-xs">{c.client_name || '—'}</td>
                        <td className="py-3 px-3 font-bold text-orange-700">
                          {c.amount ? `₹${Number(c.amount).toLocaleString('en-IN')}` : '—'}
                        </td>
                        <td className="py-3 px-3"><StatusBadge status={c.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </HistorySection>

            {/* Project Grants History */}
            <HistorySection
              icon={FolderKanban}
              title="Project Grants History"
              count={history?.project_grants?.length || 0}
              color="bg-rose-600"
            >
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-slate-100">
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">#</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Title</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Funding Agency</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Amount</th>
                      <th className="text-left py-2 px-3 text-xs font-bold text-slate-400 uppercase">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-50">
                    {history?.project_grants?.map((pg: any, i: number) => (
                      <tr key={pg.id} className="hover:bg-rose-50 transition-colors">
                        <td className="py-3 px-3 text-slate-400 font-medium">{i + 1}</td>
                        <td className="py-3 px-3 font-medium text-slate-800 max-w-xs">
                          <div className="line-clamp-2">{pg.title || '—'}</div>
                        </td>
                        <td className="py-3 px-3 text-slate-600 text-xs">{pg.funding_agency || '—'}</td>
                        <td className="py-3 px-3 font-bold text-rose-700">
                          {pg.amount ? `₹${Number(pg.amount).toLocaleString('en-IN')}` : '—'}
                        </td>
                        <td className="py-3 px-3"><StatusBadge status={pg.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </HistorySection>

          </div>
        )}

        {/* Workflow Steps - Paper & Incentive */}
        <div className="bg-white rounded-3xl border border-slate-200/60 shadow-sm overflow-hidden animate-slide-up mb-8" style={{ animationDelay: '0.4s' }}>
          <div className="px-8 py-6 border-b border-slate-100 bg-blue-50 flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[#2563EB] flex items-center justify-center shadow-lg shadow-blue-500/20">
              <TrendingUp className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="font-black text-slate-800 text-lg">Paper & Incentive Guide</h2>
              <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-1">Follow these steps to submit & claim incentives</p>
            </div>
          </div>

          <div className="p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
              {steps.map((step) => (
                <div key={step.n} className="relative group p-6 rounded-2xl bg-blue-50 border border-slate-100 hover:border-blue-200 hover:bg-white hover:shadow-xl hover:shadow-blue-500/5 transition-all duration-300">
                  <div className="absolute -top-4 -right-4 text-7xl font-black text-slate-900/5 transition-colors pointer-events-none">
                    {step.n}
                  </div>
                  <div className="relative z-10 flex flex-col gap-4">
                    <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-[#2563EB] flex items-center justify-center text-white text-lg font-black shadow-md group-hover:scale-110 transition-transform">
                      {step.n}
                    </div>
                    <div>
                      <p className="font-black text-slate-800 text-base mb-2 group-hover:text-blue-600 transition-colors">{step.title}</p>
                      <p className="text-slate-500 text-sm leading-relaxed font-medium">{step.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Workflow Steps - Seed Fund */}
        <div className="bg-white rounded-3xl border border-slate-200/60 shadow-sm overflow-hidden animate-slide-up" style={{ animationDelay: '0.5s' }}>
          <div className="px-8 py-6 border-b border-slate-100 bg-blue-50 flex items-center gap-4">
            <div className="w-12 h-12 rounded-2xl bg-[#0A3D8F] flex items-center justify-center shadow-lg shadow-blue-900/20">
              <FlaskConical className="w-6 h-6 text-white" />
            </div>
            <div>
              <h2 className="font-black text-slate-800 text-lg">Seed Fund Guide</h2>
              <p className="text-xs text-slate-500 font-bold uppercase tracking-wider mt-1">End-to-end workflow for seed funding</p>
            </div>
          </div>

          <div className="p-8">
            <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
              {seedFundSteps.map((step) => (
                <div key={step.n} className="relative group p-6 rounded-2xl bg-blue-50 border border-slate-100 hover:border-blue-200 hover:bg-white hover:shadow-xl hover:shadow-blue-500/5 transition-all duration-300">
                  <div className="absolute -top-4 -right-4 text-7xl font-black text-slate-900/5 transition-colors pointer-events-none">
                    {step.n}
                  </div>
                  <div className="relative z-10 flex flex-col gap-4">
                    <div className="flex-shrink-0 w-12 h-12 rounded-xl bg-[#0A3D8F] flex items-center justify-center text-white text-lg font-black shadow-md group-hover:scale-110 transition-transform">
                      {step.n}
                    </div>
                    <div>
                      <p className="font-black text-slate-800 text-base mb-2 group-hover:text-blue-800 transition-colors">{step.title}</p>
                      <p className="text-slate-500 text-sm leading-relaxed font-medium">{step.desc}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
