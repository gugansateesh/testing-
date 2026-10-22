'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Download, Upload, Loader2, Search, X, Trash2 } from 'lucide-react'
import { useAdminAuth } from '@/context/AdminAuthContext'

export default function GrantsReportPage() {
  const router = useRouter()
  const { token } = useAdminAuth()
  const [grants, setGrants] = useState<any[]>([])
  const [grantYears, setGrantYears] = useState<string[]>([])
  const [activeYear, setActiveYear] = useState<string>('all')
  const [departments, setDepartments] = useState<string[]>([])
  const [activeDept, setActiveDept] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [totalAmount, setTotalAmount] = useState(0)
  const [visibleCount, setVisibleCount] = useState(30)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDelete = async (id: string, title: string, piName: string, isLive: boolean) => {
    const confirmMsg = `Delete '${title}' by ${piName || 'Unknown'}? This cannot be undone.`
    if (!window.confirm(confirmMsg)) return

    try {
      const url = `/api/admin/reports/grants/${id}?source=${isLive ? 'live' : 'legacy'}`
      const res = await fetch(url, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      const data = await res.json()
      if (res.ok) {
        setGrants(prev => prev.filter(g => g.id !== id))
      } else {
        alert(data.error || 'Failed to delete record')
      }
    } catch (e: any) {
      console.error(e)
      alert('Error deleting record: ' + e.message)
    }
  }

  const fetchGrants = useCallback(async (year: string, dept: string, tok: string) => {
    try {
      setGrants([])
      setVisibleCount(30)
      const yearQ = year === 'all' ? '' : encodeURIComponent(year)
      const deptQ = dept === 'all' ? '' : encodeURIComponent(dept)
      const res = await fetch(
        `/api/admin/reports/grants?year=${yearQ}&dept=${deptQ}&_t=${Date.now()}`,
        { headers: { Authorization: `Bearer ${tok}` } }
      )
      if (res.ok) {
        const { data, departments: deptList, years: yearList, totalAmount: apiTotal } = await res.json()
        const list = data || []
        setGrants(list)
        setTotalAmount(apiTotal || 0)
        if (yearList && yearList.length > 0) {
          setGrantYears(prev => prev.length > 0 ? prev : yearList)
        }
        if (deptList && deptList.length > 0) {
          setDepartments(prev => prev.length > 0 ? prev : deptList)
        }
      }
    } catch (err) { console.error(err) }
  }, [])


  useEffect(() => {
    if (!token) return
    let mounted = true
    const init = async () => {
      await fetchGrants(activeYear, activeDept, token)
      if (mounted) setLoading(false)
    }
    init()
    return () => { mounted = false }
  }, [token, activeYear, activeDept, fetchGrants])

  const exportGrants = async () => {
    if (!token) return
    try {
      const params = new URLSearchParams()
      if (activeYear !== 'all') params.set('year', activeYear)
      if (activeDept !== 'all') params.set('dept', activeDept)
      params.set('token', token)
      const res = await fetch(`/api/admin/reports/grants/export?${params}`)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const label = [activeYear !== 'all' ? activeYear : '', activeDept !== 'all' ? activeDept : ''].filter(Boolean)
      a.download = `ProjectGrants_${label.length ? label.join('_') : 'All'}.xlsx`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      a.remove()
    } catch (err) {
      console.error(err)
      alert('Failed to export grants')
    }
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !token) return
    try {
      setImporting(true)
      const formData = new FormData()
      formData.append('file', file)
      const res = await fetch('/api/admin/reports/grants/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      })
      const result = await res.json()
      if (res.ok) {
        alert(`Import successful! Imported ${result.imported} records. Skipped ${result.skipped} subtotal/invalid rows.`)
        await fetchGrants(activeYear, activeDept, token)
      } else {
        alert(result.error || 'Import failed')
      }
    } catch (err) {
      console.error(err)
      alert('Failed to import grants')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const filteredGrants = grants.filter(g => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (g.project_title || '').toLowerCase().includes(q) ||
      (g.pi_co_investigator || '').toLowerCase().includes(q) ||
      (g.funding_agency || '').toLowerCase().includes(q) ||
      (g.department || '').toLowerCase().includes(q)
    )
  })

  const formatCurrency = (val: number) => {
    if (!val) return '₹0'
    if (val >= 10000000) return `₹${(val / 10000000).toFixed(2)} Cr`
    if (val >= 100000) return `₹${(val / 100000).toFixed(2)} L`
    return `₹${val.toLocaleString('en-IN')}`
  }

  if (loading) return (
    <div className="p-8 text-center">
      <div className="w-8 h-8 mx-auto border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  return (
    <div className="min-h-screen bg-slate-50 p-6 font-sans text-slate-900">
      <div className="w-full mx-auto space-y-6">
        <Link href="/admin/reports" className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 font-medium">
          <ArrowLeft className="w-4 h-4" /> Back to Reports Overview
        </Link>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-[#0A3D8F]">Project Grants</h1>
            <p className="text-slate-500 text-sm mt-1">Historical grants received by SECE departments</p>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="file"
              accept=".xlsx,.xls"
              ref={fileInputRef}
              onChange={handleImport}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={importing}
              className="flex items-center gap-2 bg-[#FDB813] hover:bg-yellow-400 text-[#0A3D8F] px-4 py-2 rounded-xl font-bold transition-all shadow-sm text-sm disabled:opacity-50"
            >
              {importing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {importing ? 'Importing...' : 'Upload Excel'}
            </button>
            <button
              onClick={exportGrants}
              className="flex items-center gap-2 bg-white border border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-slate-700 hover:text-blue-700 dark:bg-slate-700 dark:border-slate-500 dark:text-slate-100 dark:hover:bg-blue-700 dark:hover:border-blue-500 dark:hover:text-white px-4 py-2 rounded-xl font-bold transition-all shadow-sm text-sm"
            >
              <Download className="w-4 h-4" /> Export Excel
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          {/* Year dropdown + filters */}
          <div className="flex flex-col md:flex-row md:items-center justify-end border-b border-slate-200 bg-blue-50">
            <div className="flex flex-wrap items-center gap-3 p-3 w-full md:w-auto shrink-0">
              <select 
                value={activeYear} 
                onChange={(e) => setActiveYear(e.target.value)}
                className="w-full md:w-auto bg-white border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Years</option>
                {grantYears.map(yr => (
                  <option key={yr} value={yr}>{yr}</option>
                ))}
              </select>
              {/* Search */}
              <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-lg px-3 py-1.5">
                <Search className="w-3.5 h-3.5 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search title, PI, agency..."
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="bg-transparent text-slate-700 text-sm focus:outline-none w-48"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="text-slate-400 hover:text-red-500">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {/* Dept filter */}
              <select
                value={activeDept}
                onChange={e => setActiveDept(e.target.value)}
                className="bg-white border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Departments</option>
                {departments.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              {/* Result count */}
              <div className="flex items-center justify-center px-3 py-2 bg-[#0A3D8F]/10 text-[#0A3D8F] text-sm font-bold rounded-lg border border-[#0A3D8F]/20 whitespace-nowrap">
                {filteredGrants.length} {filteredGrants.length === 1 ? 'Result' : 'Results'}
              </div>
            </div>
          </div>

          {/* Total banner */}
          <div className="bg-gradient-to-r from-[#0A3D8F]/5 to-[#0A3D8F]/10 border-b border-slate-200 px-6 py-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-600">
              Total Grant Amount {search || activeDept !== 'all' ? '(filtered)' : ''}
            </span>
            <span className="text-xl font-black text-[#0A3D8F]">{formatCurrency(totalAmount)}</span>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#0A3D8F] text-white">
                <tr>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800 text-center">S.No</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Academic Year</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Dept</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800 min-w-[280px]">PI / Co-Investigator</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800 min-w-[280px]">Title of the Project</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Type</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800 min-w-[160px]">Funding Agency</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Period</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800 text-right">Grant Sanctioned (₹)</th>
                  <th className="px-4 py-3 font-semibold text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredGrants.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-10 text-center text-slate-500 font-medium">
                      {grants.length === 0 ? 'No grants found. Upload an Excel file to import grants.' : 'No grants match the current filters.'}
                    </td>
                  </tr>
                ) : filteredGrants.slice(0, visibleCount).map((g, idx) => (
                  <tr key={g.id} className="hover:bg-blue-50 transition-colors">
                    <td className="px-4 py-3 border-r border-slate-100 font-medium text-slate-400 text-center">{idx + 1}</td>
                    <td className="px-4 py-3 border-r border-slate-100 font-bold text-[#0A3D8F] text-center">{g.academic_year || '—'}</td>
                    <td className="px-4 py-3 border-r border-slate-100 text-slate-600">{g.department || '—'}</td>
                    <td className="px-4 py-3 border-r border-slate-100 text-slate-700 whitespace-normal min-w-[280px] text-xs">{g.pi_co_investigator || '—'}</td>
                    <td className="px-4 py-3 border-r border-slate-100 font-medium text-[#0A3D8F] whitespace-normal min-w-[280px]">{g.project_title}</td>
                    <td className="px-4 py-3 border-r border-slate-100 text-slate-600 text-xs">{g.project_type || '—'}</td>
                    <td className="px-4 py-3 border-r border-slate-100 text-slate-700 whitespace-normal min-w-[160px] text-xs">{g.funding_agency || '—'}</td>
                    <td className="px-4 py-3 border-r border-slate-100 text-slate-600 text-xs">{g.period || '—'}</td>
                    <td className="px-4 py-3 border-r border-slate-100 text-right font-bold text-green-700">
                      {g.grant_amount ? `₹${Number(g.grant_amount).toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button 
                        onClick={() => handleDelete(g.id, g.project_title, g.pi_co_investigator, !!g.is_live)}
                        className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 transition-colors"
                        title="Delete record"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredGrants.length > visibleCount && (
              <div className="flex justify-center p-6 border-t border-slate-100">
                <button
                  onClick={() => setVisibleCount(prev => prev + 30)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-6 py-2 rounded-xl font-bold transition-colors"
                >
                  View More
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
