import { useRef, useState, type ReactNode } from 'react';
import { hudStore, type FloatingPanelState } from './hudStore';

interface FloatingWindowProps {
  panel: FloatingPanelState;
  stageRef: React.RefObject<HTMLDivElement | null>;
  children: ReactNode;
}

export function FloatingWindow({ panel, stageRef, children }: FloatingWindowProps) {
  const [popoutHint, setPopoutHint] = useState(false);
  const draggingRef = useRef(false);

  const onHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    e.stopPropagation();

    hudStore.getState().bringToFront(panel.id);
    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    draggingRef.current = true;

    const startClientX = e.clientX;
    const startClientY = e.clientY;
    const startX = panel.x;
    const startY = panel.y;
    let mainBounds: { x: number; y: number; width: number; height: number } | null = null;
    void window.atlasApi?.getMainWindowBounds?.().then((b) => {
      mainBounds = b;
    });

    const isOutsideMain = (ev: PointerEvent): boolean => {
      const margin = 24;
      if (mainBounds) {
        return (
          ev.screenX < mainBounds.x - margin ||
          ev.screenX > mainBounds.x + mainBounds.width + margin ||
          ev.screenY < mainBounds.y - margin ||
          ev.screenY > mainBounds.y + mainBounds.height + margin
        );
      }
      return (
        ev.clientX < -margin ||
        ev.clientY < -margin ||
        ev.clientX > window.innerWidth + margin ||
        ev.clientY > window.innerHeight + margin
      );
    };

    const onMove = (ev: PointerEvent) => {
      if (!draggingRef.current) return;
      const dx = ev.clientX - startClientX;
      const dy = ev.clientY - startClientY;
      const stage = stageRef.current;
      const maxX = stage ? Math.max(4, stage.clientWidth - Math.min(panel.w, 120)) : 2000;
      const maxY = stage ? Math.max(4, stage.clientHeight - 36) : 2000;
      const nx = Math.max(4, Math.min(maxX, startX + dx));
      const ny = Math.max(4, Math.min(maxY, startY + dy));
      hudStore.getState().setPanelRect(panel.id, { x: nx, y: ny });
      setPopoutHint(isOutsideMain(ev));
    };

    const onUp = (ev: PointerEvent) => {
      draggingRef.current = false;
      setPopoutHint(false);
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      if (target.hasPointerCapture(ev.pointerId)) {
        target.releasePointerCapture(ev.pointerId);
      }
      if (isOutsideMain(ev)) {
        const w = Math.max(300, panel.w);
        const h = Math.max(260, panel.h);
        hudStore.getState().popoutPanel(panel.id, {
          x: Math.round(ev.screenX - w / 2),
          y: Math.round(ev.screenY - 14),
          width: w,
          height: h,
        });
      }
    };

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  const onResizePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    hudStore.getState().bringToFront(panel.id);

    const target = e.currentTarget;
    target.setPointerCapture(e.pointerId);
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = panel.w;
    const startH = panel.h;

    const onMove = (ev: PointerEvent) => {
      const stage = stageRef.current;
      const maxW = stage ? Math.max(220, stage.clientWidth - panel.x - 4) : 1400;
      const maxH = stage ? Math.max(160, stage.clientHeight - panel.y - 4) : 1000;
      hudStore.getState().setPanelRect(panel.id, {
        w: Math.max(200, Math.min(maxW, startW + (ev.clientX - startX))),
        h: Math.max(140, Math.min(maxH, startH + (ev.clientY - startY))),
      });
    };

    const onUp = (ev: PointerEvent) => {
      target.removeEventListener('pointermove', onMove);
      target.removeEventListener('pointerup', onUp);
      target.removeEventListener('pointercancel', onUp);
      if (target.hasPointerCapture(ev.pointerId)) {
        target.releasePointerCapture(ev.pointerId);
      }
    };

    target.addEventListener('pointermove', onMove);
    target.addEventListener('pointerup', onUp);
    target.addEventListener('pointercancel', onUp);
  };

  return (
    <section
      data-testid={`hud-${panel.id}`}
      onPointerDown={() => hudStore.getState().bringToFront(panel.id)}
      style={{
        position: 'absolute',
        left: panel.x,
        top: panel.y,
        width: panel.w,
        height: panel.collapsed ? 'auto' : panel.h,
        zIndex: panel.zIndex,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--atlas-hud-bg, var(--atlas-surface))',
        backdropFilter: 'blur(10px)',
        border: popoutHint
          ? '2px dashed var(--atlas-accent)'
          : '1px solid var(--atlas-border)',
        borderRadius: 8,
        boxShadow: '0 8px 28px rgba(0, 0, 0, 0.35)',
        overflow: 'hidden',
        pointerEvents: 'auto',
      }}
    >
      <div
        data-testid={`hud-header-${panel.id}`}
        onPointerDown={onHeaderPointerDown}
        onDoubleClick={() => hudStore.getState().toggleCollapse(panel.id)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          height: 28,
          padding: '0 8px',
          background: 'var(--atlas-surface-alt)',
          borderBottom: panel.collapsed ? 'none' : '1px solid var(--atlas-border)',
          fontSize: 12,
          cursor: 'grab',
          userSelect: 'none',
          flexShrink: 0,
        }}
      >
        <strong style={{ fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {panel.title}
        </strong>
        {popoutHint && (
          <span style={{ fontSize: 10, color: 'var(--atlas-accent)', fontWeight: 600 }}>
            Release to pop out
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 3 }}>
          <button
            type="button"
            title={panel.collapsed ? 'Expand' : 'Collapse'}
            aria-label={panel.collapsed ? `Expand ${panel.title}` : `Collapse ${panel.title}`}
            onClick={() => hudStore.getState().toggleCollapse(panel.id)}
            style={{ padding: '1px 5px', fontSize: 11, lineHeight: 1.2 }}
          >
            {panel.collapsed ? '□' : '—'}
          </button>
          <button
            type="button"
            data-testid={`popout-btn-${panel.id}`}
            title="Pop out to window"
            aria-label={`Pop out ${panel.title}`}
            onClick={() => hudStore.getState().popoutPanel(panel.id)}
            style={{ padding: '1px 5px', fontSize: 11, lineHeight: 1.2 }}
          >
            ↗
          </button>
          <button
            type="button"
            data-testid={`close-btn-${panel.id}`}
            title="Close"
            aria-label={`Close ${panel.title}`}
            onClick={() => hudStore.getState().closePanel(panel.id)}
            style={{ padding: '1px 5px', fontSize: 11, lineHeight: 1.2 }}
          >
            ×
          </button>
        </div>
      </div>

      {!panel.collapsed && (
        <div style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}>
          {children}
        </div>
      )}

      {!panel.collapsed && (
        <div
          onPointerDown={onResizePointerDown}
          title="Resize"
          style={{
            position: 'absolute',
            right: 0,
            bottom: 0,
            width: 12,
            height: 12,
            cursor: 'nwse-resize',
            background:
              'linear-gradient(135deg, transparent 50%, var(--atlas-border) 50%, transparent 65%, var(--atlas-border) 65%)',
          }}
        />
      )}
    </section>
  );
}
