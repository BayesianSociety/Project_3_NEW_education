import { nanoid } from 'nanoid';
import { getTemplateById, type BlockTemplate } from '@/data/blockLibrary';
import type { FailureReason, PuzzleDefinition, SceneTile } from '@/data/puzzles';

export type BlockNode = {
  id: string;
  templateId: string;
  params?: Record<string, string | number>;
  children?: BlockNode[];
  detached?: boolean;
};

export type MovementStep = {
  tileIndex: number;
  x: number;
  y: number;
  action: string;
  stepIndex: number;
  timestamp: number;
};

export type RuntimeEvent = {
  id: string;
  type: string;
  payload?: Record<string, unknown>;
  createdAt: number;
};

export type RunResult = {
  success: boolean;
  failureReason?: FailureReason;
  hint?: string;
  steps: MovementStep[];
  events: RuntimeEvent[];
  executedBlocks: string[];
};

export function createBlockNode(templateId: string): BlockNode {
  return {
    id: nanoid(),
    templateId,
    params: {},
    children: []
  };
}

export function codeFromBlocks(blocks: BlockNode[], depth = 0): string {
  const indent = '  '.repeat(depth);
  return blocks
    .map((block) => {
      const template = getTemplateById(block.templateId);
      if (template === undefined) {
        return `${indent}// Unknown block`;
      }
      if (template.acceptsChildren && block.children && block.children.length > 0) {
        return `${indent}${template.label} {\n${codeFromBlocks(block.children, depth + 1)}\n${indent}}`;
      }
      if (template.params && template.params.length > 0) {
        const args = template.params
          .map((param) => block.params?.[param.key] ?? param.defaultValue)
          .join(', ');
        return `${indent}${template.label}(${args})`;
      }
      return `${indent}${template.label}`;
    })
    .join('\n');
}

const MAX_STEPS = 64;

export function runProgram(
  puzzle: PuzzleDefinition,
  blocks: BlockNode[],
  options: { speed?: 'slow' | 'normal' | 'fast' } = {}
): RunResult {
  const state = {
    tileIndex: puzzle.initialState.playerTile,
    inventory: [...puzzle.initialState.inventory],
    needsCare: puzzle.initialState.needsCare ?? false,
    gaveSnack: false,
    treated: false,
    executedBlockIds: [] as string[],
    executedTemplates: [] as string[],
    events: [] as RuntimeEvent[],
    steps: [createStep(puzzle.scene.tiles[puzzle.initialState.playerTile], 'start', 0)] as MovementStep[],
    failure: undefined as FailureReason | undefined
  };

  const orderLog: string[] = [];
  executeBlockList(blocks, puzzle, state, orderLog, options);

  if (state.failure) {
    return finalizeResult(puzzle, state, orderLog);
  }

  if (state.tileIndex === puzzle.successCriteria.targetTile) {
    // success path handled later
  } else {
    state.failure = 'target_not_reached';
  }

  if (state.failure === undefined && puzzle.successCriteria.requiredItem && state.gaveSnack === false) {
    state.failure = 'wrong_item';
  }

  if (state.failure === undefined && puzzle.successCriteria.needsCareCheck && state.treated === false) {
    state.failure = 'condition_missing';
  }

  if (state.failure === undefined && puzzle.successCriteria.requiredOrder) {
    const expected = puzzle.successCriteria.requiredOrder.join('>').toLowerCase();
    const actual = orderLog.join('>').toLowerCase();
    if (actual.includes(expected) === false) {
      state.failure = 'wrong_order';
    }
  }

  return finalizeResult(puzzle, state, orderLog);
}

function finalizeResult(
  puzzle: PuzzleDefinition,
  state: {
    tileIndex: number;
    steps: MovementStep[];
    failure?: FailureReason;
    events: RuntimeEvent[];
    executedTemplates: string[];
  },
  orderLog: string[]
): RunResult {
  const hint = state.failure ? puzzle.hintMap[state.failure] : undefined;
  return {
    success: state.failure === undefined,
    failureReason: state.failure,
    hint,
    steps: state.steps,
    events: state.events,
    executedBlocks: orderLog
  };
}

