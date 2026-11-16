import { useStore } from 'zustand';
import { worldStore } from '../model/store';
import { viewStore } from '../model/viewStore';
import { GenerationControls } from './GenerationControls';

export function GeneratorPanel({ panelId = 'generator' }: { panelId?: string }) {
  const world = useStore(worldStore, s => s.world);
  const mapId = useStore(worldStore, s => s.activeMapId);
  const activeMapPanelId = useStore(viewStore, s => s.activeMapPanelId) ?? 'map-main';
  const map = mapId ? world?.maps[mapId] : undefined;
  return <div data-testid={`panel-${panelId}`} style={{ height: '100%', overflow: 'auto', padding: 8 }}>
    {map ? <GenerationControls map={map} panelId={activeMapPanelId} detailed /> : <p>Open a map to generate.</p>}
  </div>;
}
