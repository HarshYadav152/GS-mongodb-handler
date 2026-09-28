import { NextRequest, NextResponse } from 'next/server'
import { getClient } from '@/lib/mongodb'
import { getUri } from '@/lib/connectionStore'
import { toApiError } from '@/lib/errors'

// POST → list indexes for a collection
export async function POST(req: NextRequest) {
  try {
    const { connectionId, database, collection } = await req.json()

    if (!connectionId || !database || !collection) {
      return NextResponse.json(
        { success: false, error: 'connectionId, database, and collection are required' },
        { status: 400 }
      )
    }

    const uri    = await getUri(connectionId)
    const client = await getClient(uri)
    const db  = client.db(database)
    const col = db.collection(collection)

    const [indexes, stats] = await Promise.all([
      col.indexes(),
      db.command({ collStats: collection }).catch(() => null),
    ])

    return NextResponse.json({
      success: true,
      data: {
        indexes,
        stats: stats
          ? {
              count: stats.count,
              size: stats.size,
              avgObjSize: stats.avgObjSize,
              totalIndexSize: stats.totalIndexSize,
              nindexes: stats.nindexes,
            }
          : null,
      },
    })
  } catch (err) {
    const { message, status } = toApiError(err, 'Failed to list indexes')
    return NextResponse.json({ success: false, error: message }, { status })
  }
}

// PUT → create an index
export async function PUT(req: NextRequest) {
  try {
    const { connectionId, database, collection, keys, options = {} } = await req.json()

    if (!connectionId || !database || !collection || !keys) {
      return NextResponse.json(
        { success: false, error: 'connectionId, database, collection, and keys are required' },
        { status: 400 }
      )
    }

    const uri    = await getUri(connectionId)
    const client = await getClient(uri)
    const col = client.db(database).collection(collection)
    const indexName = await col.createIndex(keys, options)

    return NextResponse.json({ success: true, data: { indexName } })
  } catch (err) {
    const { message, status } = toApiError(err, 'Failed to create index')
    return NextResponse.json({ success: false, error: message }, { status })
  }
}

// DELETE → drop an index by name
export async function DELETE(req: NextRequest) {
  try {
    const { connectionId, database, collection, indexName } = await req.json()

    if (!connectionId || !database || !collection || !indexName) {
      return NextResponse.json(
        { success: false, error: 'connectionId, database, collection, and indexName are required' },
        { status: 400 }
      )
    }

    if (indexName === '_id_') {
      return NextResponse.json(
        { success: false, error: 'Cannot drop the default _id index' },
        { status: 403 }
      )
    }

    const uri    = await getUri(connectionId)
    const client = await getClient(uri)
    await client.db(database).collection(collection).dropIndex(indexName)

    return NextResponse.json({ success: true, data: { dropped: indexName } })
  } catch (err) {
    const { message, status } = toApiError(err, 'Failed to drop index')
    return NextResponse.json({ success: false, error: message }, { status })
  }
}
