import { NextResponse } from 'next/server';

import { endSession } from '@/lib/telemetry';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const sessionId = Number(body?.sessionId);
    if (!sessionId || Number.isNaN(sessionId)) {
      return NextResponse.json({ error: 'sessionId is required' }, { status: 400 });
    }
    const summary = {
      status: typeof body?.status === 'string' ? body.status : undefined,
      notes: typeof body?.notes === 'string' ? body.notes : undefined
    };
    const session = endSession(sessionId, summary);
    return NextResponse.json({ session }, { status: 200 });
  } catch (error) {
    console.error('Failed to end session', error);
    return NextResponse.json({ error: 'Failed to end session' }, { status: 500 });
  }
}
