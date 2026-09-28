import { NextRequest, NextResponse } from 'next/server'
import { listConnections, createConnection } from '@/lib/connectionStore'
import { toApiError } from '@/lib/errors'

export async function GET() {
  try {
    const connections = await listConnections()
    return NextResponse.json({ success: true, data: connections })
  } catch (err) {
    const { message, status } = toApiError(err, 'Failed to list connections')
    return NextResponse.json({ success: false, error: message }, { status })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { name, uri } = await req.json()
    if (!name || typeof name !== 'string' || !name.trim()) {
      return NextResponse.json({ success: false, error: 'Connection name is required' }, { status: 400 })
    }
    if (!uri || typeof uri !== 'string' || !uri.trim()) {
      return NextResponse.json({ success: false, error: 'MongoDB URI is required' }, { status: 400 })
    }
    const conn = await createConnection(name.trim(), uri.trim())
    return NextResponse.json({ success: true, data: conn })
  } catch (err) {
    const { message, status } = toApiError(err, 'Failed to save connection')
    return NextResponse.json({ success: false, error: message }, { status })
  }
}
