'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import {
  BarChart3, FileText, IndianRupee, FlaskConical, Loader2, GraduationCap, Award, Users, Briefcase, ExternalLink, FolderKanban, Target
} from 'lucide-react'
import { useAdminAuth } from '@/context/AdminAuthContext'

export default function ReportsPage() {
  const router = useRouter()
  const { token, loading: authLoading } = useAdminAuth()
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState<any>(null)
  const [targetSummary, setTargetSummary] = useState<any>(null)

  const fetchStats = useCallback(async (tok: string) => {
    try {
      const [res, targetRes] = await Promise.all([
        fetch('/api/admin/reports/stats', { headers: { Authorization: `Bearer ${tok}` } }),
        fetch('/api/admin/reports/publication-targets/summary?academic_year=2026', { headers: { Authorization: `Bearer ${tok}` } })
      ])
      
      if (res.ok) {
        const data = await res.json()
        setStats(data)
      }
      if (targetRes.ok) {
        const targetData = await targetRes.json()
        setTargetSummary(targetData)
      }
    } catch (err) {
      console.error(err)
    }
  }, [])

  useEffect(() => {
    if (!token) return
    let mounted = true
    const init = async () => {
      await fetchStats(token)
      if (mounted) setLoading(false)
    }
    init()
    return () => { mounted = false }
  }, [token, fetchStats])


  const formatCurrency = (val: number) => {
    if (!val) return '₹0'
    if (val >= 10000000) return `₹${(val / 10000000).toFixed(1).replace(/\.0$/, '')} Cr+`
    if (val >= 100000) return `₹${(val / 100000).toFixed(1).replace(/\.0$/, '')} L+`
    return `₹${val.toLocaleString('en-IN')}`
  }

  const renderNav = () => null

  if (authLoading || loading) return <div className="min-h-screen bg-blue-50 dark:bg-[#0F172A] flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>

  const man = stats?.manualStats || {}
  const liv = stats?.liveStats || {}

  return (
    <div className="min-h-screen bg-blue-50 dark:bg-[#0F172A] flex flex-col font-sans">

      <main className="flex-1 w-full mx-auto pb-12 selection:bg-indigo-500/30">
        
        {/* STATS GRID */}
        <div className="px-4 sm:px-6 pt-8 pb-4">
          <div className="mb-6">
            <h1 className="text-3xl font-black text-slate-800 dark:text-slate-100 tracking-tight">Reports Overview</h1>
            <p className="text-slate-500 dark:text-slate-400 font-medium mt-1">Key metrics and statistics</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { title: 'Phds holders', stat: `${liv.faculty_phd_percent || 0}%`, label: `${liv.phd_holders_count || 131} / ${liv.total_faculty_count || 233} FACULTY`, Icon: GraduationCap, link: '/admin/reports/phd-holders' },
              { title: 'Scopus Publications', stat: `${liv.scopus_publications_count || 0}+`, label: 'TOTAL', Icon: FileText, link: '/admin/reports/publications' },
              { title: 'Patents Published', stat: `${liv.patents_published_count || 0}+`, label: 'TOTAL', Icon: Award, link: '/admin/reports/patents' },
              { title: 'Incentives', stat: formatCurrency(liv.incentives_total), label: 'TOTAL SANCTIONED', Icon: IndianRupee, link: '/admin/reports/incentives' },
              { title: 'AU Research Supervisors', stat: `${liv.au_research_supervisors_count || 0}+`, label: 'TOTAL', Icon: Users, link: '/admin/reports/supervisors' },
              { title: 'AU Research Scholars', stat: `${liv.au_research_scholars_count || 0}+`, label: 'TOTAL', Icon: Users, link: '/admin/reports/scholars' },
              { title: 'Seed Fund Grants', stat: formatCurrency(liv.seed_fund_grants_total), label: 'SANCTIONED', Icon: FlaskConical, link: '/admin/reports/seed-fund-grants' },
              { title: 'Consultancy Projects', stat: formatCurrency(liv.consultancy_project_total), label: 'EXTERNAL', Icon: Briefcase, link: '/admin/reports/consultancy' },
              { title: 'Project Grants', stat: formatCurrency(liv.project_grants_total), label: 'SANCTIONED', Icon: FolderKanban, link: '/admin/reports/grants' },
              { title: 'Target Completion (2026)', stat: `${targetSummary?.percent_met ?? 0}%`, label: `${targetSummary?.count_met ?? 0}/${targetSummary?.total_with_target ?? 0} MET TARGET`, Icon: Target, link: '/admin/reports/publication-targets' },
            ].map((card, i) => {
              const Icon = card.Icon
              const wrapperClasses = `
                group relative flex flex-col justify-between
                h-36 lg:h-40 p-5 rounded-[20px] text-white text-left
                bg-gradient-to-br from-[#1d4ed8] to-[#1e3a8a]
                shadow-lg shadow-black/10 border border-white/5
                overflow-hidden transition-all duration-300
                ${card.link ? 'cursor-pointer hover:scale-[1.02] hover:shadow-xl hover:shadow-black/20 opacity-95 hover:opacity-100' : ''}
              `
              
              const innerContent = (
                <>
                  <Icon
                    className="absolute -bottom-4 -right-4 text-white/5 group-hover:text-white/10 transition-all duration-500"
                    style={{ width: '120px', height: '120px' }}
                  />
                  <div className="flex flex-col justify-between h-full z-10">
                    <div className="flex items-start justify-between">
                      <div className="w-10 h-10 rounded-2xl flex items-center justify-center bg-white/10 backdrop-blur-sm border border-white/10 shadow-inner group-hover:bg-white/20 transition-all">
                        <Icon className="w-5 h-5 text-yellow-400" />
                      </div>
                      <div className="flex flex-col items-end">
                        <div className="text-3xl font-black leading-none tracking-tight">{card.stat}</div>
                        <div className="text-[10px] uppercase tracking-widest font-bold opacity-80 mt-1">{card.label}</div>
                      </div>
                    </div>
                    <div>
                      <div className="font-bold text-base lg:text-lg leading-tight tracking-tight text-white/95 group-hover:text-white">
                        {card.title}
                      </div>
                      {card.link && (
                        <div className="text-xs font-semibold mt-1.5 text-yellow-400 flex items-center gap-1 opacity-0 group-hover:opacity-100 -translate-x-2 group-hover:translate-x-0 transition-all duration-300">
                          View Report <ExternalLink className="w-3.5 h-3.5" />
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )
              
              if (card.link) {
                return (
                  <div key={i} onClick={() => router.push(card.link)} className={wrapperClasses}>
                    {innerContent}
                  </div>
                )
              }

              return (
                <div key={i} className={wrapperClasses}>
                  {innerContent}
                </div>
              )
            })}
          </div>
        </div>
      </main>



    </div>
  )
}
