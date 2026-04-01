export type BlockTemplate = {
  id: string;
  label: string;
  type: 'command' | 'loop' | 'conditional' | 'output';
  group: 'movement' | 'actions' | 'control' | 'logic' | 'sensing';
  color: string;
  description: string;
  params?: {
    key: string;
    label: string;
    type: 'number' | 'text' | 'choice';
    min?: number;
    max?: number;
    options?: string[];
    defaultValue: number | string;
  }[];
  acceptsChildren?: boolean;
};

export const blockTemplates: BlockTemplate[] = [
  {
    id: 'move',
    label: 'Move →',
    type: 'command',
    group: 'movement',
    color: '#ff95e4',
    description: 'Walk one tile forward along the glowing stones.'
  },
  {
    id: 'jump',
    label: 'Jump Jelly',
    type: 'command',
    group: 'movement',
    color: '#ff7bc0',
    description: 'Leap over the jelly obstacle to the next safe stone.'
  },
  {
    id: 'giveSnack',
    label: 'Give Snack',
    type: 'command',
    group: 'actions',
    color: '#ffca6b',
    description: 'Deliver a treat to the patient.'
  },
  {
    id: 'treatPet',
    label: 'Treat Spark',
    type: 'command',
    group: 'actions',
    color: '#8ef6c7',
    description: 'Apply a quick health check before snack time.'
  },
  {
    id: 'say',
    label: 'Say',
    type: 'output',
    group: 'actions',
    color: '#a1b2ff',
    description: 'Show dialog text in the scene.',
    params: [
      {
        key: 'text',
        label: 'Message',
        type: 'text',
        defaultValue: 'Hi!'
      }
    ]
  },
  {
    id: 'repeat',
    label: 'Repeat ⟳',
    type: 'loop',
    group: 'control',
    color: '#d7a2ff',
    description: 'Repeat the nested actions multiple times.',
    params: [
      {
        key: 'count',
        label: 'Times',
        type: 'number',
        min: 2,
        max: 6,
        defaultValue: 2
      }
    ],
    acceptsChildren: true
  },
  {
    id: 'ifNeedsCare',
    label: 'If Needs Care',
    type: 'conditional',
    group: 'logic',
    color: '#ff9ab2',
    description: 'Only run the inner blocks if the status light is red.',
    acceptsChildren: true
  },
  {
    id: 'ifObstacleAhead',
    label: 'If Obstacle Ahead',
    type: 'conditional',
    group: 'sensing',
    color: '#d6f74f',
    description: 'Check the next tile for a jelly mound before moving.',
    acceptsChildren: true
  }
];

export const blockGroups = [
  { id: 'movement', label: 'Movement' },
  { id: 'actions', label: 'Actions' },
  { id: 'control', label: 'Control' },
  { id: 'logic', label: 'Logic' },
  { id: 'sensing', label: 'Sensing' }
];

export function getTemplateById(id: string) {
  return blockTemplates.find((block) => block.id === id);
}
