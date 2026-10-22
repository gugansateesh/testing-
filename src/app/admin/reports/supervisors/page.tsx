'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Download, ExternalLink, X, Upload, Loader2 } from 'lucide-react'
import { useAdminAuth } from '@/context/AdminAuthContext'

export default function SupervisorsReportPage() {
  const router = useRouter()
  const { token } = useAdminAuth()
  
  const [supervisors, setSupervisors] = useState<any[]>([])
  const [supYears, setSupYears] = useState<string[]>([])
  const [activeSupYear, setActiveSupYear] = useState<string>('all')
  const [departments, setDepartments] = useState<string[]>([])
  const [activeDept, setActiveDept] = useState<string>('all')
  const [search, setSearch] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [visibleSupCount, setVisibleSupCount] = useState(30)

  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append')
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchSupervisors = useCallback(async (year: string, dept: string, sDate: string, eDate: string, tok: string) => {
    try {
      setSupervisors([])
      setVisibleSupCount(30)
      const yearQuery = year === 'all' ? '' : year
      const deptQuery = dept === 'all' ? '' : encodeURIComponent(dept)
      const sDateQuery = sDate ? `&startDate=${sDate}` : ''
      const eDateQuery = eDate ? `&endDate=${eDate}` : ''
      const res = await fetch(`/api/admin/reports/supervisors?year=${yearQuery}&dept=${deptQuery}${sDateQuery}${eDateQuery}&_t=${Date.now()}`, { headers: { Authorization: `Bearer ${tok}` } })
      if (res.ok) {
        const { data, departments: deptList, years: yearList } = await res.json()
        setSupervisors(data || [])
        
        if (yearList && yearList.length > 0) {
          setSupYears(prev => prev.length > 0 ? prev : yearList)
        }
        if (deptList && deptList.length > 0) {
          setDepartments(prev => prev.length > 0 ? prev : deptList)
        }
      } else {
        console.error('Supervisors fetch failed', res.status)
      }
    } catch (err) {}
  }, [])


  useEffect(() => {
    if (!token) return
    let mounted = true
    const init = async () => {
      await fetchSupervisors(activeSupYear, activeDept, startDate, endDate, token)
      if (mounted) setLoading(false)
    }
    init()
    return () => { mounted = false }
  }, [token, activeSupYear, activeDept, startDate, endDate, fetchSupervisors])

  const exportSupervisors = async () => {
    if (!token) return
    try {
      const yearQuery = activeSupYear === 'all' ? '' : activeSupYear
      const deptQuery = activeDept === 'all' ? '' : encodeURIComponent(activeDept)
      
      const queryParams = new URLSearchParams()
      if (yearQuery) queryParams.set('year', yearQuery)
      if (deptQuery) queryParams.set('dept', deptQuery)
      if (startDate) queryParams.set('startDate', startDate)
      if (endDate) queryParams.set('endDate', endDate)
      queryParams.set('token', token)
      
      const url = `/api/admin/reports/supervisors/export?${queryParams.toString()}`
      
      const res = await fetch(url)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      const label = []
      if (yearQuery) label.push(yearQuery)
      if (deptQuery) label.push(deptQuery)
      if (startDate) label.push(`From_${startDate}`)
      if (endDate) label.push(`To_${endDate}`)
      a.download = `Supervisors_${label.length ? label.join('_') : 'All'}.xlsx`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(downloadUrl)
      a.remove()
    } catch (err) {
      console.error(err)
      alert('Failed to export supervisors')
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
      if (!confirm('WARNING: This will permanently delete ALL existing supervisor records before importing the new file. Are you sure you want to replace all data?')) {
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }
    }

    try {
      setImporting(true)
      const formData = new FormData()
      formData.append('file', file)
      formData.append('mode', importMode)

      console.log('[Supervisor Import Client] Sending mode:', formData.get('mode'))

      const res = await fetch('/api/admin/reports/supervisors/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      })

      const result = await res.json()
      console.log('[Supervisor Import Client] Full Diagnostic Payload:', result)

      // Always refetch if we hit the server to ensure table is not stale
      await fetchSupervisors(activeSupYear, activeDept, startDate, endDate, token)

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
      alert('Failed to import supervisors (Client Exception: ' + String(err) + ')')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  if (loading) return <div className="p-8 text-center"><div className="w-8 h-8 mx-auto border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>

  const filteredSupervisors = supervisors.filter(p => {
    if (!search) return true
    const q = search.toLowerCase()
    return (
      (p.supervisor_name || '').toLowerCase().includes(q) ||
      (p.research_area || '').toLowerCase().includes(q) ||
      (p.ref_no || '').toLowerCase().includes(q) ||
      (p.department || '').toLowerCase().includes(q)
    )
  })

  return (
    <div className="min-h-screen bg-slate-50 p-6 font-sans text-slate-900">
      <div className="w-full mx-auto space-y-6">
        <Link href="/admin/reports" className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 font-medium">
          <ArrowLeft className="w-4 h-4" /> Back to Reports Overview
        </Link>
        
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <h1 className="text-3xl font-black text-[#0A3D8F]">Supervisors</h1>
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
            <button onClick={exportSupervisors} className="flex items-center gap-2 bg-white border border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-slate-700 hover:text-blue-700 dark:bg-slate-700 dark:border-slate-500 dark:text-slate-100 dark:hover:bg-blue-700 dark:hover:border-blue-500 dark:hover:text-white px-4 py-2 rounded-xl font-bold transition-all shadow-sm text-sm">
              <Download className="w-4 h-4" /> Export Excel
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-end border-b border-slate-200 bg-blue-50">
            <div className="flex flex-wrap items-center gap-3 p-3 w-full md:w-auto shrink-0">
              <select 
                value={activeSupYear} 
                onChange={(e) => setActiveSupYear(e.target.value)}
                className="w-full md:w-auto bg-white border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Years</option>
                {supYears.map(yr => (
                  <option key={yr} value={yr}>{yr}</option>
                ))}
              </select>
              <div className="flex items-center gap-1.5 bg-white border border-slate-300 rounded-lg px-2.5 py-1.5">
                <input 
                  type="text" 
                  placeholder="Search supervisor, area, ref..." 
                  value={search} 
                  onChange={e => setSearch(e.target.value)}
                  className="bg-transparent text-sm focus:outline-none w-48"
                />
                {search && (
                  <button onClick={() => setSearch('')} className="text-slate-400 hover:text-red-500">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              <select 
                value={activeDept} 
                onChange={(e) => setActiveDept(e.target.value)}
                className="w-full md:w-auto bg-white border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Departments</option>
                {departments.map(dept => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>

              <div className="flex items-center justify-center px-3 py-2 bg-[#0A3D8F]/10 text-[#0A3D8F] text-sm font-bold rounded-lg border border-[#0A3D8F]/20 whitespace-nowrap">
                {filteredSupervisors.length} {filteredSupervisors.length === 1 ? 'Result' : 'Results'}
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#0A3D8F] text-white">
                <tr>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">S.No</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Dept</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Ref No.</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Supervisor Name</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800 min-w-[200px]">Research Area</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800 text-center">Current Scholars</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800 text-center">Slots Available</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredSupervisors.length === 0 ? (
                  <tr><td colSpan={7} className="px-4 py-8 text-center text-slate-500 font-medium">No supervisors found.</td></tr>
                ) : filteredSupervisors.slice(0, visibleSupCount).map((p, idx) => (
                    <tr key={p.id} className="hover:bg-blue-50 transition-colors">
                      <td className="px-4 py-3 border-r border-slate-100 font-medium text-slate-500 text-center">{idx + 1}</td>
                      <td className="px-4 py-3 border-r border-slate-100 font-bold text-slate-700">{p.department}</td>
                      <td className="px-4 py-3 border-r border-slate-100 text-slate-600 font-mono text-xs">{p.ref_no}</td>
                      <td className="px-4 py-3 border-r border-slate-100 font-bold text-[#0A3D8F] whitespace-normal min-w-[150px]">{p.supervisor_name}</td>
                      <td className="px-4 py-3 border-r border-slate-100 text-slate-600 whitespace-normal min-w-[200px] text-sm">{p.research_area}</td>
                      <td className="px-4 py-3 border-r border-slate-100 text-center font-bold text-slate-700">{p.current_scholars_count}</td>
                      <td className="px-4 py-3 border-r border-slate-100 text-center font-bold text-slate-700">{p.slots_available}</td>
                    </tr>
                ))}
              </tbody>
            </table>
            {filteredSupervisors.length > visibleSupCount && (
              <div className="flex justify-center p-6 border-t border-slate-100">
                <button onClick={() => setVisibleSupCount(prev => prev + 30)} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-6 py-2 rounded-xl font-bold transition-colors">
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
