import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'
import ws_lib from 'ws'
import fs from 'fs'
import path from 'path'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const ExcelJS = require('exceljs')

dotenv.config({ path: '.env.local' })

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws_lib }
  }
)

const FILE_PATH = path.join(process.cwd(), 'public/templates/Combined_Staff_Details_Only.xlsx')

function normalizeDept(dept) {
  if (!dept) return ''
  const d = dept.trim().toUpperCase()
  if (d === 'AI&DS') return 'AIDS'
  if (d === 'MECH') return 'MECH'
  if (d === 'CIVIL') return 'CIVIL'
  if (d === 'MATHS' || d === 'ENGLISH' || d === 'PHYSICS' || d === 'CHEMISTRY') return 'S&H'
  return d
}

async function main() {
  console.log(`📖 Reading Excel file: ${FILE_PATH}`)
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(FILE_PATH)
  const ws = wb.worksheets[0]

  // First fetch existing DB faculty to resolve known IDs and preserve registered user_ids
  const { data: dbFaculty, error: dbErr } = await supabase
    .from('master_faculty')
    .select('*')

  if (dbErr) {
    console.warn(`Warning fetching DB faculty: ${dbErr.message}`)
  }

  const dbMapByEmpId = new Map()
  const dbMapByName = new Map()
  if (dbFaculty) {
    dbFaculty.forEach(f => {
      if (f.emp_id) dbMapByEmpId.set(f.emp_id.trim().toUpperCase(), f)
      if (f.name) dbMapByName.set(f.name.trim().toLowerCase(), f)
    })
  }
  console.log(`ℹ️  Found ${dbFaculty ? dbFaculty.length : 0} existing faculty in DB.`)

  const staffList = []
  const seenEmpIds = new Set()
  const seenEmails = new Set()

  for (let r = 2; r <= ws.rowCount; r++) {
    const vals = ws.getRow(r).values
    if (!vals || vals.length <= 1) continue

    const name = vals[1] ? String(vals[1]).trim() : ''
    const phone = vals[2] ? String(vals[2]).trim() : ''
    const designation = vals[3] ? String(vals[3]).trim() : ''
    const origDept = vals[4] ? String(vals[4]).trim() : ''
    const rawDept = vals[5] ? String(vals[5]).trim() : ''
    const email = vals[6] ? String(vals[6]).trim().toLowerCase() : ''
    let empId = vals[7] ? String(vals[7]).trim().toUpperCase() : ''

    if (!name && !empId && !email) continue

    // Handle rows with known copy-paste anomalies in the spreadsheet:
    if (name.toLowerCase() === 'ms. megala r' && rawDept.toUpperCase() === 'CCE') {
      empId = 'SECETEC092'
    } else if (name.toLowerCase() === 'mr. vivek kumar m' && empId === 'SECETME046') {
      const existing = dbMapByName.get('mr. vivek kumar m')
      if (existing) empId = existing.emp_id
    }

    if (!empId && name) {
      const existing = dbMapByName.get(name.toLowerCase())
      if (existing) empId = existing.emp_id
    }

    if (!empId) {
      console.warn(`⚠️ Row ${r}: Staff "${name}" has no Employee ID. Skipping DB upsert.`)
      continue
    }

    const isDoc = name.toLowerCase().startsWith('dr.') || name.toLowerCase().startsWith('dr ') || designation.toLowerCase().includes('ph.d')
    const type = isDoc ? 'Doctorate' : 'Non-Doctorate'
    const dept = normalizeDept(rawDept)

    const staffObj = {
      emp_id: empId,
      name,
      phone: phone || null,
      designation: designation || 'Assistant Professor',
      original_dept: origDept || null,
      dept: dept || origDept || 'S&H',
      email: email || null,
      type
    }

    if (seenEmpIds.has(empId)) {
      console.warn(`⚠️ Duplicate Employee ID in Excel: ${empId} (${name}). Merging with latest info.`)
      const existingIdx = staffList.findIndex(s => s.emp_id === empId)
      if (existingIdx !== -1) {
        staffList[existingIdx] = { ...staffList[existingIdx], ...staffObj }
      }
    } else {
      seenEmpIds.add(empId)
      staffList.push(staffObj)
    }

    if (email) {
      seenEmails.add(email)
    }
  }

  console.log(`✅ Processed ${staffList.length} staff records from Excel.`)
  console.log(`📧 Unique Emails found: ${seenEmails.size}`)
  console.log(`🆔 Unique Employee IDs found: ${seenEmpIds.size}`)

  // 1. Save local JSON cache for instant in-app lookups
  const dataDir = path.join(process.cwd(), 'src/data')
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true })
  }
  const jsonPath = path.join(dataDir, 'staff_directory.json')
  fs.writeFileSync(jsonPath, JSON.stringify(staffList, null, 2), 'utf-8')
  console.log(`💾 Saved staff directory cache to: ${jsonPath}`)

  // 2. Upsert into Supabase master_faculty
  console.log(`🔄 Syncing staff records to Supabase master_faculty...`)
  
  let hasEmailColumn = true
  const { error: testColErr } = await supabase.from('master_faculty').select('email').limit(1)
  if (testColErr && testColErr.code === '42703') {
    hasEmailColumn = false
    console.warn(`⚠️ The 'email' column does not exist yet on master_faculty.`)
    console.warn(`   Please run the migration: supabase/migrations/20261019000000_add_email_phone_to_master_faculty.sql`)
    console.warn(`   Syncing name, dept, designation, type in the meantime...`)
  }

  const batchPayloads = staffList.map(staff => {
    const payload = {
      emp_id: staff.emp_id,
      name: staff.name,
      dept: staff.dept,
      designation: staff.designation,
      type: staff.type
    }
    if (hasEmailColumn) {
      payload.email = staff.email
      payload.phone = staff.phone
      payload.original_dept = staff.original_dept
    }
    return payload
  })

  // Batch in chunks of 50
  const chunkSize = 50
  let successCount = 0
  for (let i = 0; i < batchPayloads.length; i += chunkSize) {
    const chunk = batchPayloads.slice(i, i + chunkSize)
    const { error } = await supabase
      .from('master_faculty')
      .upsert(chunk, { onConflict: 'emp_id' })
    if (error) {
      console.error(`❌ Batch error (${i} to ${i + chunk.length}):`, error.message)
    } else {
      successCount += chunk.length
    }
  }

  console.log(`\n🎉 Batch sync complete! Upserted ${successCount}/${batchPayloads.length} records.`)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
