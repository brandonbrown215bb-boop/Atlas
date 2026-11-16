import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { hudStore, type FloatingPanelState } from './hudStore';

function getPopoutUrl(panelId: string): string {
  const base =
    window.location.protocol === 'app:'
      ? 'app://atlas/popout.html'
      : '/popout.html';
  return `${base}?panelId=${encodeURIComponent(panelId)}`;
}

function syncStylesToChild(childDoc: Document, theme: 'dark' | 'light'): void {
  childDoc.documentElement.setAttribute('data-theme', theme);
  for (const node of document.head.querySelectorAll('style, link[rel="stylesheet"]')) {
    childDoc.head.appendChild(node.cloneNode(true));
  }
}

export function PopoutPortal({
  panel,
  theme,
  children,
}: {
  panel: FloatingPanelState;
  theme: 'dark' | 'light';
  children: ReactNode;
}) {
  const [mountNode, setMountNode] = useState<HTMLElement | null>(null);

  useEffect(() => {
    const b = panel.popoutBounds ?? { x: 120, y: 120, width: Math.max(320, panel.w), height: Math.max(280, panel.h) };
    const features = `width=${Math.round(b.width)},height=${Math.round(b.height)},left=${Math.round(b.x)},top=${Math.round(b.y)}`;
    const childWin = window.open(getPopoutUrl(panel.id), panel.id, features);
    if (!childWin) {
      hudStore.getState().dockBackPanel(panel.id);
      return;
    }

    let disposed = false;
    let hostEl: HTMLDivElement | null = null;

    const attach = () => {
      if (disposed || childWin.closed) return;
      const doc = childWin.document;
      doc.title = `Campaign Atlas — ${panel.title}`;
      syncStylesToChild(doc, theme);
      doc.body.style.margin = '0';
      doc.body.style.height = '100vh';
      doc.body.style.overflow = 'hidden';
      doc.body.innerHTML = '';
      hostEl = doc.createElement('div');
      hostEl.style.display = 'flex';
      hostEl.style.flexDirection = 'column';
      hostEl.style.width = '100%';
      hostEl.style.height = '100%';
      hostEl.style.background = 'var(--atlas-bg)';
      hostEl.style.color = 'var(--atlas-text)';
      doc.body.appendChild(hostEl);
      setMountNode(hostEl);
    };

    let attached = false;
    const tryAttach = () => {
      if (attached || disposed || childWin.closed) return;
      try {
        if (childWin.location.href !== 'about:blank' && childWin.document.readyState === 'complete' && childWin.document.body) {
          attached = true;
          attach();
        }
      } catch {
        // Ignore cross-origin/transient errors while navigating
      }
    };

    tryAttach();
    const poll = window.setInterval(tryAttach, 25);
    childWin.addEventListener('load', tryAttach, { once: true });

    const onBeforeUnload = () => {
      if (!disposed) {
        setMountNode(null);
      }
    };
    childWin.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      disposed = true;
      window.clearInterval(poll);
      childWin.removeEventListener('beforeunload', onBeforeUnload);
      setMountNode(null);
      if (!childWin.closed) {
        childWin.close();
      }
    };
    // Only re-open if panel.id changes while in popout mode.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [panel.id]);

  // Keep theme synced if toggled while popped out.
  useEffect(() => {
    const doc = mountNode?.ownerDocument;
    if (doc) {
      doc.documentElement.setAttribute('data-theme', theme);
    }
  }, [mountNode, theme]);

  if (!mountNode) return null;

  return createPortal(
    <>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '5px 10px',
          background: 'var(--atlas-surface)',
          borderBottom: '1px solid var(--atlas-border)',
          fontSize: 12,
          flexShrink: 0,
        }}
      >
        <strong>{panel.title}</strong>
        <span style={{ fontSize: 11, color: 'var(--atlas-text-muted)' }}>
          Drag over main window to dock
        </span>
        <button
          type="button"
          data-testid={`dockback-btn-${panel.id}`}
          onClick={() => window.setTimeout(() => hudStore.getState().dockBackPanel(panel.id), 0)}
          style={{ marginLeft: 'auto' }}
        >
          Dock
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', position: 'relative' }}>
        {children}
      </div>
    </>,
    mountNode,
  );
}
