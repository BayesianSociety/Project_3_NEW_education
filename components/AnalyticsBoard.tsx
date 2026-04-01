'use client';

import useSWR from 'swr';
import { useState } from 'react';
import GameScene from '@/components/GameScene';
import type { PuzzleDefinition } from '@/data/puzzles';
import { getPuzzleById } from '@/data/puzzles';
import type { MovementStep } from '@/lib/blockEngine';

const fetcher = (url: string) => fetch(url).then((res) => res.json());

type Overview = {
  totalUsers: number;
  totalSessions: number;
  totalAttempts: number;
  completionRate: number;
  perPuzzle: Array<{
    puzzleId: string;
    title: string;
    attempts: number;
    completions: number;
    avgDurationMs: number;
  }>;
};

type PuzzleAttempts = {
  puzzleId: string;
  title: string;
  attempts: Array<{
    attemptId: number;
    success: boolean;
    failureReason: string | null;
    startedAt: string;
    endedAt: string | null;
    speed: string | null;
  }>;
};

type ReplayPayload = {
  puzzle: Pick<PuzzleDefinition, 'id' | 'title' | 'goal' | 'scene'>;
  steps: MovementStep[];
};

export default function AnalyticsBoard() {
  const { data: overview } = useSWR<Overview>('/api/analytics/overview', fetcher, { refreshInterval: 8000 });
  const [selectedPuzzle, setSelectedPuzzle] = useState('1');
  const { data: puzzleDetail } = useSWR<PuzzleAttempts>(`/api/analytics/puzzle?puzzleId=${selectedPuzzle}`, fetcher, {
    refreshInterval: 8000
  });
  const [selectedAttempt, setSelectedAttempt] = useState<number | null>(null);
  const { data: replay } = useSWR<ReplayPayload>(selectedAttempt ? `/api/analytics/replay?attemptId=${selectedAttempt}` : null, fetcher);

  return (
    <div style={{ padding: '3rem clamp(1.5rem, 4vw, 4rem)', display: 'flex', flexDirection: 'column', gap: '2rem' }}>
      <header>
        <p style={{ letterSpacing: '0.3em', textTransform: 'uppercase', color: 'var(--text-muted)' }}>Telemetry</p>
        <h1 style={{ margin: 0 }}>Analytics dashboard</h1>
        <p style={{ color: 'var(--text-muted)', maxWidth: '36rem' }}>
          Monitor how learners interact with the block workspace, then replay any stored run straight from the SQLite-backed
          telemetry stream.
        </p>
      </header>

      <section className="glass-panel" style={{ padding: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>Overview</h2>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', marginTop: '1rem' }}>
          {overview ? (
            <>
              <Metric label="Learners" value={overview.totalUsers} />
              <Metric label="Sessions" value={overview.totalSessions} />
              <Metric label="Attempts" value={overview.totalAttempts} />
              <Metric label="Completion %" value={`${(overview.completionRate * 100).toFixed(1)}%`} />
            </>
          ) : (
            <p>Loading overview…</p>
          )}
        </div>
        {overview && (
          <table style={{ width: '100%', marginTop: '2rem', borderCollapse: 'collapse', fontSize: '0.95rem' }}>
            <thead>
              <tr style={{ textAlign: 'left', color: 'var(--text-muted)' }}>
                <th>Puzzle</th>
                <th>Attempts</th>
                <th>Completions</th>
                <th>Avg Duration</th>
              </tr>
            </thead>
            <tbody>
              {overview.perPuzzle.map((row) => (
                <tr key={row.puzzleId} style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }}>
                  <td>{row.title}</td>
                  <td>{row.attempts}</td>
                  <td>{row.completions}</td>
                  <td>{Math.round(row.avgDurationMs / 1000)}s</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="glass-panel" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Attempts</h2>
          <select
            value={selectedPuzzle}
            onChange={(event) => {
              setSelectedPuzzle(event.target.value);
              setSelectedAttempt(null);
            }}
            style={{
              borderRadius: '999px',
              border: '1px solid rgba(255,255,255,0.3)',
              background: 'transparent',
              color: 'var(--text-bright)',
              padding: '0.5rem 1rem'
            }}
          >
            {overview?.perPuzzle.map((row) => (
              <option key={row.puzzleId} value={row.puzzleId}>
                {row.title}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 320px) 1fr', gap: '1.5rem' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxHeight: '320px', overflowY: 'auto' }}>
            {puzzleDetail?.attempts.length ? (
              puzzleDetail.attempts.map((attempt) => (
                <button
                  key={attempt.attemptId}
                  onClick={() => setSelectedAttempt(attempt.attemptId)}
                  style={{
                    textAlign: 'left',
                    borderRadius: '18px',
                    border: '1px solid rgba(255,255,255,0.2)',
                    padding: '0.75rem',
                    background: selectedAttempt === attempt.attemptId ? 'rgba(255,83,192,0.15)' : 'transparent',
                    color: 'var(--text-bright)'
                  }}
                >
                  <strong>Attempt #{attempt.attemptId}</strong>
                  <p style={{ margin: '0.25rem 0', color: 'var(--text-muted)' }}>
                    {new Date(attempt.startedAt).toLocaleTimeString()} · {attempt.success ? 'Success' : attempt.failureReason ?? 'Incomplete'}
                  </p>
                  <p style={{ margin: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Speed: {attempt.speed ?? 'normal'}</p>
                </button>
              ))
            ) : (
              <p style={{ color: 'var(--text-muted)' }}>No attempts recorded yet.</p>
            )}
          </div>
          <div>
            {replay && selectedAttempt ? (
              <div>
                <h3 style={{ marginTop: 0 }}>{replay.puzzle.title}</h3>
                <ReplayScene replay={replay} />
              </div>
            ) : (
              <p style={{ color: 'var(--text-muted)' }}>Select an attempt to replay.</p>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number | string }) {
  return (
    <div
      style={{
        borderRadius: '24px',
        border: '1px solid rgba(255,255,255,0.2)',
        padding: '1rem'
      }}
    >
      <p style={{ margin: 0, color: 'var(--text-muted)' }}>{label}</p>
      <strong style={{ fontSize: '1.6rem' }}>{value}</strong>
    </div>
  );
}

function ReplayScene({ replay }: { replay: ReplayPayload }) {
  const basePuzzle = getPuzzleById(replay.puzzle.id) as PuzzleDefinition | undefined;
  if (!basePuzzle) {
    return <p style={{ color: 'var(--text-muted)' }}>Puzzle definition missing.</p>;
  }
  const puzzleForScene: PuzzleDefinition = {
    ...basePuzzle,
    goal: replay.puzzle.goal,
    scene: replay.puzzle.scene
  };

  return <GameScene puzzle={puzzleForScene} steps={replay.steps} currentStep={replay.steps.length - 1} playing={false} />;
}
