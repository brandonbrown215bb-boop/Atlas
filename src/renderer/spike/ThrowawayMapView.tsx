import { useEffect, useRef, useState } from 'react';
import { Application, Container, Graphics, Sprite } from 'pixi.js';
import type { IDockviewPanelProps } from 'dockview-react';

export interface ThrowawayMapParams {
  label: string;
}

const SPRITE_COUNT = 5000;

export function ThrowawayMapView(props: IDockviewPanelProps<ThrowawayMapParams>) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [locationEpoch, setLocationEpoch] = useState(0);
  const [isPopout, setIsPopout] = useState(
    () => props.api.location.type === 'popout',
  );
  const [renderCount, setRenderCount] = useState(0);

  useEffect(() => {
    const disposable = props.api.onDidLocationChange((event) => {
      setIsPopout(event.location.type === 'popout');
      setLocationEpoch((n) => n + 1);
    });
    return () => disposable.dispose();
  }, [props.api]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }

    const ownerDoc = host.ownerDocument;
    const ownerWin = ownerDoc.defaultView;
    if (!ownerWin) {
      return;
    }

    const canvas = ownerDoc.createElement('canvas');
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.display = 'block';
    canvas.tabIndex = 0;
    host.replaceChildren(canvas);

    let disposed = false;
    let rafId: number | null = null;
    let dirty = false;

    const app = new Application();
    const world = new Container();
    world.eventMode = 'none';

    let camX = 0;
    let camY = 0;
    let camZoom = 1;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const applyCamera = () => {
      world.position.set(camX, camY);
      world.scale.set(camZoom);
    };

    const scheduleRender = () => {
      if (disposed || dirty) {
        return;
      }
      dirty = true;
      rafId = ownerWin.requestAnimationFrame(() => {
        rafId = null;
        if (disposed) {
          return;
        }
        dirty = false;
        applyCamera();
        app.render();
        setRenderCount((c) => c + 1);
      });
    };

    const resizeToHost = () => {
      if (disposed) {
        return;
      }
      const rect = host.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      const dpr = ownerWin.devicePixelRatio || 1;
      app.renderer.resolution = dpr;
      app.renderer.resize(width, height);
      scheduleRender();
    };

    const onPointerDown = (e: PointerEvent) => {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      if (!dragging) {
        return;
      }
      camX += e.clientX - lastX;
      camY += e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      scheduleRender();
    };

    const onPointerUp = (e: PointerEvent) => {
      if (!dragging) {
        return;
      }
      dragging = false;
      if (canvas.hasPointerCapture(e.pointerId)) {
        canvas.releasePointerCapture(e.pointerId);
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      const factor = e.deltaY < 0 ? 1.12 : 1 / 1.12;
      const nextZoom = Math.min(8, Math.max(0.1, camZoom * factor));
      const wx = (sx - camX) / camZoom;
      const wy = (sy - camY) / camZoom;
      camZoom = nextZoom;
      camX = sx - wx * camZoom;
      camY = sy - wy * camZoom;
      scheduleRender();
    };

    let observer: ResizeObserver | null = null;

    void app
      .init({
        canvas,
        preference: 'webgl',
        autoStart: false,
        antialias: true,
        backgroundColor: 0x161b22,
        width: Math.max(1, Math.floor(host.clientWidth)),
        height: Math.max(1, Math.floor(host.clientHeight)),
        resolution: ownerWin.devicePixelRatio || 1,
      })
      .then(() => {
        if (disposed) {
          app.destroy(true, { children: true, texture: true });
          return;
        }

        app.stage.eventMode = 'none';
        app.stage.addChild(world);

        // Draw grid
        const grid = new Graphics();
        grid.eventMode = 'none';
        const step = 64;
        const cols = 40;
        const rows = 40;
        for (let i = 0; i <= cols; i++) {
          grid.moveTo(i * step, 0).lineTo(i * step, rows * step);
        }
        for (let j = 0; j <= rows; j++) {
          grid.moveTo(0, j * step).lineTo(cols * step, j * step);
        }
        grid.stroke({ width: 1, color: 0x2d3748, alpha: 0.7 });
        world.addChild(grid);

        // Generate one sprite texture and place 5,000 sprites
        const markerGfx = new Graphics();
        markerGfx.circle(6, 6, 5).fill({ color: 0x58a6ff });
        const spriteTexture = app.renderer.generateTexture(markerGfx);
        markerGfx.destroy();

        const spritesLayer = new Container();
        spritesLayer.eventMode = 'none';
        for (let i = 0; i < SPRITE_COUNT; i++) {
          const s = new Sprite(spriteTexture);
          s.x = ((i * 73) % (cols * step)) + 8;
          s.y = ((Math.floor(i / 50) * 29) % (rows * step)) + 8;
          s.alpha = 0.85;
          spritesLayer.addChild(s);
        }
        world.addChild(spritesLayer);

        canvas.addEventListener('pointerdown', onPointerDown);
        canvas.addEventListener('pointermove', onPointerMove);
        canvas.addEventListener('pointerup', onPointerUp);
        canvas.addEventListener('pointercancel', onPointerUp);
        canvas.addEventListener('wheel', onWheel, { passive: false });

        observer = new ownerWin.ResizeObserver(() => {
          resizeToHost();
        });
        observer.observe(host);

        resizeToHost();
      });

    return () => {
      disposed = true;
      if (rafId !== null) {
        ownerWin.cancelAnimationFrame(rafId);
      }
      observer?.disconnect();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('wheel', onWheel);
      if (app.renderer) {
        app.destroy(true, { children: true, texture: true });
      }
      host.replaceChildren();
    };
  }, [locationEpoch]);

  const handlePopout = () => {
    const panel = props.containerApi.getPanel(props.api.id);
    if (panel) {
      void props.containerApi.addPopoutGroup(panel);
    }
  };

  const handleDockBack = () => {
    const mainGroup = props.containerApi.groups.find(
      (g) => g.api.location.type === 'grid',
    );
    if (mainGroup) {
      props.api.moveTo({ group: mainGroup });
    }
  };

  return (
    <div
      data-testid={`panel-${props.api.id}`}
      data-render-count={renderCount}
      data-location-type={isPopout ? 'popout' : 'grid'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        background: '#0d1117',
        color: '#e6edf3',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px',
          borderBottom: '1px solid #30363d',
          fontSize: 12,
        }}
      >
        <span>{props.params.label}</span>
        <span style={{ opacity: 0.7 }}>({SPRITE_COUNT} sprites)</span>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
          {!isPopout ? (
            <button
              type="button"
              data-testid={`popout-btn-${props.api.id}`}
              onClick={handlePopout}
            >
              Pop out
            </button>
          ) : (
            <button
              type="button"
              data-testid={`dockback-btn-${props.api.id}`}
              onClick={handleDockBack}
            >
              Dock back
            </button>
          )}
        </div>
      </div>
      <div
        ref={hostRef}
        data-testid={`canvas-host-${props.api.id}`}
        style={{ flex: 1, minHeight: 0, position: 'relative' }}
      />
    </div>
  );
}
