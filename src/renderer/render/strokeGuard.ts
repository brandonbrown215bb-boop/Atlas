import { GraphicsContext } from 'pixi.js';

/**
 * Pixi builds a round join/cap from 15·angle·√radius/π segments, with the radius in the
 * graphics' own units. Map graphics are drawn in metres, and on world maps the screen-sized
 * strokes (width ∝ 1/zoom) are tens of kilometres wide, so one coastline corner became
 * ~1,400 triangles. Etharis opened at 2 GB and zooming ran the renderer out of memory.
 * Above this width, a bevel/butt is visually the same at the zoom where it is drawn.
 */
const MAX_ROUND_WIDTH = 128;

type StrokeArg = Parameters<GraphicsContext['stroke']>[0];
const original = GraphicsContext.prototype.stroke;
let installed = false;

export function installStrokeGuard(): void {
  if (installed) return;
  installed = true;
  GraphicsContext.prototype.stroke = function guardedStroke(this: GraphicsContext, style?: StrokeArg) {
    if (style && typeof style === 'object' && 'width' in style && typeof style.width === 'number' && style.width > MAX_ROUND_WIDTH) {
      const s = style as { join?: string; cap?: string };
      if (s.join === 'round' || s.cap === 'round') {
        style = { ...style, ...(s.join === 'round' ? { join: 'bevel' } : {}), ...(s.cap === 'round' ? { cap: 'butt' } : {}) } as StrokeArg;
      }
    }
    return original.call(this, style);
  };
}

installStrokeGuard();
