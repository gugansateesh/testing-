import { AlertCircle, Lock } from 'lucide-react'

export function FormField({ label, required, error, hint, children }: {
  label: string; required?: boolean; error?: string; hint?: string; children: React.ReactNode
}) {
  return (
    <div className="space-y-2">
      <label className="block text-sm font-semibold text-slate-700 tracking-tight">
        {label}{required && <span className="text-blue-600 ml-1">*</span>}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-slate-500 font-medium">{hint}</p>}
      {error && (
        <p className="flex items-center gap-1.5 text-xs text-red-600 font-medium bg-red-50 p-2 rounded-md">
          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" /> {error}
        </p>
      )}
    </div>
  )
}

export const inputClass = 'w-full rounded-2xl border-slate-200/60 bg-blue-50/50 px-5 py-3.5 text-slate-800 text-sm placeholder-slate-400 shadow-sm focus:bg-white focus:outline-none focus:ring-4 focus:ring-indigo-500/10 focus:border-indigo-400 transition-all duration-300 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed font-semibold border hover:border-indigo-200'
export const readonlyClass = 'w-full rounded-2xl border-slate-200 bg-slate-100/50 px-5 py-3.5 text-slate-700 text-sm shadow-inner font-bold border cursor-default select-none'

interface PublicationDetailsFormProps {
  mode: 'manual' | 'prefilled'
  defaultValues: any
}

function LockedInput({ value, name, as = 'input' }: { value: string, name: string, as?: 'input' | 'textarea' | 'select' }) {
  return (
    <div className="relative group">
      <Lock className="absolute right-4 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
      {as === 'textarea' ? (
        <textarea name={name} readOnly value={value} rows={2} className={`${readonlyClass} pr-10 resize-none`} />
      ) : as === 'select' ? (
        <input type="text" name={name} readOnly value={value} className={`${readonlyClass} pr-10`} />
      ) : (
        <input type="text" name={name} readOnly value={value} className={`${readonlyClass} pr-10`} />
      )}
    </div>
  )
}

