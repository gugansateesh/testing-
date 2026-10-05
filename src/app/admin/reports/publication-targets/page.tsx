'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import {
  ArrowLeft, Target, Download, Search, CheckCircle, XCircle,
  Circle, AlertTriangle, TrendingUp, TrendingDown, Users, BarChart2, Loader2, Save
} from 'lucide-react'
import { useAdminAuth } from '@/context/AdminAuthContext'

type BandLabel = 'Poor' | 'Unsatisfied' | 'Average' | 'Satisfied' | 'Good'

const BAND_COLORS: Record<BandLabel, { bg: string; text: string; border: string; dot: string }> = {
  Poor:        { bg: 'bg-red-50 dark:bg-red-900/20',       text: 'text-red-700 dark:text-red-300',       border: 'border-red-200 dark:border-red-700',       dot: 'bg-red-500' },
  Unsatisfied: { bg: 'bg-orange-50 dark:bg-orange-900/20', text: 'text-orange-700 dark:text-orange-300', border: 'border-orange-200 dark:border-orange-700', dot: 'bg-orange-500' },
  Average:     { bg: 'bg-yellow-50 dark:bg-yellow-900/20', text: 'text-yellow-700 dark:text-yellow-300', border: 'border-yellow-200 dark:border-yellow-700', dot: 'bg-yellow-500' },
  Satisfied:   { bg: 'bg-blue-50 dark:bg-blue-900/20',     text: 'text-blue-700 dark:text-blue-300',     border: 'border-blue-200 dark:border-blue-700',     dot: 'bg-blue-500' },
  Good:        { bg: 'bg-green-50 dark:bg-green-900/20',   text: 'text-green-700 dark:text-green-300',   border: 'border-green-200 dark:border-green-700',   dot: 'bg-green-500' },
}

function getBand(pct: number): BandLabel {
  if (pct <= 20) return 'Poor'
  if (pct <= 40) return 'Unsatisfied'
  if (pct <= 60) return 'Average'
  if (pct <= 80) return 'Satisfied'
  return 'Good'
}

function PctBar({ pct }: { pct: number }) {
  const band = getBand(pct)
  const c = BAND_COLORS[band]
  return (
    <div className="flex items-center gap-2">
      <div className="w-24 h-2 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ${c.dot}`}
          style={{ width: `${Math.min(100, pct)}%` }}
        />
      </div>
      <span className={`text-xs font-bold ${c.text}`}>{pct}%</span>
    </div>
  )
}

function BandBadge({ band }: { band: BandLabel }) {
  const c = BAND_COLORS[band]
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold border ${c.bg} ${c.text} ${c.border}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
      {band}
    </span>
  )
}

