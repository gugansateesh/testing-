import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase'
import { verifyToken, extractToken, requireAdmin } from '@/lib/verifyAuth'
import { getGeminiClient, GEMINI_MODEL } from '@/lib/gemini'
import { Type } from '@google/genai'

export const dynamic = 'force-dynamic'

async function fetchAll(queryFactory: () => any) {
  let allData: any[] = []
  let from = 0
  const step = 1000
  while (true) {
    const { data, error } = await queryFactory().range(from, from + step - 1)
    if (error) throw error
    if (data && data.length > 0) {
      allData.push(...data)
      if (data.length < step) break
      from += step
    } else {
      break
    }
  }
  return { data: allData }
}

const adminTools = [{
  functionDeclarations: [
    {
      name: 'listPhdHolders',
      description: 'List PhD holders, optionally filtered by department. Used for answering questions about PhD holders. It returns the total count and a max sample of 10 names. Do NOT attempt to list all of them if the user asks for a general list; just provide the count and the few examples, suggesting they view the reports page for the full list.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          dept: { type: Type.STRING, description: 'Department name (e.g. CSE, IT, ECE)' }
        }
      }
    },
    {
      name: 'publicationsByDepartment',
      description: 'Get counts of approved publications grouped by department. Used for answering questions like "best performing department in publications" or "publication count by department".',
      parameters: {
        type: Type.OBJECT,
        properties: {
          year: { type: Type.STRING, description: 'Year (e.g. "2024")' },
          category: { type: Type.STRING, description: 'Publication category (e.g. "SCI", "Scopus")' }
        }
      }
    },
    {
      name: 'incentivesSummary',
      description: 'Get summary of paid/approved incentives, optionally filtered by year or department. Use for total incentives paid, or incentive count.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          year: { type: Type.STRING, description: 'Year (e.g. "2025")' },
          dept: { type: Type.STRING, description: 'Department name' }
        }
      }
    },
    {
      name: 'seedFundSummary',
      description: 'Get summary of approved seed fund grants, optionally filtered by year or department.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          year: { type: Type.STRING, description: 'Year (e.g. "2025")' },
          dept: { type: Type.STRING, description: 'Department name' }
        }
      }
    },
    {
      name: 'projectGrantsSummary',
      description: 'Get summary of approved project grants, optionally filtered by year or department.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          year: { type: Type.STRING, description: 'Year (e.g. "2025")' },
          dept: { type: Type.STRING, description: 'Department name' }
        }
      }
    },
    {
      name: 'consultancySummary',
      description: 'Get summary of approved consultancy projects, optionally filtered by year or department.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          year: { type: Type.STRING, description: 'Year (e.g. "2025")' },
          dept: { type: Type.STRING, description: 'Department name' }
        }
      }
    },
    {
      name: 'facultyOverview',
      description: 'Get total faculty counts, PhD counts, supervisor counts, optionally filtered by department.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          dept: { type: Type.STRING, description: 'Department name' }
        }
      }
    },
    {
      name: 'patentsCount',
      description: 'Get total approved patents count, optionally filtered by department.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          dept: { type: Type.STRING, description: 'Department name' }
        }
      }
    },
    {
      name: 'listAnnouncements',
      description: 'List active announcements. Can optionally filter by category (e.g. "workshops", "seminars", "events", "deadlines", "funding_opportunities", "general_notices", "cfrd_circular"). Used to answer if there are any current announcements.',
      parameters: {
        type: Type.OBJECT,
        properties: {
          category: { type: Type.STRING, description: 'Category name' }
        }
      }
    }
  ]
}]

const systemInstruction = `You are an assistant for the admin of a college research portal. You can call the provided tools to look up real data — always call a tool rather than guessing or using outside knowledge. When asked things like 'best performing department', call the relevant summary tool and base your answer on the actual returned numbers, naming the specific department and figure. If a tool returns no data for what's asked, say so — never invent faculty names, amounts, or departments. Keep answers concise and lead with the direct answer, then brief supporting numbers.

CRITICAL RULE: Report the exact numeric values returned by tool calls, character for character — never round, estimate, or approximate any figure, even if it looks cleaner (e.g. if the tool returns 651, write 651, NOT 650).

CRITICAL RULE: If you cannot answer the exact question asked with the available tools (e.g. the user asks for a filter like 'SCI' or '2024' but the tool doesn't accept those parameters), say so directly. Do not offer loosely-related statistics as if they answer the question. If you must provide unrelated context, you MUST use an explicit, unmistakable "Note: this is unrelated to what you asked" framing.`

