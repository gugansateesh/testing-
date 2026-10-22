'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Download, ExternalLink, X, Upload, Loader2, Info, Trash2, Pencil } from 'lucide-react'
import { useAdminAuth } from '@/context/AdminAuthContext'

export default function PatentsReportPage() {
  const router = useRouter()
  const { token } = useAdminAuth()
  
  const [patents, setPatents] = useState<any[]>([])
  const [patYears, setPatYears] = useState<string[]>([])
  const [activePatYear, setActivePatYear] = useState<string>('all')
  const [departments, setDepartments] = useState<string[]>([])
  const [activeDept, setActiveDept] = useState<string>('all')
  const [activeStatus, setActiveStatus] = useState<string>('all')
  const [activeGrantType, setActiveGrantType] = useState<string>('all')
  const [activeJurisdiction, setActiveJurisdiction] = useState<string>('all')
  const [appNumberSearch, setAppNumberSearch] = useState<string>('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [visiblePatCount, setVisiblePatCount] = useState(30)
  const [viewPatent, setViewPatent] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append')
  const [updatingId, setUpdatingId] = useState<string | null>(null)
  const [editPatent, setEditPatent] = useState<any>(null)
  const [editSaving, setEditSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDelete = async (id: string, title: string, inventors: string) => {
    const confirmMsg = `Delete '${title}' by ${inventors || 'Unknown'}? This cannot be undone.`
    if (!window.confirm(confirmMsg)) return

    try {
      const url = `/api/admin/reports/patents/${id}`
      const res = await fetch(url, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      const data = await res.json()
      if (res.ok) {
        setPatents(prev => prev.filter(p => p.id !== id))
      } else {
        alert(data.error || 'Failed to delete record')
      }
    } catch (e: any) {
      console.error(e)
      alert('Error deleting record: ' + e.message)
    }
  }

  const handleSaveEditPatent = async () => {
    if (!editPatent || !token) return
    setEditSaving(true)
    try {
      const res = await fetch(`/api/admin/reports/patents/${editPatent.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title: editPatent.title,
          inventors: editPatent.inventors,
          applicants: editPatent.applicants,
          assignee: editPatent.assignee,
          department: editPatent.department,
          application_number: editPatent.application_number,
          status: editPatent.status,
          filed_date: editPatent.filed_date || null,
          published_or_granted_date: editPatent.published_or_granted_date || null,
          publication_or_grant_number: editPatent.publication_or_grant_number,
          academic_year: editPatent.academic_year,
          institute_faculty: editPatent.institute_faculty,
          name_of_faculty: editPatent.name_of_faculty,
          type: editPatent.type,
          proof_link: editPatent.proof_link,
          patent_type: editPatent.patent_type,
          jurisdiction: editPatent.jurisdiction,
        })
      })
      if (res.ok) {
        setPatents(prev => prev.map(p => p.id === editPatent.id ? { ...p, ...editPatent } : p))
        setEditPatent(null)
      } else {
        const err = await res.json()
        alert(err.error || 'Failed to save')
      }
    } catch (e: any) {
      alert('Error saving: ' + e.message)
    } finally {
      setEditSaving(false)
    }
  }

  const handleJurisdictionChange = async (id: string, newJurisdiction: string) => {
    if (!token) return
    setUpdatingId(id)
    try {
      const res = await fetch('/api/admin/reports/patents/jurisdiction', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, jurisdiction: newJurisdiction })
      })
      if (res.ok) {
        const updated = await res.json()
        setPatents(prev => prev.map(p => p.id === id ? { ...p, jurisdiction: updated.jurisdiction } : p))
      } else {
        alert('Failed to update jurisdiction')
      }
    } catch (err) {
      console.error(err)
      alert('Error updating jurisdiction')
    } finally {
      setUpdatingId(null)
    }
  }

  const handlePatentTypeChange = async (id: string, newType: string) => {
    if (!token) return
    setUpdatingId(id + '-type')
    try {
      const res = await fetch('/api/admin/reports/patents/patent-type', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ id, patent_type: newType })
      })
      if (res.ok) {
        const updated = await res.json()
        setPatents(prev => prev.map(p => p.id === id ? { ...p, patent_type: updated.patent_type } : p))
      } else {
        alert('Failed to update patent type')
      }
    } catch (err) {
      console.error(err)
      alert('Error updating patent type')
    } finally {
      setUpdatingId(null)
    }
  }

  const getGrantType = (inventors: string | undefined | null) => {
    if (!inventors) return 'Staff'
    const name = inventors.replace(/^\s*\d+[\).]\s*/, '').trim().toLowerCase()
    return name === 'sri eshwar college of engineering' ? 'College' : 'Staff'
  }

  const getExpiryDate = (p: any) => {
    if (p.status?.toLowerCase() === 'granted' && p.filed_date) {
      const fd = new Date(p.filed_date)
      if (!isNaN(fd.getTime())) {
        fd.setFullYear(fd.getFullYear() + 20)
        return fd.toLocaleDateString('en-IN')
      }
    }
    return '—'
  }

  const [activePatentType, setActivePatentType] = useState<string>('all')

  const filteredPatents = patents.filter(p => {
    if (activeGrantType !== 'all') {
      if (getGrantType(p.inventors) !== activeGrantType) return false
    }
    if (activeJurisdiction !== 'all') {
      const rowJur = p.jurisdiction || 'Unconfirmed'
      if (rowJur !== activeJurisdiction) return false
    }
    if (activePatentType !== 'all') {
      const rowType = p.patent_type || 'Utility'
      if (rowType !== activePatentType) return false
    }
    if (appNumberSearch) {
      const q = appNumberSearch.toLowerCase()
      if (!p.application_number?.toLowerCase().includes(q) &&
          !p.title?.toLowerCase().includes(q) &&
          !p.inventors?.toLowerCase().includes(q)) {
        return false
      }
    }
    return true
  })

  const fetchPatents = useCallback(async (year: string, dept: string, status: string, sDate: string, eDate: string, tok: string) => {
    try {
      setPatents([])
      setVisiblePatCount(30)
      const yearQuery = year === 'all' ? '' : year
      const deptQuery = dept === 'all' ? '' : encodeURIComponent(dept)
      const statusQuery = status === 'all' ? '' : encodeURIComponent(status)
      const sDateQuery = sDate ? `&startDate=${sDate}` : ''
      const eDateQuery = eDate ? `&endDate=${eDate}` : ''
      const res = await fetch(`/api/admin/reports/patents?year=${yearQuery}&dept=${deptQuery}&status=${statusQuery}${sDateQuery}${eDateQuery}&_t=${Date.now()}`, { headers: { Authorization: `Bearer ${tok}` } })
      if (res.ok) {
        const { data, departments: deptList, years: yearList } = await res.json()
        setPatents(data || [])
        
        if (yearList && yearList.length > 0) {
          setPatYears(prev => prev.length > 0 ? prev : yearList)
        }
        if (deptList && deptList.length > 0) {
          setDepartments(prev => prev.length > 0 ? prev : deptList)
        }
      } else {
        console.error('Patents fetch failed', res.status)
      }
    } catch (err) {}
  }, [])


  useEffect(() => {
    if (!token) return
    let mounted = true
    const init = async () => {
      await fetchPatents(activePatYear, activeDept, activeStatus, startDate, endDate, token)
      if (mounted) setLoading(false)
    }
    init()
    return () => { mounted = false }
  }, [token, activePatYear, activeDept, activeStatus, startDate, endDate, fetchPatents])

  const exportPatents = async () => {
    if (!token) return
    try {
      const yearQuery = activePatYear === 'all' ? '' : activePatYear
      const deptQuery = activeDept === 'all' ? '' : encodeURIComponent(activeDept)
      const statusQuery = activeStatus === 'all' ? '' : encodeURIComponent(activeStatus)
      const jurQuery = activeJurisdiction === 'all' ? '' : encodeURIComponent(activeJurisdiction)
      
      const queryParams = new URLSearchParams()
      if (yearQuery) queryParams.set('year', yearQuery)
      if (deptQuery) queryParams.set('dept', deptQuery)
      if (statusQuery) queryParams.set('status', statusQuery)
      if (jurQuery) queryParams.set('jurisdiction', jurQuery)
      if (startDate) queryParams.set('startDate', startDate)
      if (endDate) queryParams.set('endDate', endDate)
      queryParams.set('token', token)
      
      const url = `/api/admin/reports/patents/export?${queryParams.toString()}`
      
      const res = await fetch(url)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      const label = []
      if (yearQuery) label.push(yearQuery)
      if (deptQuery) label.push(deptQuery)
      if (statusQuery) label.push(statusQuery)
      if (startDate) label.push(`From_${startDate}`)
      if (endDate) label.push(`To_${endDate}`)
      a.download = `Patents_${label.length ? label.join('_') : 'All'}.xlsx`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(downloadUrl)
      a.remove()
    } catch (err) {
      console.error(err)
      alert('Failed to export patents')
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
      if (!confirm('WARNING: This will permanently delete ALL existing patent records before importing the new file. Are you sure you want to replace all data?')) {
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }
    }

    try {
      setImporting(true)
      const formData = new FormData()
      formData.append('file', file)
      formData.append('mode', importMode)

      console.log('[Patent Import Client] Sending mode:', formData.get('mode'))

      const res = await fetch('/api/admin/reports/patents/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      })

      const result = await res.json()
      console.log('[Patent Import Client] Full Diagnostic Payload:', result)

      // Always refetch if we hit the server to ensure table is not stale
      await fetchPatents(activePatYear, activeDept, activeStatus, startDate, endDate, token)

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
      alert('Failed to import patents (Client Exception: ' + String(err) + ')')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  if (loading) return <div className="p-8 text-center"><div className="w-8 h-8 mx-auto border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>

  return (
    <div className="min-h-screen bg-slate-50 p-6 font-sans text-slate-900">
      <div className="w-full mx-auto space-y-6">
        <Link href="/admin/reports" className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 font-medium">
          <ArrowLeft className="w-4 h-4" /> Back to Reports Overview
        </Link>
        
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <h1 className="text-3xl font-black text-[#0A3D8F]">Patents</h1>
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
            <button onClick={exportPatents} className="flex items-center gap-2 bg-white border border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-slate-700 hover:text-blue-700 dark:bg-slate-700 dark:border-slate-500 dark:text-slate-100 dark:hover:bg-blue-700 dark:hover:border-blue-500 dark:hover:text-white px-4 py-2 rounded-xl font-bold transition-all shadow-sm text-sm">
              <Download className="w-4 h-4" /> Export Excel
            </button>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <div className="flex flex-col md:flex-row md:items-center justify-end border-b border-slate-200 bg-blue-50">
            <div className="flex flex-wrap items-center gap-3 p-3 w-full md:w-auto shrink-0">
              <select 
                value={activePatYear} 
                onChange={(e) => setActivePatYear(e.target.value)}
                className="w-full md:w-auto bg-white border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Years</option>
                {patYears.map(yr => (
                  <option key={yr} value={yr}>{yr}</option>
                ))}
              </select>
              <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-lg px-3 py-1">
                <span className="text-xs font-semibold text-slate-500">From:</span>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-transparent text-slate-700 text-sm font-semibold focus:outline-none" />
              </div>
              <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-lg px-3 py-1">
                <span className="text-xs font-semibold text-slate-500">To:</span>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-transparent text-slate-700 text-sm font-semibold focus:outline-none" />
                {(startDate || endDate) && (
                  <button onClick={() => { setStartDate(''); setEndDate(''); }} className="ml-2 text-slate-400 hover:text-red-500">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
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
              <select 
                value={activeStatus} 
                onChange={(e) => setActiveStatus(e.target.value)}
                className="w-full md:w-auto bg-white border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Statuses</option>
                <option value="Published">Published</option>
                <option value="Design Grant">Design Grant</option>
                <option value="Granted">Granted</option>
              </select>
              <select 
                value={activeGrantType} 
                onChange={(e) => setActiveGrantType(e.target.value)}
                className="w-full md:w-auto bg-white border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Grant Types</option>
                <option value="College">College Grant</option>
                <option value="Staff">Staff Grant</option>
              </select>
              <select 
                value={activeJurisdiction} 
                onChange={(e) => setActiveJurisdiction(e.target.value)}
                className="w-full md:w-auto bg-white border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Jurisdictions</option>
                <option value="Unconfirmed">Unconfirmed</option>
                {Array.from(new Set(patents.map(p => p.jurisdiction || 'Unconfirmed'))).filter(j => j !== 'Unconfirmed').sort().map(j => (
                  <option key={j} value={j}>{j}</option>
                ))}
              </select>
              <select 
                value={activePatentType} 
                onChange={(e) => setActivePatentType(e.target.value)}
                className="w-full md:w-auto bg-white border border-slate-300 text-slate-700 text-sm font-semibold rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-purple-500"
              >
                <option value="all">All Types</option>
                <option value="Utility">Utility Patent</option>
                <option value="Design">Design Patent</option>
                <option value="Copyright">Copyright</option>
              </select>
              <div className="flex items-center gap-2 bg-white border border-slate-300 rounded-lg px-3 py-1">
                <input 
                  type="text" 
                  placeholder="Search app no, title, inventor..."
                  value={appNumberSearch} 
                  onChange={e => setAppNumberSearch(e.target.value)} 
                  className="bg-transparent text-slate-700 text-sm font-semibold focus:outline-none w-52" 
                />
                {appNumberSearch && (
                  <button onClick={() => setAppNumberSearch('')} className="ml-1 text-slate-400 hover:text-red-500">
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
              <div className="flex items-center justify-center px-3 py-2 bg-[#0A3D8F]/10 text-[#0A3D8F] text-sm font-bold rounded-lg border border-[#0A3D8F]/20 whitespace-nowrap">
                {filteredPatents.length} {filteredPatents.length === 1 ? 'Result' : 'Results'}
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#0A3D8F] text-white">
                <tr>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">S.No</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Dept</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">App No.</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Type</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Status</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800 min-w-[150px]">Inventors</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800 min-w-[200px]">Title</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Filed Date</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800 text-emerald-100">Validity Expires On</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Pub/Grant Date</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Pub/Grant No.</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Proof</th>
                  <th className="px-4 py-3 font-semibold text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPatents.length === 0 ? (
                  <tr><td colSpan={13} className="px-4 py-8 text-center text-slate-500 font-medium">No patents found.</td></tr>
                ) : filteredPatents.slice(0, visiblePatCount).map((p, idx) => (
                    <tr key={p.id} className="hover:bg-blue-50 transition-colors">
                      <td className="px-4 py-3 border-r border-slate-100 font-medium text-slate-500 text-center">{idx + 1}</td>
                      <td className="px-4 py-3 border-r border-slate-100 font-bold text-slate-700">{p.department}</td>
                      <td className="px-4 py-3 border-r border-slate-100 text-slate-600">
                        <div>{p.application_number}</div>
                        <div className="mt-1 flex items-center gap-2 flex-wrap">
                          <div 
                            title={`Raw Inventor(s):\n${p.inventors || 'None'}`}
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] uppercase tracking-wider font-bold bg-blue-100 text-blue-700 cursor-help"
                          >
                             {getGrantType(p.inventors)}
                             <Info className="w-3 h-3 ml-1 opacity-50 hover:opacity-100" />
                          </div>
                          {updatingId === p.id ? (
                            <Loader2 className="w-3 h-3 animate-spin text-slate-400" />
                          ) : (
                            <select
                              value={p.jurisdiction || ''}
                              onChange={(e) => handleJurisdictionChange(p.id, e.target.value)}
                              className={`text-[9px] uppercase tracking-wider font-bold rounded px-1 py-0.5 outline-none cursor-pointer border ${!p.jurisdiction ? 'bg-orange-100 text-orange-700 border-orange-200' : 'bg-purple-100 text-purple-700 border-purple-200'}`}
                            >
                              <option value="" disabled>Unconfirmed</option>
                              <option value="India">India</option>
                              <option value="USA">USA</option>
                              <option value="UK">UK</option>
                              <option value="Australia">Australia</option>
                              <option value="EPO">EPO</option>
                              <option value="WIPO">WIPO</option>
                              <option value="Other">Other</option>
                            </select>
                          )}
                        </div>
                      </td>
                      {/* Patent Type inline dropdown */}
                      <td className="px-4 py-3 border-r border-slate-100">
                        {updatingId === p.id + '-type' ? (
                          <Loader2 className="w-3 h-3 animate-spin text-slate-400" />
                        ) : (
                          <select
                            value={p.patent_type || 'Utility'}
                            onChange={(e) => handlePatentTypeChange(p.id, e.target.value)}
                            className={`text-[9px] uppercase tracking-wider font-bold rounded px-1.5 py-0.5 outline-none cursor-pointer border ${
                              p.patent_type === 'Design' ? 'bg-pink-100 text-pink-700 border-pink-200' :
                              p.patent_type === 'Copyright' ? 'bg-amber-100 text-amber-700 border-amber-200' :
                              'bg-indigo-100 text-indigo-700 border-indigo-200'
                            }`}
                          >
                            <option value="Utility">Utility</option>
                            <option value="Design">Design</option>
                            <option value="Copyright">Copyright</option>
                          </select>
                        )}
                      </td>
                      <td className="px-4 py-3 border-r border-slate-100 text-slate-800 font-semibold">{p.status}</td>
                      <td className="px-4 py-3 border-r border-slate-100 text-slate-600 whitespace-normal min-w-[150px] text-xs">{p.inventors}</td>
                      <td className="px-4 py-3 border-r border-slate-100 font-medium text-[#0A3D8F] whitespace-normal min-w-[200px]">{p.title}</td>
                      <td className="px-4 py-3 border-r border-slate-100 text-slate-600">{p.filed_date ? new Date(p.filed_date).toLocaleDateString('en-IN') : ''}</td>
                      <td className="px-4 py-3 border-r border-slate-100 text-emerald-600 font-semibold text-xs">{getExpiryDate(p)}</td>
                      <td className="px-4 py-3 border-r border-slate-100 text-slate-600">{p.published_or_granted_date ? new Date(p.published_or_granted_date).toLocaleDateString('en-IN') : ''}</td>
                      <td className="px-4 py-3 border-r border-slate-100 text-slate-600 font-mono text-xs">{p.publication_or_grant_number}</td>
                      <td className="px-4 py-3 border-r border-slate-100 text-center">
                        {p.proof_link && (
                          <a href={p.proof_link.includes('http') ? p.proof_link : `https://${p.proof_link}`} target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-700 flex justify-center"><ExternalLink className="w-4 h-4" /></a>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => setViewPatent(p)} className="text-xs font-bold text-white bg-[#0A3D8F] hover:bg-blue-800 px-3 py-1.5 rounded-lg transition-colors whitespace-nowrap">
                            View More
                          </button>
                          <button
                            onClick={() => setEditPatent({ ...p })}
                            className="text-blue-500 hover:text-blue-700 p-1.5 rounded hover:bg-blue-50 transition-colors"
                            title="Edit record"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleDelete(p.id, p.title, p.inventors)}
                            className="text-red-500 hover:text-red-700 p-1.5 rounded hover:bg-red-50 transition-colors"
                            title="Delete record"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                ))}
              </tbody>
            </table>
            {filteredPatents.length > visiblePatCount && (
              <div className="flex justify-center p-6 border-t border-slate-100">
                <button onClick={() => setVisiblePatCount(prev => prev + 30)} className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-6 py-2 rounded-xl font-bold transition-colors">
                  View More List
                </button>
              </div>
            )}
          </div>
        </div>

        {viewPatent && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-xl w-full max-w-4xl my-auto flex flex-col max-h-[90vh]">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-blue-50 shrink-0 rounded-t-2xl">
                <div>
                  <h3 className="font-black text-[#0A3D8F] text-xl">Patent Details</h3>
                  <p className="text-sm text-slate-500 font-medium">{viewPatent.department}</p>
                </div>
                <button onClick={() => setViewPatent(null)} className="text-slate-400 hover:text-slate-600 bg-white p-2 rounded-full shadow-sm hover:shadow transition-all">
                  <X className="w-5 h-5" />
                </button>
              </div>
              
              <div className="p-6 overflow-y-auto custom-scrollbar">
                <div className="mb-8">
                  <h2 className="text-2xl font-bold text-slate-800 leading-tight mb-2">{viewPatent.title}</h2>
                  <p className="text-slate-600 font-medium">Inventors: <span className="text-slate-800">{viewPatent.inventors}</span></p>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8 bg-slate-50 p-4 rounded-xl border border-slate-100">
                  <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                    <p className="text-xs font-bold text-slate-400 uppercase mb-1">Department</p>
                    <p className="text-sm font-medium text-slate-800">{viewPatent.department || '—'}</p>
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                    <p className="text-xs font-bold text-slate-400 uppercase mb-1">Academic Year</p>
                    <p className="text-sm font-medium text-slate-800">{viewPatent.academic_year || '—'}</p>
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                    <p className="text-xs font-bold text-slate-400 uppercase mb-1">Application No.</p>
                    <p className="text-sm font-medium text-slate-800">{viewPatent.application_number || '—'}</p>
                  </div>
                  <div className="bg-white p-4 rounded-xl border border-slate-100 shadow-sm">
                    <p className="text-xs font-bold text-slate-400 uppercase mb-1">Status</p>
                    <p className="text-sm font-bold text-emerald-600">{viewPatent.status || '—'}</p>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <div>
                    <h4 className="font-bold text-slate-700 mb-3 pb-2 border-b border-slate-100">Dates & Numbers</h4>
                    <div className="space-y-3">
                      <div className="flex justify-between border-b border-slate-50 pb-2">
                        <span className="text-sm text-slate-500">Filed Date:</span>
                        <span className="text-sm font-medium text-slate-800">{viewPatent.filed_date ? new Date(viewPatent.filed_date).toLocaleDateString('en-IN') : '—'}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-50 pb-2 bg-emerald-50/50 p-2 rounded">
                        <span className="text-sm text-slate-500">Validity Expires On:</span>
                        <span className="text-sm font-bold text-emerald-700">{getExpiryDate(viewPatent)}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-50 pb-2">
                        <span className="text-sm text-slate-500">Pub/Grant Date:</span>
                        <span className="text-sm font-medium text-slate-800">{viewPatent.published_or_granted_date ? new Date(viewPatent.published_or_granted_date).toLocaleDateString('en-IN') : '—'}</span>
                      </div>
                      <div className="flex justify-between border-b border-slate-50 pb-2">
                        <span className="text-sm text-slate-500">Pub/Grant No:</span>
                        <span className="text-sm font-mono text-slate-800">{viewPatent.publication_or_grant_number || '—'}</span>
                      </div>
                    </div>
                  </div>

                  <div>
                    <h4 className="font-bold text-slate-700 mb-3 pb-2 border-b border-slate-100">Additional Details</h4>
                    <div className="space-y-3">
                      <div className="flex flex-col border-b border-slate-50 pb-2 bg-blue-50/50 p-2 rounded">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-bold text-slate-400 uppercase">Grant Type</span>
                          <span className="text-xs font-bold bg-[#0A3D8F] text-white px-2 py-0.5 rounded">{getGrantType(viewPatent.inventors)}</span>
                        </div>
                      </div>
                      <div className="flex flex-col border-b border-slate-50 pb-2 bg-purple-50/50 p-2 rounded">
                        <div className="flex justify-between items-center">
                          <span className="text-xs font-bold text-slate-400 uppercase">Jurisdiction</span>
                          <span className={`text-xs font-bold px-2 py-0.5 rounded ${viewPatent.jurisdiction ? 'bg-purple-600 text-white' : 'bg-orange-500 text-white'}`}>
                            {viewPatent.jurisdiction || 'Unconfirmed'}
                          </span>
                        </div>
                      </div>
                      <div className="flex flex-col border-b border-slate-50 pb-2">
                        <span className="text-xs font-bold text-slate-400 uppercase">Applicants (Raw Value)</span>
                        <span className="text-sm font-medium text-slate-800 mt-1">{viewPatent.applicants || '—'}</span>
                      </div>
                      <div className="flex flex-col border-b border-slate-50 pb-2">
                        <span className="text-xs font-bold text-slate-400 uppercase">Assignee</span>
                        <span className="text-sm font-medium text-slate-800 mt-1">{viewPatent.assignee || '—'}</span>
                      </div>
                      <div className="flex flex-col border-b border-slate-50 pb-2">
                        <span className="text-xs font-bold text-slate-400 uppercase">Faculty / Institute</span>
                        <span className="text-sm font-medium text-slate-800 mt-1">{viewPatent.institute_faculty || '—'}</span>
                      </div>
                      <div className="flex flex-col border-b border-slate-50 pb-2">
                        <span className="text-xs font-bold text-slate-400 uppercase">Type & Name of Faculty</span>
                        <span className="text-sm font-medium text-slate-800 mt-1">{viewPatent.type ? `${viewPatent.type} - ` : ''}{viewPatent.name_of_faculty || '—'}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              <div className="p-4 border-t border-slate-100 bg-slate-50 flex justify-end shrink-0 rounded-b-2xl">
                {viewPatent.proof_link && (
                  <a href={viewPatent.proof_link.includes('http') ? viewPatent.proof_link : `https://${viewPatent.proof_link}`} target="_blank" rel="noreferrer" className="flex items-center gap-2 bg-[#FDB813] hover:bg-yellow-400 text-[#0A3D8F] px-6 py-2.5 rounded-xl font-bold transition-colors">
                    <ExternalLink className="w-4 h-4" /> View Source Proof
                  </a>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Edit Patent Modal */}
        {editPatent && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-auto flex flex-col max-h-[90vh]">
              <div className="px-6 py-4 border-b border-slate-100 flex items-center justify-between bg-blue-50 rounded-t-2xl shrink-0">
                <div>
                  <h3 className="font-black text-[#0A3D8F] text-xl">Edit Patent</h3>
                  <p className="text-xs text-slate-500 mt-0.5">{editPatent.application_number}</p>
                </div>
                <button onClick={() => setEditPatent(null)} className="text-slate-400 hover:text-slate-600 bg-white p-2 rounded-full shadow-sm">
                  <X className="w-5 h-5" />
                </button>
              </div>
              <div className="p-6 overflow-y-auto space-y-4">
                {([
                  { label: 'Title', key: 'title', type: 'textarea' },
                  { label: 'Inventors', key: 'inventors', type: 'textarea' },
                  { label: 'Applicants', key: 'applicants', type: 'text' },
                  { label: 'Assignee', key: 'assignee', type: 'text' },
                  { label: 'Department', key: 'department', type: 'text' },
                  { label: 'Application Number', key: 'application_number', type: 'text' },
                  { label: 'Pub/Grant Number', key: 'publication_or_grant_number', type: 'text' },
                  { label: 'Academic Year', key: 'academic_year', type: 'text' },
                  { label: 'Filed Date', key: 'filed_date', type: 'date' },
                  { label: 'Pub/Grant Date', key: 'published_or_granted_date', type: 'date' },
                  { label: 'Faculty / Institute', key: 'institute_faculty', type: 'text' },
                  { label: 'Name of Faculty', key: 'name_of_faculty', type: 'text' },
                  { label: 'Proof Link', key: 'proof_link', type: 'text' },
                ] as { label: string; key: string; type: string }[]).map(({ label, key, type }) => (
                  <div key={key}>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{label}</label>
                    {type === 'textarea' ? (
                      <textarea
                        rows={2}
                        value={editPatent[key] || ''}
                        onChange={e => setEditPatent((prev: any) => ({ ...prev, [key]: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    ) : (
                      <input
                        type={type}
                        value={editPatent[key] || ''}
                        onChange={e => setEditPatent((prev: any) => ({ ...prev, [key]: e.target.value }))}
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    )}
                  </div>
                ))}
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Status</label>
                    <select
                      value={editPatent.status || ''}
                      onChange={e => setEditPatent((prev: any) => ({ ...prev, status: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="Published">Published</option>
                      <option value="Granted">Granted</option>
                      <option value="Design Grant">Design Grant</option>
                      <option value="Filed">Filed</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Patent Type</label>
                    <select
                      value={editPatent.patent_type || 'Utility'}
                      onChange={e => setEditPatent((prev: any) => ({ ...prev, patent_type: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="Utility">Utility</option>
                      <option value="Design">Design</option>
                      <option value="Copyright">Copyright</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Jurisdiction</label>
                    <select
                      value={editPatent.jurisdiction || ''}
                      onChange={e => setEditPatent((prev: any) => ({ ...prev, jurisdiction: e.target.value }))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    >
                      <option value="">Unconfirmed</option>
                      <option value="India">India</option>
                      <option value="USA">USA</option>
                      <option value="UK">UK</option>
                      <option value="Australia">Australia</option>
                      <option value="EPO">EPO</option>
                      <option value="WIPO">WIPO</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>
                </div>
              </div>
              <div className="px-6 py-4 border-t border-slate-100 bg-slate-50 flex justify-end gap-3 rounded-b-2xl shrink-0">
                <button onClick={() => setEditPatent(null)} className="px-5 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-100 transition-all text-sm">
                  Cancel
                </button>
                <button
                  onClick={handleSaveEditPatent}
                  disabled={editSaving}
                  className="px-6 py-2 rounded-xl bg-[#0A3D8F] text-white font-bold hover:bg-blue-800 transition-all text-sm disabled:opacity-50 flex items-center gap-2"
                >
                  {editSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                  {editSaving ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
