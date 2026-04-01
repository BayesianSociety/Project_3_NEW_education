import { NextResponse } from 'next/server';

import { recordAttempt, type MovementPayload, type TelemetryEventInput } from '@/lib/telemetry';

type AttemptPatch = {
  id?: number;
  success?: boolean;
  failureReason?: string | null;
  code?: string;
  speed?: string;
};

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: 'Request body is required' }, { status: 400 });
    }
    const sessionId = Number(body.sessionId);
    const puzzleId = typeof body.puzzleId === 'string' ? body.puzzleId : '';
    if (!sessionId || Number.isNaN(sessionId) || !puzzleId) {
      return NextResponse.json({ error: 'sessionId and puzzleId are required' }, { status: 400 });
    }

    const attemptInput = normalizeAttempt(body.attempt);
    const events = normalizeEvents(body.events);
    const movements = normalizeMovements(body.movements);

    const result = recordAttempt({
      sessionId,
      puzzleId,
      attemptId: attemptInput.id,
      success: attemptInput.success,
      failureReason: attemptInput.failureReason,
      code: attemptInput.code,
      speed: attemptInput.speed,
      events,
      movements
    });

    return NextResponse.json(
      {
        attemptId: result.attemptId,
        eventsInserted: result.eventsInserted,
        movementsInserted: result.movementsInserted
      },
      { status: 200 }
    );
  } catch (error) {
    console.error('Failed to record telemetry batch', error);
    return NextResponse.json({ error: 'Failed to record telemetry batch' }, { status: 500 });
  }
}

function normalizeAttempt(raw: AttemptPatch | undefined): AttemptPatch {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const attemptId = typeof raw.id === 'number' ? raw.id : undefined;
  const success =
    typeof raw.success === 'boolean'
      ? raw.success
      : typeof raw.success === 'string'
        ? raw.success === 'true'
        : undefined;
  let failureReason: string | null | undefined;
  if (typeof raw.failureReason === 'string') {
    failureReason = raw.failureReason;
  } else if (raw.failureReason === null) {
    failureReason = null;
  }
  const code = typeof raw.code === 'string' ? raw.code : undefined;
  const speed = typeof raw.speed === 'string' ? raw.speed : undefined;
  return {
    id: attemptId,
    success,
    failureReason,
    code,
    speed
  };
}

function normalizeEvents(input: unknown): TelemetryEventInput[] {
  if (!Array.isArray(input)) return [];
  const events: TelemetryEventInput[] = [];
  for (const entry of input) {
    if (!isRecord(entry) || typeof entry.type !== 'string') continue;
    const payload = isRecord(entry.payload) ? (entry.payload as Record<string, unknown>) : undefined;
    events.push({
      type: entry.type,
      payload,
      timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : undefined
    });
  }
  return events;
}

function normalizeMovements(input: unknown): MovementPayload[] {
  if (!Array.isArray(input)) return [];
  const movements: MovementPayload[] = [];
  for (const entry of input) {
    if (!isRecord(entry) || typeof entry.stepIndex !== 'number') continue;
    movements.push({
      stepIndex: entry.stepIndex,
      tileIndex: typeof entry.tileIndex === 'number' ? entry.tileIndex : undefined,
      x: typeof entry.x === 'number' ? entry.x : 0,
      y: typeof entry.y === 'number' ? entry.y : 0,
      action: typeof entry.action === 'string' ? entry.action : undefined,
      timestamp: typeof entry.timestamp === 'number' ? entry.timestamp : undefined
    });
  }
  return movements;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
