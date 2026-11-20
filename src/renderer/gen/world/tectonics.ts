import { createNoise2D } from 'simplex-noise';
import { mulberry32 } from '../rng';

export interface Plate { x: number; y: number; vx: number; vy: number; oceanic: boolean }

/** Seeded warped plates, local boundary normals, subduction arcs, trenches and rifts. */
export function tectonicField(
  points: [number, number][],
  neighbors: number[][],
  seed: number,
  count: number,
  aspectX: number,
  aspectY: number,
  ruggedness: number,
) {
  const random = mulberry32(seed ^ 0x74ec);
  const noise = createNoise2D(mulberry32(seed ^ 0x9e37));
  const plates: Plate[] = Array.from({ length: count }, (_, i) => {
    const angle = random() * Math.PI * 2;
    const speed = 0.65 + random() * 0.6;
    return {
      x: random() * aspectX,
      y: random() * aspectY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      oceanic: i > Math.min(2, count - 1) && random() < 0.58,
    };
  });

  // Domain-warp coordinates so plate boundaries curve and interlock organically.
  const owner = points.map(([x, y]) => {
    const wx = x + noise(x * 3.2 + 11, y * 3.2) * 0.13 + noise(x * 8.5, y * 8.5 + 23) * 0.04;
    const wy = y + noise(x * 3.2, y * 3.2 + 37) * 0.13 + noise(x * 8.5 + 41, y * 8.5) * 0.04;
    return plates.reduce(
      (best, p, i) => (Math.hypot(p.x - wx, p.y - wy) < Math.hypot(plates[best]!.x - wx, plates[best]!.y - wy) ? i : best),
      0,
    );
  });

  let base: number[] = owner.map(i => (plates[i]!.oceanic ? 0.24 : 0.56));
  let uplift = points.map(() => 0);
  let rift = points.map(() => 0);
  const spineCells = new Set<number>();
  const boundaries: Array<{ a: number; b: number; kind: 'collision' | 'subduction' | 'spreading' | 'transform' }> = [];

  for (let i = 0; i < points.length; i++) {
    const [ix, iy] = points[i]!;
    const a = plates[owner[i]!]!;
    for (const j of neighbors[i]!) {
      if (owner[i] === owner[j]) continue;
      const b = plates[owner[j]!]!;
      const [jx, jy] = points[j]!;
      const dx = jx - ix, dy = jy - iy;
      const length = Math.hypot(dx, dy) || 1;
      const nx = dx / length, ny = dy / length;
      // Positive closing means plate A is moving into plate B across this local boundary.
      const closing = (a.vx - b.vx) * nx + (a.vy - b.vy) * ny;
      const shear = Math.abs((a.vx - b.vx) * ny - (a.vy - b.vy) * nx);

      if (i < j) {
        const kind = closing > 0.18
          ? (a.oceanic !== b.oceanic ? 'subduction' : 'collision')
          : closing < -0.22
            ? 'spreading'
            : 'transform';
        boundaries.push({ a: i, b: j, kind });
      }

      if (closing > 0.18) {
        const strength = Math.min(1.1, closing / 1.45);
        if (!a.oceanic && !b.oceanic) {
          // Continental collision: broad, continuous fold mountain belt with coherent spine.
          uplift[i] = Math.max(uplift[i]!, strength * (count > 3 ? 1.03 : 1.0));
          if (count > 3) spineCells.add(i);
        } else if (a.oceanic && !b.oceanic) {
          // Subducting oceanic slab forms a deep trench on the oceanic side.
          rift[i] = Math.max(rift[i]!, 0.45 + strength * 0.45);
        } else if (!a.oceanic && b.oceanic) {
          // Overriding continental plate: push volcanic arc 1-2 cells inland when possible.
          const arcVal = strength * 0.92;
          uplift[i] = Math.max(uplift[i]!, arcVal * 0.55);
          for (const k of neighbors[i]!) {
            if (owner[k] !== owner[i]) continue;
            const [kx, ky] = points[k]!;
            const inward = ((kx - ix) * -nx + (ky - iy) * -ny) / (Math.hypot(kx - ix, ky - iy) || 1);
            if (inward > 0.25) {
              uplift[k] = Math.max(uplift[k]!, arcVal);
              if (count > 3) spineCells.add(k);
            }
          }
        } else {
          // Oceanic-oceanic convergence: one side trenches, the overriding side forms a volcanic island arc.
          if (owner[i]! < owner[j]!) {
            rift[i] = Math.max(rift[i]!, 0.35 + strength * 0.35);
          } else {
            uplift[i] = Math.max(uplift[i]!, strength * 0.72);
          }
        }
      } else if (closing < -0.22) {
        const div = Math.min(1, -closing / 1.8);
        if (a.oceanic && b.oceanic) {
          // Mid-ocean ridge: modest underwater uplift.
          uplift[i] = Math.max(uplift[i]!, div * 0.28);
        } else {
          // Continental rift valley.
          rift[i] = Math.max(rift[i]!, div * 0.9);
        }
      } else {
        // Transform fault: modest shear ridge without inventing collision peaks.
        uplift[i] = Math.max(uplift[i]!, Math.min(0.14, shear * 0.065));
      }
    }
  }

  // Modulate ridge seeds and propagation decay so ranges form spurs, saddles, and foothills.
  const ridgeMod = points.map(([x, y]) => 0.74 + 0.44 * (0.5 + 0.5 * noise(x * 11 + 53, y * 11 + 19)));
  const decay = points.map(([x, y]) => 0.69 + 0.14 * (0.5 + 0.5 * noise(x * 7.5 + 71, y * 7.5 + 13)));
  const ridgeSeeds = uplift.map((v, i) => v * ridgeMod[i]!);
  const riftSeeds = [...rift];
  uplift = [...ridgeSeeds];

  for (let pass = 0; pass < 14; pass++) {
    uplift = uplift.map((v, i) => Math.max(
      ridgeSeeds[i]!,
      ...neighbors[i]!.map(j => uplift[j]! * (spineCells.has(i) && spineCells.has(j) ? Math.min(0.90, decay[i]! + 0.08) : decay[i]!)),
    ));
    rift = rift.map((v, i) => Math.max(riftSeeds[i]!, ...neighbors[i]!.map(j => rift[j]! * 0.7)));
    if (pass < 6) {
      base = base.map((v, i) => (v * 2 + neighbors[i]!.reduce((sum, j) => sum + base[j]!, 0)) / (2 + neighbors[i]!.length));
    }
  }

  return {
    plates,
    owner,
    boundaries,
    elevation: base.map((v, i) => v + uplift[i]! * (0.17 + 0.30 * ruggedness) - rift[i]! * 0.18),
  };
}
