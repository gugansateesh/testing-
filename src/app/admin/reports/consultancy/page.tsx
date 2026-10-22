'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Download, Upload, Loader2, Trash2 } from 'lucide-react'
import { useAdminAuth } from '@/context/AdminAuthContext'

export default function ConsultancyReportPage() {
  const router = useRouter()
  const { token } = useAdminAuth()

  const [consultancies, setConsultancies] = useState<any[]>([])
  const [years, setYears] = useState<string[]>([])
  const [activeYear, setActiveYear] = useState<string>('all')
  const [departments, setDepartments] = useState<string[]>([])
  const [activeDept, setActiveDept] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [visibleCount, setVisibleCount] = useState(30)
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append')
  const [totalAmount, setTotalAmount] = useState(0)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDelete = async (id: string, title: string, facultyName: string) => {
    const confirmMsg = `Delete '${title}' by ${facultyName || 'Unknown'}? This cannot be undone.`
    if (!window.confirm(confirmMsg)) return

    try {
      const url = `/api/admin/reports/consultancy/${id}`
      const res = await fetch(url, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      const data = await res.json()
      if (res.ok) {
        setConsultancies(prev => prev.filter(c => c.id !== id))
      } else {
        alert(data.error || 'Failed to delete record')
      }
    } catch (e: any) {
      console.error(e)
      alert('Error deleting record: ' + e.message)
    }
  }

  const fetchConsultancies = useCallback(async (year: string, dept: string, sDate: string, eDate: string, tok: string) => {
    try {
      setConsultancies([])
      setVisibleCount(30)
      const yearQ = year === 'all' ? '' : encodeURIComponent(year)
      const deptQ = dept === 'all' ? '' : encodeURIComponent(dept)
      const sDateQ = sDate ? `&startDate=${sDate}` : ''
      const eDateQ = eDate ? `&endDate=${eDate}` : ''
      const res = await fetch(
        `/api/admin/reports/consultancy?year=${yearQ}&dept=${deptQ}${sDateQ}${eDateQ}&_t=${Date.now()}`,
        { headers: { Authorization: `Bearer ${tok}` } }
      )
      if (res.ok) {
        const { data, departments: deptList, years: yearList, totalAmount: apiTotal } = await res.json()
        setConsultancies(data || [])
        setTotalAmount(apiTotal || 0)
        if (yearList && yearList.length > 0) {
          setYears(prev => prev.length > 0 ? prev : yearList)
        }
        if (deptList && deptList.length > 0) {
          setDepartments(prev => prev.length > 0 ? prev : deptList)
        }
      } else {
        console.error('Consultancy fetch failed', res.status)
      }
    } catch (err) { console.error(err) }
  }, [])


  useEffect(() => {
    if (!token) return
    let mounted = true
    const init = async () => {
      await fetchConsultancies(activeYear, activeDept, startDate, endDate, token)
      if (mounted) setLoading(false)
    }
    init()
    return () => { mounted = false }
  }, [token, activeYear, activeDept, startDate, endDate, fetchConsultancies])

  const exportConsultancies = async () => {
    if (!token) return
    try {
      const params = new URLSearchParams()
      if (activeYear !== 'all') params.set('year', activeYear)
      if (activeDept !== 'all') params.set('dept', activeDept)
      if (startDate) params.set('startDate', startDate)
      if (endDate) params.set('endDate', endDate)
      params.set('token', token)
      const res = await fetch(`/api/admin/reports/consultancy/export?${params}`)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      const label = [activeYear !== 'all' ? activeYear : '', activeDept !== 'all' ? activeDept : ''].filter(Boolean)
      a.download = `ConsultancyProjects_${label.length ? label.join('_') : 'All'}.xlsx`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(url)
      a.remove()
    } catch (err) {
      console.error(err)
      alert('Failed to export consultancy data')
    }
  }

  const handleUploadClick = (mode: 'append' | 'replace') => {
    setImportMode(mode)
    fileInputRef.current?.click()
  }

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (!token) return

    if (importMode === 'replace') {
      if (!confirm('WARNING: This will permanently delete ALL existing consultancy records before importing the new file. Are you sure you want to replace all data?')) {
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }
    }

    try {
      setImporting(true)
      const formData = new FormData()
      formData.append('file', file)
      formData.append('mode', importMode)

      const res = await fetch('/api/admin/reports/consultancy/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData,
      })

      const result = await res.json()

      // Always refetch after import
      await fetchConsultancies(activeYear, activeDept, startDate, endDate, token)
      // Also refresh year tabs from fresh 'all' fetch
      await fetchConsultancies('all', 'all', '', '', token)
      await fetchConsultancies(activeYear, activeDept, startDate, endDate, token)

      if (res.ok) {
        let msg = `Import API Returned OK.\nMode: ${result.mode}\nImported: ${result.imported}\nDeleted: ${result.deleted || 0}\nSkipped: ${result.skipped}\n\nSheets:\n`
        if (result.sheets) {
          result.sheets.forEach((s: any) => {
            msg += `- ${s.name}: ${s.skipped ? 'Skipped' : `Parsed ${s.rowsParsed} (found ${s.rowsFound}, skipped ${s.rowsSkipped}). Error: ${s.error || 'none'}`}\n`
          })
        }
        if (result.errors && result.errors.length > 0) {
          msg += `\nErrors:\n`
          result.errors.forEach((e: any) => {
            msg += `- ${e.sheet}: ${e.error}\n`
          })
        }
        alert(msg)
      } else {
        let msg = `Import API Failed (Status ${res.status}).\nError: ${result.error}\n\nDetails: ${JSON.stringify(result.details || {})}\n`
        if (result.sheets && result.sheets.length > 0) {
          msg += `\nSheets processed before failure:\n`
          result.sheets.forEach((s: any) => {
            msg += `- ${s.name}: ${s.skipped ? 'Skipped' : `Parsed ${s.rowsParsed}`}\n`
          })
        }
        alert(msg)
      }
    } catch (err) {
      console.error(err)
      alert('Failed to import consultancy data (Client Exception: ' + String(err) + ')')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

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

  const filteredConsultancies = consultancies.filter(c => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (c.project_title || '').toLowerCase().includes(q) ||
      (c.faculty_name || '').toLowerCase().includes(q) ||
      (c.funding_agency || '').toLowerCase().includes(q) ||
      (c.department || '').toLowerCase().includes(q)
    )
  })

  const filteredTotal = filteredConsultancies.reduce((sum, c) => sum + (Number(c.amount) || 0), 0)

  return (
    <div className="min-h-screen bg-slate-50 p-6 font-sans text-slate-900">
      <div className="w-full mx-auto space-y-6">
        <Link href="/admin/reports" className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 font-medium">
          <ArrowLeft className="w-4 h-4" /> Back to Reports Overview
        </Link>

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black text-[#0A3D8F]">Consultancy Projects</h1>
            <p className="text-slate-500 text-sm mt-1">Historical consultancy & corporate training projects by faculty</p>
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
              onClick={() => handleUploadClick('append')}
              disabled={importing}
              className="flex items-center gap-2 bg-[#FDB813] hover:bg-yellow-400 text-[#0A3D8F] px-4 py-2 rounded-xl font-bold transition-all shadow-sm text-sm disabled:opacity-50"
            >
              {importing && importMode === 'append' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {importing && importMode === 'append' ? 'Importing...' : 'Upload Excel'}
            </button>
            <button
              onClick={() => handleUploadClick('replace')}
              disabled={importing}
              className="flex items-center gap-2 bg-red-100 hover:bg-red-200 text-red-700 px-4 py-2 rounded-xl font-bold transition-all shadow-sm text-sm disabled:opacity-50 border border-red-200"
            >
              {importing && importMode === 'replace' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {importing && importMode === 'replace' ? 'Replacing...' : 'Replace All Data'}
            </button>
            <button
              onClick={exportConsultancies}
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
                {years.map(yr => (
                  <option key={yr} value={yr}>{yr}</option>
                ))}
              </select>
              <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-lg px-3 py-1">
                <span className="text-xs font-semibold text-slate-500">Date From:</span>
                <input
                  type="date"
                  value={startDate}
                  onChange={e => setStartDate(e.target.value)}
                  className="bg-transparent text-slate-700 text-sm font-semibold focus:outline-none"
                />
              </div>
              <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-lg px-3 py-1">
                <span className="text-xs font-semibold text-slate-500">To:</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={e => setEndDate(e.target.value)}
                  className="bg-transparent text-slate-700 text-sm font-semibold focus:outline-none"
                />
                {(startDate || endDate) && (
                  <button
                    onClick={() => { setStartDate(''); setEndDate('') }}
                    className="ml-2 text-slate-400 hover:text-red-500"
                  >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
              </div>
              <div className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5">
                <input 
                  type="text" 
                  placeholder="Search project, faculty, agency..." 
                  value={search} 
                  onChange={e => setSearch(e.target.value)}
                  className="bg-transparent text-sm focus:outline-none w-44"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="text-slate-400 hover:text-red-500">
                    <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
              </div>
              <select
                value={activeDept}
                onChange={e => setActiveDept(e.target.value)}
                className="w-full md:w-auto bg-white border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Departments</option>
                {departments.map(dept => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
              <div className="flex items-center justify-center px-3 py-2 bg-[#0A3D8F]/10 text-[#0A3D8F] text-sm font-bold rounded-lg border border-[#0A3D8F]/20 whitespace-nowrap">
                {filteredConsultancies.length} {filteredConsultancies.length === 1 ? 'Result' : 'Results'}
              </div>
            </div>
          </div>

          {/* Total Amount banner */}
          <div className="bg-gradient-to-r from-[#0A3D8F]/5 to-[#0A3D8F]/10 border-b border-slate-200 px-6 py-3 flex items-center justify-between">
            <span className="text-sm font-semibold text-slate-600">
              Total Consultancy Amount {activeDept !== 'all' || startDate || endDate || activeYear !== 'all' || search ? '(filtered)' : ''}
            </span>
            <span className="text-xl font-black text-[#0A3D8F]">{formatCurrency(filteredTotal)}</span>
          </div>

          {/* Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#0A3D8F] text-white">
                <tr>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800 text-center">S.No</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Academic Year</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Dept</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Date</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800 min-w-[200px]">Faculty Name</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800 min-w-[320px]">Project Title</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800 min-w-[180px]">Funding Agency</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800 text-right">Amount</th>
                  <th className="px-4 py-3 font-semibold text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredConsultancies.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="px-4 py-8 text-center text-slate-500 font-medium">
                      {consultancies.length === 0
                        ? 'No consultancy records found. Upload an Excel file to import data.'
                        : 'No records match the current filters.'}
                    </td>
                  </tr>
                ) : filteredConsultancies.slice(0, visibleCount).map((c, idx) => (
                  <tr key={c.id} className="hover:bg-blue-50 transition-colors">
                    <td className="px-4 py-3 border-r border-slate-100 font-medium text-slate-500 text-center">{idx + 1}</td>
                    <td className="px-4 py-3 border-r border-slate-100 font-bold text-[#0A3D8F] text-center">{c.academic_year || '—'}</td>
                    <td className="px-4 py-3 border-r border-slate-100 font-bold text-slate-700">{c.department || '—'}</td>
                    <td className="px-4 py-3 border-r border-slate-100 text-slate-600">
                      {c.project_date ? new Date(c.project_date).toLocaleDateString('en-IN') : '—'}
                    </td>
                    <td className="px-4 py-3 border-r border-slate-100 text-slate-800 font-semibold whitespace-normal min-w-[200px] text-xs">{c.faculty_name || '—'}</td>
                    <td className="px-4 py-3 border-r border-slate-100 font-medium text-[#0A3D8F] whitespace-normal min-w-[320px] text-xs">{c.project_title || '—'}</td>
                    <td className="px-4 py-3 border-r border-slate-100 text-slate-600 text-xs whitespace-normal min-w-[180px]">{c.funding_agency || '—'}</td>
                    <td className="px-4 py-3 border-r border-slate-100 text-slate-700 text-right font-bold">
                      {c.amount ? `₹${Number(c.amount).toLocaleString('en-IN')}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <button 
                        onClick={() => handleDelete(c.id, c.project_title, c.faculty_name)}
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
            {filteredConsultancies.length > visibleCount && (
              <div className="flex justify-center p-6 border-t border-slate-100">
                <button
                  onClick={() => setVisibleCount(prev => prev + 30)}
                  className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-6 py-2 rounded-xl font-bold transition-colors"
                >
                  View More List
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
