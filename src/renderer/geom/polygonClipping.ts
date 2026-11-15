import clipping, { type MultiPolygon, type Polygon } from 'polygon-clipping';

type Operation = 'union' | 'intersection' | 'difference' | 'xor';
type Geometry = Polygon | MultiPolygon;

/** Keep exact coordinates normally; retry numerical topology failures on a micron grid. */
function clip(operation: Operation, subject: Geometry, ...others: Geometry[]): MultiPolygon {
  try {
    return clipping[operation](subject, ...others);
  } catch (error) {
    const numericalFailure = error instanceof Error && (
      error instanceof RangeError && /Maximum call stack size exceeded/.test(error.message) ||
      /^(Unable to complete output ring starting at |Unable to find segment #|Unable to pop\(\) |Tried to link already linked events|Tried to create degenerate segment at )/.test(error.message));
    if (!numericalFailure) throw error;
    // Near-coincident intersections can leave rings unclosed or cyclically nested.
    // Round temporary operands only. Saved geometry and successful operations stay exact.
    const snap = (shape: Geometry): MultiPolygon => {
      const polygons = typeof shape[0]?.[0]?.[0] === 'number' ? [shape as Polygon] : shape as MultiPolygon;
      return polygons.map(poly => poly.map(ring =>
        ring.map(([x, y]) => [Math.round(x * 1e6) / 1e6, Math.round(y * 1e6) / 1e6])));
    };
    return clipping[operation](snap(subject), ...others.map(snap));
  }
}

export default {
  union: (subject: Geometry, ...others: Geometry[]) => clip('union', subject, ...others),
  intersection: (subject: Geometry, ...others: Geometry[]) => clip('intersection', subject, ...others),
  difference: (subject: Geometry, ...others: Geometry[]) => clip('difference', subject, ...others),
  xor: (subject: Geometry, ...others: Geometry[]) => clip('xor', subject, ...others),
};