async function executeTool(name: string, args: any, admin: any) {
  try {
    switch (name) {
      case 'listPhdHolders': {
        let liveQuery = admin.from('master_faculty').select('name, dept').eq('type', 'Doctorate')
        let legacyQuery = admin.from('legacy_phd_holders').select('name, dept')
        
        if (args.dept) {
          liveQuery = liveQuery.ilike('dept', `%${args.dept}%`)
          legacyQuery = legacyQuery.ilike('dept', `%${args.dept}%`)
        }
        
        const [liveRes, legacyRes] = await Promise.all([liveQuery, legacyQuery])
        const all = [...(liveRes.data || []), ...(legacyRes.data || [])]
        
        const unique = Array.from(new Map(all.map((item: any) => [item.name, item])).values())
        return { count: unique.length, data: unique.slice(0, 10) }
      }
      
      case 'publicationsByDepartment': {
        const STANDARD_DEPTS = ['CSE', 'IT', 'ECE', 'EEE', 'MECH', 'CYS', 'AI-DS', 'AI-ML', 'CSBS', 'S&H']
        const normalizeDept = (d: string | null | undefined) => {
           if (!d) return 'Others'
           const upper = d.toUpperCase().trim()
           if (upper.includes('S&H') || upper.includes('S & H') || upper.includes('MATHS') || upper.includes('PHYSICS') || upper.includes('CHEMISTRY') || upper.includes('ENGLISH') || upper.includes('SCIENCE')) return 'S&H'
           if (upper === 'MECH' || upper === 'MECHANICAL') return 'MECH'
           if (upper === 'CSE' || upper === 'CS') return 'CSE'
           if (upper === 'ECE') return 'ECE'
           if (upper === 'EEE') return 'EEE'
           if (upper === 'IT') return 'IT'
           if (upper === 'CYS' || upper.includes('CYBER')) return 'CYS'
           if (upper === 'AIDS' || upper === 'AI&DS' || upper === 'AI-DS') return 'AI-DS'
           if (upper === 'AIML' || upper === 'AI&ML' || upper === 'AI-ML') return 'AI-ML'
           if (upper === 'CSBS') return 'CSBS'
           if (upper === 'CCE') return 'CCE'
           if (STANDARD_DEPTS.includes(upper)) return upper
           return 'Others'
        }

        const liveQueryFactory = () => {
          let q = admin.from('submissions').select('department, year, doc_type_scopus, doc_type, doc_type_report').eq('status', 'approved')
          if (args.year) q = q.eq('year', Number(args.year))
          if (args.category) {
            q = q.or(`doc_type_scopus.ilike.%${args.category}%,doc_type.ilike.%${args.category}%,doc_type_report.ilike.%${args.category}%`)
          }
          return q
        }
        
        const legacyQueryFactory = () => {
          let q = admin.from('legacy_publications').select('department, year, document_type_scopus, document_type_report')
          if (args.year) q = q.eq('year', Number(args.year))
          if (args.category) {
            q = q.or(`document_type_scopus.ilike.%${args.category}%,document_type_report.ilike.%${args.category}%`)
          }
          return q
        }
        
        const [liveRes, legacyRes] = await Promise.all([fetchAll(liveQueryFactory), fetchAll(legacyQueryFactory)])
        const allData = [...(liveRes.data || []), ...(legacyRes.data || [])]
        
        const counts: Record<string, number> = {}
        for (const item of allData) {
          const d = normalizeDept(item.department)
          counts[d] = (counts[d] || 0) + 1
        }
        
        const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([dept, count]) => ({ dept, count }))
        
        return { 
          total: sorted.reduce((acc, curr) => acc + curr.count, 0),
          sorted_departments: sorted 
        }
      }
      
      case 'incentivesSummary': {
        const liveQueryFactory = () => {
          let q = admin.from('incentive_applications').select('calculated_amount, submissions!inner(department, year)').eq('status', 'approved')
          if (args.year) q = q.eq('submissions.year', Number(args.year))
          if (args.dept) q = q.ilike('submissions.department', `%${args.dept}%`)
          return q
        }
        const legacyQueryFactory = () => {
          let q = admin.from('legacy_incentives').select('received_amount, incentive_year, department')
          if (args.year) q = q.eq('incentive_year', String(args.year))
          if (args.dept) q = q.ilike('department', `%${args.dept}%`)
          return q
        }
        
        const [liveRes, legacyRes] = await Promise.all([fetchAll(liveQueryFactory), fetchAll(legacyQueryFactory)])
        const liveData = liveRes.data || []
        const legacyData = legacyRes.data || []
        
        const liveSum = liveData.reduce((acc: number, r: any) => acc + (Number(r.calculated_amount) || 0), 0)
        const legacySum = legacyData.reduce((acc: number, r: any) => acc + (Number(r.received_amount) || 0), 0)
        
        return {
          total_amount: liveSum + legacySum,
          total_count: liveData.length + legacyData.length
        }
      }
      
      case 'seedFundSummary': {
        const liveQueryFactory = () => {
          let q = admin.from('seed_fund_applications').select('amount_requested, created_at').eq('status', 'approved')
          // Using gte and lt to filter by year reliably based on created_at timestamp
          if (args.year) {
            const startOfYear = `${args.year}-01-01T00:00:00Z`
            const endOfYear = `${args.year}-12-31T23:59:59Z`
            q = q.gte('created_at', startOfYear).lte('created_at', endOfYear)
          }
          return q
        }
        const legacyQueryFactory = () => {
          let q = admin.from('legacy_seed_fund_grants').select('amount_sanctioned, academic_year, dept')
          if (args.year) q = q.ilike('academic_year', `%${args.year}%`)
          return q
        }
        
        const [liveRes, legacyRes] = await Promise.all([fetchAll(liveQueryFactory), fetchAll(legacyQueryFactory)])
        const liveData = liveRes.data || []
        const legacyData = legacyRes.data || []
        
        const liveSum = liveData.reduce((acc: number, r: any) => acc + (Number(r.amount_requested) || 0), 0)
        const legacySum = legacyData.reduce((acc: number, r: any) => acc + (Number(r.amount_sanctioned) || 0), 0)
        
        return {
          total_amount: liveSum + legacySum,
          total_count: liveData.length + legacyData.length
        }
      }
      
      case 'projectGrantsSummary': {
        const liveQueryFactory = () => {
          let q = admin.from('project_grant_applications').select('total_proposed_budget, created_at').eq('status', 'approved')
          if (args.year) {
            const startOfYear = `${args.year}-01-01T00:00:00Z`
            const endOfYear = `${args.year}-12-31T23:59:59Z`
            q = q.gte('created_at', startOfYear).lte('created_at', endOfYear)
          }
          return q
        }
        const legacyQueryFactory = () => {
          let q = admin.from('research_grants').select('grant_amount, academic_year')
          if (args.year) q = q.ilike('academic_year', `%${args.year}%`)
          return q
        }
        
        const [liveRes, legacyRes] = await Promise.all([fetchAll(liveQueryFactory), fetchAll(legacyQueryFactory)])
        const liveData = liveRes.data || []
        const legacyData = legacyRes.data || []
        
        const liveSum = liveData.reduce((acc: number, r: any) => acc + (Number(r.total_proposed_budget) || 0), 0)
        const legacySum = legacyData.reduce((acc: number, r: any) => acc + (Number(r.grant_amount) || 0), 0)
        
        return {
          total_amount: liveSum + legacySum,
          total_count: liveData.length + legacyData.length
        }
      }
      
      case 'consultancySummary': {
        const liveQueryFactory = () => {
          let q = admin.from('consultancy_applications').select('consultancy_fee, created_at').eq('status', 'approved')
          if (args.year) {
            const startOfYear = `${args.year}-01-01T00:00:00Z`
            const endOfYear = `${args.year}-12-31T23:59:59Z`
            q = q.gte('created_at', startOfYear).lte('created_at', endOfYear)
          }
          return q
        }
        const legacyQueryFactory = () => {
          let q = admin.from('legacy_consultancy').select('amount, academic_year, department')
          if (args.year) q = q.ilike('academic_year', `%${args.year}%`)
          return q
        }
        
        const [liveRes, legacyRes] = await Promise.all([fetchAll(liveQueryFactory), fetchAll(legacyQueryFactory)])
        const liveData = liveRes.data || []
        const legacyData = legacyRes.data || []
        
        const liveSum = liveData.reduce((acc: number, r: any) => acc + (Number(r.consultancy_fee) || 0), 0)
        const legacySum = legacyData.reduce((acc: number, r: any) => acc + (Number(r.amount) || 0), 0)
        
        return {
          total_amount: liveSum + legacySum,
          total_count: liveData.length + legacyData.length
        }
      }
      
      case 'facultyOverview': {
        let mfQuery = admin.from('master_faculty').select('dept, type')
        if (args.dept) mfQuery = mfQuery.ilike('dept', `%${args.dept}%`)
        
        const [mfRes, supRes, schRes] = await Promise.all([
          mfQuery,
          admin.from('legacy_research_supervisors').select('*', { count: 'exact', head: true }),
          admin.from('legacy_research_scholars').select('*', { count: 'exact', head: true })
        ])
        
        const mf = mfRes.data || []
        const totalFaculty = mf.length
        const phdCount = mf.filter((f: any) => f.type === 'Doctorate').length
        
        return {
          total_faculty: totalFaculty,
          phd_count: phdCount,
          phd_percentage: totalFaculty ? Math.round((phdCount / totalFaculty) * 100) + '%' : '0%',
          research_supervisors: supRes.count || 0,
          research_scholars: schRes.count || 0
        }
      }
      
      case 'patentsCount': {
        const [liveRes, legacyRes] = await Promise.all([
          admin.from('incentive_applications').select('id').eq('category', 'patent').eq('status', 'approved'),
          admin.from('legacy_patents').select('id')
        ])
        return {
          total_patents_count: (liveRes.data?.length || 0) + (legacyRes.data?.length || 0)
        }
      }
      
      case 'listAnnouncements': {
        let q = admin.from('announcements').select('category, title, body, event_date, start_date, registration_end_date').eq('is_active', true)
        if (args.category) {
          q = q.ilike('category', `%${args.category}%`)
        }
        const res = await q.order('created_at', { ascending: false }).limit(10)
        return { 
          count: res.data?.length || 0,
          data: res.data || []
        }
      }
      
      default:
        return { error: 'Unknown tool' }
    }
  } catch (err: any) {
    return { error: err.message }
  }
}

