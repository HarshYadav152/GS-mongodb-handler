import { NextRequest, NextResponse } from 'next/server'
import { getClient } from '@/lib/mongodb'
import { getUri } from '@/lib/connectionStore'
import { toApiError } from '@/lib/errors'

export async function POST(req: NextRequest) {
  try {
    const { connectionId, database } = await req.json()
    if (!connectionId || !database) {
      return NextResponse.json({ success: false, error: 'connectionId and database are required' }, { status: 400 })
    }

    const uri    = await getUri(connectionId)
    const client = await getClient(uri)
    const db     = client.db(database)
    const collections = await db.listCollections().toArray()

    // Get approximate counts
    const withCounts = await Promise.all(
      collections.map(async (col: { name: string; type?: string }) => {
        try {
          const count = await db.collection(col.name).estimatedDocumentCount()
          return { name: col.name, type: col.type ?? 'collection', count }
        } catch {
          return { name: col.name, type: col.type ?? 'collection', count: 0 }
        }
      })
    )

    return NextResponse.json({ success: true, data: withCounts })
  } catch (err) {
    const { message, status } = toApiError(err, 'Failed to list collections')
    return NextResponse.json({ success: false, error: message }, { status })
  }
}
