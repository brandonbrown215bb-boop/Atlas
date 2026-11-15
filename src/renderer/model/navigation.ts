import { worldStore } from './store';
import { viewStore } from './viewStore';

worldStore.subscribe((state,previous)=>{
  if (state.world && state.world.meta.id === previous.world?.meta.id) {
    // Undo can remove the interior currently being viewed. Recover each affected
    // editor to its surviving parent without changing the player display.
    const view = viewStore.getState();
    for (const [panelId, panel] of Object.entries(view.panels)) {
      if (panel.mapId && !state.world.maps[panel.mapId]) {
        const parentId = previous.world?.maps[panel.mapId]?.parent?.mapId;
        const fallback = parentId && state.world.maps[parentId] ? parentId : Object.keys(state.world.maps)[0] ?? null;
        view.setPanelMap(panelId, fallback);
        if (view.activeMapPanelId === panelId) {
          view.setSelection([]);
          if (state.activeMapId !== fallback) worldStore.getState().setActiveMap(fallback);
        }
      }
    }
  }
  if(state.world?.meta.id===previous.world?.meta.id)return;
  const view=viewStore.getState();
  viewStore.setState({panels:Object.fromEntries(Object.keys(view.panels).map(id=>[id,{mapId:state.activeMapId,camera:null}])),selectedEntityIds:[],diagnosticEntityIds:[],draftUndo:false,draftRedo:false,editParts:false});
});

/** All explicit map navigation targets the active editor, never the player view. */
export function navigateToMap(mapId: string, panelId = viewStore.getState().activeMapPanelId ?? 'map-main') {
  if (!worldStore.getState().world?.maps[mapId]) return;
  const view = viewStore.getState();
  view.setActiveMapPanelId(panelId);
  view.setPanelMap(panelId, mapId);
  view.setSelection([]);
  viewStore.setState({diagnosticEntityIds:[], editParts:false});
  view.setActiveLayerId(null);
  worldStore.getState().setActiveMap(mapId);
}

export function activateMapPanel(panelId: string, mapId?: string) {
  const view=viewStore.getState();
  // Dock activation can happen before React updates mapRef after navigation.
  const target=view.panels[panelId]?.mapId ?? mapId;
  view.setActiveMapPanelId(panelId);
  if (target && worldStore.getState().world?.maps[target]) {
    if(worldStore.getState().activeMapId!==target){view.setSelection([]);view.setActiveLayerId(null);viewStore.setState({diagnosticEntityIds:[],interactionMessage:''});}
    worldStore.getState().setActiveMap(target);
  }
}