export async function POST(request: Request) {
  try {
    const admin = createAdminClient()
    const token = extractToken(request)
    
    if (!token) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const authResult = await verifyToken(token)
    if (!authResult) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
    
    const isAdmin = await requireAdmin(authResult)
    if (!isAdmin) {
      return NextResponse.json({ error: 'Forbidden. Admin access required.' }, { status: 403 })
    }

    let body: any
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    }

    const message = body.message
    const history = body.history || []

    const ai = getGeminiClient()
    
    const currentHistory = history.map((msg: any) => ({
      role: msg.role === 'user' ? 'user' : 'model',
      parts: [{ text: msg.text }]
    }))
    
    currentHistory.push({
      role: 'user',
      parts: [{ text: message }]
    })

    let iterations = 0
    let finalText = ''

    while (iterations < 5) {
      const result = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: currentHistory,
        config: {
          systemInstruction: systemInstruction,
          tools: adminTools as any,
        }
      })
      
      const functionCalls = result.functionCalls

      if (functionCalls && functionCalls.length > 0) {
        // Model returned function calls. Append the model's functionCall part to history
        currentHistory.push({
          role: 'model',
          parts: result.candidates?.[0]?.content?.parts || []
        })
        
        // Tools are read-only and independent — run them concurrently (order is preserved)
        const functionResponses = await Promise.all(functionCalls.map(async call => ({
          functionResponse: {
            name: call.name,
            response: await executeTool(call.name || '', call.args, admin)
          }
        })))
        
        currentHistory.push({
          role: 'user',
          parts: functionResponses
        })
      } else {
        finalText = result.text || ''
        break
      }
      
      iterations++
    }

    return NextResponse.json({ reply: finalText })

  } catch (error: any) {
    console.error('Admin Chat API Error:', error)
    if (error?.status === 429) {
      return NextResponse.json({ error: 'The assistant is busy right now — please try again in a moment', rateLimited: true }, { status: 429 })
    }
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 })
  }
}
