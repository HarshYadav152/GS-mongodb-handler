import { NextRequest, NextResponse } from 'next/server'
import { getClient } from '@/lib/mongodb'
import { getUri } from '@/lib/connectionStore'
import { toApiError } from '@/lib/errors'

export async function POST(req: NextRequest) {
  try {
    const { connectionId } = await req.json()
    if (!connectionId) {
      return NextResponse.json({ success: false, error: 'connectionId is required' }, { status: 400 })
    }

    const uri    = await getUri(connectionId)
    const client = await getClient(uri)
    const adminDb = client.db('admin')
    const result = await adminDb.command({ listDatabases: 1, nameOnly: false })

    const databases = result.databases.map((db: { name: string; sizeOnDisk?: number; empty?: boolean }) => ({
      name: db.name,
      sizeOnDisk: db.sizeOnDisk,
      empty: db.empty,
    }))

    return NextResponse.json({ success: true, data: databases })
  } catch (err) {
    const { message, status } = toApiError(err, 'Failed to list databases')
    return NextResponse.json({ success: false, error: message }, { status })
  }
}
