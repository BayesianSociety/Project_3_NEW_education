import { NextResponse } from 'next/server';

import { startSession } from '@/lib/telemetry';

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    const userKey = typeof body?.userKey === 'string' ? body.userKey.trim() : '';
    if (!userKey) {
      return NextResponse.json({ error: 'userKey is required' }, { status: 400 });
    }
    const puzzleId = typeof body?.puzzleId === 'string' ? body.puzzleId : undefined;
    const session = startSession(userKey, puzzleId);
    return NextResponse.json(
      {
        sessionId: session.sessionId,
        userId: session.userId,
        puzzleId: session.puzzleId,
        startedAt: session.startedAt
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Failed to start session', error);
    return NextResponse.json({ error: 'Failed to start session' }, { status: 500 });
  }
}
