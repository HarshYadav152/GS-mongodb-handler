import { NextRequest, NextResponse } from 'next/server'
import { getClient, parseQueryFilter, assertSafeQueryObject } from '@/lib/mongodb'
import { getUri } from '@/lib/connectionStore'
import { toApiError, AppError } from '@/lib/errors'
import { ObjectId, Sort } from 'mongodb'

// ── BSON helpers ──────────────────────────────────────────────────────────────

/** Recursively convert {$oid} / {$date} back to native BSON for writes */
function deserializeBSON(value: unknown): unknown {
  if (value === null || value === undefined) return value
  if (Array.isArray(value)) return value.map(deserializeBSON)
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    if ('$oid' in obj && typeof obj.$oid === 'string') {
      return ObjectId.isValid(obj.$oid) ? new ObjectId(obj.$oid) : obj.$oid
    }
    if ('$date' in obj && typeof obj.$date === 'string') {
      return new Date(obj.$date)
    }
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(obj)) {
      out[k] = deserializeBSON(v)
    }
    return out
  }
  return value
}

/** Recursively convert BSON types to JSON-safe shapes for reads */
function serializeBSON(value: unknown): unknown {
  if (value instanceof ObjectId) return { $oid: value.toString() }
  if (value instanceof Date) return { $date: value.toISOString() }
  if (Array.isArray(value)) return value.map(serializeBSON)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = serializeBSON(v)
    }
    return out
  }
  return value
}

// ── READ (paginated) ──────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const {
      connectionId, database, collection,
      filter = '{}', sort = '{}', limit = 20, skip = 0, projection = '{}',
    } = await req.json()

    if (!connectionId || !database || !collection) {
      return NextResponse.json(
        { success: false, error: 'connectionId, database, and collection are required' },
        { status: 400 }
      )
    }

    const uri      = await getUri(connectionId)
    const client   = await getClient(uri)
    const col      = client.db(database).collection(collection)
    // Filters can carry `$where`-style operators — sort/projection can't,
    // so only the filter is checked against the operator denylist.
    const filterObj = parseQueryFilter(filter, /* checkOperators */ true)
    const sortObj    = parseQueryFilter(sort)
    const projObj    = parseQueryFilter(projection)
    const limitNum   = Math.min(Math.max(1, Number(limit)), 1000)
    const skipNum    = Math.max(0, Number(skip))
    const hasFilter  = Object.keys(filterObj).length > 0

    const [rawDocs, total] = await Promise.all([
      col
        .find(filterObj, { projection: Object.keys(projObj).length ? projObj : undefined })
        .sort(sortObj as Sort)
        .skip(skipNum)
        .limit(limitNum)
        .toArray(),
      // estimatedDocumentCount() is a fast metadata read but ignores the
      // filter; only pay for an exact (and capped) count when a filter is
      // actually applied.
      hasFilter
        ? col.countDocuments(filterObj, { maxTimeMS: 5_000 })
        : col.estimatedDocumentCount(),
    ])

    const documents = rawDocs.map(serializeBSON)

    return NextResponse.json({
      success: true,
      data: {
        documents,
        total,
        page: Math.floor(skipNum / limitNum) + 1,
        pageSize: limitNum,
        totalPages: Math.max(1, Math.ceil(total / limitNum)),
      },
    })
  } catch (err) {
    const { message, status } = toApiError(err, 'Query failed')
    return NextResponse.json({ success: false, error: message }, { status })
  }
}

// ── CREATE ────────────────────────────────────────────────────────────────────

export async function PUT(req: NextRequest) {
  try {
    const { connectionId, database, collection, document } = await req.json()

    if (!connectionId || !database || !collection || document === undefined) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 })
    }
    if (typeof document !== 'object' || Array.isArray(document) || document === null) {
      return NextResponse.json({ success: false, error: 'document must be a JSON object' }, { status: 400 })
    }

    const uri    = await getUri(connectionId)
    const client = await getClient(uri)
    const col    = client.db(database).collection(collection)

    const toInsert = deserializeBSON(document) as Record<string, unknown>

    const result = await col.insertOne(toInsert)
    return NextResponse.json({
      success: true,
      data: { insertedId: result.insertedId.toString() },
    })
  } catch (err) {
    const { message, status } = toApiError(err, 'Insert failed')
    return NextResponse.json({ success: false, error: message }, { status })
  }
}

// ── UPDATE ────────────────────────────────────────────────────────────────────

export async function PATCH(req: NextRequest) {
  try {
    const { connectionId, database, collection, id, update } = await req.json()

    if (!connectionId || !database || !collection || id === undefined || update === undefined) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 })
    }
    if (typeof update !== 'object' || Array.isArray(update) || update === null) {
      return NextResponse.json({ success: false, error: 'update must be a JSON object' }, { status: 400 })
    }

    const uri    = await getUri(connectionId)
    const client = await getClient(uri)
    const col    = client.db(database).collection(collection)

    let updatePayload = deserializeBSON(update) as Record<string, unknown>
    assertSafeQueryObject(updatePayload)

    const hasOperators = Object.keys(updatePayload).some((k) => k.startsWith('$'))

    if (hasOperators) {
      // User-supplied operators — strip _id from $set and $unset to be safe
      for (const op of ['$set', '$unset', '$setOnInsert'] as const) {
        if (op in updatePayload && typeof updatePayload[op] === 'object') {
          delete (updatePayload[op] as Record<string, unknown>)._id
        }
      }
    } else {
      // Plain replacement object — strip _id (immutable) and wrap in $set
      delete updatePayload._id
      updatePayload = { $set: updatePayload }
    }

    // `id` is the client's already-serialized `_id` value (e.g. {"$oid": "..."},
    // a plain string, or a number) as returned by the read endpoint — NOT a
    // flattened/guessed string. Deserializing it the same way we deserialize
    // document bodies means a 24-hex-character *string* `_id` (a legitimate,
    // non-ObjectId id shape) is never misinterpreted as an ObjectId, which a
    // previous heuristic-based `resolveId()` helper could do.
    const resolvedId = deserializeBSON(id)
    const result = await col.updateOne({ _id: resolvedId as ObjectId }, updatePayload)

    return NextResponse.json({
      success: true,
      data: { matchedCount: result.matchedCount, modifiedCount: result.modifiedCount },
    })
  } catch (err) {
    const { message, status } = toApiError(err, 'Update failed')
    return NextResponse.json({ success: false, error: message }, { status })
  }
}

// ── DELETE ────────────────────────────────────────────────────────────────────

export async function DELETE(req: NextRequest) {
  try {
    const { connectionId, database, collection, id } = await req.json()

    if (!connectionId || !database || !collection || id === undefined) {
      return NextResponse.json({ success: false, error: 'Missing required fields' }, { status: 400 })
    }

    const uri        = await getUri(connectionId)
    const client      = await getClient(uri)
    const col         = client.db(database).collection(collection)
    const resolvedId  = deserializeBSON(id)
    const result      = await col.deleteOne({ _id: resolvedId as ObjectId })

    if (result.deletedCount === 0) {
      throw new AppError('Document not found', 404)
    }

    return NextResponse.json({
      success: true,
      data: { deletedCount: result.deletedCount },
    })
  } catch (err) {
    const { message, status } = toApiError(err, 'Delete failed')
    return NextResponse.json({ success: false, error: message }, { status })
  }
}
