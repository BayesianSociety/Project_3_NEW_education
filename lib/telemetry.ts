import { connection as db } from '@/lib/db';
import { puzzles, getPuzzleById, type PuzzleDefinition } from '@/data/puzzles';

export type TelemetryEventInput = {
  type: string;
  payload?: Record<string, unknown>;
  timestamp?: number;
};

export type MovementPayload = {
  stepIndex: number;
  tileIndex?: number | null;
  x: number;
  y: number;
  action?: string;
  timestamp?: number;
};

export type RecordAttemptPayload = {
  sessionId: number;
  puzzleId: string;
  attemptId?: number;
  success?: boolean;
  failureReason?: string | null;
  code?: string;
  speed?: string;
  events: TelemetryEventInput[];
  movements: MovementPayload[];
};

export type AnalyticsOverview = {
  totalUsers: number;
  totalSessions: number;
  totalAttempts: number;
  completionRate: number;
  perPuzzle: {
    puzzleId: string;
    title: string;
    attempts: number;
    completions: number;
    avgDurationMs: number;
  }[];
};

export type PuzzleAnalytics = {
  puzzleId: string;
  title: string;
  attempts: {
    attemptId: number;
    success: boolean;
    failureReason: string | null;
    startedAt: string;
    endedAt: string | null;
    speed: string | null;
  }[];
};

export type ReplayPayload = {
  puzzle: {
    id: string;
    title: string;
    scene: PuzzleDefinition['scene'];
    goal: string;
  };
  steps: {
    tileIndex: number;
    x: number;
    y: number;
    action: string | null;
  }[];
};

type SessionRow = {
  id: number;
  userId: number;
  puzzleId: string | null;
  status: string | null;
  notes: string | null;
  startedAt: string;
  endedAt: string | null;
};

type UserRow = {
  id: number;
  userKey: string;
};

type AttemptRow = {
  id: number;
  sessionId: number;
  puzzleId: string;
};

type CountRow = {
  count: number;
};

type TotalAttemptsRow = {
  attempts: number | null;
  completions: number | null;
};

type PuzzleAggregateRow = {
  puzzleId: string;
  title: string;
  attempts: number | null;
  completions: number | null;
  avgDuration: number | null;
};

type AttemptDetailRow = {
  id: number;
  sessionId: number;
  success: number | null;
  failureReason: string | null;
  code: string | null;
  speed: string | null;
  startedAt: string;
  endedAt: string | null;
};

type MovementDetailRow = {
  tileIndex: number | null;
  x: number | null;
  y: number | null;
  action: string | null;
};

type AttemptReplayRow = AttemptDetailRow & {
  puzzleId: string;
};

const insertPuzzleStmt = db.prepare(
  `INSERT INTO puzzles (id, slug, title, concept, story, goal, data, updated_at)
   VALUES (@id, @slug, @title, @concept, @story, @goal, @data, CURRENT_TIMESTAMP)
   ON CONFLICT(id) DO UPDATE SET
     slug = excluded.slug,
     title = excluded.title,
     concept = excluded.concept,
     story = excluded.story,
     goal = excluded.goal,
     data = excluded.data,
     updated_at = CURRENT_TIMESTAMP`
);

const selectUserStmt = db.prepare('SELECT id, user_key as userKey FROM users WHERE user_key = ?');
const insertUserStmt = db.prepare('INSERT INTO users (user_key) VALUES (?)');
const selectSessionStmt = db.prepare(
  `SELECT id,
          user_id as userId,
          puzzle_id as puzzleId,
          status,
          notes,
          started_at as startedAt,
          ended_at as endedAt
   FROM sessions
   WHERE id = ?`
);
const insertSessionStmt = db.prepare(
  `INSERT INTO sessions (user_id, puzzle_id, status)
   VALUES (?, ?, 'active')`
);
const updateSessionStmt = db.prepare(
  `UPDATE sessions
   SET status = COALESCE(?, status),
       notes = COALESCE(?, notes),
       ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP)
   WHERE id = ?`
);

