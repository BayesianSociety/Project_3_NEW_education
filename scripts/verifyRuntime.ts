import assert from 'node:assert/strict';

import { getPuzzleById } from '../data/puzzles.ts';
import { createBlockNode, runProgram, type BlockNode } from '../lib/blockEngine.ts';
import { startSession, recordAttempt, getPuzzleAnalytics, getReplay } from '../lib/telemetry.ts';

function makeBlock(templateId: string): BlockNode {
  return createBlockNode(templateId);
}

function failureProgram(): BlockNode[] {
  // Intentionally skip the jump so we collide with the jelly mound.
  return [makeBlock('move'), makeBlock('move'), makeBlock('move'), makeBlock('giveSnack')];
}

async function main() {
  const puzzle = getPuzzleById('1');
  assert(puzzle, 'Puzzle 1 definition missing');

  const logicResult = runProgram(puzzle, failureProgram());
  assert(!logicResult.success, 'Expected the failure program to collide with the obstacle');

  const userKey = `runtime-${Date.now()}`;
  const session = startSession(userKey, puzzle.id);
  const attempt = recordAttempt({
    sessionId: session.sessionId,
    puzzleId: puzzle.id,
    success: logicResult.success,
    failureReason: logicResult.failureReason ?? 'unknown',
    code: 'auto:verifyRuntime',
    speed: 'normal',
    events: logicResult.events,
    movements: logicResult.steps
  });

  const analytics = getPuzzleAnalytics(puzzle.id);
  assert(analytics.attempts.length > 0, 'Expected puzzle analytics to include at least one attempt');

  const replay = getReplay(attempt.attemptId);
  assert(replay.steps.length > 0, 'Replay payload should include stored movement steps');

  console.log(
    `verify:runtime ✓ attempt ${attempt.attemptId} stored with ${replay.steps.length} replayable steps for puzzle ${replay.puzzle.title}.`
  );
}

main().catch((error) => {
  console.error('verify:runtime ✗ failed', error);
  process.exit(1);
});