export default function PublicationDetailsForm({ mode, defaultValues }: PublicationDetailsFormProps) {
  const isPrefilled = mode === 'prefilled'

  const renderField = (name: string, type: 'input' | 'textarea' | 'date' = 'input', req: boolean, ph: string, locked: boolean, val: any, extraProps: any = {}) => {
    if (locked) return <LockedInput name={name} value={val || ''} as={type === 'textarea' ? 'textarea' : 'input'} />
    
    if (type === 'textarea') return <textarea name={name} defaultValue={val} required={req} rows={2} className={`${inputClass} resize-none`} placeholder={ph} {...extraProps} />
    if (type === 'date') return <input type="date" name={name} defaultValue={val || ''} required={req} className={inputClass} {...extraProps} />
    return <input type={extraProps.type || 'text'} name={name} defaultValue={val} required={req} className={inputClass} placeholder={ph} {...extraProps} />
  }

  const renderSelect = (name: string, locked: boolean, val: any, options: React.ReactNode, req: boolean) => {
    if (locked) return <LockedInput name={name} value={val || ''} as="select" />
    return (
      <select name={name} required={req} className={inputClass} defaultValue={val || ""}>
        <option value="" disabled>Select Type…</option>
        {options}
      </select>
    )
  }

  return (
    <div className="bg-white/90 backdrop-blur-xl rounded-3xl shadow-[0_8px_30px_rgb(0,0,0,0.04)] overflow-hidden ring-1 ring-slate-200/60 transition-transform duration-300 hover:shadow-[0_8px_30px_rgb(0,0,0,0.08)]">
      <div className="px-8 py-6 border-b border-slate-100 bg-gradient-to-r from-slate-50 to-white dark:from-transparent dark:to-transparent flex items-center gap-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-indigo-500 to-cyan-500 flex items-center justify-center shadow-lg shadow-indigo-500/20 text-white font-black text-lg">
          2
        </div>
        <h2 className="text-xl font-black text-slate-800">Publication Details</h2>
      </div>
      <div className="p-6 sm:p-8 space-y-6">
        <FormField label="Authors" required>
          {renderField('authors', 'input', true, "e.g. Smith J., Jones B., Patel R.", isPrefilled, defaultValues?.authors)}
        </FormField>
        
        <FormField label="Title of the Paper" required>
          {renderField('title', 'textarea', true, "Enter the full official title of the publication", isPrefilled, defaultValues?.title)}
        </FormField>
        
        <FormField label="Source Title" required hint="Full name of the Journal or Conference Proceedings">
          {renderField('source_title', 'input', true, "e.g. IEEE Transactions on Neural Networks", isPrefilled, defaultValues?.source_title)}
        </FormField>
        
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
          <FormField label="Volume">
            {renderField('volume', 'input', false, "e.g. 12", isPrefilled && !!defaultValues?.volume, defaultValues?.volume)}
          </FormField>
          
          <FormField label="Issue">
            {renderField('issue', 'input', false, "e.g. 3", isPrefilled && !!defaultValues?.issue, defaultValues?.issue)}
          </FormField>
          
          <FormField label="Publication Year" required>
            {renderField('year', 'input', true, String(new Date().getFullYear()), isPrefilled, defaultValues?.year, { min: 1990, max: 2099, type: 'number' })}
          </FormField>
          
          <FormField label="Date of Publication" hint="Leave blank if unknown">
            {renderField('publication_date', 'date', false, "", isPrefilled && !!defaultValues?.publication_date, defaultValues?.publication_date, {
              max: new Date().toISOString().split('T')[0],
              onChange: (e: any) => {
                if (isPrefilled) return; // In prefilled, year is locked anyway
                const d = e.target.value
                if (d) {
                  const yr = new Date(d).getFullYear()
                  const form = e.target.closest('form') as HTMLFormElement | null
                  const yearInput = form?.querySelector('input[name="year"]') as HTMLInputElement | null
                  if (yearInput && !isPrefilled) yearInput.value = String(yr)
                }
              }
            })}
          </FormField>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
          <FormField label="DOI" required hint="The unique permanent link to your paper">
            {renderField('doi', 'input', true, "10.xxxx/xxxxx", isPrefilled, defaultValues?.doi)}
          </FormField>
          <FormField label="Scopus Record Link" required hint="Direct URL to your paper on Scopus.com">
            {renderField('scopus_link', 'input', true, "https://www.scopus.com/...", isPrefilled, defaultValues?.link || defaultValues?.scopus_link, { type: 'url' })}
          </FormField>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 pt-4 border-t border-slate-100">
          <FormField label="Scopus Document Type" required>
            {renderSelect('doc_type_scopus', isPrefilled, defaultValues?.document_type_scopus || defaultValues?.doc_type_scopus, 
              <>
                <option>Article</option><option>Book</option><option>Book chapter</option>
                <option>Conference paper</option><option>Editorial</option><option>Erratum</option>
                <option>Retracted</option><option>Review</option>
              </>, true)}
          </FormField>
          
          <FormField label="Internal Category" required>
            {renderSelect('doc_type', isPrefilled, isPrefilled ? 'Faculty Publication' : defaultValues?.doc_type,
              <>
                <option>Student Publication</option><option>Faculty Publication</option><option>Scholar Publication</option>
              </>, true)}
          </FormField>
          
          <FormField label="Report Classification" required>
            {renderSelect('doc_type_report', isPrefilled, defaultValues?.document_type_report || defaultValues?.doc_type_report,
              <>
                <option>SCI</option><option>Scopus/WoS Journals</option>
                <option>Scopus/WoS Conference/Book Chapter/Others</option>
                <option>Student Publication</option><option>Book</option>
              </>, true)}
          </FormField>
        </div>
        
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-6 pt-2">
          <FormField label="ISBN Number" hint="Only if applicable (Books/Chapters)">
            {renderField('isbn_no', 'input', false, "978-x-xxxx-xxxx-x", isPrefilled && !!defaultValues?.isbn_no, defaultValues?.isbn_no)}
          </FormField>
          <FormField label="ISSN Number" hint="Only if applicable (Journals)">
            {renderField('issn_no', 'input', false, "xxxx-xxxx", isPrefilled && !!defaultValues?.issn_no, defaultValues?.issn_no)}
          </FormField>
        </div>
      </div>
    </div>
  )
}
