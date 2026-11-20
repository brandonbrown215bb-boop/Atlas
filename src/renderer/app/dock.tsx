import { PanelErrorBoundary } from './PanelErrorBoundary';
import type { FloatingPanelState } from './hudStore';
import { InspectorPanel } from '../panels/InspectorPanel';
import { LayersPanel } from '../panels/LayersPanel';
import { MapsPanel } from '../panels/MapsPanel';
import { PlacesPanel } from '../panels/PlacesPanel';
import { SettingsPanel } from '../panels/SettingsPanel';
import { AssetsPanel } from '../panels/AssetsPanel';
import { GeneratorPanel } from '../panels/GeneratorPanel';
import { ToolsPanel } from '../panels/ToolsPanel';
import { MapView } from '../render/MapView';
import { TransferPanel } from '../panels/TransferPanel';
import { PlayerPanelSlot } from '../panels/PlayerControls';

export function renderPanelBody(panel: FloatingPanelState) {
  let content = null;
  switch (panel.kind) {
    case 'tools':
      content = <ToolsPanel />;
      break;
    case 'maps':
      content = <MapsPanel panelId={panel.id} />;
      break;
    case 'layers':
      content = <LayersPanel panelId={panel.id} />;
      break;
    case 'inspector':
      content = <InspectorPanel panelId={panel.id} />;
      break;
    case 'generator':
      content = <GeneratorPanel panelId={panel.id} />;
      break;
    case 'assets':
      content = <AssetsPanel />;
      break;
    case 'places':
      content = <PlacesPanel panelId={panel.id} />;
      break;
    case 'settings':
      content = <SettingsPanel panelId={panel.id} />;
      break;
    case 'transfers':
      content = <TransferPanel />;
      break;
    case 'player':
      content = <PlayerPanelSlot />;
      break;
    case 'newMap':
      content = <MapsPanel panelId={panel.id} section="create" />;
      break;
    case 'map':
      content = <MapView panelId={panel.id} isPopout={panel.mode === 'popout'} />;
      break;
  }
  return <PanelErrorBoundary>{content}</PanelErrorBoundary>;
}