const selectProgressStmt = db.prepare('SELECT puzzle_id FROM puzzle_progress WHERE user_id = ?');
const insertProgressStmt = db.prepare(
  `INSERT INTO puzzle_progress (user_id, puzzle_id, status)
   VALUES (?, ?, ?)`
);
const markProgressCompletedStmt = db.prepare(
  `INSERT INTO puzzle_progress (user_id, puzzle_id, status, completed_at)
   VALUES (?, ?, 'completed', CURRENT_TIMESTAMP)
   ON CONFLICT(user_id, puzzle_id) DO UPDATE SET
     status = 'completed',
     completed_at = CURRENT_TIMESTAMP`
);
const unlockProgressStmt = db.prepare(
  `INSERT INTO puzzle_progress (user_id, puzzle_id, status)
   VALUES (?, ?, 'unlocked')
   ON CONFLICT(user_id, puzzle_id) DO UPDATE SET
     status = CASE
       WHEN puzzle_progress.status = 'completed' THEN puzzle_progress.status
       ELSE 'unlocked'
     END`
);

const insertAttemptStmt = db.prepare(
  `INSERT INTO attempts (session_id, puzzle_id, success, failure_reason, code, speed)
   VALUES (?, ?, ?, ?, ?, ?)`
);
const updateAttemptStmt = db.prepare(
  `UPDATE attempts
   SET success = CASE WHEN @successProvided THEN @success ELSE success END,
       failure_reason = CASE WHEN @failureProvided THEN @failure ELSE failure_reason END,
       code = COALESCE(@code, code),
       speed = COALESCE(@speed, speed)
   WHERE id = @id`
);
const markAttemptEndedStmt = db.prepare(
  `UPDATE attempts
   SET ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP)
   WHERE id = ?`
);
const selectAttemptStmt = db.prepare(
  `SELECT id, session_id as sessionId, puzzle_id as puzzleId FROM attempts WHERE id = ?`
);

const insertEventStmt = db.prepare(
  `INSERT INTO events (attempt_id, session_id, event_type, payload, recorded_at)
   VALUES (?, ?, ?, ?, ?)`
);

