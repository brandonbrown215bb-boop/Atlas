import { useStore } from 'zustand';
import { THEME_ROLES } from '../model/themes';
import { worldStore } from '../model/store';
import { viewStore, type ToolId } from '../model/viewStore';
import type { AreaRole, MapKind, PathRole } from '../model/schema';

const names: Record<ToolId, string> = { select: 'Select', prop: 'Objects', area: 'Area', biome: 'Paint biome',
  path: 'Path', pointEdit: 'Edit outline', wall: 'Wall', door: 'Door', light: 'Light', label: 'Label',
  portal: 'Portal', developArea: 'Create location', measure: 'Measure', fog: 'Fog' };

const BUILTIN_PROP_ROLES = THEME_ROLES.filter(r => !r.endsWith('Texture'));

export function activatePropTool(mapKind?: MapKind): void {
  const vs = viewStore.getState();
  if (!vs.selectedPackAssetId && !vs.selectedBuiltin) {
    const fallback = mapKind === 'interior' || mapKind === 'settlement' ? 'table' : 'tree';
    viewStore.setState({ selectedBuiltin: fallback, assetError: '' });
  }
  vs.setActiveTool('prop');
}

interface QuickAction {
  id: string;
  label: string;
  tool: ToolId;
  areaRole?: AreaRole;
  pathRole?: PathRole;
  hint?: string;
}

function quickActionsForMap(kind?: MapKind): QuickAction[] {
  if (kind === 'world' || kind === 'region') {
    return [
      { id: 'land', label: 'Land', tool: 'area', areaRole: 'land' },
      { id: 'water', label: 'Water', tool: 'area', areaRole: 'water' },
      { id: 'river', label: 'River', tool: 'path', pathRole: 'river' },
      { id: 'road', label: 'Road', tool: 'path', pathRole: 'road' },
      { id: 'biome', label: 'Paint biome', tool: 'biome', hint: 'B' },
      { id: 'develop-area', label: 'Create location', tool: 'developArea' },
    ];
  }
  if (kind === 'settlement') {
    return [
      { id: 'district', label: 'District', tool: 'area', areaRole: 'district' },
      { id: 'building', label: 'Building', tool: 'area', areaRole: 'building' },
      { id: 'street', label: 'Street', tool: 'path', pathRole: 'road' },
      { id: 'water', label: 'Water', tool: 'area', areaRole: 'water' },
      { id: 'city-wall', label: 'City wall', tool: 'path', pathRole: 'cityWall' },
      { id: 'door', label: 'Door', tool: 'door', hint: 'D' },
      { id: 'develop-area', label: 'Create location', tool: 'developArea' },
    ];
  }
  if (kind === 'interior') {
    return [
      { id: 'floor', label: 'Floor', tool: 'area', areaRole: 'floor' },
      { id: 'wall', label: 'Wall', tool: 'wall', hint: 'W' },
      { id: 'door', label: 'Door', tool: 'door', hint: 'D' },
      { id: 'light', label: 'Light', tool: 'light' },
    ];
  }
  return [
    { id: 'land', label: 'Area', tool: 'area', areaRole: 'land' },
    { id: 'trail', label: 'Trail', tool: 'path', pathRole: 'trail' },
    { id: 'water', label: 'Water', tool: 'area', areaRole: 'water' },
    { id: 'wall', label: 'Wall', tool: 'wall', hint: 'W' },
    { id: 'door', label: 'Door', tool: 'door', hint: 'D' },
  ];
}

