import { viewStore } from './viewStore';
import { worldStore } from './store';
const handlers = new Map<string, (redo: boolean) => boolean>();
export function registerDrawingHistory(panelId: string, handler: (redo: boolean) => boolean) {
  handlers.set(panelId, handler);
  return () => { handlers.delete(panelId); };
}
export function editorHistory(redo = false) {
  const id = viewStore.getState().activeMapPanelId;
  if (id && handlers.get(id)?.(redo)) return true;
  return redo ? worldStore.getState().redo() : worldStore.getState().undo();
}
