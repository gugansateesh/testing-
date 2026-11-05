'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ArrowLeft, Download, ExternalLink, Upload, Loader2, FileText, Search, CheckCircle, Trash2, Pencil, X } from 'lucide-react'
import { useAdminAuth } from '@/context/AdminAuthContext'
import { supabase } from '@/lib/supabase'

export default function PublicationsReportPage() {
  const router = useRouter()
  const { token } = useAdminAuth()
  const [publications, setPublications] = useState<any[]>([])
  const [pubYears, setPubYears] = useState<string[]>([])
  const [activePubYear, setActivePubYear] = useState<string>('all')
  const [departments, setDepartments] = useState<string[]>([])
  const [activeDept, setActiveDept] = useState<string>('all')
  const [months, setMonths] = useState<string[]>([])
  const [activeMonth, setActiveMonth] = useState<string>('all')
  const [activeDuplicate, setActiveDuplicate] = useState<string>('all')
  const [textSearch, setTextSearch] = useState<string>('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [visiblePubCount, setVisiblePubCount] = useState(30)
  const [loading, setLoading] = useState(true)
  const [importing, setImporting] = useState(false)
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append')
  const [editPub, setEditPub] = useState<any>(null)
  const [editSaving, setEditSaving] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const fetchPublications = useCallback(async (year: string, dept: string, month: string, duplicate: string, sDate: string, eDate: string, tok: string) => {
    try {
      // Always refresh the session token before fetching to avoid 401 on stale tokens
      let freshTok = tok
      try {
        const { data: { session } } = await supabase.auth.getSession()
        if (session?.access_token) freshTok = session.access_token
      } catch {}

      setPublications([])
      setVisiblePubCount(30)
      const yearQuery = year === 'all' ? '' : year
      const deptQuery = dept === 'all' ? '' : encodeURIComponent(dept)
      const monthQuery = month === 'all' ? '' : encodeURIComponent(month)
      const dupQuery = duplicate === 'all' ? '' : duplicate
      const sDateQuery = sDate ? `&startDate=${sDate}` : ''
      const eDateQuery = eDate ? `&endDate=${eDate}` : ''
      const res = await fetch(`/api/admin/reports/publications?year=${yearQuery}&dept=${deptQuery}&month=${monthQuery}&duplicate=${dupQuery}${sDateQuery}${eDateQuery}&_t=${Date.now()}`, { headers: { Authorization: `Bearer ${freshTok}` } })
      if (res.ok) {
        const { data, departments: deptList, years: yearList, months: monthList } = await res.json()
        setPublications(data || [])
        
        if (yearList && yearList.length > 0) {
          setPubYears(prev => prev.length > 0 ? prev : yearList)
        }
        if (deptList && deptList.length > 0) {
          setDepartments(prev => prev.length > 0 ? prev : deptList)
        }
        if (monthList && monthList.length > 0) {
          setMonths(prev => prev.length > 0 ? prev : monthList)
        }
      } else {
        console.error('Publications fetch failed', res.status)
      }
    } catch (err) {
      console.error('Error in fetchPublications:', err)
    }
  }, [])


  useEffect(() => {
    if (!token) return
    let mounted = true
    const init = async () => {
      await fetchPublications(activePubYear, activeDept, activeMonth, activeDuplicate, startDate, endDate, token)
      if (mounted) setLoading(false)
    }
    init()
    return () => { mounted = false }
  }, [token, activePubYear, activeDept, activeMonth, activeDuplicate, startDate, endDate, fetchPublications])

  const exportPublications = async () => {
    if (!token) return
    try {
      const yearQuery = activePubYear === 'all' ? '' : activePubYear
      const deptQuery = activeDept === 'all' ? '' : encodeURIComponent(activeDept)
      const monthQuery = activeMonth === 'all' ? '' : encodeURIComponent(activeMonth)
      const dupQuery = activeDuplicate === 'all' ? '' : activeDuplicate
      
      const queryParams = new URLSearchParams()
      if (yearQuery) queryParams.set('year', yearQuery)
      if (deptQuery) queryParams.set('dept', deptQuery)
      if (monthQuery) queryParams.set('month', monthQuery)
      if (dupQuery) queryParams.set('duplicate', dupQuery)
      if (startDate) queryParams.set('startDate', startDate)
      if (endDate) queryParams.set('endDate', endDate)
      queryParams.set('token', token)
      
      const url = `/api/admin/reports/publications/export?${queryParams.toString()}`
      
      const res = await fetch(url)
      if (!res.ok) throw new Error('Export failed')
      const blob = await res.blob()
      const downloadUrl = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = downloadUrl
      const label = []
      if (yearQuery) label.push(yearQuery)
      if (deptQuery) label.push(deptQuery)
      if (monthQuery) label.push(monthQuery)
      if (dupQuery) label.push(`Dup_${dupQuery}`)
      if (startDate) label.push(`From_${startDate}`)
      if (endDate) label.push(`To_${endDate}`)
      a.download = `Publications_${label.length ? label.join('_') : 'All'}.xlsx`
      document.body.appendChild(a)
      a.click()
      window.URL.revokeObjectURL(downloadUrl)
      a.remove()
    } catch (err) {
      console.error(err)
      alert('Failed to export publications')
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
      if (!confirm('WARNING: This will permanently delete ALL existing publications before importing the new file. Are you sure you want to replace all data?')) {
        if (fileInputRef.current) fileInputRef.current.value = ''
        return
      }
    }

    try {
      setImporting(true)
      const formData = new FormData()
      formData.append('file', file)
      formData.append('mode', importMode)

      const res = await fetch('/api/admin/reports/publications/import', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: formData
      })

      const result = await res.json()
      if (res.ok) {
        alert(`Import successful! ${importMode === 'replace' ? `Deleted ${result.deleted || 0} old records. ` : ''}Imported ${result.imported} new records. Skipped ${result.skipped} duplicates/invalid rows.`)
        // Refresh table
        await fetchPublications(activePubYear, activeDept, activeMonth, activeDuplicate, startDate, endDate, token)
      } else {
        alert(result.error || 'Failed to import')
      }
    } catch (err) {
      console.error(err)
      alert('Failed to import publications')
    } finally {
      setImporting(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleDelete = async (id: string, title: string, facultyName: string, source: string, cascade = false) => {
    const confirmMsg = `Delete '${title}' by ${facultyName || 'Unknown'}? This cannot be undone.`
    if (!cascade && !window.confirm(confirmMsg)) return

    try {
      const url = `/api/admin/reports/publications/${id}?source=${source}${cascade ? '&cascade=true' : ''}`
      const res = await fetch(url, {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${token}`
        }
      })

      const data = await res.json()
      if (res.status === 409 && data.error === 'linked_records') {
        if (window.confirm(`This submission has ${data.count} linked incentive application(s). Delete those first, or confirm cascade delete.\n\nWould you like to delete the linked incentive applications too?`)) {
          await handleDelete(id, title, facultyName, source, true)
        }
        return
      }

      if (res.ok) {
        setPublications(prev => prev.filter(p => p.id !== id))
      } else {
        alert(data.error || 'Failed to delete record')
      }
    } catch (e: any) {
      console.error(e)
      alert('Error deleting record: ' + e.message)
    }
  }

  const handleSaveEdit = async () => {
    if (!editPub || !token) return
    setEditSaving(true)
    try {
      const source = editPub._source || 'legacy'
      const payload = source === 'live'
        ? {
            authors: editPub.authors,
            title: editPub.title,
            source_title: editPub.source_title,
            volume: editPub.volume,
            issue: editPub.issue,
            year: editPub.year ? parseInt(editPub.year) : null,
            doi: editPub.doi,
            department: editPub.department,
            faculty_name: editPub.faculty_name,
            doc_type_scopus: editPub.document_type_scopus,
            doc_type_report: editPub.document_type_report,
          }
        : {
            authors: editPub.authors,
            title: editPub.title,
            source_title: editPub.source_title,
            volume: editPub.volume,
            issue: editPub.issue,
            year: editPub.year ? parseInt(editPub.year) : null,
            doi: editPub.doi,
            department: editPub.department,
            faculty_name: editPub.faculty_name,
            document_type_scopus: editPub.document_type_scopus,
            document_type_report: editPub.document_type_report,
            emp_id: editPub.emp_id,
          }

      const res = await fetch(`/api/admin/reports/publications/${editPub.id}?source=${source}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(payload)
      })
      if (res.ok) {
        setPublications(prev => prev.map(p => p.id === editPub.id ? { ...p, ...editPub } : p))
        setEditPub(null)
        // Refresh the list from server to reflect saved changes
        const { data: { session: freshSession } } = await supabase.auth.getSession()
        const freshTok = freshSession?.access_token || token
        if (freshTok) {
          await fetchPublications(activePubYear, activeDept, activeMonth, activeDuplicate, startDate, endDate, freshTok)
        }
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

  if (loading) return <div className="p-8 text-center"><div className="w-8 h-8 mx-auto border-4 border-blue-600 border-t-transparent rounded-full animate-spin" /></div>

  const filteredPublications = publications.filter(p => {
    if (textSearch) {
      const search = textSearch.toLowerCase()
      if (!p.title?.toLowerCase().includes(search) &&
          !p.authors?.toLowerCase().includes(search) &&
          !p.doi?.toLowerCase().includes(search) &&
          !p.faculty_name?.toLowerCase().includes(search) &&
          !p.emp_id?.toLowerCase().includes(search) &&
          !p.department?.toLowerCase().includes(search)) {
        return false
      }
    }
    return true
  })

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-[#0F172A] p-6 font-sans text-slate-900 dark:text-slate-100">
      <div className="w-full mx-auto space-y-6">
        <Link href="/admin/reports" className="inline-flex items-center gap-2 text-blue-600 hover:text-blue-800 font-medium">
          <ArrowLeft className="w-4 h-4" /> Back to Reports Overview
        </Link>
        
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <h1 className="text-3xl font-black text-[#0A3D8F]">Publications</h1>
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
              className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-4 py-2 rounded-xl font-bold transition-all shadow-sm text-sm disabled:opacity-50"
            >
              {importing && importMode === 'replace' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {importing && importMode === 'replace' ? 'Replacing...' : 'Replace All Data'}
            </button>
            <button onClick={exportPublications} className="flex items-center gap-2 bg-white border border-slate-200 hover:border-blue-300 hover:bg-blue-50 text-slate-700 hover:text-blue-700 dark:bg-slate-700 dark:border-slate-500 dark:text-slate-100 dark:hover:bg-blue-700 dark:hover:border-blue-500 dark:hover:text-white px-4 py-2 rounded-xl font-bold transition-all shadow-sm text-sm">
              <Download className="w-4 h-4" /> Export Excel
            </button>
          </div>
        </div>

        <div className="bg-white dark:bg-[#1E293B] rounded-2xl shadow-sm border border-slate-200 dark:border-slate-600 overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 p-4 border-b border-slate-200 dark:border-slate-600 bg-blue-50 dark:bg-slate-800">
              <select 
                value={activePubYear} 
                onChange={(e) => setActivePubYear(e.target.value)}
                className="w-full md:w-auto bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-500 text-slate-700 dark:text-slate-100 text-sm font-semibold rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Years</option>
                {pubYears.map(yr => (
                  <option key={yr} value={yr}>{yr}</option>
                ))}
              </select>
              <div className="flex items-center gap-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-500 rounded-lg px-3 py-1">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">From:</span>
                <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="bg-transparent text-slate-700 dark:text-slate-100 text-sm font-semibold focus:outline-none" />
              </div>
              <div className="flex items-center gap-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-500 rounded-lg px-3 py-1">
                <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">To:</span>
                <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="bg-transparent text-slate-700 dark:text-slate-100 text-sm font-semibold focus:outline-none" />
                {(startDate || endDate) && (
                  <button onClick={() => { setStartDate(''); setEndDate(''); }} className="ml-2 text-slate-400 hover:text-red-500">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
              </div>
              <select 
                value={activeMonth} 
                onChange={(e) => setActiveMonth(e.target.value)}
                className="w-full md:w-auto bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-500 text-slate-700 dark:text-slate-100 text-sm font-semibold rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Months</option>
                {months.map(m => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
              <select 
                value={activeDept} 
                onChange={(e) => setActiveDept(e.target.value)}
                className="w-full md:w-auto bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-500 text-slate-700 dark:text-slate-100 text-sm font-semibold rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All Departments</option>
                {departments.map(dept => (
                  <option key={dept} value={dept}>{dept}</option>
                ))}
              </select>
              <select 
                value={activeDuplicate} 
                onChange={(e) => setActiveDuplicate(e.target.value)}
                className="w-full md:w-auto bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-500 text-slate-700 dark:text-slate-100 text-sm font-semibold rounded-lg px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="all">All (Incl. Duplicates)</option>
                <option value="no">Originals Only</option>
                <option value="yes">Duplicates Only</option>
              </select>
              <div className="flex items-center gap-2 bg-white dark:bg-slate-700 border border-slate-300 dark:border-slate-500 rounded-lg px-3 py-1">
                <input 
                  type="text" 
                  placeholder="Search title, author, faculty, emp id..."
                  value={textSearch} 
                  onChange={e => setTextSearch(e.target.value)} 
                  className="bg-transparent text-slate-700 dark:text-slate-100 text-sm font-semibold focus:outline-none w-52" 
                />
                {textSearch && (
                  <button onClick={() => setTextSearch('')} className="ml-1 text-slate-400 hover:text-red-500">
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                )}
              </div>
              <div className="px-4 py-3 bg-white text-sm text-slate-500 font-medium border-l border-slate-200 text-center whitespace-nowrap ml-auto">
                {filteredPublications.length} {filteredPublications.length === 1 ? 'Result' : 'Results'}
              </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm whitespace-nowrap">
              <thead className="bg-[#0A3D8F] text-white">
                <tr>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">S.No</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Year</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Month</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800 min-w-[100px]">Date</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800 min-w-[200px]">Authors</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800 min-w-[250px]">Title</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Source Title</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Volume & Issue</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">DOI</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Duplicates</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Link</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Proofs</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Doc Type (Scopus)</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Doc Type (Report)</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Dept</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Faculty Name</th>
                  <th className="px-4 py-3 font-semibold border-r border-blue-800">Emp ID</th>
                  <th className="px-4 py-3 font-semibold text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredPublications.length === 0 ? (
                  <tr><td colSpan={18} className="px-4 py-8 text-center text-slate-500 font-medium">No publications found.</td></tr>
                ) : filteredPublications.slice(0, visiblePubCount).map((p, idx) => (
                    <tr key={p.id} className="hover:bg-blue-50 transition-colors">
                      <td className="px-4 py-3 border-r border-slate-100 font-medium text-slate-500 text-center">{idx + 1}</td>
                      <td className="px-4 py-3 border-r border-slate-100 text-slate-700 font-bold text-center">{p.year || '—'}</td>
                      <td className="px-4 py-3 border-r border-slate-100 text-slate-600 text-center">{p.publication_month || '—'}</td>
                      <td className="px-4 py-3 border-r border-slate-100 text-slate-600 text-center">{p.publication_date || '—'}</td>
                      <td className="px-4 py-3 border-r border-slate-100 text-slate-600 whitespace-normal min-w-[200px] text-xs">{p.authors}</td>
                      <td className="px-4 py-3 border-r border-slate-100 font-medium text-[#0A3D8F] whitespace-normal min-w-[250px]">{p.title}</td>
                      <td className="px-4 py-3 border-r border-slate-100 text-slate-600 whitespace-normal min-w-[150px]">{p.source_title}</td>
                      <td className="px-4 py-3 border-r border-slate-100 text-slate-500">{p.volume && `Vol ${p.volume}`} {p.issue && `(${p.issue})`}</td>
                      <td className="px-4 py-3 border-r border-slate-100 text-slate-600 max-w-[150px] truncate">{p.doi || '—'}</td>
                      <td className="px-4 py-3 border-r border-slate-100 text-center">
                        {p.is_duplicate ? (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-red-100 text-red-800">Yes</span>
                        ) : (
                          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-800">No</span>
                        )}
                      </td>
                      <td className="px-4 py-3 border-r border-slate-100 text-slate-600 text-center">
                        {p.link ? (
                          <a href={p.link} target="_blank" rel="noreferrer" className="text-blue-500 hover:text-blue-700 inline-block"><ExternalLink className="w-4 h-4" /></a>
                        ) : '—'}
                      </td>
                      <td className="px-4 py-3 border-r border-slate-100 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          {p.proof_full_paper_url ? (
                            <a href={p.proof_full_paper_url} target="_blank" rel="noreferrer"
                               title="Full Paper" className="inline-flex items-center justify-center w-6 h-6 rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200 transition-colors">
                              <FileText className="w-3.5 h-3.5" />
                            </a>
                          ) : <span className="text-slate-300 text-xs">—</span>}
                          {p.proof_scopus_url ? (
                            <a href={p.proof_scopus_url} target="_blank" rel="noreferrer"
                               title="Scopus Record" className="inline-flex items-center justify-center w-6 h-6 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 transition-colors">
                              <Search className="w-3.5 h-3.5" />
                            </a>
                          ) : null}
                          {p.proof_published_url ? (
                            <a href={p.proof_published_url} target="_blank" rel="noreferrer"
                               title="Published Proof" className="inline-flex items-center justify-center w-6 h-6 rounded bg-green-100 text-green-700 hover:bg-green-200 transition-colors">
                              <CheckCircle className="w-3.5 h-3.5" />
                            </a>
                          ) : null}
                          {!p.proof_full_paper_url && !p.proof_scopus_url && !p.proof_published_url && (
                            <span className="text-slate-300 text-xs">—</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 border-r border-slate-100 text-slate-600 text-xs">{p.document_type_scopus || '—'}</td>
                      <td className="px-4 py-3 border-r border-slate-100 text-slate-600 text-xs">{p.document_type_report || '—'}</td>
                      <td className="px-4 py-3 border-r border-slate-100 text-slate-600">{p.department}</td>
                      <td className="px-4 py-3 border-r border-slate-100 text-slate-700 font-medium whitespace-normal min-w-[150px]">{p.faculty_name}</td>
                      <td className="px-4 py-3 border-r border-slate-100 text-slate-600 font-mono text-xs">{p.emp_id || '—'}</td>
                      <td className="px-4 py-3 text-center">
                        <div className="flex items-center justify-center gap-1">
                          <button
                            onClick={() => setEditPub({ ...p })}
                            className="text-blue-500 hover:text-blue-700 p-1 rounded hover:bg-blue-50 transition-colors"
                            title="Edit record"
                          >
                            <Pencil className="w-4 h-4" />
                          </button>
                          <button 
                            onClick={() => handleDelete(p.id, p.title, p.faculty_name, p._source || 'legacy')}
                            className="text-red-500 hover:text-red-700 p-1 rounded hover:bg-red-50 transition-colors"
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
          </div>
          {filteredPublications.length > visiblePubCount && (
            <div className="p-4 bg-slate-50 border-t border-slate-200 text-center">
              <button 
                onClick={() => setVisiblePubCount(prev => prev + 30)}
                className="px-6 py-2 bg-white border border-slate-300 hover:bg-blue-50 hover:text-blue-600 hover:border-blue-300 text-slate-600 font-semibold rounded-xl shadow-sm transition-all text-sm"
              >
                Load More ({filteredPublications.length - visiblePubCount} remaining)
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Edit Publication Modal */}
      {editPub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm overflow-y-auto">
          <div className="bg-white dark:bg-[#1E293B] rounded-2xl shadow-2xl w-full max-w-3xl my-auto flex flex-col max-h-[90vh]">
            <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-600 flex items-center justify-between bg-blue-50 dark:bg-slate-800 rounded-t-2xl shrink-0">
              <div>
                <h3 className="font-black text-[#0A3D8F] dark:text-blue-300 text-xl">Edit Publication</h3>
                <p className="text-xs text-slate-500 mt-0.5">Source: {editPub._source === 'live' ? 'Live Submission' : 'Legacy Upload'}</p>
              </div>
              <button onClick={() => setEditPub(null)} className="text-slate-400 hover:text-slate-600 bg-white dark:bg-slate-700 p-2 rounded-full shadow-sm">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4">
              {([
                { label: 'Title', key: 'title', type: 'textarea' },
                { label: 'Authors', key: 'authors', type: 'textarea' },
                { label: 'Source Title (Journal/Conference)', key: 'source_title', type: 'text' },
                { label: 'DOI', key: 'doi', type: 'text' },
                { label: 'Year', key: 'year', type: 'number' },
                { label: 'Volume', key: 'volume', type: 'text' },
                { label: 'Issue', key: 'issue', type: 'text' },
                { label: 'Department', key: 'department', type: 'text' },
                { label: 'Faculty Name', key: 'faculty_name', type: 'text' },
                { label: 'Emp ID', key: 'emp_id', type: 'text' },
                { label: 'Doc Type (Scopus)', key: 'document_type_scopus', type: 'text' },
              ] as { label: string; key: string; type: string }[]).map(({ label, key, type }) => (
                <div key={key}>
                  <label className="block text-xs font-bold text-slate-500 uppercase mb-1">{label}</label>
                  {type === 'textarea' ? (
                    <textarea
                      rows={2}
                      value={editPub[key] || ''}
                      onChange={e => setEditPub((prev: any) => ({ ...prev, [key]: e.target.value }))}
                      className="w-full border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  ) : (
                    <input
                      type={type}
                      value={editPub[key] || ''}
                      onChange={e => setEditPub((prev: any) => ({ ...prev, [key]: e.target.value }))}
                      className="w-full border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  )}
                </div>
              ))}
              <div>
                <label className="block text-xs font-bold text-slate-500 uppercase mb-1">Doc Type (Report)</label>
                <select
                  value={editPub.document_type_report || ''}
                  onChange={e => setEditPub((prev: any) => ({ ...prev, document_type_report: e.target.value }))}
                  className="w-full border border-slate-200 dark:border-slate-600 dark:bg-slate-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— Select —</option>
                  <option value="SCI">SCI</option>
                  <option value="Scopus/WoS Journals">Scopus/WoS Journals</option>
                  <option value="Scopus/WoS Conference/Book Chapter/Others">Scopus/WoS Conference/Book Chapter/Others</option>
                  <option value="Student Publication">Student Publication</option>
                </select>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-100 dark:border-slate-600 bg-slate-50 dark:bg-slate-800 flex justify-end gap-3 rounded-b-2xl shrink-0">
              <button onClick={() => setEditPub(null)} className="px-5 py-2 rounded-xl border border-slate-200 text-slate-600 font-semibold hover:bg-slate-100 transition-all text-sm">
                Cancel
              </button>
              <button
                onClick={handleSaveEdit}
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
  )
}
