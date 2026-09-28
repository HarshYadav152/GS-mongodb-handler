import { NextRequest, NextResponse } from 'next/server'
import { createSessionToken, requireAppPassword, timingSafeEqual, SESSION_COOKIE } from '@/lib/auth'
import { rateLimit } from '@/lib/rateLimit'

export async function POST(req: NextRequest) {
  // Best-effort brute-force throttle, keyed by source IP.
  const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
  if (!rateLimit(`login:${ip}`, 5, 60_000)) {
    return NextResponse.json({ success: false, error: 'Too many attempts. Try again in a minute.' }, { status: 429 })
  }

  try {
    const { password } = await req.json()
    if (typeof password !== 'string' || !password) {
      return NextResponse.json({ success: false, error: 'Password is required' }, { status: 400 })
    }

    const expected = requireAppPassword()
    const ok = await timingSafeEqual(password, expected)
    if (!ok) {
      return NextResponse.json({ success: false, error: 'Incorrect password' }, { status: 401 })
    }

    const token = await createSessionToken()
    const res = NextResponse.json({ success: true })
    res.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 60 * 60 * 12, // 12h, matches SESSION_TTL_MS in lib/auth.ts
    })
    return res
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Login failed'
    return NextResponse.json({ success: false, error: message }, { status: 500 })
  }
}