export function ContextTools({ onOpenAssets }: { onOpenAssets?: () => void }) {
  const map = useStore(worldStore, s => s.activeMapId ? s.world?.maps[s.activeMapId] : undefined);
  const active = useStore(viewStore, s => s.activeTool);
  const areaRole = useStore(viewStore, s => s.areaRole);
  const pathRole = useStore(viewStore, s => s.pathRole);
  const selectedIds = useStore(viewStore, s => s.selectedEntityIds);
  const selectedBuiltin = useStore(viewStore, s => s.selectedBuiltin);
  const selectedPackAssetId = useStore(viewStore, s => s.selectedPackAssetId);
  const assetsIndex = useStore(viewStore, s => s.assetsIndex);

  const canEditOutline =
    active === 'pointEdit' ||
    (selectedIds.length === 1 &&
      Boolean(map?.entities[selectedIds[0]!]) &&
      ['area', 'path', 'wall'].includes(map!.entities[selectedIds[0]!]!.type));

  const button = (tool: ToolId, title?: string) => (
    <button
      type="button"
      key={tool}
      data-testid={`tool-btn-${tool}`}
      title={title}
      aria-pressed={active === tool}
      onClick={e => {
        if (tool === 'prop') activatePropTool(map?.kind);
        else viewStore.getState().setActiveTool(tool);
        e.currentTarget.closest('details')?.removeAttribute('open');
      }}
    >
      {names[tool]}
    </button>
  );

  const isQuickActive = (action: QuickAction) => {
    if (action.tool === 'area' && action.areaRole) return active === 'area' && areaRole === action.areaRole;
    if (action.tool === 'path' && action.pathRole) return active === 'path' && pathRole === action.pathRole;
    return active === action.tool;
  };

  return <>
    {button('select', 'Select (V)')}
    {quickActionsForMap(map?.kind).map(action => (
      <button
        type="button"
        key={action.id}
        data-testid={`quick-draw-${action.id}`}
        title={action.hint ? `${action.label} (${action.hint})` : action.label}
        aria-pressed={isQuickActive(action)}
        onClick={() => {
          const vs = viewStore.getState();
          if (action.areaRole) vs.setAreaRole(action.areaRole);
          if (action.pathRole) {
            vs.setPathRole(action.pathRole);
            vs.setPathClosed(false);
          }
          vs.setActiveTool(action.tool);
        }}
      >
        {action.label}
      </button>
    ))}
    {canEditOutline && (
      <button
        type="button"
        data-testid="quick-draw-point-edit"
        title="Edit outline (E)"
        aria-pressed={active === 'pointEdit'}
        onClick={() => viewStore.getState().setActiveTool('pointEdit')}
      >
        Edit outline
      </button>
    )}
    {button('prop', 'Objects (O)')}
    {active === 'prop' && (
      <>
        <select
          data-testid="toolbar-builtin-prop"
          aria-label="Active prop"
          value={selectedPackAssetId ? '__pack__' : (selectedBuiltin ?? 'tree')}
          onChange={e => {
            if (e.target.value === '__pack__') return;
            viewStore.setState({ selectedBuiltin: e.target.value, selectedPackAssetId: null, assetError: '' });
          }}
        >
          {selectedPackAssetId && (
            <option value="__pack__">
              Pack: {assetsIndex[selectedPackAssetId]?.originalName ?? 'Selected asset'}
            </option>
          )}
          {BUILTIN_PROP_ROLES.map(role => (
            <option key={role} value={role}>
              {role}
            </option>
          ))}
        </select>
        {onOpenAssets && (
          <button type="button" onClick={onOpenAssets}>
            Browse assets…
          </button>
        )}
      </>
    )}
    {button('label', 'Label (L)')}
    {button('measure', 'Measure (M)')}
    <details className="context-menu" data-testid="more-tools"><summary>More tools…</summary><div>
      {(Object.keys(names) as ToolId[]).filter(tool => !['select', 'prop', 'label', 'measure'].includes(tool)).map(tool => button(tool))}
      <button type="button" data-testid="tool-btn-river" onClick={e => { viewStore.getState().setPathRole('river'); viewStore.getState().setPathClosed(false); viewStore.getState().setActiveTool('path'); e.currentTarget.closest('details')?.removeAttribute('open'); }}>River</button>
    </div></details>
    {!['select', 'prop', 'label', 'measure'].includes(active) && <span data-testid="current-tool">{names[active]}</span>}
  </>;
}
