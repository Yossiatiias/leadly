'use client'

import { useParams, useRouter } from 'next/navigation'
import LeadDetail from '@/components/LeadDetail'

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  return <LeadDetail leadId={id} onClose={() => router.push('/leads')} />
}
