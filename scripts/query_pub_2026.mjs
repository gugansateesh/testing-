import { createClient } from '@supabase/supabase-js'
import ws from 'ws'

const supabase = createClient(
  'https://ukwdrbzjvdtpoxygekfo.supabase.co',
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVrd2RyYnpqdmR0cG94eWdla2ZvIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4Nzk1MTA4NCwiZXhwIjoyMTAzNTI3MDg0fQ.yDNENPzmlmJR0aCwJKHTovXS9WZo1THZgn1b1liN0BA',
  {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws }
  }
)

let allRows = []
let page = 0
const pageSize = 1000

while (true) {
  const { data, error } = await supabase
    .from('legacy_publications')
    .select('faculty_name, emp_id, department')
    .eq('year', 2026)
    .range(page * pageSize, (page + 1) * pageSize - 1)
  
  if (error) { console.error('DB Error:', error.message); process.exit(1) }
  if (!data || data.length === 0) break
  allRows = [...allRows, ...data]
  if (data.length < pageSize) break
  page++
}

console.log(`\n====== 2026 Publications in legacy_publications ======`)
console.log(`Total rows (publication records): ${allRows.length}`)

const withEmpId = allRows.filter(r => r.emp_id && r.emp_id.trim() !== '')
const withoutEmpId = allRows.filter(r => !r.emp_id || r.emp_id.trim() === '')

console.log(`\n✅ Rows WITH Emp ID   : ${withEmpId.length}`)
console.log(`❌ Rows WITHOUT Emp ID: ${withoutEmpId.length}`)

// Unique staff WITH emp_id
const withMap = new Map()
for (const r of withEmpId) {
  const key = r.emp_id.trim().toUpperCase()
  if (!withMap.has(key)) withMap.set(key, { name: r.faculty_name || '(no name)', dept: r.department || '—', count: 0 })
  withMap.get(key).count++
}

console.log(`\n────────────────────────────────────────────────────────────────────────────────`)
console.log(`STAFF WITH EMP ID — ${withMap.size} unique staff, ${withEmpId.length} publication rows`)
console.log(`────────────────────────────────────────────────────────────────────────────────`)
console.log(`${'Emp ID'.padEnd(16)} ${'Faculty Name'.padEnd(38)} ${'Dept'.padEnd(14)} Pubs`)
console.log(`${'─'.repeat(16)} ${'─'.repeat(38)} ${'─'.repeat(14)} ────`)
const withList = [...withMap.entries()].sort((a,b) => a[0].localeCompare(b[0]))
withList.forEach(([empId, info]) => {
  console.log(`${empId.padEnd(16)} ${(info.name).substring(0,38).padEnd(38)} ${(info.dept||'').padEnd(14)} ${info.count}`)
})

// Unique staff WITHOUT emp_id
const noEmpMap = new Map()
for (const r of withoutEmpId) {
  const key = (r.faculty_name || '(unknown)').trim().toLowerCase()
  if (!noEmpMap.has(key)) noEmpMap.set(key, { name: r.faculty_name || '(unknown)', dept: r.department || '—', count: 0 })
  noEmpMap.get(key).count++
}

console.log(`\n────────────────────────────────────────────────────────────────────────────────`)
console.log(`STAFF WITHOUT EMP ID — ${noEmpMap.size} unique names, ${withoutEmpId.length} publication rows`)
console.log(`────────────────────────────────────────────────────────────────────────────────`)
console.log(`${'Faculty Name'.padEnd(42)} ${'Dept'.padEnd(14)} Pubs`)
console.log(`${'─'.repeat(42)} ${'─'.repeat(14)} ────`)
const noList = [...noEmpMap.entries()].sort((a,b) => a[0].localeCompare(b[0]))
noList.forEach(([, info]) => {
  console.log(`${(info.name).substring(0,42).padEnd(42)} ${(info.dept||'').padEnd(14)} ${info.count}`)
})
