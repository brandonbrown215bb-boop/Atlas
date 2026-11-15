import type { Point } from '../../model/schema';
import { pointInPolygon } from '../../geom/hitTest';

export function signedArea(ring: Point[]): number {
  return ring.reduce((sum, a, i) => {
    const b = ring[(i + 1) % ring.length]!;
    return sum + a.x * b.y - b.x * a.y;
  }, 0) / 2;
}

/** Taubin (zero-shrinkage) + Chaikin corner-cutting on closed polygon rings to round Voronoi cell sawtooths. */
export function smoothPolygons(polygons: Point[][][], passes = 1): Point[][][] {
  if (passes <= 0) return polygons;
  const taubinStep = (ring: Point[], factor: number): Point[] =>
    ring.map((cur, i) => {
      const prev = ring[(i - 1 + ring.length) % ring.length]!;
      const next = ring[(i + 1) % ring.length]!;
      const avgX = (prev.x + next.x) * 0.5;
      const avgY = (prev.y + next.y) * 0.5;
      return {
        x: cur.x + factor * (avgX - cur.x),
        y: cur.y + factor * (avgY - cur.y),
      };
    });

  return polygons.map(poly => poly.map(ring => {
    let cur = ring;
    if (cur.length >= 4) {
      for (let t = 0; t < 2; t++) {
        cur = taubinStep(cur, 0.45);
        cur = taubinStep(cur, -0.46);
      }
    }
    for (let pass = 0; pass < passes; pass++) {
      if (cur.length < 3) break;
      const next: Point[] = [];
      for (let i = 0; i < cur.length; i++) {
        const a = cur[i]!, b = cur[(i + 1) % cur.length]!;
        next.push(
          { x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 },
          { x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 },
        );
      }
      cur = next;
    }
    return cur;
  }));
}

/** Cancel shared cell edges, then walk only the boundary. Coordinates are normalized. */
export function traceCellBoundaries(cells: Point[][], groups: Array<string | null>): Map<string, Point[][][]> {
  type Edge = { a: string; b: string };
  const points = new Map<string, Point>();
  const grouped = new Map<string, Map<string, Edge>>();
  const key = (p: Point) => {
    const k = `${Math.round(p.x * 1e9)},${Math.round(p.y * 1e9)}`;
    if (!points.has(k)) points.set(k, p);
    return k;
  };
  cells.forEach((raw, i) => {
    const group = groups[i];
    if (group == null || raw.length < 3) return;
    const ring = signedArea(raw) < 0 ? [...raw].reverse() : raw;
    let edges = grouped.get(group);
    if (!edges) { edges = new Map(); grouped.set(group, edges); }
    ring.forEach((p, j) => {
      const a = key(p), b = key(ring[(j + 1) % ring.length]!);
      if (a === b) return;
      if (!edges.delete(`${b}:${a}`)) edges.set(`${a}:${b}`, { a, b });
    });
  });
  const result = new Map<string, Point[][][]>();
  for (const [group, edges] of grouped) {
    const outgoing = new Map<string, Edge[]>();
    for (const edge of edges.values()) {
      const list = outgoing.get(edge.a) ?? [];
      list.push(edge); outgoing.set(edge.a, list);
    }
    const rings: Point[][] = [];
    while (edges.size) {
      const first = edges.values().next().value!;
      let edge: Edge | undefined = first;
      const ring: Point[] = [];
      while (edge) {
        ring.push(points.get(edge.a)!);
        edges.delete(`${edge.a}:${edge.b}`);
        if (edge.b === first.a) break;
        const next: Edge[] = outgoing.get(edge.b)?.filter(e => edges.has(`${e.a}:${e.b}`)) ?? [];
        if (next.length > 1) {
          // At a point contact follow the leftmost turn, keeping the filled region on the left.
          const a = points.get(edge.a)!, b = points.get(edge.b)!;
          const angle = Math.atan2(b.y - a.y, b.x - a.x);
          next.sort((u, v) => {
            const turn = (e: Edge) => { const p = points.get(e.b)!; return (Math.atan2(p.y - b.y, p.x - b.x) - angle + Math.PI * 3) % (Math.PI * 2); };
            return turn(u) - turn(v);
          });
        }
        edge = next[0];
        if (!edge) throw new Error('Terrain boundary did not close.');
      }
      if (ring.length >= 3 && Math.abs(signedArea(ring)) > 1e-15) rings.push(ring);
    }
    const polygons = rings.filter(r => signedArea(r) > 0).map(r => [r]);
    for (const hole of rings.filter(r => signedArea(r) < 0)) {
      const containers = polygons.filter(p => pointInPolygon(hole[0]!, [p[0]!]));
      containers.sort((a, b) => signedArea(a[0]!) - signedArea(b[0]!));
      if (!containers[0]) throw new Error('Terrain hole has no enclosing coast.');
      containers[0].push(hole);
    }
    result.set(group, polygons);
  }
  return result;
}
