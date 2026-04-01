'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import BlockWorkspace from '@/components/BlockWorkspace';
import GameScene from '@/components/GameScene';
import type { PuzzleDefinition, FailureReason } from '@/data/puzzles';
import { createBlockNode, codeFromBlocks, runProgram, type BlockNode, type MovementStep } from '@/lib/blockEngine';

interface PuzzleExperienceProps {
  puzzle: PuzzleDefinition;
}

interface WorkspaceState {
  attached: BlockNode[];
  floating: BlockNode[];
}

interface PendingOutcome {
  success: boolean;
  failureReason?: FailureReason;
  hint?: string;
  events: ReturnType<typeof runProgram>['events'];
}

function mutateBlockTree(
  blocks: BlockNode[],
  blockId: string,
  updater: (block: BlockNode) => BlockNode
): BlockNode[] {
  return blocks.map((block) => {
    if (block.id === blockId) {
      return updater(block);
    }
    if (block.children?.length) {
      return { ...block, children: mutateBlockTree(block.children, blockId, updater) };
    }
    return block;
  });
}

const WORKSPACE_KEY = (id: string) => `workspace-${id}`;

export default function PuzzleExperience({ puzzle }: PuzzleExperienceProps) {
  const [workspace, setWorkspace] = useState<WorkspaceState>({ attached: [], floating: [] });
  const [speed, setSpeed] = useState<'slow' | 'normal' | 'fast'>('normal');
  const [showCode, setShowCode] = useState(false);
  const [feedback, setFeedback] = useState<'idle' | 'running' | 'success' | 'failure'>('idle');
  const [failureContext, setFailureContext] = useState<{ reason?: FailureReason; hint?: string }>({});
  const [steps, setSteps] = useState<MovementStep[]>([]);
  const [currentStep, setCurrentStep] = useState(0);
  const [pendingOutcome, setPendingOutcome] = useState<PendingOutcome | null>(null);
  const [sessionId, setSessionId] = useState<number | null>(null);
  const [attemptId, setAttemptId] = useState<number | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem(WORKSPACE_KEY(puzzle.id));
    if (!stored) {
      setWorkspace({ attached: [], floating: [] });
      return;
    }
    try {
      setWorkspace(JSON.parse(stored) as WorkspaceState);
    } catch {
      setWorkspace({ attached: [], floating: [] });
    }
  }, [puzzle.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(WORKSPACE_KEY(puzzle.id), JSON.stringify(workspace));
  }, [workspace, puzzle.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const storageKey = 'block-coding-user';
    let userKey = window.localStorage.getItem(storageKey);
    if (!userKey) {
      userKey = crypto.randomUUID();
      window.localStorage.setItem(storageKey, userKey);
    }
    fetch('/api/session/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userKey, puzzleId: puzzle.id })
    })
      .then((res) => res.json())
      .then((data) => setSessionId(data.sessionId))
      .catch((error) => console.error('Failed to start session', error));
  }, [puzzle.id]);

  useEffect(() => {
    if (steps.length === 0 || !pendingOutcome) return;
    const duration = speed === 'slow' ? 1200 : speed === 'fast' ? 350 : 700;
    const interval = window.setInterval(() => {
      setCurrentStep((prev) => {
        if (prev + 1 >= steps.length) {
          window.clearInterval(interval);
          if (pendingOutcome.success) {
            setFeedback('success');
            setFailureContext({});
          } else {
            setFeedback('failure');
            setFailureContext({ reason: pendingOutcome.failureReason, hint: pendingOutcome.hint });
          }
          return steps.length - 1;
        }
        return prev + 1;
      });
    }, duration);

    return () => window.clearInterval(interval);
  }, [steps, pendingOutcome, speed]);

  const codeText = useMemo(() => codeFromBlocks(workspace.attached), [workspace.attached]);

  const handleAdd = useCallback(
    (templateId: string, target: 'attached' | 'floating') => {
      const node = createBlockNode(templateId);
      setWorkspace((prev) => ({ ...prev, [target]: [...prev[target], node] }));
    },
    []
  );

  const handleReorder = useCallback((nextAttached: BlockNode[]) => {
    setWorkspace((prev) => ({ ...prev, attached: nextAttached }));
  }, []);

  const handleDetach = useCallback((blockId: string) => {
    setWorkspace((prev) => {
      const remaining = prev.attached.filter((block) => block.id !== blockId);
      const detached = prev.attached.find((block) => block.id === blockId);
      return {
        attached: remaining,
        floating: detached ? [...prev.floating, detached] : prev.floating
      };
    });
  }, []);

  const handleAttachFloating = useCallback((blockId: string) => {
    setWorkspace((prev) => {
      const floating = [...prev.floating];
      const index = floating.findIndex((block) => block.id === blockId);
      if (index === -1) return prev;
      const [block] = floating.splice(index, 1);
      return {
        attached: [...prev.attached, block],
        floating
      };
    });
  }, []);

  const handleUpdateParams = useCallback(
    (blockId: string, params: Record<string, string | number>) => {
      setWorkspace((prev) => ({
        ...prev,
        attached: mutateBlockTree(prev.attached, blockId, (block) => ({ ...block, params }))
      }));
    },
    []
  );

  const handleAddChild = useCallback(
    (parentId: string, templateId: string) => {
      setWorkspace((prev) => ({
        ...prev,
        attached: mutateBlockTree(prev.attached, parentId, (block) => ({
          ...block,
          children: [...(block.children ?? []), createBlockNode(templateId)]
        }))
      }));
    },
    []
  );

  const handleRemoveChild = useCallback(
    (parentId: string, childId: string) => {
      setWorkspace((prev) => ({
        ...prev,
        attached: mutateBlockTree(prev.attached, parentId, (block) => ({
          ...block,
          children: (block.children ?? []).filter((child) => child.id !== childId)
        }))
      }));
    },
    []
  );

  const handlePlay = useCallback(() => {
    const result = runProgram(puzzle, workspace.attached);
    setSteps(result.steps);
    setPendingOutcome({
      success: result.success,
      failureReason: result.failureReason,
      hint: result.hint,
      events: result.events
    });
    setFeedback('running');
    setFailureContext({});
    setCurrentStep(0);

    if (sessionId) {
      fetch('/api/events/batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          puzzleId: puzzle.id,
          attempt: {
            id: attemptId,
            success: result.success,
            failureReason: result.failureReason ?? null,
            code: codeText,
            speed
          },
          events: result.events,
          movements: result.steps
        })
      })
        .then((res) => res.json())
        .then((data) => setAttemptId(data.attemptId ?? data.id))
        .catch((error) => console.error('Failed to persist attempt', error));
    }
  }, [puzzle, workspace.attached, sessionId, attemptId, codeText, speed]);

  const handleReset = useCallback(() => {
    setWorkspace({ attached: [], floating: [] });
    setSteps([]);
    setCurrentStep(0);
    setPendingOutcome(null);
    setFeedback('idle');
    setFailureContext({});
  }, []);

  const speakGoal = () => {
    if (typeof window === 'undefined') return;
    const utterance = new SpeechSynthesisUtterance(puzzle.goal);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  return (
    <div style={{ padding: '2rem clamp(1rem, 3vw, 3rem)', position: 'relative', zIndex: 1, maxWidth: '1440px', margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '1rem', marginBottom: '1.5rem', flexWrap: 'wrap' }}>
        <div>
          <p style={{ letterSpacing: '0.3em', fontSize: '0.7rem', textTransform: 'uppercase', color: 'var(--text-muted)' }}>
            Puzzle {puzzle.id} · {puzzle.concept}
          </p>
          <h1 style={{ margin: '0.2rem 0 0', fontSize: 'clamp(2rem, 4vw, 3.4rem)', lineHeight: 1 }}>{puzzle.title}</h1>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <button className="primary-cta" onClick={handlePlay} aria-label="Play program">
            Play
          </button>
          <button
            onClick={handleReset}
            style={{
              borderRadius: '999px',
              border: '1px solid var(--border-strong)',
              background: 'transparent',
              color: 'var(--text-bright)',
              padding: '0.75rem 1.8rem'
            }}
          >
            Reset
          </button>
        </div>
      </header>

      <section className="glass-panel" style={{ padding: '1.5rem', marginBottom: '1.5rem' }}>
        <div className="puzzle-layout">
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', marginBottom: '0.85rem', flexWrap: 'wrap' }}>
              <p style={{ margin: 0, color: 'var(--text-bright)', fontSize: '1.05rem', maxWidth: '38rem', lineHeight: 1.45 }}>{puzzle.goal}</p>
              <button
                onClick={speakGoal}
                style={{
                  borderRadius: '999px',
                  border: '1px solid rgba(255,255,255,0.3)',
                  background: 'transparent',
                  color: 'var(--text-bright)',
                  padding: '0.35rem 0.9rem'
                }}
              >
                Speak Goal
              </button>
            </div>
            <GameScene puzzle={puzzle} steps={steps} currentStep={currentStep} playing={feedback === 'running'} />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginTop: '1rem' }}>
              <SpeedToggle value={speed} onChange={setSpeed} />
              <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-bright)' }}>
                <input type="checkbox" checked={showCode} onChange={(event) => setShowCode(event.target.checked)} />
                Show code
              </label>
            </div>
            {feedback === 'failure' && (
              <div style={{ marginTop: '1rem', padding: '1rem', borderRadius: '16px', background: 'rgba(255,0,120,0.15)' }}>
                <strong>Oops!</strong>
                <p style={{ margin: 0 }}>{failureContext.hint ?? 'Check your sequence and try again.'}</p>
              </div>
            )}
            {feedback === 'success' && (
              <div style={{ marginTop: '1rem', padding: '1rem', borderRadius: '16px', background: 'rgba(0,200,160,0.2)' }}>
                <strong>Nice run!</strong>
                <p style={{ margin: 0 }}>Spark reached the goal and telemetry captured the attempt.</p>
              </div>
            )}
            {showCode && (
              <pre
                style={{
                  marginTop: '1rem',
                  background: 'rgba(0,0,0,0.35)',
                  padding: '1rem',
                  borderRadius: '16px',
                  maxHeight: '180px',
                  overflowY: 'auto'
                }}
              >
                {codeText || '// On Start is empty'}
              </pre>
            )}
          </div>

          <BlockWorkspace
            attached={workspace.attached}
            floating={workspace.floating}
            availableBlocks={puzzle.availableBlocks}
            onAdd={handleAdd}
            onReorder={handleReorder}
            onDetach={handleDetach}
            onAttachFloating={handleAttachFloating}
            onUpdateParams={handleUpdateParams}
            onAddChild={handleAddChild}
            onRemoveChild={handleRemoveChild}
          />
        </div>
      </section>
    </div>
  );
}

function SpeedToggle({ value, onChange }: { value: 'slow' | 'normal' | 'fast'; onChange: (value: 'slow' | 'normal' | 'fast') => void }) {
  const speeds: Array<{ label: string; value: 'slow' | 'normal' | 'fast' }> = [
    { label: 'Slow', value: 'slow' },
    { label: 'Normal', value: 'normal' },
    { label: 'Fast', value: 'fast' }
  ];
  return (
    <div style={{ display: 'flex', gap: '0.5rem' }}>
      {speeds.map((speedOption) => (
        <button
          key={speedOption.value}
          onClick={() => onChange(speedOption.value)}
          style={{
            borderRadius: '999px',
            border: speedOption.value === value ? '1px solid var(--accent-hot)' : '1px solid rgba(255,255,255,0.2)',
            background: speedOption.value === value ? 'rgba(255,83,192,0.15)' : 'transparent',
            color: 'var(--text-bright)',
            padding: '0.35rem 0.9rem'
          }}
        >
          {speedOption.label}
        </button>
      ))}
    </div>
  );
}
