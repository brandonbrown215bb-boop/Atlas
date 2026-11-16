import type { AreaEntity, MapDoc } from '../model/schema';

export function InteriorPreview({ map }: { map: MapDoc }) {
  const entities = Object.values(map.entities);
  const path = (rings: { x: number; y: number }[][]) =>
    rings.map((r) => r.map((p, i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' ') + ' Z').join(' ');
  return (
    <svg
      data-testid="interior-preview"
      aria-label="Interior layout preview"
      role="img"
      viewBox={`-1 -1 ${map.bounds.w + 2} ${map.bounds.h + 2}`}
      style={{ width: '100%', height: 240, background: '#22272d', border: '1px solid var(--atlas-border)' }}
    >
      {entities.map((e) =>
        e.type === 'area' ? (
          <path key={e.id} d={path(e.rings)} fill={e.role === 'floor' ? (e.fill ?? '#73634e') : '#333'} fillRule="evenodd" />
        ) : null,
      )}
      {entities.map((e) =>
        e.type === 'wall' ? (
          <polyline key={e.id} points={e.points.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="#e5e7eb" strokeWidth={0.16} />
        ) : e.type === 'door' ? (
          <line key={e.id} x1={e.a.x} y1={e.a.y} x2={e.b.x} y2={e.b.y} stroke={e.kind === 'secret' ? '#c084fc' : '#d97706'} strokeWidth={0.24} />
        ) : e.type === 'prop' ? (
          <rect
            key={e.id}
            x={e.x - (e.w ?? 1) / 2}
            y={e.y - (e.h ?? 1) / 2}
            width={e.w ?? 1}
            height={e.h ?? 1}
            fill="#c39b70"
            transform={`rotate(${(e.rotation * 180) / Math.PI} ${e.x} ${e.y})`}
          >
            <title>{e.name}</title>
          </rect>
        ) : null,
      )}
    </svg>
  );
}

/** 4-side cardinal exterior elevation silhouette derived from building/floor footprint and story count. */
export function ExteriorElevations({
  map,
  building,
  stories,
}: {
  map: MapDoc;
  building?: AreaEntity;
  stories?: number;
}) {
  const storyCount = Math.max(1, stories ?? map.elevationStories ?? 1);
  const pts = building
    ? (building.rings[0] ?? [])
    : Object.values(map.entities)
        .filter((e): e is AreaEntity => e.type === 'area' && (e.role === 'floor' || e.role === 'building'))
        .flatMap((a) => a.rings[0] ?? []);

  let minX = 0, maxX = Math.max(8, map.bounds.w), minY = 0, maxY = Math.max(6, map.bounds.h);
  if (pts.length >= 3) {
    minX = Math.min(...pts.map((p) => p.x));
    maxX = Math.max(...pts.map((p) => p.x));
    minY = Math.min(...pts.map((p) => p.y));
    maxY = Math.max(...pts.map((p) => p.y));
  }
  const spanX = Math.max(4, maxX - minX);
  const spanY = Math.max(4, maxY - minY);
  const wallH = storyCount * 3.1;
  const roofShape = building?.roofShape ?? 'gable';
  const roofFill = building?.roofColor ?? (roofShape === 'hip' ? '#6d5c4e' : '#8e4d3a');
  const sides = [
    { label: 'N', span: spanX, wideGable: roofShape === 'gable' },
    { label: 'E', span: spanY, wideGable: false },
    { label: 'S', span: spanX, wideGable: roofShape === 'gable' },
    { label: 'W', span: spanY, wideGable: false },
  ];
  const cellW = 72;
  const pad = 6;
  const totalW = sides.length * cellW + (sides.length + 1) * pad;
  const totalH = 66;
  const maxSpan = Math.max(spanX, spanY, wallH + 3.2);

  return (
    <svg
      data-testid="exterior-elevations"
      aria-label="4-side exterior architectural elevations"
      role="img"
      viewBox={`0 0 ${totalW} ${totalH}`}
      style={{
        width: '100%',
        height: 76,
        background: '#1c2026',
        border: '1px solid var(--atlas-border)',
        borderRadius: 4,
      }}
    >
      {sides.map((side, idx) => {
        const x0 = pad + idx * (cellW + pad);
        const groundY = 54;
        const drawW = Math.max(22, (side.span / maxSpan) * (cellW - 10));
        const bx = x0 + (cellW - drawW) / 2;
        const drawH = Math.min(28, (wallH / maxSpan) * 38);
        const roofH = Math.max(6, Math.min(14, drawW * 0.28));
        const roofTop = groundY - drawH - roofH;
        const roofPoly = side.wideGable
          ? `${bx - 2},${groundY - drawH} ${bx + 5},${roofTop} ${bx + drawW - 5},${roofTop} ${bx + drawW + 2},${groundY - drawH}`
          : roofShape === 'hip'
            ? `${bx - 2},${groundY - drawH} ${bx + drawW * 0.25},${roofTop} ${bx + drawW * 0.75},${roofTop} ${bx + drawW + 2},${groundY - drawH}`
            : `${bx - 2},${groundY - drawH} ${bx + drawW / 2},${roofTop} ${bx + drawW + 2},${groundY - drawH}`;
        return (
          <g key={side.label}>
            <line x1={x0 + 2} y1={groundY} x2={x0 + cellW - 2} y2={groundY} stroke="#4b5563" strokeWidth={1} />
            <rect x={bx} y={groundY - drawH} width={drawW} height={drawH} fill="#d6cab3" stroke="#3f362d" strokeWidth={0.8} />
            <polygon points={roofPoly} fill={roofFill} stroke="#2b211a" strokeWidth={0.8} />
            {Array.from({ length: storyCount }).map((_, si) => {
              const wy = groundY - ((si + 0.55) / storyCount) * drawH;
              if (si === 0) {
                return (
                  <g key={si}>
                    <rect x={bx + drawW * 0.5 - 2} y={groundY - Math.min(7, drawH * 0.45)} width={4} height={Math.min(7, drawH * 0.45)} fill="#5c4028" />
                    <rect x={bx + drawW * 0.22 - 1.5} y={wy - 1.5} width={3} height={3} fill="#384452" />
                    <rect x={bx + drawW * 0.78 - 1.5} y={wy - 1.5} width={3} height={3} fill="#384452" />
                  </g>
                );
              }
              return (
                <g key={si}>
                  <rect x={bx + drawW * 0.28 - 1.5} y={wy - 1.5} width={3} height={3} fill="#384452" />
                  <rect x={bx + drawW * 0.72 - 1.5} y={wy - 1.5} width={3} height={3} fill="#384452" />
                </g>
              );
            })}
            <text x={x0 + cellW / 2} y={63} textAnchor="middle" fill="#9ca3af" fontSize="8">
              {side.label} ({storyCount}F)
            </text>
          </g>
        );
      })}
    </svg>
  );
}
