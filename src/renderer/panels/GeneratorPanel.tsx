import type { IDockviewPanelProps } from 'dockview-react';
import { useStore } from 'zustand';
import { worldStore } from '../model/store';
import { viewStore } from '../model/viewStore';
import { PanelHeaderBar } from './PanelHeaderBar';
import { GenerationControls } from './GenerationControls';

// Saved layouts may still contain this panel. It uses the same context and drafts
// as the map strip and Inspector instead of maintaining a second generation flow.
export function GeneratorPanel(props: IDockviewPanelProps) {
  const world = useStore(worldStore, s => s.world);
  const mapId = useStore(worldStore, s => s.activeMapId);
  const panelId = useStore(viewStore, s => s.activeMapPanelId) ?? 'map-main';
  const map = mapId ? world?.maps[mapId] : undefined;
  return <div data-testid={`panel-${props.api.id}`} style={{ height: '100%', overflow: 'auto' }}>
    <PanelHeaderBar title="Generation settings" panelProps={props} />
    {map ? <GenerationControls map={map} panelId={panelId} api={props.containerApi} detailed /> : <p>Open a map to generate.</p>}
  </div>;
}