const insertMovementStmt = db.prepare(
  `INSERT INTO movements (attempt_id, session_id, step_index, tile_index, x, y, action, recorded_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);

const syncPuzzles = db.transaction((definitions: PuzzleDefinition[]) => {
  definitions.forEach((definition) => {
    insertPuzzleStmt.run({
      id: definition.id,
      slug: definition.slug,
      title: definition.title,
      concept: definition.concept,
      story: definition.story,
      goal: definition.goal,
      data: JSON.stringify(definition)
    });
  });
});

syncPuzzles(puzzles);

function ensurePuzzle(puzzleId: string) {
  const definition = getPuzzleById(puzzleId);
  if (!definition) {
    throw new Error(`Puzzle ${puzzleId} is not defined.`);
  }
  insertPuzzleStmt.run({
    id: definition.id,
    slug: definition.slug,
    title: definition.title,
    concept: definition.concept,
    story: definition.story,
    goal: definition.goal,
    data: JSON.stringify(definition)
  });
  return definition;
}

function ensureProgressSeeds(userId: number) {
  const existingRows = selectProgressStmt.all(userId) as { puzzle_id: string }[];
  const existing = new Set(existingRows.map((row) => row.puzzle_id));
  puzzles.forEach((puzzle, index) => {
    if (!existing.has(puzzle.id)) {
      insertProgressStmt.run(userId, puzzle.id, index === 0 ? 'unlocked' : 'locked');
    }
  });
}

function fetchSession(sessionId: number): SessionRow | undefined {
  return selectSessionStmt.get(sessionId) as SessionRow | undefined;
}

export function ensureUser(userKey: string): UserRow {
  if (!userKey) {
    throw new Error('userKey is required');
  }
  const existing = selectUserStmt.get(userKey) as UserRow | undefined;
  if (existing) {
    ensureProgressSeeds(existing.id);
    return existing;
  }
  const result = insertUserStmt.run(userKey);
  const user: UserRow = { id: Number(result.lastInsertRowid), userKey };
  ensureProgressSeeds(user.id);
  return user;
}

export function startSession(userKey: string, puzzleId?: string) {
  const user = ensureUser(userKey);
  const puzzle = puzzleId ? ensurePuzzle(puzzleId) : undefined;
  if (puzzle) {
    ensureProgressSeeds(user.id);
  }
  const insertResult = insertSessionStmt.run(user.id, puzzle?.id ?? null);
  const sessionId = Number(insertResult.lastInsertRowid);
  const session = fetchSession(sessionId);
  return {
    sessionId,
    userId: user.id,
    puzzleId: session?.puzzleId ?? puzzle?.id ?? null,
    startedAt: session?.startedAt ?? new Date().toISOString()
  };
}

export function endSession(sessionId: number, summary?: { status?: string; notes?: string }) {
  if (!sessionId) {
    throw new Error('sessionId is required');
  }
  const session = fetchSession(sessionId);
  if (!session) {
    throw new Error(`Session ${sessionId} was not found`);
  }
  updateSessionStmt.run(summary?.status ?? null, summary?.notes ?? null, sessionId);
  const updated = fetchSession(sessionId);
  return updated ?? session;
}

const recordAttemptTx = db.transaction((payload: RecordAttemptPayload) => {
  const session = fetchSession(payload.sessionId);
  if (!session) {
    throw new Error(`Session ${payload.sessionId} not found`);
  }
  const puzzle = ensurePuzzle(payload.puzzleId);
  ensureProgressSeeds(session.userId);

  const successProvided = typeof payload.success === 'boolean';
  const successValue = successProvided ? (payload.success ? 1 : 0) : null;
  const failureProvided = payload.failureReason !== undefined;
  const failureValue =
    payload.failureReason === null
      ? null
      : typeof payload.failureReason === 'string' && payload.failureReason.length > 0
        ? payload.failureReason
        : null;
  const shouldMarkEnded =
    successProvided || (typeof payload.failureReason === 'string' && payload.failureReason.length > 0);

  let attemptId = payload.attemptId;
  if (attemptId) {
    const attempt = selectAttemptStmt.get(attemptId) as AttemptRow | undefined;
    if (!attempt || attempt.sessionId !== payload.sessionId) {
      throw new Error(`Attempt ${attemptId} does not belong to session ${payload.sessionId}`);
    }
    updateAttemptStmt.run({
      successProvided,
      success: successValue,
      failureProvided,
      failure: failureValue,
      code: payload.code ?? null,
      speed: payload.speed ?? null,
      id: attemptId
    });
    if (shouldMarkEnded) {
      markAttemptEndedStmt.run(attemptId);
    }
  } else {
    const insertResult = insertAttemptStmt.run(
      payload.sessionId,
      puzzle.id,
      successValue,
      failureProvided ? failureValue : null,
      payload.code ?? null,
      payload.speed ?? null
    );
    attemptId = Number(insertResult.lastInsertRowid);
    if (shouldMarkEnded) {
      markAttemptEndedStmt.run(attemptId);
    }
  }

  let eventsInserted = 0;
  for (const event of payload.events ?? []) {
    if (!event?.type) continue;
    insertEventStmt.run(
      attemptId,
      payload.sessionId,
      event.type,
      event.payload ? JSON.stringify(event.payload) : null,
      event.timestamp ? new Date(event.timestamp).toISOString() : new Date().toISOString()
    );
    eventsInserted += 1;
  }

  let movementsInserted = 0;
  for (const movement of payload.movements ?? []) {
    if (typeof movement?.stepIndex !== 'number') continue;
    const tileValue = typeof movement.tileIndex === 'number' ? movement.tileIndex : null;
    const xValue = typeof movement.x === 'number' ? movement.x : null;
    const yValue = typeof movement.y === 'number' ? movement.y : null;
    insertMovementStmt.run(
      attemptId,
      payload.sessionId,
      movement.stepIndex,
      tileValue,
      xValue,
      yValue,
      movement.action ?? null,
      movement.timestamp ? new Date(movement.timestamp).toISOString() : new Date().toISOString()
    );
    movementsInserted += 1;
  }

  if (payload.success === true) {
    markProgressCompletedStmt.run(session.userId, puzzle.id);
    const nextPuzzleIndex = puzzles.findIndex((p) => p.id === puzzle.id) + 1;
    if (nextPuzzleIndex > 0 && nextPuzzleIndex < puzzles.length) {
      const nextPuzzle = puzzles[nextPuzzleIndex];
      unlockProgressStmt.run(session.userId, nextPuzzle.id);
    }
  }

  return {
    attemptId,
    eventsInserted,
    movementsInserted
  };
});

export function recordAttempt(payload: RecordAttemptPayload) {
  return recordAttemptTx(payload);
}

export function getAnalyticsOverview(): AnalyticsOverview {
  const totalUsersRow = db.prepare('SELECT COUNT(*) as count FROM users').get() as CountRow | undefined;
  const totalSessionsRow = db.prepare('SELECT COUNT(*) as count FROM sessions').get() as CountRow | undefined;
  const totalAttemptsRow = db
    .prepare('SELECT COUNT(*) as attempts, SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as completions FROM attempts')
    .get() as TotalAttemptsRow | undefined;
  const totalUsers = Number(totalUsersRow?.count ?? 0);
  const totalSessions = Number(totalSessionsRow?.count ?? 0);
  const totalAttempts = Number(totalAttemptsRow?.attempts ?? 0);
  const totalCompletions = Number(totalAttemptsRow?.completions ?? 0);
  const completionRate = totalAttempts > 0 ? totalCompletions / totalAttempts : 0;

  const perPuzzleRowsRaw = db
    .prepare(
      `SELECT p.id as puzzleId,
              p.title as title,
              COUNT(a.id) as attempts,
              SUM(CASE WHEN a.success = 1 THEN 1 ELSE 0 END) as completions,
              AVG(CASE WHEN a.ended_at IS NOT NULL THEN (julianday(a.ended_at) - julianday(a.started_at)) * 86400 END) as avgDuration
       FROM puzzles p
       LEFT JOIN attempts a ON a.puzzle_id = p.id
       GROUP BY p.id
       ORDER BY p.id`
    )
    .all() as PuzzleAggregateRow[];
  const perPuzzleRows = perPuzzleRowsRaw.map((row) => ({
    puzzleId: row.puzzleId,
    title: row.title,
    attempts: Number(row.attempts ?? 0),
    completions: Number(row.completions ?? 0),
    avgDurationMs: row.avgDuration ? Math.round(Number(row.avgDuration) * 1000) : 0
  }));

  return {
    totalUsers,
    totalSessions,
    totalAttempts,
    completionRate,
    perPuzzle: perPuzzleRows
  };
}

export function getPuzzleAnalytics(puzzleId: string): PuzzleAnalytics {
  const puzzle = ensurePuzzle(puzzleId);
  const attemptRows = db
    .prepare(
      `SELECT id,
              session_id as sessionId,
              success,
              failure_reason as failureReason,
              code,
              speed,
              started_at as startedAt,
              ended_at as endedAt
       FROM attempts
       WHERE puzzle_id = ?
       ORDER BY started_at DESC
       LIMIT 50`
    )
    .all(puzzleId) as AttemptDetailRow[];
  const attempts = attemptRows.map((row) => ({
    attemptId: Number(row.id),
    success: row.success === 1,
    failureReason: row.failureReason ?? null,
    speed: row.speed ?? null,
    startedAt: row.startedAt,
    endedAt: row.endedAt ?? null
  }));

  return {
    puzzleId: puzzle.id,
    title: puzzle.title,
    attempts
  };
}

export function getReplay(attemptId: number): ReplayPayload {
  if (!attemptId) {
    throw new Error('attemptId is required');
  }
  const attemptRow = db
    .prepare(
      `SELECT id,
              session_id as sessionId,
              puzzle_id as puzzleId,
              success,
              failure_reason as failureReason,
              code,
              speed,
              started_at as startedAt,
              ended_at as endedAt
       FROM attempts
       WHERE id = ?`
    )
    .get(attemptId) as AttemptReplayRow | undefined;
  if (!attemptRow) {
    throw new Error(`Attempt ${attemptId} not found`);
  }

  const movementsRaw = db
    .prepare(
      `SELECT id,
              step_index as stepIndex,
              tile_index as tileIndex,
              x,
              y,
              action,
              recorded_at as recordedAt
       FROM movements
       WHERE attempt_id = ?
       ORDER BY step_index ASC, id ASC`
    )
    .all(attemptId) as MovementDetailRow[];
  const movements = movementsRaw.map((row) => ({
    tileIndex: row.tileIndex === null || row.tileIndex === undefined ? -1 : Number(row.tileIndex),
    x: row.x === null || row.x === undefined ? 0 : Number(row.x),
    y: row.y === null || row.y === undefined ? 0 : Number(row.y),
    action: row.action ?? null
  }));

  const puzzle = ensurePuzzle(attemptRow.puzzleId as string);

  return {
    puzzle: {
      id: puzzle.id,
      title: puzzle.title,
      scene: puzzle.scene,
      goal: puzzle.goal
    },
    steps: movements
  };
}
