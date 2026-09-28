import { NextRequest, NextResponse } from 'next/server'
import { testConnection } from '@/lib/mongodb'
import { getUri, touchLastUsed } from '@/lib/connectionStore'
import { toApiError } from '@/lib/errors'

// Accepts EITHER:
//  - { uri }           — ad-hoc test, used by the Add/Edit connection form
//                         before the connection has been saved.
//  - { connectionId }  — test (and mark as used) an already-saved connection.
// This route sits behind the auth middleware, so only an authenticated
// operator can reach it — see the audit note on why an arbitrary-URI test
// endpoint is acceptable here but would not be if it were public.
export async function POST(req: NextRequest) {
  try {
    const { uri, connectionId } = await req.json()

    let targetUri: string
    if (connectionId) {
      targetUri = await getUri(connectionId)
    } else if (uri) {
      targetUri = uri
    } else {
      return NextResponse.json({ success: false, error: 'uri or connectionId is required' }, { status: 400 })
    }

    const result = await testConnection(targetUri)
    if (connectionId) await touchLastUsed(connectionId)

    return NextResponse.json({ success: true, data: result })
  } catch (err) {
    const { message, status } = toApiError(err, 'Connection failed')
    return NextResponse.json({ success: false, error: message }, { status })
  }
}
