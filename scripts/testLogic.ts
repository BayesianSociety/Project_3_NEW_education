import assert from 'node:assert/strict';

import { getPuzzleById } from '../data/puzzles.ts';
import { createBlockNode, runProgram, type BlockNode } from '../lib/blockEngine.ts';

function makeBlock(templateId: string, params: Record<string, number | string> = {}, children: BlockNode[] = []): BlockNode {
  const block = createBlockNode(templateId);
  block.params = params;
  block.children = children;
  return block;
}

function walkwayProgram(): BlockNode[] {
  return [
    makeBlock('move'),
    makeBlock('move'),
    makeBlock('jump'),
    makeBlock('move'),
    makeBlock('move'),
    makeBlock('giveSnack')
  ];
}

function puzzleThreeProgram(): BlockNode[] {
  const treatBranch = makeBlock('ifNeedsCare', {}, [makeBlock('treatPet')]);
  return [
    makeBlock('move'),
    makeBlock('move'),
    makeBlock('jump'),
    makeBlock('move'),
    makeBlock('move'),
    treatBranch,
    makeBlock('giveSnack')
  ];
}

function main() {
  const puzzle1 = getPuzzleById('1');
  assert(puzzle1, 'Puzzle 1 definition missing');
  const puzzle3 = getPuzzleById('3');
  assert(puzzle3, 'Puzzle 3 definition missing');

  const successRun = runProgram(puzzle1, walkwayProgram());
  assert(successRun.success, 'Puzzle 1 program should succeed');

  const failedRun = runProgram(puzzle1, [makeBlock('move'), makeBlock('move'), makeBlock('move')]);
  assert(!failedRun.success, 'Puzzle 1 failure case should fail');
  assert.strictEqual(failedRun.failureReason, 'obstacle_collision', 'Failure reason should flag obstacle collision');

  const conditionalRun = runProgram(puzzle3, puzzleThreeProgram());
  assert(conditionalRun.success, 'Puzzle 3 program should succeed when treating Spark');

  console.log('test:logic ✓ sequencing, failure hints, and conditional paths validated.');
}

main();
