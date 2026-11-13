import type { Point } from '../model/schema';
import { simplifyRDP } from '../geom/simplify';

const NS = 'http://www.w3.org/2000/svg';
const geometryTags = new Set(['path', 'rect', 'circle', 'ellipse', 'polygon', 'polyline', 'line']);
const geometryAttrs = ['d', 'x', 'y', 'width', 'height', 'rx', 'ry', 'cx', 'cy', 'r', 'x1', 'y1', 'x2', 'y2', 'points', 'transform', 'viewBox', 'preserveAspectRatio'];
const styleAttrs = ['fill', 'fill-rule', 'stroke', 'stroke-width', 'display', 'visibility'];

export interface SvgContour { points: Point[]; closed: boolean }
export interface SvgShape {
  name: string;
  contours: SvgContour[];
  fillRule: 'evenodd' | 'nonzero';
  filled: boolean;
  width: number;
}
export interface SvgDrawing {
  width: number;
  height: number;
  shapes: SvgShape[];
  warnings: string[];
}

/** Browser geometry APIs flatten curves; no imported markup is mounted directly. */
export function parseSvg(text: string, doc: Document): SvgDrawing {
  const win = doc.defaultView;
  if (!win) throw new Error('The import window has closed.');
  const parsed = new win.DOMParser().parseFromString(text, 'image/svg+xml');
  const source = parsed.documentElement;
  if (parsed.querySelector('parsererror') || source.localName !== 'svg' || source.namespaceURI !== NS) {
    throw new Error('This file is not a valid SVG drawing.');
  }
  const warnings = new Set<string>();
  let shapeCount = 0;
  const root = doc.createElementNS(NS, 'svg');
  // Rebuild a geometry-only tree. Scripts, event handlers, hrefs, stylesheets,
  // images and foreignObject never enter the live document or fetch resources.
  const copy = (node: Element, parent: Element): void => {
    const tag = node.localName;
    if (node.namespaceURI !== NS) return;
    if (!geometryTags.has(tag) && tag !== 'g' && tag !== 'svg') {
      if (!['title', 'desc', 'metadata', 'defs'].includes(tag)) {
        warnings.add(`Skipped ${tag} content; only plain vector geometry is imported.`);
      }
      return;
    }
    const clean = doc.createElementNS(NS, tag === 'svg' && node === source ? 'g' : tag);
    for (const attr of geometryAttrs) {
      const value = node.getAttribute(attr);
      if (value !== null) clean.setAttribute(attr, value);
    }
    const inline = (node as SVGElement).style;
    for (const attr of styleAttrs) {
      const value = inline?.getPropertyValue(attr) || node.getAttribute(attr);
      if (value && !/url\s*\(/i.test(value)) clean.setAttribute(attr, value);
    }
    if (node.hasAttribute('clip-path') || node.hasAttribute('mask') || inline?.clipPath || inline?.mask) {
      warnings.add('Clipping and masks are ignored; the full underlying outlines are imported.');
    }
    if (geometryTags.has(tag)) {
      shapeCount += 1;
      if (shapeCount > 2000) throw new Error('Import up to 2,000 SVG shapes at a time.');
      clean.setAttribute('data-shape-name', node.getAttribute('id') || `${tag} ${shapeCount}`);
    }
    parent.appendChild(clean);
    for (const child of node.children) copy(child, clean);
  };
  const viewBox = source.getAttribute('viewBox');
  if (viewBox) root.setAttribute('viewBox', viewBox);
  for (const attr of ['width', 'height']) {
    if (source.hasAttribute(attr)) root.setAttribute(attr, source.getAttribute(attr)!);
  }
  // A fixed viewport makes percentage dimensions deterministic.
  const host = doc.createElement('div');
  host.style.cssText = 'position:fixed;left:-100000px;top:0;width:1000px;height:1000px;opacity:0;pointer-events:none;';
  host.appendChild(root);
  copy(source, root);
  doc.body.appendChild(host);
  try {
    const box = root.viewBox.baseVal;
    const width = viewBox ? box.width : root.width.baseVal.value;
    const height = viewBox ? box.height : root.height.baseVal.value;
    if (!(width > 0 && height > 0 && Number.isFinite(width + height))) {
      throw new Error('The SVG needs a positive width and height or viewBox.');
    }
    const origin = viewBox ? { x: box.x, y: box.y } : { x: 0, y: 0 };
    const rootMatrix = root.getScreenCTM();
    if (!rootMatrix) throw new Error('Cannot read SVG coordinates.');
    const inverseRoot = rootMatrix.inverse();
    const shapes: SvgShape[] = [];
    const geometries = root.querySelectorAll<SVGGeometryElement>('[data-shape-name]');
    let pointCount = 0;
    for (const element of geometries) {
      const style = win.getComputedStyle(element);
      let hidden = style.visibility === 'hidden' || style.visibility === 'collapse';
      for (let ancestor: Element | null = element; ancestor && ancestor !== host; ancestor = ancestor.parentElement) {
        if (win.getComputedStyle(ancestor).display === 'none') hidden = true;
      }
      if (hidden) continue;
      const screenMatrix = element.getScreenCTM();
      if (!screenMatrix) continue;
      const matrix = inverseRoot.multiply(screenMatrix);
      const transform = (p: Point): Point => ({
        x: matrix.a * p.x + matrix.c * p.y + matrix.e - origin.x,
        y: matrix.b * p.x + matrix.d * p.y + matrix.f - origin.y,
      });
      const contours: SvgContour[] = [];
      const sample = (geometry: SVGGeometryElement, closed: boolean) => {
        const length = geometry.getTotalLength();
        if (!(length > 0 && Number.isFinite(length))) return;
        const stretch = Math.max(Math.hypot(matrix.a, matrix.b), Math.hypot(matrix.c, matrix.d));
        const steps = Math.max(2, Math.min(8192, Math.ceil(length * stretch / (width / 2000))));
        pointCount += steps;
        if (pointCount > 250000) throw new Error('This SVG is too detailed; simplify it before importing.');
        const points = Array.from({ length: steps + 1 }, (_, i) => transform(geometry.getPointAtLength(length * i / steps)));
        if (closed) points.pop();
        const simplified = simplifyRDP(points, width / 20000, closed);
        if (simplified.some((p) => !Number.isFinite(p.x + p.y))) throw new Error('The SVG contains invalid coordinates.');
        if (simplified.length >= (closed ? 3 : 2)) contours.push({ points: simplified, closed });
      };
      if (element.localName === 'path') {
        const data = element.getAttribute('d') ?? '';
        const subpaths = data.match(/[Mm][^Mm]*/g) ?? [];
        let previousEnd: Point = { x: 0, y: 0 };
        const probe = doc.createElementNS(NS, 'path');
        element.parentElement!.appendChild(probe);
        try {
          for (let part of subpaths) {
            // Relative moveto after an earlier subpath starts at its endpoint.
            if (part[0] === 'm') {
              part = part.replace(/^m\s*([+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?)[\s,]*([+-]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][+-]?\d+)?)/,
                (_, x: string, y: string) => `M ${Number(x) + previousEnd.x} ${Number(y) + previousEnd.y} l `);
              // The extra l is only needed for implicit lineto coordinate pairs.
              part = part.replace(/l\s*(?=[a-zA-Z]|$)/, '');
            }
            probe.setAttribute('d', part);
            const total = probe.getTotalLength();
            previousEnd = probe.getPointAtLength(total);
            sample(probe, /[zZ]\s*$/.test(part));
          }
        } finally { probe.remove(); }
      } else if (element.localName === 'polygon' || element.localName === 'polyline') {
        const list = (element as SVGPolygonElement).points;
        pointCount += list.numberOfItems;
        if (pointCount > 250000) throw new Error('This SVG is too detailed; simplify it before importing.');
        const points = Array.from({ length: list.numberOfItems }, (_, i) => transform(list.getItem(i)));
        if (points.length >= 2) contours.push({ points, closed: element.localName === 'polygon' });
      } else if (element.localName === 'line') {
        const line = element as SVGLineElement;
        contours.push({ points: [transform({ x: line.x1.baseVal.value, y: line.y1.baseVal.value }), transform({ x: line.x2.baseVal.value, y: line.y2.baseVal.value })], closed: false });
      } else if (element.localName === 'rect' && !(element as SVGRectElement).rx.baseVal.value && !(element as SVGRectElement).ry.baseVal.value) {
        const rect = element as SVGRectElement;
        const x = rect.x.baseVal.value;
        const y = rect.y.baseVal.value;
        const w = rect.width.baseVal.value;
        const h = rect.height.baseVal.value;
        if (w > 0 && h > 0) contours.push({ points: [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }].map(transform), closed: true });
      } else {
        sample(element, true);
      }
      if (contours.some((c) => c.points.some((p) => !Number.isFinite(p.x) || !Number.isFinite(p.y)))) {
        throw new Error('The SVG contains invalid coordinates.');
      }
      if (!contours.length) { warnings.add('Skipped empty or zero-length shapes.'); continue; }
      shapes.push({
        name: element.getAttribute('data-shape-name')!, contours,
        fillRule: style.fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
        filled: style.fill !== 'none' && !['line', 'polyline'].includes(element.localName),
        width: Math.max(0.01, (parseFloat(style.strokeWidth) || 1) * Math.sqrt(Math.abs(matrix.a * matrix.d - matrix.b * matrix.c))),
      });
    }
    if (!shapes.length) throw new Error('No supported visible shapes found. Use paths, rectangles, circles, ellipses, polygons or lines.');
    return { width, height, shapes, warnings: [...warnings] };
  } finally { host.remove(); }
}
