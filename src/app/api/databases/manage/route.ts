import { NextRequest, NextResponse } from 'next/server'
import { getClient } from '@/lib/mongodb'
import { getUri } from '@/lib/connectionStore'
import { toApiError, AppError } from '@/lib/errors'

// DELETE → drop an entire database
export async function DELETE(req: NextRequest) {
  try {
    const { connectionId, database, confirm } = await req.json()

    if (!connectionId || !database) {
      return NextResponse.json(
        { success: false, error: 'connectionId and database are required' },
        { status: 400 }
      )
    }

    // Refuse to drop system databases
    if (['admin', 'local', 'config'].includes(database)) {
      return NextResponse.json(
        { success: false, error: `Cannot drop system database "${database}"` },
        { status: 403 }
      )
    }

    // Server-side confirmation: the client UI still shows a confirm()
    // dialog, but that alone is trivially bypassed by calling this route
    // directly. The caller must also echo the exact database name back —
    // this can't be satisfied by a generic "yes"/true, so an automated or
    // careless caller can't drop a database without explicitly naming it.
    if (confirm !== database) {
      throw new AppError('Drop not confirmed: `confirm` must exactly match the database name', 400)
    }

    const uri    = await getUri(connectionId)
    const client = await getClient(uri)
    await client.db(database).dropDatabase()

    return NextResponse.json({ success: true, data: { dropped: database } })
  } catch (err) {
    const { message, status } = toApiError(err, 'Failed to drop database')
    return NextResponse.json({ success: false, error: message }, { status })
  }
}
