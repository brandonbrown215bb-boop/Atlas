import { useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { useStore } from 'zustand';
import { worldStore } from '../model/store';
import { viewStore } from '../model/viewStore';
import { renderMapToPngBase64 } from '../render/renderPng';
import type { CameraState } from '../render/camera';

function PlayerScreen({ mapId, labels, grid, camera, owner }: { mapId: string; labels: boolean; grid: boolean; camera?: CameraState; owner: Window }) {
  const map = useStore(worldStore, s => s.world?.maps[mapId]);
  const [size, setSize] = useState({ width: owner.innerWidth, height: owner.innerHeight });
  const image = useRef<HTMLImageElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const resize = () => setSize({ width: owner.innerWidth, height: owner.innerHeight });
    owner.addEventListener('resize', resize);
    return () => owner.removeEventListener('resize', resize);
  }, [owner]);
  useEffect(() => {
    let cancelled = false;
    // Clear the old frame immediately: switching maps or hiding content must not leave it visible.
    image.current?.removeAttribute('src');
    if (map) void renderMapToPngBase64({ map, view: 'player', labels, grid, camera, ...size, document: owner.document })
      .then(data => { if (!cancelled && image.current) { image.current.src = `data:image/png;base64,${data}`; setError(''); } })
      .catch(e => { if (!cancelled) setError(String(e)); });
    return () => { cancelled = true; };
  }, [map, labels, grid, camera, size, owner]);
  return <><img ref={image} data-testid="player-image" style={{ width: '100vw', height: '100vh', objectFit: 'contain' }} />{error && <p style={{color:'white'}}>{error}</p>}</>;
}

export function PlayerControls() {
  const world = useStore(worldStore, s => s.world);
  const fogRadius = useStore(viewStore, s => s.fogRadius);
  const fogMode = useStore(viewStore, s => s.fogMode);
  const activeMap = useStore(worldStore, s => s.activeMapId);
  const [chosen, setChosen] = useState('');
  const mapId = chosen && world?.maps[chosen] ? chosen : activeMap ?? '';
  const [labels, setLabels] = useState(true);
  const [grid, setGrid] = useState(false);
  const [camera, setCamera] = useState<CameraState>();
  const [displays, setDisplays] = useState<Array<{id:number;label:string}>>([]);
  const [display, setDisplay] = useState('');
  const [error, setError] = useState('');
  const child = useRef<Window | null>(null);
  const root = useRef<Root | null>(null);
  const [epoch, setEpoch] = useState(0);
  useEffect(() => { root.current?.render(<PlayerScreen mapId={mapId} labels={labels} grid={grid} camera={camera} owner={child.current!} />); }, [mapId, labels, grid, camera, epoch, world?.meta.id]);
  useEffect(() => () => { child.current?.close(); }, []);
  const open = () => {
    if (child.current && !child.current.closed) { child.current.focus(); return; }
    const win = window.open(window.location.protocol === 'app:' ? 'app://atlas/player.html' : '/player.html', 'atlas-player');
    if (!win) { setError('Could not open player window.'); return; }
    if(!chosen && activeMap)setChosen(activeMap);
    child.current = win;
    win.addEventListener('load', () => {
      root.current = createRoot(win.document.body);
      setEpoch(n => n + 1);
      win.addEventListener('beforeunload', () => { root.current?.unmount(); root.current = null; child.current = null; }, { once: true });
    }, { once: true });
    void window.atlasApi.listDisplays().then(setDisplays).catch(e => setError(String(e)));
  };
  const send = () => {
    const vs = viewStore.getState();
    const id = vs.activeMapPanelId;
    const panel = id ? vs.panels[id] : undefined;
    setChosen(panel?.mapId ?? activeMap ?? '');
    setCamera(panel?.camera ?? undefined);
  };
  return <div style={{display:'flex',alignItems:'center',gap:8,padding:'4px 10px',flexWrap:'wrap',fontSize:12}}>
    <button onClick={open} disabled={!world} data-testid="btn-player-window">Player window</button>
    <select aria-label="Player map" value={mapId} onChange={e => { setChosen(e.target.value); setCamera(undefined); }}>{world?.meta.maps.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
    <button onClick={send} disabled={!world}>Send my view</button>
    <label><input type="checkbox" checked={labels} onChange={e => setLabels(e.target.checked)} />Player labels</label>
    <label><input type="checkbox" checked={grid} onChange={e => setGrid(e.target.checked)} />Player grid</label>
    <select aria-label="Player monitor" value={display} onChange={e => setDisplay(e.target.value)} onFocus={() => void window.atlasApi.listDisplays().then(setDisplays)}><option value="">Windowed</option>{displays.map(d => <option key={d.id} value={d.id}>{d.label}</option>)}</select>
    <button onClick={() => void window.atlasApi.playerFullscreen(display ? Number(display) : null).catch(e => setError(String(e)))}>Apply display</button>
    <label><input type="checkbox" checked={world?.maps[activeMap??'']?.fog.enabled ?? false} onChange={e => worldStore.getState().execute('fog.paint',{mapId:activeMap,mode:e.target.checked?'enable':'disable'})} disabled={!activeMap} />Fog on {world?.maps[activeMap??'']?.name??'edited map'}</label>
    <select aria-label="Fog brush mode" value={fogMode} onChange={e => viewStore.setState({fogMode:e.target.value as 'reveal'|'hide'})}><option value="reveal">Reveal</option><option value="hide">Hide</option></select>
    <label>Brush radius (m) <input aria-label="Fog brush radius" type="number" min="0.1" value={fogRadius} style={{width:55}} onChange={e => {const n=Number(e.target.value); if(n>0 && Number.isFinite(n)) viewStore.setState({fogRadius:n});}} /></label>
    <button disabled={!activeMap} onClick={() => worldStore.getState().execute('fog.paint',{mapId:activeMap,mode:'revealAll'})}>Reveal all</button>
    <button disabled={!activeMap} onClick={() => worldStore.getState().execute('fog.paint',{mapId:activeMap,mode:'hideAll'})}>Hide all</button>
    {error && <span role="alert">{error}</span>}
  </div>;
}
