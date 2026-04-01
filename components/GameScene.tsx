'use client';

import Image from 'next/image';
import { useMemo } from 'react';
import type { PuzzleDefinition } from '@/data/puzzles';
import type { MovementStep } from '@/lib/blockEngine';

interface GameSceneProps {
  puzzle: PuzzleDefinition;
  steps: MovementStep[];
  currentStep: number;
  playing: boolean;
}

interface TilePosition {
  left: string;
  top: string;
}

const playerSprite = '/assets/sprites/main_character.png';

function toPercent(value: number) {
  return `${value}%`;
}

export default function GameScene({ puzzle, steps, currentStep, playing }: GameSceneProps) {
  const { tilePositions, laneTop, laneBottom } = useMemo(() => {
    const xs = puzzle.scene.tiles.map((tile) => tile.x);
    const ys = puzzle.scene.tiles.map((tile) => tile.y);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanX = Math.max(maxX - minX, 0.001);
    const spanY = Math.max(maxY - minY, 0.001);

    const positions = puzzle.scene.tiles.reduce<Record<number, TilePosition>>((map, tile) => {
      const normalizedX = (tile.x - minX) / spanX;
      const normalizedY = (tile.y - minY) / spanY;
      map[tile.index] = {
        left: toPercent(14 + normalizedX * 72),
        top: toPercent(spanY <= 0.01 ? 56 : 30 + normalizedY * 42)
      };
      return map;
    }, {});

    return {
      tilePositions: positions,
      laneTop: spanY <= 0.01 ? '56%' : '30%',
      laneBottom: spanY <= 0.01 ? '56%' : '72%'
    };
  }, [puzzle.scene.tiles]);

  const activeStep = steps[currentStep] ?? steps[0];
  const playerPosition = tilePositions[activeStep?.tileIndex ?? puzzle.initialState.playerTile];

  return (
    <div
      style={{
        height: '420px',
        borderRadius: '32px',
        overflow: 'hidden',
        position: 'relative',
        border: '1px solid rgba(255,255,255,0.14)',
        background: 'linear-gradient(180deg, rgba(24, 7, 47, 0.88), rgba(8, 7, 24, 0.95))'
      }}
    >
      <Image
        src={puzzle.scene.background}
        alt=""
        fill
        priority
        sizes="(max-width: 768px) 100vw, 800px"
        style={{ objectFit: 'cover', opacity: 0.78 }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          background:
            'linear-gradient(180deg, rgba(24, 8, 42, 0.12), rgba(8, 5, 19, 0.34)), radial-gradient(circle at top left, rgba(255, 177, 232, 0.16), transparent 40%)'
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '12%',
          right: '12%',
          top: laneTop,
          height: '16px',
          transform: 'translateY(-50%)',
          borderRadius: '999px',
          background: 'linear-gradient(90deg, rgba(255,255,255,0.18), rgba(255,238,171,0.28))',
          boxShadow: '0 12px 30px rgba(12, 5, 23, 0.28)'
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: '12%',
          right: '12%',
          top: laneBottom,
          height: '120px',
          borderRadius: '60px 60px 0 0',
          background: 'linear-gradient(180deg, rgba(22, 8, 35, 0.1), rgba(12, 5, 24, 0.34))',
          filter: 'blur(24px)'
        }}
      />

      {puzzle.scene.tiles.map((tile) => {
        const position = tilePositions[tile.index];
        const size = tile.kind === 'obstacle' ? 84 : tile.kind === 'goal' ? 82 : 72;
        const tileLabel = tile.label ?? (tile.kind === 'obstacle' ? 'Hazard' : tile.kind === 'path' ? 'Path' : '');
        const showTileSprite = tile.kind !== 'start';
        return (
          <div
            key={tile.id}
            style={{
              position: 'absolute',
              left: position.left,
              top: position.top,
              width: `${size}px`,
              height: `${size}px`,
              transform: 'translate(-50%, -50%)',
              borderRadius: tile.kind === 'goal' ? '28px' : '24px',
              overflow: 'hidden',
              border:
                tile.kind === 'goal'
                  ? '2px solid rgba(255, 241, 148, 0.95)'
                  : tile.kind === 'obstacle'
                    ? '2px solid rgba(255, 149, 190, 0.8)'
                    : '1px solid rgba(255,255,255,0.22)',
              boxShadow:
                tile.kind === 'goal'
                  ? '0 0 40px rgba(255, 235, 130, 0.38)'
                  : tile.kind === 'obstacle'
                    ? '0 18px 32px rgba(9, 5, 18, 0.45)'
                    : '0 12px 24px rgba(9, 5, 18, 0.28)',
              background:
                tile.kind === 'goal'
                  ? 'radial-gradient(circle at 30% 30%, rgba(255, 245, 185, 0.4), rgba(255, 177, 82, 0.18))'
                  : tile.kind === 'obstacle'
                    ? 'radial-gradient(circle at 30% 30%, rgba(255, 155, 196, 0.36), rgba(109, 37, 77, 0.2))'
                    : 'rgba(19, 8, 34, 0.36)'
            }}
          >
            {showTileSprite ? (
              <Image
                src={tile.asset}
                alt={tile.kind}
                fill
                sizes="84px"
                style={{
                  objectFit: 'contain',
                  padding: tile.kind === 'obstacle' ? '0.1rem' : '0.35rem',
                  filter: tile.kind === 'path' ? 'saturate(1.12) brightness(1.06)' : 'none'
                }}
              />
            ) : (
              <div
                style={{
                  position: 'absolute',
                  inset: '18%',
                  borderRadius: '999px',
                  border: '2px dashed rgba(255,255,255,0.45)',
                  background: 'rgba(255,255,255,0.08)'
                }}
              />
            )}
            {tileLabel ? (
              <span
                style={{
                  position: 'absolute',
                  left: '50%',
                  bottom: '-1.8rem',
                  transform: 'translateX(-50%)',
                  fontSize: '0.72rem',
                  letterSpacing: '0.08em',
                  textTransform: 'uppercase',
                  color: 'rgba(255, 244, 255, 0.78)',
                  whiteSpace: 'nowrap'
                }}
              >
                {tileLabel}
              </span>
            ) : null}
          </div>
        );
      })}

      <div
        style={{
          position: 'absolute',
          left: playerPosition.left,
          top: playerPosition.top,
          width: '78px',
          height: '92px',
          transform: 'translate(-50%, -78%)',
          transition: playing ? 'left 0.38s ease, top 0.38s ease' : 'left 0.7s ease, top 0.7s ease',
          zIndex: 3,
          pointerEvents: 'none'
        }}
      >
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '100%',
            filter: 'drop-shadow(0 16px 24px rgba(10, 5, 18, 0.38))',
            animation: playing && activeStep?.action === 'jump' ? 'player-jump-arc 0.48s cubic-bezier(0.32, 0, 0.22, 1)' : 'none'
          }}
        >
          <Image src={playerSprite} alt="Spark" fill sizes="78px" style={{ objectFit: 'contain' }} />
        </div>
      </div>
    </div>
  );
}
