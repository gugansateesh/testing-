'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

export default function SubmitPage() {
  const router = useRouter()

  useEffect(() => {
    // Legacy paper submission is disabled; all applications start from Profile -> Publication History
    router.replace('/profile')
  }, [router])

  return (
    <div className="min-h-screen bg-blue-50 flex items-center justify-center">
      <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
    </div>
  )
}