export default function PublicationTargetsPage() {
  const { token, loading: authLoading } = useAdminAuth()

  const [data, setData] = useState<any[]>([])
  const [deptSummary, setDeptSummary] = useState<any[]>([])
  const [departments, setDepartments] = useState<string[]>([])
  const [summary, setSummary] = useState({ percent_met: 0, count_met: 0, total_with_target: 0 })
  const [academicYear, setAcademicYear] = useState('2026')

  const [activeDept, setActiveDept] = useState('all')
  const [activeTab, setActiveTab] = useState<'all' | 'met' | 'not_met' | 'zero_pubs' | 'one_pub' | 'poor_performers'>('all')
  const [textSearch, setTextSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [mainView, setMainView] = useState<'staff' | 'dept'>('dept')

  // Edit State
  const [edits, setEdits] = useState<Record<string, { sci: number, scopus: number, conf: number }>>({})
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async (tok: string, year: string) => {
    try {
      setLoading(true)
      const res = await fetch(
        `/api/admin/reports/publication-targets?academic_year=${year}&dept=all`,
        { headers: { Authorization: `Bearer ${tok}` } }
      )
      if (res.ok) {
        const json = await res.json()
        setData(json.data || [])
        setDeptSummary(json.dept_summary || [])
        setDepartments(json.departments || [])
        setSummary(json.summary || { percent_met: 0, count_met: 0, total_with_target: 0 })
        
        // Populate initial edit state
        const initialEdits: any = {}
        ;(json.data || []).forEach((d: any) => {
          initialEdits[d.emp_id] = {
            sci: d.sci_target || 0,
            scopus: d.scopus_journal_target || 0,
            conf: d.scopus_conference_target || 0
          }
        })
        setEdits(initialEdits)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!token) return
    fetchData(token, academicYear)
  }, [token, academicYear, fetchData])

  const filteredData = useMemo(() => {
    return data.filter(d => {
      if (activeDept !== 'all' && d.dept !== activeDept) return false
      if (textSearch) {
        const q = textSearch.toLowerCase()
        if (!d.name.toLowerCase().includes(q) && !d.dept.toLowerCase().includes(q)) return false
      }
      if (activeTab === 'met') return d.met_target
      if (activeTab === 'not_met') return !d.met_target && d.total_target > 0
      if (activeTab === 'zero_pubs') return d.achievement.total_achieved === 0
      if (activeTab === 'one_pub') return d.achievement.total_achieved === 1
      if (activeTab === 'poor_performers') return d.achievement.total_achieved <= 1
      return true
    })
  }, [data, activeDept, textSearch, activeTab])

  const displayData = activeTab === 'poor_performers'
    ? [...filteredData].sort((a, b) => a.achievement.total_achieved - b.achievement.total_achieved || b.total_target - a.total_target)
    : filteredData

  const [uploading, setUploading] = useState(false)

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    const formData = new FormData()
    formData.append('file', file)

    try {
      const res = await fetch('/api/admin/reports/publication-targets/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })
      if (res.ok) {
        alert('File uploaded successfully. Targets updated!')
        fetchData(token!, academicYear)
      } else {
        const err = await res.json()
        alert(`Upload failed: ${err.error}`)
      }
    } catch (err: any) {
      alert(`Error: ${err.message}`)
    } finally {
      setUploading(false)
    }
  }

  const exportCsv = (rows?: typeof displayData) => {
    const source = rows ?? displayData
    const tabLabel = activeTab === 'all' ? 'All' : activeTab === 'met' ? 'MetTarget' : activeTab === 'not_met' ? 'NotMet' : activeTab === 'zero_pubs' ? 'ZeroPubs' : activeTab === 'one_pub' ? 'OnePub' : 'PoorPerformers'
    const deptLabel = activeDept === 'all' ? '' : `_${activeDept}`
    const filename = `PubTargets_${academicYear}_${tabLabel}${deptLabel}.csv`

    const headers = [
      'Name', 'Dept', 'Designation', 'Type',
      'SCI Target', 'SCI Achieved',
      'Journal Target', 'Journal Achieved',
      'Conf Target', 'Conf Achieved',
      'Total Target', 'Total Achieved', '% Achieved', 'Status',
      'Student Pub Target', 'Student Pub Achieved',
      'Utility Patent Target', 'Utility Patent Achieved',
      'Design Patent Target', 'Design Patent Achieved',
      'Copyright Target', 'Copyright Achieved',
      'Funding Target (Rs)', 'Funding Achieved (Rs)',
      'Consultancy Target (Rs)', 'Consultancy Achieved (Rs)',
    ]
    const csvRows = source.map(d => {
      const pct = d.total_target > 0 ? Math.round((d.achievement.total_achieved / d.total_target) * 100) : 0
      return [
        `"${d.name}"`, `"${d.dept}"`, `"${d.designation ?? ''}"`, `"${d.faculty_type ?? ''}"`,
        d.sci_target, d.achievement.sci_achieved,
        d.scopus_journal_target, d.achievement.scopus_journal_achieved,
        d.scopus_conference_target, d.achievement.scopus_conference_achieved,
        d.total_target, d.achievement.total_achieved, pct + '%',
        d.total_target === 0 ? 'No Target' : d.met_target ? 'Met' : 'Not Met',
        d.student_publication_target, d.achievement.student_publication_achieved,
        d.utility_patent_target, d.achievement.utility_patent_achieved,
        d.design_patent_target, d.achievement.design_patent_achieved,
        d.copyright_target, d.achievement.copyright_achieved,
        d.funding_target, d.achievement.funding_achieved,
        d.consultancy_target, d.achievement.consultancy_achieved,
      ]
    })
    const csv = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...csvRows.map(r => r.join(','))].join('\n')
    const a = document.createElement('a')
    a.href = encodeURI(csv)
    a.download = filename
    a.click()
  }

  const handleEditChange = (emp_id: string, field: 'sci' | 'scopus' | 'conf', value: string) => {
    const num = parseInt(value, 10) || 0
    setEdits(prev => ({
      ...prev,
      [emp_id]: { ...prev[emp_id], [field]: Math.max(0, num) }
    }))
  }

  const saveSingleRow = async (emp_id: string) => {
    const edit = edits[emp_id]
    if (!edit) return
    setSaving(true)
    try {
      const res = await fetch('/api/admin/reports/publication-targets', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          academic_year: academicYear,
          emp_id,
          sci_target: edit.sci,
          scopus_target: edit.scopus,
          conference_target: edit.conf
        })
      })
      if (!res.ok) throw new Error(await res.text())
      await fetchData(token!, academicYear)
    } catch (e: any) {
      alert(`Save failed: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  const bulkSave = async () => {
    if (!confirm(`Are you sure you want to save all 2027 targets for ${displayData.length} faculty currently in view?`)) return
    setSaving(true)
    try {
      const updates = displayData.map(d => {
        const e = edits[d.emp_id] || { sci: 0, scopus: 0, conf: 0 }
        return {
          emp_id: d.emp_id,
          sci_target: e.sci,
          scopus_target: e.scopus,
          conference_target: e.conf
        }
      })
      const res = await fetch('/api/admin/reports/publication-targets', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          academic_year: academicYear,
          updates
        })
      })
      if (!res.ok) throw new Error(await res.text())
      alert('Bulk save successful!')
      await fetchData(token!, academicYear)
    } catch (e: any) {
      alert(`Bulk save failed: ${e.message}`)
    } finally {
      setSaving(false)
    }
  }

  const zeroPubCount = data.filter(d => d.achievement.total_achieved === 0).length
  const onePubCount = data.filter(d => d.achievement.total_achieved === 1).length
  const metTargetCount = data.filter(d => d.met_target).length
  
  // Is this year editable? Currently 2027 is editable, 2026 is read-only historical.
  const isEditable = academicYear === '2027'

  if (authLoading) return <div className="min-h-screen flex items-center justify-center"><Loader2 className="w-8 h-8 animate-spin" /></div>

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0F172A] pb-12">

      {/* Header */}
      <div className="bg-white dark:bg-[#1E293B] border-b border-slate-200 dark:border-slate-800 px-6 py-4 flex items-center justify-between sticky top-0 z-20 shadow-sm">
        <div className="flex items-center gap-4">
          <Link href="/admin/reports" className="p-2 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5 text-slate-600 dark:text-slate-400" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Target className="w-5 h-5 text-blue-500" />
              Faculty Publication Targets
            </h1>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Manage and track faculty research goals
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <select 
            value={academicYear} 
            onChange={(e) => {
              const newYear = e.target.value;
              setAcademicYear(newYear);
              if (newYear === '2027' && mainView === 'dept') {
                setMainView('staff');
              }
            }}
            className="bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-600 text-slate-800 dark:text-white rounded-lg px-3 py-2 text-sm font-bold shadow-sm focus:ring-2 focus:ring-blue-500"
          >
            <option value="2026">2026 (Current)</option>
            <option value="2027">2027 (Next Year)</option>
          </select>
          {academicYear === '2026' && (
            <label className="flex items-center gap-2 px-4 py-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors cursor-pointer">
              {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Target className="w-4 h-4" />}
              {uploading ? 'Uploading...' : 'Upload Excel'}
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={handleUpload} disabled={uploading} />
            </label>
          )}
          <button onClick={() => exportCsv()} className="flex items-center gap-2 px-4 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors">
            <Download className="w-4 h-4" />
            Export CSV
          </button>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-6 py-8 space-y-6">

        {/* KPI Cards Row */}
        {loading ? (
          <div className="flex justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-slate-400" /></div>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Overall Completion</div>
                <div className="text-3xl font-black text-slate-900 dark:text-white">{summary.percent_met}%</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">{summary.count_met} of {summary.total_with_target} staff met target</div>
                <div className="mt-3 h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${summary.percent_met}%` }} />
                </div>
              </div>

              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Zero Publications</div>
                <div className="text-3xl font-black text-red-600 dark:text-red-400">{zeroPubCount}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">faculty need immediate attention</div>
                <button onClick={() => { setActiveTab('zero_pubs'); setMainView('staff') }} className="mt-3 text-xs text-red-600 dark:text-red-400 font-semibold hover:underline">View list →</button>
              </div>

              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">One Publication</div>
                <div className="text-3xl font-black text-orange-500 dark:text-orange-400">{onePubCount}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">faculty with minimal output</div>
                <button onClick={() => { setActiveTab('one_pub'); setMainView('staff') }} className="mt-3 text-xs text-orange-500 dark:text-orange-400 font-semibold hover:underline">View list →</button>
              </div>

              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5">
                <div className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1">Total Faculty</div>
                <div className="text-3xl font-black text-slate-900 dark:text-white">{data.length}</div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">across {departments.length} departments</div>
              </div>

              {/* Met Target Card */}
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-green-200 dark:border-green-800 p-5 relative overflow-hidden">
                <div className="absolute inset-0 bg-gradient-to-br from-green-50/60 to-emerald-50/30 dark:from-green-900/20 dark:to-emerald-900/10" />
                <div className="relative">
                  <div className="flex items-center gap-2 mb-1">
                    <CheckCircle className="w-4 h-4 text-green-500" />
                    <div className="text-xs font-semibold text-green-700 dark:text-green-400 uppercase tracking-wider">Met Target</div>
                  </div>
                  <div className="text-3xl font-black text-green-600 dark:text-green-400">{metTargetCount}</div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                    out of {data.filter(d => d.total_target > 0).length} with targets
                  </div>
                  <button
                    onClick={() => { setActiveTab('met'); setMainView('staff') }}
                    className="mt-3 text-xs text-green-600 dark:text-green-400 font-semibold hover:underline"
                  >
                    View list →
                  </button>
                </div>
              </div>
            </div>

            {/* View Toggle */}
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
              <div className="flex gap-2 bg-white dark:bg-slate-800 p-1 rounded-xl border border-slate-200 dark:border-slate-700 w-fit">
                <button
                  onClick={() => setMainView('dept')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${mainView === 'dept' ? 'bg-blue-600 text-white shadow' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                >
                  <BarChart2 className="w-4 h-4" /> Department View
                </button>
                <button
                  onClick={() => setMainView('staff')}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors ${mainView === 'staff' ? 'bg-blue-600 text-white shadow' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'}`}
                >
                  <Users className="w-4 h-4" /> Staff View
                </button>
              </div>
              
              {isEditable && mainView === 'staff' && (
                <button
                  onClick={bulkSave}
                  disabled={saving}
                  className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white px-5 py-2.5 rounded-xl font-bold shadow-sm transition-all"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                  Bulk Save All Targets
                </button>
              )}
            </div>

            {/* ===== DEPARTMENT VIEW ===== */}
            {mainView === 'dept' && (
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/50 flex items-center justify-between">
                  <h3 className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                    <BarChart2 className="w-4 h-4 text-blue-500" />
                    Department Performance — Publication Target Achievement
                  </h3>
                  <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
                    {(['Good','Satisfied','Average','Unsatisfied','Poor'] as BandLabel[]).map(b => (
                      <span key={b} className="flex items-center gap-1">
                        <span className={`w-2 h-2 rounded-full ${BAND_COLORS[b].dot}`} />{b}
                      </span>
                    ))}
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400">
                      <tr>
                        <th className="px-6 py-3 font-medium">Department</th>
                        <th className="px-6 py-3 font-medium text-right">Faculty</th>
                        <th className="px-6 py-3 font-medium text-right">Target</th>
                        <th className="px-6 py-3 font-medium text-right">Achieved</th>
                        <th className="px-6 py-3 font-medium">Achievement %</th>
                        <th className="px-6 py-3 font-medium">Band</th>
                        <th className="px-6 py-3 font-medium text-right">Met Target</th>
                        <th className="px-6 py-3 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                      {deptSummary.map((d) => {
                        const band: BandLabel = d.band as BandLabel
                        const c = BAND_COLORS[band]
                        return (
                          <tr key={d.dept} className={`hover:bg-slate-50 dark:hover:bg-slate-750 ${c.bg}`}>
                            <td className={`px-6 py-3 font-semibold ${c.text}`}>
                              <span className={`inline-flex items-center gap-2`}>
                                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${c.dot}`} />
                                {d.dept}
                              </span>
                            </td>
                            <td className="px-6 py-3 text-right font-medium text-slate-700 dark:text-slate-300">{d.total}</td>
                            <td className="px-6 py-3 text-right text-slate-600 dark:text-slate-400">{d.total_target}</td>
                            <td className={`px-6 py-3 text-right font-bold ${c.text}`}>{d.total_achieved}</td>
                            <td className="px-6 py-3"><PctBar pct={d.pct_achieved} /></td>
                            <td className="px-6 py-3"><BandBadge band={band} /></td>
                            <td className="px-6 py-3 text-right text-slate-600 dark:text-slate-400 text-xs">{d.met} / {d.total}</td>
                            <td className="px-6 py-3">
                              <button
                                onClick={() => { setActiveDept(d.dept); setActiveTab('all'); setMainView('staff') }}
                                className="text-xs text-blue-600 dark:text-blue-400 font-medium hover:underline whitespace-nowrap"
                              >
                                View staff →
                              </button>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* ===== STAFF VIEW ===== */}
            {mainView === 'staff' && (
              <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
                {/* Filters */}
                <div className="p-4 border-b border-slate-200 dark:border-slate-700 space-y-3">
                  <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                    <div className="relative flex-1 max-w-xs">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search name or dept..."
                        value={textSearch}
                        onChange={e => setTextSearch(e.target.value)}
                        className="w-full pl-9 pr-4 py-2 bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm"
                      />
                    </div>
                    <select
                      value={activeDept}
                      onChange={e => setActiveDept(e.target.value)}
                      className="bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm px-4 py-2"
                    >
                      <option value="all">All Departments</option>
                      {departments.map(d => <option key={d} value={d}>{d}</option>)}
                    </select>
                    <span className="text-xs text-slate-500 dark:text-slate-400 ml-auto">
                      {displayData.length} faculty shown
                    </span>
                    <button
                      onClick={() => exportCsv()}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold rounded-lg transition-colors shadow-sm"
                      title={`Export current filtered view (${displayData.length} rows)`}
                    >
                      <Download className="w-3.5 h-3.5" />
                      Export CSV
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {[
                      { id: 'all', label: 'All Faculty', icon: null },
                      { id: 'met', label: '✓ Met Target', icon: null },
                      { id: 'not_met', label: '✗ Not Met', icon: null },
                      { id: 'poor_performers', label: '⚠ Poor Performers (0–1 pubs)', icon: null },
                      { id: 'zero_pubs', label: '0 Publications', icon: null },
                      { id: 'one_pub', label: '1 Publication', icon: null },
                    ].map(tab => (
                      <button
                        key={tab.id}
                        onClick={() => setActiveTab(tab.id as any)}
                        className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                          activeTab === tab.id
                            ? tab.id === 'poor_performers' || tab.id === 'zero_pubs'
                              ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                              : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400'
                            : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                        }`}
                      >
                        {tab.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Poor Performers Banner */}
                {activeTab === 'poor_performers' && displayData.length > 0 && (
                  <div className="mx-4 mt-4 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl flex items-start gap-3">
                    <AlertTriangle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
                    <div>
                      <div className="text-sm font-bold text-red-700 dark:text-red-300">
                        {displayData.length} faculty with 0 or 1 publication — require immediate attention
                      </div>
                      <div className="text-xs text-red-600 dark:text-red-400 mt-0.5">
                        Sorted by lowest achievement first. {displayData.filter(d => d.achievement.total_achieved === 0).length} have zero publications,{' '}
                        {displayData.filter(d => d.achievement.total_achieved === 1).length} have exactly one.
                      </div>
                    </div>
                  </div>
                )}

                {/* Staff Table */}
                <div className="overflow-x-auto mt-2 pb-16">
                  <table className="w-full text-sm text-left">
                    <thead className="bg-slate-50 dark:bg-slate-900/50 text-slate-500 dark:text-slate-400">
                      <tr>
                        <th className="px-4 py-3 font-medium">Faculty</th>
                        <th className="px-4 py-3 font-medium text-center">SCI (T/A)</th>
                        <th className="px-4 py-3 font-medium text-center">Scopus/WoS Journals (T/A)</th>
                        <th className="px-4 py-3 font-medium text-center">Scopus/WoS Conference/Book Chapter/Others (T/A)</th>
                        <th className="px-4 py-3 font-medium text-center">Total Publication Target (T/A)</th>
                        <th className="px-4 py-3 font-medium">Achievement</th>
                        <th className="px-4 py-3 font-medium">Status</th>
                        <th className="px-4 py-3 font-medium text-center whitespace-nowrap">Student Publication Target</th>
                        <th className="px-4 py-3 font-medium text-center whitespace-nowrap">Utility Patent</th>
                        <th className="px-4 py-3 font-medium text-center whitespace-nowrap">Design Patent</th>
                        <th className="px-4 py-3 font-medium text-center">Copyright</th>
                        <th className="px-4 py-3 font-medium text-center">Funding (₹)</th>
                        <th className="px-4 py-3 font-medium text-center">Consultancy (₹)</th>
                        {isEditable && <th className="px-4 py-3 font-medium text-right">Actions</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                      {displayData.length === 0 ? (
                        <tr><td colSpan={isEditable ? 8 : 7} className="px-4 py-10 text-center text-slate-500">No records matching filters.</td></tr>
                      ) : displayData.map((d, idx) => {
                        const pct = d.total_target > 0 ? Math.round((d.achievement.total_achieved / d.total_target) * 100) : 0
                        const isPoor = d.achievement.total_achieved === 0
                        const isOne = d.achievement.total_achieved === 1
                        
                        const e = edits[d.emp_id] || { sci: 0, scopus: 0, conf: 0 }
                        const totalEditTarget = e.sci + e.scopus + e.conf
                        const isChanged = e.sci !== d.sci_target || e.scopus !== d.scopus_journal_target || e.conf !== d.scopus_conference_target

                        return (
                          <tr
                          key={d.id || d.emp_id || idx}
                          className={`hover:bg-slate-50 dark:hover:bg-slate-750 transition-colors ${isPoor && !isEditable ? 'bg-red-50/50 dark:bg-red-900/10' : isOne && !isEditable ? 'bg-orange-50/50 dark:bg-orange-900/10' : ''}`}
                        >
                            <td className="px-4 py-3 min-w-[200px]">
                              <div className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-2">
                                {isPoor && !isEditable && <span className="w-1.5 h-1.5 rounded-full bg-red-500 flex-shrink-0" />}
                                {isOne && !isPoor && !isEditable && <span className="w-1.5 h-1.5 rounded-full bg-orange-500 flex-shrink-0" />}
                                {d.name}
                              </div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">{d.dept}</div>
                              <div className="text-[10px] text-slate-400 dark:text-slate-500 font-mono mt-0.5">{d.emp_id}</div>
                            </td>
                            
                            {/* SCI */}
                            <td className="px-4 py-3 text-center">
                              {isEditable ? (
                                <div className="flex flex-col items-center gap-1">
                                  <input type="number" min="0" value={e.sci} onChange={ev => handleEditChange(d.emp_id, 'sci', ev.target.value)} className="w-14 text-center text-xs py-1 px-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800" />
                                  <span className="text-[10px] text-slate-400 font-medium">A: {d.achievement.sci_achieved}</span>
                                </div>
                              ) : (
                                <>
                                  <span className="text-slate-500">{d.sci_target}</span>
                                  <span className="mx-1 text-slate-300">/</span>
                                  <span className={d.achievement.sci_achieved >= d.sci_target && d.sci_target > 0 ? 'text-green-600 dark:text-green-400 font-bold' : 'text-slate-800 dark:text-slate-200'}>
                                    {d.achievement.sci_achieved}
                                  </span>
                                </>
                              )}
                            </td>

                            {/* Journal */}
                            <td className="px-4 py-3 text-center">
                              {isEditable ? (
                                <div className="flex flex-col items-center gap-1">
                                  <input type="number" min="0" value={e.scopus} onChange={ev => handleEditChange(d.emp_id, 'scopus', ev.target.value)} className="w-14 text-center text-xs py-1 px-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800" />
                                  <span className="text-[10px] text-slate-400 font-medium">A: {d.achievement.scopus_journal_achieved}</span>
                                </div>
                              ) : (
                                <>
                                  <span className="text-slate-500">{d.scopus_journal_target}</span>
                                  <span className="mx-1 text-slate-300">/</span>
                                  <span className={d.achievement.scopus_journal_achieved >= d.scopus_journal_target && d.scopus_journal_target > 0 ? 'text-green-600 dark:text-green-400 font-bold' : 'text-slate-800 dark:text-slate-200'}>
                                    {d.achievement.scopus_journal_achieved}
                                  </span>
                                </>
                              )}
                            </td>

                            {/* Conference */}
                            <td className="px-4 py-3 text-center">
                              {isEditable ? (
                                <div className="flex flex-col items-center gap-1">
                                  <input type="number" min="0" value={e.conf} onChange={ev => handleEditChange(d.emp_id, 'conf', ev.target.value)} className="w-14 text-center text-xs py-1 px-1 border border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-800" />
                                  <span className="text-[10px] text-slate-400 font-medium">A: {d.achievement.scopus_conference_achieved}</span>
                                </div>
                              ) : (
                                <>
                                  <span className="text-slate-500">{d.scopus_conference_target}</span>
                                  <span className="mx-1 text-slate-300">/</span>
                                  <span className={d.achievement.scopus_conference_achieved >= d.scopus_conference_target && d.scopus_conference_target > 0 ? 'text-green-600 dark:text-green-400 font-bold' : 'text-slate-800 dark:text-slate-200'}>
                                    {d.achievement.scopus_conference_achieved}
                                  </span>
                                </>
                              )}
                            </td>

                            {/* Total */}
                            <td className="px-4 py-3 text-center">
                              {isEditable ? (
                                <div className="flex flex-col items-center gap-1">
                                  <div className="w-14 text-center text-xs py-1 px-1 bg-slate-100 dark:bg-slate-900 text-slate-600 dark:text-slate-400 rounded border border-transparent font-bold">
                                    {totalEditTarget}
                                  </div>
                                  <span className="text-[10px] text-slate-400 font-bold">A: {d.achievement.total_achieved}</span>
                                </div>
                              ) : (
                                <>
                                  <span className="text-slate-500 font-medium">{d.total_target}</span>
                                  <span className="mx-1 text-slate-300">/</span>
                                  <span className={`font-bold ${d.met_target ? 'text-green-600 dark:text-green-400' : isPoor ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}`}>
                                    {d.achievement.total_achieved}
                                  </span>
                                </>
                              )}
                            </td>

                            <td className="px-4 py-3">
                              {d.total_target > 0 ? (
                                <PctBar pct={pct} />
                              ) : (
                                <span className="text-xs text-slate-400">—</span>
                              )}
                            </td>

                            <td className="px-4 py-3">
                              {d.total_target === 0 ? (
                                <span className="inline-flex items-center gap-1 text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded text-xs font-medium">
                                  <Circle className="w-3 h-3" /> No Target
                                </span>
                              ) : d.met_target ? (
                                <span className="inline-flex items-center gap-1 text-green-700 dark:text-green-400 bg-green-50 dark:bg-green-900/30 px-2 py-1 rounded text-xs font-bold">
                                  <CheckCircle className="w-3 h-3" /> Met
                                </span>
                              ) : isPoor ? (
                                <span className="inline-flex items-center gap-1 text-red-700 dark:text-red-400 bg-red-50 dark:bg-red-900/30 px-2 py-1 rounded text-xs font-bold">
                                  <AlertTriangle className="w-3 h-3" /> Zero Pubs
                                </span>
                              ) : (
                                <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-2 py-1 rounded text-xs font-medium">
                                  <XCircle className="w-3 h-3" /> {d.achievement.total_achieved}/{d.total_target}
                                </span>
                              )}
                            </td>

                            {isEditable && (
                              <td className="px-4 py-3 text-right">
                                {isChanged && (
                                  <button
                                    onClick={() => saveSingleRow(d.emp_id)}
                                    disabled={saving}
                                    className="text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 font-semibold py-1 px-3 rounded transition-colors"
                                  >
                                    Save
                                  </button>
                                )}
                              </td>
                            )}

                            {/* Extended Targets with Achieved */}
                            {/* Student Publications */}
                            <td className="px-4 py-3 text-center">
                              <div className="flex flex-col items-center gap-0.5">
                                <div className="flex items-center gap-1 text-xs">
                                  <span className="text-slate-400">{d.student_publication_target || 0}</span>
                                  <span className="text-slate-300">/</span>
                                  <span className={d.achievement.student_publication_achieved >= d.student_publication_target && d.student_publication_target > 0 ? 'text-green-600 dark:text-green-400 font-bold' : 'text-slate-700 dark:text-slate-300 font-semibold'}>
                                    {d.achievement.student_publication_achieved}
                                  </span>
                                </div>
                                <span className="text-[9px] text-slate-400">T/A</span>
                              </div>
                            </td>
                            {/* Utility Patent */}
                            <td className="px-4 py-3 text-center">
                              <div className="flex flex-col items-center gap-0.5">
                                <div className="flex items-center gap-1 text-xs">
                                  <span className="text-slate-400">{d.utility_patent_target || 0}</span>
                                  <span className="text-slate-300">/</span>
                                  <span className={d.achievement.utility_patent_achieved >= d.utility_patent_target && d.utility_patent_target > 0 ? 'text-green-600 dark:text-green-400 font-bold' : 'text-slate-700 dark:text-slate-300 font-semibold'}>
                                    {d.achievement.utility_patent_achieved}
                                  </span>
                                </div>
                                <span className="text-[9px] text-slate-400">T/A</span>
                              </div>
                            </td>
                            {/* Design Patent */}
                            <td className="px-4 py-3 text-center">
                              <div className="flex flex-col items-center gap-0.5">
                                <div className="flex items-center gap-1 text-xs">
                                  <span className="text-slate-400">{d.design_patent_target || 0}</span>
                                  <span className="text-slate-300">/</span>
                                  <span className={d.achievement.design_patent_achieved >= d.design_patent_target && d.design_patent_target > 0 ? 'text-green-600 dark:text-green-400 font-bold' : 'text-slate-700 dark:text-slate-300 font-semibold'}>
                                    {d.achievement.design_patent_achieved}
                                  </span>
                                </div>
                                <span className="text-[9px] text-slate-400">T/A</span>
                              </div>
                            </td>
                            {/* Copyright */}
                            <td className="px-4 py-3 text-center">
                              <div className="flex flex-col items-center gap-0.5">
                                <div className="flex items-center gap-1 text-xs">
                                  <span className="text-slate-400">{d.copyright_target || 0}</span>
                                  <span className="text-slate-300">/</span>
                                  <span className={d.achievement.copyright_achieved >= d.copyright_target && d.copyright_target > 0 ? 'text-green-600 dark:text-green-400 font-bold' : 'text-slate-700 dark:text-slate-300 font-semibold'}>
                                    {d.achievement.copyright_achieved}
                                  </span>
                                </div>
                                <span className="text-[9px] text-slate-400">T/A</span>
                              </div>
                            </td>
                            {/* Funding */}
                            <td className="px-4 py-3 text-center">
                              <div className="flex flex-col items-center gap-0.5">
                                <div className="flex items-center gap-1 text-xs">
                                  <span className="text-slate-400">{d.funding_target ? d.funding_target.toLocaleString('en-IN') : 0}</span>
                                  <span className="text-slate-300">/</span>
                                  <span className={d.achievement.funding_achieved >= d.funding_target && d.funding_target > 0 ? 'text-green-600 dark:text-green-400 font-bold' : 'text-slate-700 dark:text-slate-300 font-semibold'}>
                                    {d.achievement.funding_achieved ? d.achievement.funding_achieved.toLocaleString('en-IN') : 0}
                                  </span>
                                </div>
                                <span className="text-[9px] text-slate-400">T/A (₹)</span>
                              </div>
                            </td>
                            {/* Consultancy */}
                            <td className="px-4 py-3 text-center">
                              <div className="flex flex-col items-center gap-0.5">
                                <div className="flex items-center gap-1 text-xs">
                                  <span className="text-slate-400">{d.consultancy_target ? d.consultancy_target.toLocaleString('en-IN') : 0}</span>
                                  <span className="text-slate-300">/</span>
                                  <span className={d.achievement.consultancy_achieved >= d.consultancy_target && d.consultancy_target > 0 ? 'text-green-600 dark:text-green-400 font-bold' : 'text-slate-700 dark:text-slate-300 font-semibold'}>
                                    {d.achievement.consultancy_achieved ? d.achievement.consultancy_achieved.toLocaleString('en-IN') : 0}
                                  </span>
                                </div>
                                <span className="text-[9px] text-slate-400">T/A (₹)</span>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
