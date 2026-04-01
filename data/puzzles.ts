export type FailureReason =
  | 'target_not_reached'
  | 'wrong_item'
  | 'wrong_order'
  | 'obstacle_collision'
  | 'condition_missing';

export type TileKind = 'start' | 'path' | 'obstacle' | 'goal' | 'item';

export type SceneTile = {
  id: string;
  index: number;
  x: number;
  y: number;
  kind: TileKind;
  asset: string;
  label?: string;
};

export type PuzzleDefinition = {
  id: string;
  title: string;
  slug: string;
  concept: 'sequencing' | 'loops' | 'conditionals';
  story: string;
  goal: string;
  scene: {
    background: string;
    tiles: SceneTile[];
  };
  initialState: {
    playerTile: number;
    inventory: string[];
    needsCare?: boolean;
  };
  availableBlocks: string[];
  successCriteria: {
    targetTile: number;
    requiredItem?: string;
    requiredOrder?: string[];
    needsCareCheck?: boolean;
  };
  hintMap: Record<FailureReason, string>;
  failureReasons: FailureReason[];
};

const baseTiles: SceneTile[] = [
  { id: 'start', index: 0, x: 0, y: 0, kind: 'start', asset: '/assets/sprites/place.png', label: 'Start' },
  { id: 'path-1', index: 1, x: 0.16, y: 0, kind: 'path', asset: '/assets/sprites/place.png' },
  { id: 'path-2', index: 2, x: 0.32, y: 0, kind: 'path', asset: '/assets/sprites/place.png' },
  { id: 'obstacle', index: 3, x: 0.5, y: 0, kind: 'obstacle', asset: '/assets/sprites/obstacle.png' },
  { id: 'path-3', index: 4, x: 0.68, y: 0, kind: 'path', asset: '/assets/sprites/place.png' },
  { id: 'path-4', index: 5, x: 0.84, y: 0, kind: 'path', asset: '/assets/sprites/place.png' },
  { id: 'goal', index: 6, x: 1, y: 0, kind: 'goal', asset: '/assets/sprites/food.png', label: 'Treat' }
];

export const puzzles: PuzzleDefinition[] = [
  {
    id: '1',
    slug: 'puddle-parade',
    title: 'Puddle Parade',
    concept: 'sequencing',
    story: 'Guide Luma across the glowing walkway, timing a jump over the jelly mound and delivering a snack.',
    goal: 'Reach the treat pad without colliding with the jelly hazard.',
    scene: {
      background: '/assets/backgrounds/background.jpg',
      tiles: baseTiles
    },
    initialState: {
      playerTile: 0,
      inventory: []
    },
    availableBlocks: ['move', 'jump', 'giveSnack', 'say'],
    successCriteria: {
      targetTile: 6,
      requiredOrder: ['move', 'move', 'jump', 'move', 'move']
    },
    hintMap: {
      target_not_reached: 'Use enough Move blocks to land on the treat pad.',
      wrong_item: 'This puzzle only needs the movement path. Save Give Snack for later puzzles.',
      wrong_order: 'Try placing the Jump right before the obstacle.',
      obstacle_collision: 'Jump exactly once over the jelly mound.',
      condition_missing: 'Sequencing puzzle does not need conditionals here.'
    },
    failureReasons: ['target_not_reached', 'wrong_item', 'wrong_order', 'obstacle_collision']
  },
  {
    id: '2',
    slug: 'looping-leaps',
    title: 'Looping Leaps',
    concept: 'loops',
    story: 'The walkway flickers in repeating tiles. Use loops to hop across without rebuilding every step.',
    goal: 'Repeat the move + jump pattern twice to reach the goal faster.',
    scene: {
      background: '/assets/backgrounds/background.jpg',
      tiles: baseTiles
    },
    initialState: {
      playerTile: 0,
      inventory: []
    },
    availableBlocks: ['move', 'jump', 'repeat', 'giveSnack', 'say'],
    successCriteria: {
      targetTile: 6,
      requiredItem: 'snack'
    },
    hintMap: {
      target_not_reached: 'Wrap your stepping pattern inside a loop to cover all tiles.',
      wrong_item: 'Deliver the treat at the end each time.',
      wrong_order: 'Place the Repeat block so it surrounds the stepping instructions.',
      obstacle_collision: 'Jump when the jelly sits ahead even inside a loop.',
      condition_missing: 'Consider using loops rather than conditionals here.'
    },
    failureReasons: ['target_not_reached', 'wrong_item', 'wrong_order', 'obstacle_collision']
  },
  {
    id: '3',
    slug: 'clinic-check',
    title: 'Clinic Check',
    concept: 'conditionals',
    story: 'Patients now blink status lights. Decide whether to treat first or go straight for the snack.',
    goal: 'Use a condition to treat Spark if the status light is red before delivering the snack.',
    scene: {
      background: '/assets/backgrounds/background.jpg',
      tiles: baseTiles
    },
    initialState: {
      playerTile: 0,
      inventory: [],
      needsCare: true
    },
    availableBlocks: ['move', 'jump', 'repeat', 'giveSnack', 'treatPet', 'ifNeedsCare', 'say'],
    successCriteria: {
      targetTile: 6,
      requiredItem: 'treat',
      needsCareCheck: true
    },
    hintMap: {
      target_not_reached: 'You still need enough movement to reach Spark.',
      wrong_item: 'Treat Spark when the light is red, then hand over the snack.',
      wrong_order: 'Run the conditional before the snack block.',
      obstacle_collision: 'Jump over the jelly mound even when treating patients.',
      condition_missing: 'Use If Needs Care to cover the new red light rule.'
    },
    failureReasons: ['target_not_reached', 'wrong_item', 'wrong_order', 'obstacle_collision', 'condition_missing']
  }
];

export function getPuzzleById(id: string) {
  return puzzles.find((puzzle) => puzzle.id === id);
}
