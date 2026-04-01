import assert from 'node:assert/strict';

import { getPuzzleById } from '../data/puzzles.ts';
import { createBlockNode, runProgram, type BlockNode } from '../lib/blockEngine.ts';
import { startSession, recordAttempt, getAnalyticsOverview } from '../lib/telemetry.ts';

function makeBlock(templateId: string): BlockNode {
  return createBlockNode(templateId);
}

function successProgram(): BlockNode[] {
  return [
    makeBlock('move'),
    makeBlock('move'),
    makeBlock('jump'),
    makeBlock('move'),
    makeBlock('move'),
    makeBlock('giveSnack')
  ];
}

async function main() {
  const puzzle = getPuzzleById('1');
  assert(puzzle, 'Puzzle 1 definition missing');

  const logicResult = runProgram(puzzle, successProgram());
  assert(logicResult.success, 'Expected the canonical program to solve puzzle 1');

  const userKey = `telemetry-test-${Date.now()}`;
  const session = startSession(userKey, puzzle.id);
  const attempt = recordAttempt({
    sessionId: session.sessionId,
    puzzleId: puzzle.id,
    success: logicResult.success,
    failureReason: logicResult.failureReason ?? null,
    code: 'auto:testTelemetry',
    speed: 'normal',
    events: logicResult.events,
    movements: logicResult.steps
  });

  const overview = getAnalyticsOverview();

  console.log(
    `test:telemetry ✓ stored attempt ${attempt.attemptId} (events=${attempt.eventsInserted}, movements=${attempt.movementsInserted}).`
  );
  console.log(
    `            Totals -> users=${overview.totalUsers}, sessions=${overview.totalSessions}, attempts=${overview.totalAttempts}.`
  );
}

main().catch((error) => {
  console.error('test:telemetry ✗ failed', error);
  process.exit(1);
});
