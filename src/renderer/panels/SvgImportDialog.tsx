import { useEffect, useRef, useState } from 'react';
import type { SvgDrawing } from '../import/svg';
import { svgAreaRings } from '../geom/svgRings';
import { PathRoleSchema, type AreaRole, type Entity, type MapDoc, type PathRole, type Point } from '../model/schema';
import { worldStore } from '../model/store';
import { viewStore } from '../model/viewStore';

export function SvgImportDialog({ drawing, fileName, map, worldId, onClose }: {
  drawing: SvgDrawing; fileName: string; map: MapDoc; worldId: string; onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [widthFeet, setWidthFeet] = useState(String(Math.round(map.bounds.w / 0.3048 * 100) / 100));
  const [layerId, setLayerId] = useState(() => {
    const active = viewStore.getState().activeLayerId;
    return map.layers.find((l) => l.id === active && l.visible && !l.locked)?.id
      ?? map.layers.find((l) => l.visible && !l.locked)?.id ?? '';
  });
  const [roles, setRoles] = useState<string[]>(() => drawing.shapes.map((s) => s.filled && s.contours.some((c) => c.points.length >= 3) ? 'area:land' : 'path:road'));
  const [biome, setBiome] = useState('forest');
  const [error, setError] = useState('');
  useEffect(() => { ref.current?.showModal(); }, []);
  const included = roles.filter((r) => r !== 'skip').length;
  const width = Number(widthFeet) * 0.3048;
  const importShapes = () => {
    try {
      const state = worldStore.getState();
      if (state.world?.meta.id !== worldId) throw new Error('The open world changed. Reopen the SVG import.');
      const scale = width / drawing.width;
      const transform = (p: Point): Point => ({ x: map.bounds.x + p.x * scale, y: map.bounds.y + p.y * scale });
      type ImportedShape = Omit<Extract<Entity, { type: 'area' }>, 'id' | 'layerId' | 'origin' | 'rev'> | Omit<Extract<Entity, { type: 'path' }>, 'id' | 'layerId' | 'origin' | 'rev'>;
      const shapes = drawing.shapes.flatMap<ImportedShape>((shape, index) => {
        const role = roles[index]!;
        if (role === 'skip') return [];
        if (role.startsWith('area:')) {
          const areaRole = role === 'area:biome' ? `biome:${biome.trim()}` : role.slice(5);
          const polygons = svgAreaRings(shape.contours.map((c) => c.points), shape.fillRule);
          if (!polygons.length) throw new Error(`“${shape.name}” has no filled area. Assign a path role or skip it.`);
          return polygons.map((rings) => ({ type: 'area' as const, name: shape.name, role: areaRole as AreaRole, rings: rings.map((r) => r.map(transform)) }));
        }
        return shape.contours.map((contour) => ({
          type: 'path' as const, name: shape.name, role: role.slice(5) as PathRole,
          points: contour.points.map(transform), closed: contour.closed, width: shape.width * scale,
        }));
      });
      const result = state.execute('map.importSvg', { mapId: map.id, layerId, shapes }) as { ids: string[] };
      viewStore.getState().setSelection(result.ids);
      onClose();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  };
  return (
    <dialog ref={ref} className="svg-import-dialog" aria-label="Import SVG" onCancel={onClose}>
      <h2>Import SVG</h2>
      <p>{fileName} → {map.name}</p>
      <div className="svg-import-options">
        <label>Drawing width (feet) <input data-testid="svg-width" type="number" min="0.01" step="any" value={widthFeet} onChange={(e) => setWidthFeet(e.target.value)} /></label>
        <label>Layer <select data-testid="svg-layer" value={layerId} onChange={(e) => setLayerId(e.target.value)}>
          <option value="" disabled>Choose an editable layer</option>
          {map.layers.filter((l) => l.visible && !l.locked).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
        </select></label>
      </div>
      <p>Placed at the map’s top-left corner. Height follows the SVG proportions. Colours and artwork become editable map geometry.</p>
      <svg className="svg-import-preview" viewBox={`0 0 ${drawing.width} ${drawing.height}`} aria-label="SVG outlines preview">
        {drawing.shapes.map((shape, i) => <g key={i} opacity={roles[i] === 'skip' ? 0.15 : 1}>
          {shape.contours.map((c, j) => <polyline key={j} points={[...c.points, ...(c.closed ? c.points.slice(0, 1) : [])].map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke="currentColor" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />)}
        </g>)}
      </svg>
      {drawing.warnings.map((warning) => <p key={warning} className="svg-import-warning">{warning}</p>)}
      <div className="svg-import-shapes">
        {drawing.shapes.map((shape, i) => <label key={i} className="svg-import-row">
          <span>{shape.name} <small>({shape.contours.length} outline{shape.contours.length === 1 ? '' : 's'})</small></span>
          <select aria-label={`Role for ${shape.name}`} data-testid={`svg-role-${i}`} value={roles[i]} onChange={(e) => setRoles((old) => old.map((r, index) => index === i ? e.target.value : r))}>
            <option value="skip">Skip</option>
            <optgroup label="Area">
              {['land', 'water', 'plateau', 'district', 'building', 'floor', 'biome'].map((r) => <option key={r} value={`area:${r}`} disabled={!shape.contours.some((c) => c.points.length >= 3)}>{r}</option>)}
            </optgroup>
            <optgroup label="Path">{PathRoleSchema.options.map((r) => <option key={r} value={`path:${r}`}>{r}</option>)}</optgroup>
          </select>
        </label>)}
      </div>
      {roles.includes('area:biome') && <label>Biome name <input aria-label="Biome name" value={biome} onChange={(e) => setBiome(e.target.value)} /></label>}
      {error && <p role="alert">{error}</p>}
      <div className="svg-import-actions">
        <button type="button" onClick={onClose}>Cancel</button>
        <button type="button" data-testid="btn-confirm-svg" disabled={!included || !Number.isFinite(width) || width <= 0 || !layerId || (roles.includes('area:biome') && !biome.trim())} onClick={importShapes}>Import {included} shape{included === 1 ? '' : 's'}</button>
      </div>
    </dialog>
  );
}