function executeBlockList(
  blocks: BlockNode[] | undefined,
  puzzle: PuzzleDefinition,
  state: any,
  orderLog: string[],
  options: { speed?: 'slow' | 'normal' | 'fast' }
) {
  if (!blocks || blocks.length === 0) return;
  for (const block of blocks) {
    if (state.failure) return;
    if (state.steps.length > MAX_STEPS) {
      state.failure = 'condition_missing';
      return;
    }
    const template = getTemplateById(block.templateId);
    if (!template) continue;
    state.executedTemplates.push(template.id);
    orderLog.push(template.id);
    const now = Date.now();
    state.events.push({ id: nanoid(), type: 'block:start', payload: { id: template.id }, createdAt: now });
    runInstruction(template, block, puzzle, state, orderLog, options);
    state.events.push({ id: nanoid(), type: 'block:end', payload: { id: template.id }, createdAt: Date.now() });
  }
}

function runInstruction(
  template: BlockTemplate,
  block: BlockNode,
  puzzle: PuzzleDefinition,
  state: any,
  orderLog: string[],
  options: { speed?: 'slow' | 'normal' | 'fast' }
) {
  switch (template.id) {
    case 'move':
      stepForward(1, puzzle, state);
      break;
    case 'jump':
      stepForward(2, puzzle, state, true);
      break;
    case 'giveSnack':
      state.gaveSnack = true;
      state.events.push({ id: nanoid(), type: 'action:giveSnack', payload: {}, createdAt: Date.now() });
      break;
    case 'treatPet':
      state.treated = true;
      state.needsCare = false;
      state.events.push({ id: nanoid(), type: 'action:treat', payload: {}, createdAt: Date.now() });
      break;
    case 'say': {
      const text = (block.params?.text as string) || 'Hello friend';
      state.events.push({ id: nanoid(), type: 'action:say', payload: { text }, createdAt: Date.now() });
      break;
    }
    case 'repeat': {
      const count = clamp(Number(block.params?.count ?? 2), 1, 6);
      for (let i = 0; i < count; i += 1) {
        executeBlockList(block.children, puzzle, state, orderLog, options);
        if (state.failure) break;
      }
      break;
    }
    case 'ifNeedsCare':
      if (state.needsCare) {
        executeBlockList(block.children, puzzle, state, orderLog, options);
      }
      break;
    case 'ifObstacleAhead': {
      const nextTile = puzzle.scene.tiles[state.tileIndex + 1];
      if (nextTile?.kind === 'obstacle') {
        executeBlockList(block.children, puzzle, state, orderLog, options);
      }
      break;
    }
    default:
      break;
  }
}

function stepForward(distance: number, puzzle: PuzzleDefinition, state: any, viaJump = false) {
  const nextTile = puzzle.scene.tiles[state.tileIndex + distance];
  const blockedTile = puzzle.scene.tiles[state.tileIndex + 1];
  if (!nextTile) {
    state.failure = 'target_not_reached';
    return;
  }
  if (!viaJump && blockedTile?.kind === 'obstacle') {
    state.failure = 'obstacle_collision';
    return;
  }
  state.tileIndex = nextTile.index;
  state.steps.push(createStep(nextTile, viaJump ? 'jump' : 'move', state.steps.length));
  state.events.push({
    id: nanoid(),
    type: 'movement',
    payload: { tileIndex: nextTile.index, action: viaJump ? 'jump' : 'move' },
    createdAt: Date.now()
  });
}

function createStep(tile: SceneTile | undefined, action: string, stepIndex: number): MovementStep {
  return {
    tileIndex: tile?.index ?? 0,
    x: tile?.x ?? 0,
    y: tile?.y ?? 0,
    action,
    stepIndex,
    timestamp: Date.now()
  };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

export function defaultWorkspace(): BlockNode[] {
  return [];
}
