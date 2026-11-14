import { useEffect, useRef, useState } from 'react';
import type { IDockviewPanelProps } from 'dockview-react';
import type { AssetPage, AssetResult } from '../model/packs';
import { useStore } from 'zustand';
import { viewStore } from '../model/viewStore';
import { worldStore } from '../model/store';
import { executeAssetCommands } from '../assets/commands';

function Thumbnail({ asset, onSelect }: { asset: AssetResult; onSelect: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [url, setUrl] = useState('');
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    let alive = true;
    const win = element.ownerDocument.defaultView!;
    const observer = new win.IntersectionObserver(entries => {
      if (!entries.some(e => e.isIntersecting)) return;
      observer.disconnect();
      void window.atlasApi.getAssetThumbnail(asset.id).then(value => { if (alive) setUrl(value); }).catch(() => {});
    });
    observer.observe(element);
    return () => { alive = false; observer.disconnect(); };
  }, [asset.id]);
  return <button ref={ref} title={`${asset.relativePath}\n${asset.width} × ${asset.height} px`} onClick={onSelect} className="asset-card">
    {url ? <img src={url} alt="" width="64" height="64" /> : <span className="asset-thumbnail-placeholder">◇</span>}
    <span>{asset.name}</span>
  </button>;
}

export function AssetsPanel(_props: IDockviewPanelProps) {
  const [page, setPage] = useState<AssetPage | null>(null);
  const [query, setQuery] = useState('');
  const [tag, setTag] = useState('');
  const [packId, setPackId] = useState('');
  const [folder, setFolder] = useState('');
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<AssetResult | null>(null);
  const [refresh, setRefresh] = useState(0);
  const assetError = useStore(viewStore, s => s.assetError);
  const propScale = useStore(viewStore, s => s.propScale);
  const propRotation = useStore(viewStore, s => s.propRotation);
  const propFlipX = useStore(viewStore, s => s.propFlipX);
  const applyTexture = async (clear = false) => {
    try {
      const vs = viewStore.getState();
      const mapId = (vs.activeMapPanelId && vs.panels[vs.activeMapPanelId]?.mapId) || worldStore.getState().activeMapId;
      await executeAssetCommands([{ name: 'entity.setTexture', input: { mapId, entityIds: vs.selectedEntityIds, packAssetId: vs.selectedPackAssetId, clear } }]);
      viewStore.setState({ assetError: '' });
    } catch (e) { viewStore.setState({ assetError: String(e) }); }
  };
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => {
      void window.atlasApi.searchAssets({ query, tag, packId, folder, offset }).then(p => {
        if (alive) { setPage(p); setError(''); }
      }).catch(e => { if (alive) setError(String(e)); });
    }, 120);
    return () => { alive = false; clearTimeout(timer); };
  }, [query, tag, packId, folder, offset, refresh]);
  return <div className="assets-panel" data-testid="assets-panel">
    <div className="asset-filters">
      <input aria-label="Search assets" placeholder="Search name or tags" value={query} onChange={e => { setQuery(e.target.value); setOffset(0); }} />
      <input aria-label="Asset tag" placeholder="Exact tag" value={tag} onChange={e => { setTag(e.target.value); setOffset(0); }} />
      <select aria-label="Asset pack" value={packId} onChange={e => { setPackId(e.target.value); setFolder(''); setOffset(0); }}>
        <option value="">All packs</option>{page?.packs.map(p => <option key={p.id} value={p.id}>{p.name} ({p.count.toLocaleString()})</option>)}
      </select>
      <button onClick={() => setRefresh(n => n + 1)}>Refresh</button>
    </div>
    {error && <div role="alert">{error}</div>}
    <nav aria-label="Asset folders" className="asset-folders">
      <button onClick={() => { setFolder(''); setOffset(0); }}>All folders</button>
      {folder && <><span>{folder}</span><button onClick={() => { setFolder(folder.split('/').slice(0,-1).join('/')); setOffset(0); }}>Up</button></>}
      {page?.folders.map(f => <button key={f} onClick={() => { setFolder(f); setOffset(0); }}>▸ {f.split('/').at(-1)}</button>)}
    </nav>
    <div>{page?.total.toLocaleString() ?? '…'} assets</div>
    <div className="asset-grid">{page?.assets.map(a => <Thumbnail key={a.id} asset={a} onSelect={() => { setSelected(a); viewStore.setState({ selectedPackAssetId: a.id }); }} />)}</div>
    {page?.total === 0 && <p>Register an image folder in Settings, then refresh here.</p>}
    <div><button disabled={offset === 0} onClick={() => setOffset(n => Math.max(0,n-100))}>Previous</button>{' '}
      {page && page.total > 0 && `${offset + 1}–${Math.min(offset + 100,page.total)}`}{' '}
      <button disabled={!page || offset + 100 >= page.total} onClick={() => setOffset(n => n+100)}>Next</button></div>
    {selected && <div>{selected.name} · {selected.width} × {selected.height} px · {selected.pxPerSquare} px/square</div>}
    {selected && <div className="asset-actions">
      <button onClick={() => viewStore.getState().setActiveTool('prop')}>Stamp on map</button>
      <label>Scale <input aria-label="Prop scale" type="number" min="0.01" step="0.1" value={propScale} onChange={e => { const v = Number(e.target.value); if (v > 0) viewStore.setState({ propScale: v }); }} /></label>
      <label>Rotation ° <input aria-label="Prop rotation" type="number" value={propRotation} onChange={e => viewStore.setState({ propRotation: Number(e.target.value) })} /></label>
      <label><input type="checkbox" checked={propFlipX} onChange={e => viewStore.setState({ propFlipX: e.target.checked })} />Flip</label>
      <button onClick={() => void applyTexture()}>Texture selection</button>
      <button onClick={() => void applyTexture(true)}>Clear texture</button>
    </div>}
    {assetError && <div role="alert">{assetError}</div>}
  </div>;
}
