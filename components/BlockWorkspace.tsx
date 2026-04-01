'use client';

import { useEffect, useMemo, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { blockGroups, blockTemplates, getTemplateById } from '@/data/blockLibrary';
import type { BlockNode } from '@/lib/blockEngine';

interface BlockWorkspaceProps {
  attached: BlockNode[];
  floating: BlockNode[];
  availableBlocks: string[];
  onReorder(attached: BlockNode[]): void;
  onAdd(templateId: string, target: 'attached' | 'floating'): void;
  onDetach(blockId: string): void;
  onAttachFloating(blockId: string): void;
  onUpdateParams(blockId: string, params: Record<string, string | number>): void;
  onAddChild(parentId: string, templateId: string): void;
  onRemoveChild(parentId: string, childId: string): void;
}

type DragPayload =
  | { source: 'palette'; templateId: string; label: string }
  | { source: 'attached'; blockId: string; label: string }
  | { source: 'floating'; blockId: string; label: string };

type DragState = {
  payload: DragPayload;
  x: number;
  y: number;
  offsetX: number;
  offsetY: number;
  pointerId: number;
  startedAsClick: boolean;
  armed: boolean;
};

function reorderAttached(attached: BlockNode[], blockId: string, targetIndex: number) {
  const currentIndex = attached.findIndex((block) => block.id === blockId);
  if (currentIndex === -1) return attached;
  const next = [...attached];
  const [moved] = next.splice(currentIndex, 1);
  const insertIndex = currentIndex < targetIndex ? targetIndex - 1 : targetIndex;
  next.splice(insertIndex, 0, moved);
  return next;
}

export default function BlockWorkspace({
  attached,
  floating,
  availableBlocks,
  onReorder,
  onAdd,
  onDetach,
  onAttachFloating,
  onUpdateParams,
  onAddChild,
  onRemoveChild
}: BlockWorkspaceProps) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [activeDrop, setActiveDrop] = useState<string | null>(null);

  const templates = useMemo(
    () => blockTemplates.filter((block) => availableBlocks.includes(block.id)),
    [availableBlocks]
  );

  useEffect(() => {
    if (!dragState) return;

    const handlePointerMove = (event: PointerEvent) => {
      setDragState((current) => {
        if (!current || event.pointerId !== current.pointerId) return current;
        const moved = Math.abs(event.clientX - current.x) > 6 || Math.abs(event.clientY - current.y) > 6;
        return {
          ...current,
          x: event.clientX,
          y: event.clientY,
          armed: current.armed || moved
        };
      });
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const insertion = target?.closest<HTMLElement>('[data-insertion-index]');
      if (insertion?.dataset.insertionIndex) {
        setActiveDrop(`insert:${insertion.dataset.insertionIndex}`);
        return;
      }
      const zone = target?.closest<HTMLElement>('[data-dropzone]');
      setActiveDrop(zone?.dataset.dropzone ?? null);
    };

    const handlePointerUp = (event: PointerEvent) => {
      if (event.pointerId !== dragState.pointerId) return;
      const payload = dragState.payload;
      if (dragState.startedAsClick && dragState.armed === false) {
        if (payload.source === 'palette') {
          onAdd(payload.templateId, 'attached');
        }
        setDragState(null);
        setActiveDrop(null);
        return;
      }
      const target = document.elementFromPoint(event.clientX, event.clientY);
      const insertion = target?.closest<HTMLElement>('[data-insertion-index]');
      const zone = target?.closest<HTMLElement>('[data-dropzone]')?.dataset.dropzone ?? null;

      if (payload.source === 'palette') {
        if (insertion?.dataset.insertionIndex || zone === 'attached') {
          onAdd(payload.templateId, 'attached');
        } else if (zone === 'floating') {
          onAdd(payload.templateId, 'floating');
        }
      }

      if (payload.source === 'attached') {
        if (insertion?.dataset.insertionIndex) {
          const targetIndex = Number(insertion.dataset.insertionIndex);
          if (!Number.isNaN(targetIndex)) {
            onReorder(reorderAttached(attached, payload.blockId, targetIndex));
          }
        } else if (zone === 'attached') {
          const currentIndex = attached.findIndex((block) => block.id === payload.blockId);
          if (currentIndex !== -1) {
            const next = [...attached];
            const [moved] = next.splice(currentIndex, 1);
            next.push(moved);
            onReorder(next);
          }
        } else if (zone === 'floating') {
          onDetach(payload.blockId);
        }
      }

      if (payload.source === 'floating' && (insertion?.dataset.insertionIndex || zone === 'attached')) {
        onAttachFloating(payload.blockId);
      }

      setDragState(null);
      setActiveDrop(null);
    };

    const handlePointerCancel = () => {
      setDragState(null);
      setActiveDrop(null);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    window.addEventListener('pointercancel', handlePointerCancel);
    document.body.style.userSelect = 'none';

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      window.removeEventListener('pointercancel', handlePointerCancel);
      document.body.style.userSelect = '';
    };
  }, [attached, dragState, onAdd, onAttachFloating, onDetach, onReorder]);

  const startDrag = (payload: DragPayload) => (event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    const rect = event.currentTarget.getBoundingClientRect();
    setDragState({
      payload,
      x: event.clientX,
      y: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      pointerId: event.pointerId,
      startedAsClick: payload.source === 'palette',
      armed: false
    });
  };

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 320px) 1fr', gap: '1.5rem' }}>
        <aside style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {blockGroups.map((group) => (
            <div key={group.id} className="glass-panel" style={{ padding: '1rem' }}>
              <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.75rem', letterSpacing: '0.1em' }}>{group.label}</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '0.75rem' }}>
                {templates
                  .filter((template) => template.group === group.id)
                  .map((template) => (
                    <PaletteBlock
                      key={template.id}
                      label={template.label}
                      description={template.description}
                      onPointerDown={startDrag({ source: 'palette', templateId: template.id, label: template.label })}
                      onPark={() => onAdd(template.id, 'floating')}
                    />
                  ))}
              </div>
            </div>
          ))}
        </aside>

        <div>
          <div
            className="glass-panel"
            data-dropzone="attached"
            style={{ padding: '1.5rem', marginBottom: '1rem', boxShadow: activeDrop === 'attached' ? '0 0 0 2px rgba(255, 83, 192, 0.45)' : undefined }}
          >
            <h3 style={{ marginTop: 0 }}>On Start</h3>
            <p style={{ color: 'var(--text-muted)' }}>Press and drag blocks from the palette into this area, then drag the handles to reorder them.</p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {attached.map((block, index) => (
                <div key={block.id}>
                  <InsertionBar active={activeDrop === `insert:${index}`} index={index} />
                  <SortableBlock
                    block={block}
                    onDetach={onDetach}
                    onUpdateParams={onUpdateParams}
                    onAddChild={onAddChild}
                    onRemoveChild={onRemoveChild}
                    availableBlocks={availableBlocks}
                    onDragHandlePointerDown={startDrag({
                      source: 'attached',
                      blockId: block.id,
                      label: getTemplateById(block.templateId)?.label ?? block.templateId
                    })}
                  />
                </div>
              ))}
              <InsertionBar active={activeDrop === `insert:${attached.length}`} index={attached.length} />
              {attached.length === 0 && (
                <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Drag blocks from the left palette here to get started.</p>
              )}
            </div>
          </div>

          <div
            className="glass-panel"
            data-dropzone="floating"
            style={{ padding: '1.5rem', boxShadow: activeDrop === 'floating' ? '0 0 0 2px rgba(255, 83, 192, 0.45)' : undefined }}
          >
            <h3 style={{ marginTop: 0 }}>Parking Area</h3>
            {floating.length === 0 ? (
              <p style={{ color: 'var(--text-muted)' }}>No detached blocks. Drag a palette block here if you want to park it for later.</p>
            ) : (
              <div>
                <p style={{ color: 'var(--danger)' }}>Detached blocks will not execute. Drag them back to On Start or tap attach.</p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {floating.map((block) => (
                    <div
                      key={block.id}
                      style={{
                        border: '1px dashed rgba(255,255,255,0.25)',
                        borderRadius: '18px',
                        padding: '0.75rem',
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        background: 'rgba(255,255,255,0.03)'
                      }}
                    >
                      <div
                        onPointerDown={startDrag({
                          source: 'floating',
                          blockId: block.id,
                          label: getTemplateById(block.templateId)?.label ?? block.templateId
                        })}
                        style={{ cursor: 'grab', fontWeight: 600 }}
                      >
                        {getTemplateById(block.templateId)?.label ?? block.templateId}
                      </div>
                      <button
                        type="button"
                        style={{
                          borderRadius: '999px',
                          border: '1px solid var(--accent-hot)',
                          background: 'transparent',
                          color: 'var(--accent-hot)',
                          padding: '0.35rem 0.9rem'
                        }}
                        onClick={() => onAttachFloating(block.id)}
                      >
                        Attach
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {dragState && typeof document !== 'undefined'
        ? createPortal(
            <div
              style={{
                position: 'fixed',
                left: dragState.x - dragState.offsetX,
                top: dragState.y - dragState.offsetY,
                zIndex: 999999,
                pointerEvents: 'none',
                borderRadius: '18px',
                padding: '0.7rem 1rem',
                background: 'rgba(32, 12, 56, 0.92)',
                border: '1px solid rgba(255,255,255,0.22)',
                boxShadow: '0 18px 36px rgba(7, 3, 17, 0.38)',
                color: 'var(--text-bright)'
              }}
            >
              {dragState.payload.label}
            </div>,
            document.body
          )
        : null}
    </>
  );
}

function PaletteBlock({
  label,
  description,
  onPointerDown,
  onClick,
  onPark
}: {
  label: string;
  description: string;
  onPointerDown(event: ReactPointerEvent<HTMLDivElement>): void;
  onPark(): void;
}) {
  return (
    <div
      onPointerDown={onPointerDown}
      onContextMenu={(event) => {
        event.preventDefault();
        onPark();
      }}
      style={{
        border: '1px solid rgba(255,255,255,0.2)',
        borderRadius: '20px',
        padding: '0.65rem 0.9rem',
        background: 'rgba(255,255,255,0.04)',
        color: 'var(--text-bright)',
        textAlign: 'left',
        cursor: 'grab',
        touchAction: 'none'
      }}
    >
      <strong>{label}</strong>
      <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)' }}>{description}</span>
      <span style={{ display: 'block', fontSize: '0.7rem', color: 'var(--text-muted)' }}>Drag into On Start or Parking Area. Double-click to add.</span>
    </div>
  );
}

function InsertionBar({ active, index }: { active: boolean; index: number }) {
  return (
    <div
      data-insertion-index={index}
      style={{
        height: active ? '12px' : '8px',
        borderRadius: '999px',
        background: active ? 'linear-gradient(90deg, rgba(255,83,192,0.9), rgba(192,91,255,0.9))' : 'transparent',
        transition: 'height 140ms ease, background 140ms ease',
        margin: '0.15rem 0'
      }}
    />
  );
}

interface SortableBlockProps {
  block: BlockNode;
  onDetach(id: string): void;
  onUpdateParams(id: string, params: Record<string, string | number>): void;
  onAddChild(parentId: string, templateId: string): void;
  onRemoveChild(parentId: string, childId: string): void;
  availableBlocks: string[];
  onDragHandlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void;
}

function SortableBlock({
  block,
  onDetach,
  onUpdateParams,
  onAddChild,
  onRemoveChild,
  availableBlocks,
  onDragHandlePointerDown
}: SortableBlockProps) {
  const template = getTemplateById(block.templateId);

  return (
    <div
      style={{
        border: '1px solid rgba(255,255,255,0.2)',
        borderRadius: '18px',
        padding: '0.75rem',
        background: 'rgba(255,255,255,0.05)'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.65rem' }}>
          <div
            onPointerDown={onDragHandlePointerDown}
            style={{
              cursor: 'grab',
              touchAction: 'none',
              userSelect: 'none',
              color: 'var(--text-muted)',
              fontSize: '1rem',
              lineHeight: 1
            }}
            aria-label="Drag block"
            title="Drag block"
          >
            ≡
          </div>
          <strong>{template?.label ?? block.templateId}</strong>
        </div>
        <button
          type="button"
          onClick={() => onDetach(block.id)}
          style={{
            border: 'none',
            background: 'transparent',
            color: 'var(--text-muted)',
            cursor: 'pointer'
          }}
        >
          Detach
        </button>
      </div>
      {template?.params?.map((param) => (
        <label key={param.key} style={{ display: 'flex', flexDirection: 'column', fontSize: '0.85rem', marginTop: '0.5rem' }}>
          {param.label}
          <input
            type="text"
            defaultValue={(block.params?.[param.key] ?? param.defaultValue).toString()}
            onChange={(event) =>
              onUpdateParams(block.id, {
                ...(block.params ?? {}),
                [param.key]: param.type === 'number' ? Number(event.target.value) : event.target.value
              })
            }
            style={{
              marginTop: '0.35rem',
              borderRadius: '12px',
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'rgba(0,0,0,0.2)',
              color: 'var(--text-bright)',
              padding: '0.4rem 0.6rem'
            }}
          />
        </label>
      ))}
      {template?.acceptsChildren && (
        <div style={{ marginTop: '0.75rem', padding: '0.75rem', borderRadius: '14px', background: 'rgba(0,0,0,0.25)' }}>
          <p style={{ marginTop: 0, fontSize: '0.85rem', color: 'var(--text-muted)' }}>Inner steps</p>
          {block.children && block.children.length > 0 ? (
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              {block.children.map((child) => (
                <li
                  key={child.id}
                  style={{
                    padding: '0.35rem 0.5rem',
                    borderRadius: '10px',
                    background: 'rgba(255,255,255,0.04)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center'
                  }}
                >
                  {getTemplateById(child.templateId)?.label ?? child.templateId}
                  <button
                    type="button"
                    onClick={() => onRemoveChild(block.id, child.id)}
                    style={{ border: 'none', background: 'transparent', color: 'var(--text-muted)', cursor: 'pointer' }}
                    aria-label="Remove child"
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>No steps yet.</p>
          )}
          <ChildAddMenu parentId={block.id} availableBlocks={availableBlocks} onAddChild={onAddChild} />
        </div>
      )}
    </div>
  );
}

function ChildAddMenu({
  parentId,
  availableBlocks,
  onAddChild
}: {
  parentId: string;
  availableBlocks: string[];
  onAddChild(parentId: string, templateId: string): void;
}) {
  const allowedTemplates = blockTemplates.filter((template) => availableBlocks.includes(template.id));
  return (
    <div style={{ marginTop: '0.5rem', display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
      {allowedTemplates.map((template) => (
        <button
          key={`${parentId}-${template.id}`}
          type="button"
          onClick={() => onAddChild(parentId, template.id)}
          style={{
            borderRadius: '999px',
            border: '1px solid rgba(255,255,255,0.2)',
            background: 'transparent',
            color: 'var(--text-bright)',
            padding: '0.25rem 0.75rem',
            fontSize: '0.75rem'
          }}
        >
          {template.label}
        </button>
      ))}
    </div>
  );
}
