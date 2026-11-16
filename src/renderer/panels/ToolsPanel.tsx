import { useState } from 'react';
import { useStore } from 'zustand';
import { ContextTools } from './ContextTools';
import { MeasureBar } from './MeasureBar';
import { hudStore } from '../app/hudStore';
import { extentLabel } from '../model/mapDefaults';
import { defaultGenerationDraft, generateFromContext } from '../model/generationState';
import { resolveGenerationContext } from '../model/generationContext';
import { navigateToMap } from '../model/navigation';
import {
  DEFAULT_BIOMES,
  MapKindSchema,
  WALL_PRESET_DEFAULTS,
  type AreaRole,
  type ConnectorKind,
  type MapKind,
  type PathRole,
  type RouteTier,
  type WallKind,
} from '../model/schema';
import { worldStore } from '../model/store';
import {
  viewStore,
  type DoorKind,
  type DrawMode,
  type PointEditMode,
} from '../model/viewStore';

export function ToolsPanel() {
  const world = useStore(worldStore, (s) => s.world);
  const activeMapId = useStore(worldStore, (s) => s.activeMapId);
  const activeMapPanelId = useStore(viewStore, (s) => s.activeMapPanelId) ?? 'map-main';
  const activeTool = useStore(viewStore, (s) => s.activeTool);
  const drawMode = useStore(viewStore, (s) => s.drawMode);
  const pointEditMode = useStore(viewStore, (s) => s.pointEditMode);
  const snapToGrid = useStore(viewStore, (s) => s.snapToGrid);
  const areaRole = useStore(viewStore, (s) => s.areaRole);
  const pathRole = useStore(viewStore, (s) => s.pathRole);
  const biomeName = useStore(viewStore, (s) => s.biomeName);
  const biomeRadius = useStore(viewStore, (s) => s.biomeRadius);
  const geoBrushRadius = useStore(viewStore, (s) => s.geoBrushRadius);
  const biomeErase = useStore(viewStore, (s) => s.biomeErase);
  const pathWidth = useStore(viewStore, (s) => s.pathWidth);
  const pathClosed = useStore(viewStore, (s) => s.pathClosed);
  const wallSnapToGrid = useStore(viewStore, (s) => s.wallSnapToGrid);
  const wallBlocksMove = useStore(viewStore, (s) => s.wallBlocksMove);
  const wallBlocksSight = useStore(viewStore, (s) => s.wallBlocksSight);
  const wallKind = useStore(viewStore, (s) => s.wallKind);
  const wallBlocksLight = useStore(viewStore, (s) => s.wallBlocksLight);
  const wallBlocksSound = useStore(viewStore, (s) => s.wallBlocksSound);
  const doorKind = useStore(viewStore, (s) => s.doorKind);
  const doorLocked = useStore(viewStore, (s) => s.doorLocked);
  const portalConnectorKind = useStore(viewStore, (s) => s.portalConnectorKind);
  const pathRouteTier = useStore(viewStore, (s) => s.pathRouteTier);
  const lightRadius = useStore(viewStore, (s) => s.lightRadius);
  const lightColor = useStore(viewStore, (s) => s.lightColor);
  const labelText = useStore(viewStore, (s) => s.labelText);
  const labelSize = useStore(viewStore, (s) => s.labelSize);
  const portalTargetMapId = useStore(viewStore, (s) => s.portalTargetMapId);
  const developAreaKind = useStore(viewStore, (s) => s.developAreaKind);
  const pendingDevelopRect = useStore(viewStore, (s) => s.pendingDevelopRect);
  const assetError = useStore(viewStore, (s) => s.assetError);

  const [developName, setDevelopName] = useState('Developed Area');
  const [autoPopulateRegion, setAutoPopulateRegion] = useState(true);

  const map = activeMapId ? world?.maps[activeMapId] : undefined;

  const confirmDevelopArea = () => {
    if (!pendingDevelopRect || !developName.trim()) return;
    const res = worldStore.getState().execute('map.developArea', {
      parentMapId: pendingDevelopRect.mapId,
      name: developName.trim(),
      kind: developAreaKind,
      rect: pendingDevelopRect.rect,
    }) as { id: string };
    const vs = viewStore.getState();
    vs.setPendingDevelopRect(null);
    vs.setActiveTool('select');
    const targetPanelId = vs.activeMapPanelId ?? 'map-main';
    vs.setPanelMap(targetPanelId, res.id);
    navigateToMap(res.id);
    if (developAreaKind === 'region' && autoPopulateRegion) {
      const childMap = worldStore.getState().world?.maps[res.id];
      if (childMap) {
        const ctx = resolveGenerationContext(childMap, [], false);
        const draft = defaultGenerationDraft(childMap, ctx);
        draft.params = { ...draft.params, mode: 'populate' };
        void generateFromContext(childMap, ctx, draft, targetPanelId, 'generate');
      }
    }
  };

  return (
    <div
      data-testid="panel-tools"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 8,
        fontSize: 12,
      }}
    >
      <div
        data-testid="tool-bar"
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          alignItems: 'center',
          gap: 5,
        }}
      >
        <ContextTools onOpenAssets={() => hudStore.getState().openOrFocusPanel('assets')} />
      </div>

      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 6,
          borderTop: '1px solid var(--atlas-border)',
          paddingTop: 6,
        }}
      >
        {(activeTool === 'landBrush' || activeTool === 'waterBrush') && (
          <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
            <span>Brush radius (m)</span>
            <input
              aria-label="Geography brush radius"
              type="number"
              min="10"
              step="100"
              value={Math.round(geoBrushRadius)}
              onChange={(e) =>
                viewStore.setState({ geoBrushRadius: Math.max(10, Number(e.target.value) || 10) })
              }
              style={{ width: 84 }}
            />
          </label>
        )}

        {activeTool === 'biome' && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span>Biome</span>
              <select
                aria-label="Paint biome"
                value={biomeName}
                onChange={(e) => viewStore.setState({ biomeName: e.target.value })}
              >
                {(world?.meta.climate?.biomes ?? DEFAULT_BIOMES).map((b) => (
                  <option key={b.name} value={b.name}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span>Brush radius (ft)</span>
              <input
                aria-label="Biome brush radius"
                type="number"
                min="1"
                value={Number((biomeRadius / 0.3048).toFixed(1))}
                onChange={(e) =>
                  viewStore.setState({ biomeRadius: Math.max(0.3048, Number(e.target.value) * 0.3048) })
                }
                style={{ width: 76 }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={biomeErase}
                onChange={(e) => viewStore.setState({ biomeErase: e.target.checked })}
              />
              <span>Erase</span>
            </label>
          </>
        )}

        {activeTool === 'pointEdit' && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span>Mode</span>
              <select
                data-testid="select-point-edit-mode"
                value={pointEditMode}
                onChange={(e) => viewStore.getState().setPointEditMode(e.target.value as PointEditMode)}
              >
                <option value="edit">Edit vertices</option>
                <option value="add">Add to area</option>
                <option value="subtract">Subtract (carve hole)</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                data-testid="checkbox-snap-grid"
                checked={snapToGrid}
                onChange={(e) => viewStore.getState().setSnapToGrid(e.target.checked)}
              />
              <span>Snap to grid</span>
            </label>
          </>
        )}

        {(activeTool === 'area' || activeTool === 'path') && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span>Mode</span>
              <select
                data-testid="select-draw-mode"
                value={drawMode}
                onChange={(e) => viewStore.getState().setDrawMode(e.target.value as DrawMode)}
              >
                <option value="click">Click points</option>
                <option value="freehand">Freehand</option>
              </select>
            </label>

            {activeTool === 'area' && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <span>Role</span>
                  <select
                    data-testid="select-area-role"
                    value={areaRole}
                    onChange={(e) => viewStore.getState().setAreaRole(e.target.value as AreaRole)}
                  >
                    <option value="land">land</option>
                    <option value="water">water</option>
                    <option value="plateau">plateau</option>
                    <option value="district">district</option>
                    <option value="building">building</option>
                    <option value="floor">floor</option>
                    {(world?.meta.climate?.biomes ?? DEFAULT_BIOMES).map((b) => (
                      <option key={b.name} value={`biome:${b.name}`}>
                        {b.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label
                  style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                  title="Blueprint polygons act as preserve/keepout masks across Shift+Enter regeneration"
                >
                  <input
                    type="checkbox"
                    data-testid="toggle-blueprint-mask"
                    checked={useStore(viewStore, (s) => s.blueprintMode)}
                    onChange={(e) => viewStore.getState().setBlueprintMode(e.target.checked)}
                  />
                  <span>Blueprint mask brush</span>
                </label>
              </>
            )}

            {activeTool === 'path' && (
              <>
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <span>Role</span>
                  <select
                    data-testid="select-path-role"
                    value={pathRole}
                    onChange={(e) => viewStore.getState().setPathRole(e.target.value as PathRole)}
                  >
                    <option value="road">road</option>
                    <option value="river">river</option>
                    <option value="cliff">cliff</option>
                    <option value="cityWall">cityWall</option>
                    <option value="trail">trail</option>
                  </select>
                </label>
                {(pathRole === 'road' || pathRole === 'trail') && (
                  <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                    <span>Route tier</span>
                    <select
                      aria-label="Route tier"
                      value={pathRouteTier}
                      onChange={(e) => viewStore.getState().setPathRouteTier(e.target.value as RouteTier)}
                    >
                      <option value="highway">Highway</option>
                      <option value="road">Main Road</option>
                      <option value="track">Cart Track</option>
                      <option value="gameTrail">Game Trail</option>
                      <option value="secret">Secret Path</option>
                    </select>
                  </label>
                )}
                <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                  <span>Width (ft)</span>
                  <input
                    type="number"
                    min={0.1}
                    step={0.5}
                    value={Number((pathWidth / 0.3048).toFixed(2))}
                    onChange={(e) => {
                      const val = Number.parseFloat(e.target.value);
                      if (Number.isFinite(val) && val > 0) {
                        viewStore.getState().setPathWidth(val * 0.3048);
                      }
                    }}
                    style={{ width: 72 }}
                  />
                </label>
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={pathClosed}
                    onChange={(e) => viewStore.getState().setPathClosed(e.target.checked)}
                  />
                  <span>Closed</span>
                </label>
              </>
            )}

            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                data-testid="checkbox-snap-grid"
                checked={snapToGrid}
                onChange={(e) => viewStore.getState().setSnapToGrid(e.target.checked)}
              />
              <span>Snap to grid</span>
            </label>
          </>
        )}

        {(activeTool === 'area' ||
          activeTool === 'path' ||
          activeTool === 'wall' ||
          (activeTool === 'pointEdit' && pointEditMode !== 'edit')) && (
          <small style={{ color: 'var(--atlas-text-muted)' }}>
            Enter: finish · Ctrl+Z / Backspace: undo point · Ctrl+Y: redo · Esc: cancel
          </small>
        )}

        {activeTool === 'wall' && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span>Preset</span>
              <select
                data-testid="select-wall-kind"
                value={wallKind}
                onChange={(e) => {
                  const kind = e.target.value as WallKind;
                  const defs = WALL_PRESET_DEFAULTS[kind];
                  viewStore.setState({
                    wallKind: kind,
                    wallBlocksMove: defs.blocksMove,
                    wallBlocksSight: defs.blocksSight,
                    wallBlocksLight: defs.blocksLight,
                    wallBlocksSound: defs.blocksSound,
                  });
                }}
              >
                <option value="solid">Solid wall</option>
                <option value="terrain">Terrain / one-way</option>
                <option value="invisible">Invisible barrier</option>
                <option value="ethereal">Illusion / curtain</option>
                <option value="window">Window / slit</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                data-testid="checkbox-wall-snap"
                checked={wallSnapToGrid}
                onChange={(e) => viewStore.getState().setWallSnapToGrid(e.target.checked)}
              />
              <span>Snap to grid</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={wallBlocksMove}
                onChange={(e) => viewStore.getState().setWallBlocksMove(e.target.checked)}
              />
              <span>Blocks move</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={wallBlocksSight}
                onChange={(e) => viewStore.getState().setWallBlocksSight(e.target.checked)}
              />
              <span>Blocks sight</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={wallBlocksLight}
                onChange={(e) => viewStore.getState().setWallBlocksLight(e.target.checked)}
              />
              <span>Blocks light</span>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={wallBlocksSound}
                onChange={(e) => viewStore.getState().setWallBlocksSound(e.target.checked)}
              />
              <span>Blocks sound</span>
            </label>
          </>
        )}

        {activeTool === 'door' && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span>Kind</span>
              <select
                data-testid="select-door-kind"
                value={doorKind}
                onChange={(e) => viewStore.getState().setDoorKind(e.target.value as DoorKind)}
              >
                <option value="door">door</option>
                <option value="secret">secret</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input
                type="checkbox"
                checked={doorLocked}
                onChange={(e) => viewStore.getState().setDoorLocked(e.target.checked)}
              />
              <span>Locked</span>
            </label>
          </>
        )}

        {activeTool === 'light' && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span>Radius (m)</span>
              <input
                type="number"
                min={0.5}
                step={1}
                value={lightRadius}
                onChange={(e) => {
                  const val = Number.parseFloat(e.target.value);
                  if (Number.isFinite(val) && val > 0) {
                    viewStore.getState().setLightRadius(val);
                  }
                }}
                style={{ width: 72 }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span>Color</span>
              <input
                type="color"
                value={lightColor}
                onChange={(e) => viewStore.getState().setLightColor(e.target.value)}
              />
            </label>
          </>
        )}

        {activeTool === 'label' && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span>Text</span>
              <input
                type="text"
                value={labelText}
                onChange={(e) => viewStore.getState().setLabelText(e.target.value)}
                style={{ width: 130 }}
              />
            </label>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span>Size</span>
              <input
                type="number"
                min={6}
                step={2}
                value={labelSize}
                onChange={(e) => {
                  const val = Number.parseFloat(e.target.value);
                  if (Number.isFinite(val) && val >= 1) {
                    viewStore.getState().setLabelSize(val);
                  }
                }}
                style={{ width: 72 }}
              />
            </label>
          </>
        )}

        {activeTool === 'portal' && world && (
          <>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span>Connector</span>
              <select
                data-testid="select-portal-connector"
                value={portalConnectorKind}
                onChange={(e) => viewStore.getState().setPortalConnectorKind(e.target.value as ConnectorKind)}
              >
                <option value="portal">Map link (portal)</option>
                <option value="stairsUp">Stairs Up</option>
                <option value="stairsDown">Stairs Down</option>
                <option value="spiralStairs">Spiral Stairs</option>
                <option value="ladder">Ladder / Hatch</option>
                <option value="slope">Slope / Ramp</option>
                <option value="chute">Shaft / Chute</option>
                <option value="balcony">Balcony / Drop</option>
                <option value="rubble">Rubble Choke</option>
                <option value="pit">Pit Drop</option>
                <option value="secretStair">Secret Stair</option>
                <option value="elevator">Elevator / Pulley</option>
                <option value="waterfall">Underground Waterfall</option>
                <option value="siphon">U-Bend Siphon</option>
                <option value="teleport">Teleport Rune</option>
                <option value="hatch">Floor Hatch</option>
                <option value="chimney">Natural Chimney</option>
                <option value="passwall">Brute-Force Passwall</option>
              </select>
            </label>
            <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
              <span>Target map</span>
              <select
                data-testid="select-portal-target"
                value={portalTargetMapId ?? world.meta.maps[0]?.id ?? ''}
                onChange={(e) => viewStore.getState().setPortalTargetMapId(e.target.value)}
              >
                {world.meta.maps.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name} ({m.kind})
                  </option>
                ))}
              </select>
            </label>
          </>
        )}

        {activeTool === 'developArea' && (
          pendingDevelopRect ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span>{extentLabel(pendingDevelopRect.rect)}</span>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span>Width (mi)</span>
                <input
                  data-testid="develop-area-width"
                  type="number"
                  min="0.0001"
                  step="0.01"
                  value={Number((pendingDevelopRect.rect.w / 1609.344).toFixed(4))}
                  onChange={(e) => {
                    const w = Number(e.target.value) * 1609.344;
                    if (w > 0) {
                      viewStore.getState().setPendingDevelopRect({
                        ...pendingDevelopRect,
                        rect: {
                          ...pendingDevelopRect.rect,
                          x: pendingDevelopRect.rect.x + (pendingDevelopRect.rect.w - w) / 2,
                          w,
                        },
                      });
                    }
                  }}
                  style={{ width: 90 }}
                />
              </label>
              <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                <span>Height (mi)</span>
                <input
                  data-testid="develop-area-height"
                  type="number"
                  min="0.0001"
                  step="0.01"
                  value={Number((pendingDevelopRect.rect.h / 1609.344).toFixed(4))}
                  onChange={(e) => {
                    const h = Number(e.target.value) * 1609.344;
                    if (h > 0) {
                      viewStore.getState().setPendingDevelopRect({
                        ...pendingDevelopRect,
                        rect: {
                          ...pendingDevelopRect.rect,
                          y: pendingDevelopRect.rect.y + (pendingDevelopRect.rect.h - h) / 2,
                          h,
                        },
                      });
                    }
                  }}
                  style={{ width: 90 }}
                />
              </label>
              {developAreaKind === 'settlement' &&
                pendingDevelopRect.rect.w * pendingDevelopRect.rect.h > 16000000 && (
                  <small style={{ color: '#fbbf24' }}>
                    Region-sized: draw a district under 6.18 sq mi for town generation.
                  </small>
                )}
              <input
                type="text"
                data-testid="develop-area-name"
                placeholder="Child map name..."
                value={developName}
                onChange={(e) => setDevelopName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    confirmDevelopArea();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    viewStore.getState().setPendingDevelopRect(null);
                  }
                }}
              />
              <select
                data-testid="select-develop-kind"
                value={developAreaKind}
                onChange={(e) => viewStore.getState().setDevelopAreaKind(e.target.value as MapKind)}
              >
                {MapKindSchema.options
                  .filter((k) => k !== 'interior')
                  .map((k) => (
                    <option key={k} value={k}>
                      {k}
                    </option>
                  ))}
              </select>
              {developAreaKind === 'region' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={autoPopulateRegion}
                    onChange={(e) => setAutoPopulateRegion(e.target.checked)}
                  />
                  <span>Populate POIs &amp; detail</span>
                </label>
              )}
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  type="button"
                  data-testid="btn-confirm-develop"
                  disabled={developName.trim().length === 0}
                  onClick={confirmDevelopArea}
                >
                  Create Child Map
                </button>
                <button
                  type="button"
                  data-testid="btn-cancel-develop"
                  onClick={() => viewStore.getState().setPendingDevelopRect(null)}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <span style={{ color: 'var(--atlas-text-muted)' }}>
              Drag a rectangle on the map to develop a child area
            </span>
          )
        )}

        {activeTool === 'measure' && map && world && (
          <MeasureBar panelId={activeMapPanelId} worldId={world.meta.id} mapId={map.id} />
        )}

        {assetError && (
          <span
            data-testid="toolbar-asset-error"
            style={{ color: 'var(--atlas-danger)', display: 'inline-flex', alignItems: 'center', gap: 6 }}
          >
            <span>{assetError}</span>
            <button
              type="button"
              aria-label="Dismiss asset error"
              onClick={() => viewStore.setState({ assetError: '' })}
            >
              ×
            </button>
          </span>
        )}
      </div>
    </div>
  );
}
