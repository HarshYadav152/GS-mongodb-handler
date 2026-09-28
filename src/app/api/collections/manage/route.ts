import { NextRequest, NextResponse } from 'next/server'
import { getClient } from '@/lib/mongodb'
import { getUri } from '@/lib/connectionStore'
import { toApiError, AppError } from '@/lib/errors'

// POST  → create a collection
export async function POST(req: NextRequest) {
  try {
    const { connectionId, database, collection, options = {} } = await req.json()

    if (!connectionId || !database || !collection) {
      return NextResponse.json(
        { success: false, error: 'connectionId, database, and collection are required' },
        { status: 400 }
      )
    }

    const name = String(collection).trim()
    if (!name || name.includes('$') || name.startsWith('system.')) {
      return NextResponse.json(
        { success: false, error: 'Invalid collection name' },
        { status: 400 }
      )
    }

    const uri    = await getUri(connectionId)
    const client = await getClient(uri)
    const db     = client.db(database)

    // Check it doesn't already exist
    const existing = await db.listCollections({ name }).toArray()
    if (existing.length > 0) {
      return NextResponse.json(
        { success: false, error: `Collection "${name}" already exists` },
        { status: 409 }
      )
    }

    await db.createCollection(name, options)

    return NextResponse.json({ success: true, data: { name } })
  } catch (err) {
    const { message, status } = toApiError(err, 'Failed to create collection')
    return NextResponse.json({ success: false, error: message }, { status })
  }
}

// DELETE → drop a collection
export async function DELETE(req: NextRequest) {
  try {
    const { connectionId, database, collection, confirm } = await req.json()

    if (!connectionId || !database || !collection) {
      return NextResponse.json(
        { success: false, error: 'connectionId, database, and collection are required' },
        { status: 400 }
      )
    }

    // Server-side confirmation, mirrors databases/manage — a client-only
    // confirm() dialog is not a real guard against a direct API call.
    if (confirm !== collection) {
      throw new AppError('Drop not confirmed: `confirm` must exactly match the collection name', 400)
    }

    const uri    = await getUri(connectionId)
    const client = await getClient(uri)
    const db     = client.db(database)

    const dropped = await db.collection(collection).drop()

    return NextResponse.json({ success: true, data: { dropped } })
  } catch (err) {
    const { message, status } = toApiError(err, 'Failed to drop collection')
    return NextResponse.json({ success: false, error: message }, { status })
  }
}
