import { NextRequest, NextResponse } from 'next/server'
import { updateConnection, deleteConnection } from '@/lib/connectionStore'
import { toApiError } from '@/lib/errors'

interface Params { params: Promise<{ id: string }> }

export async function PUT(req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    const { name, uri } = await req.json()
    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ success: false, error: 'Connection name is required' }, { status: 400 })
    }
    const conn = await updateConnection(id, name.trim(), typeof uri === 'string' ? uri : undefined)
    return NextResponse.json({ success: true, data: conn })
  } catch (err) {
    const { message, status } = toApiError(err, 'Failed to update connection')
    return NextResponse.json({ success: false, error: message }, { status })
  }
}

export async function DELETE(_req: NextRequest, { params }: Params) {
  try {
    const { id } = await params
    await deleteConnection(id)
    return NextResponse.json({ success: true, data: { deleted: id } })
  } catch (err) {
    const { message, status } = toApiError(err, 'Failed to delete connection')
    return NextResponse.json({ success: false, error: message }, { status })
  }
}
