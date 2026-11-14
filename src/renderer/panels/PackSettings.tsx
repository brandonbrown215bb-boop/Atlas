import { useEffect, useState } from 'react';
import type { Pack, PackProgress } from '../model/packs';

export function PackSettings() {
  const [packs, setPacks] = useState<Pack[]>([]);
  const [progress, setProgress] = useState<PackProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    void window.atlasApi.listPacks().then(setPacks).catch(e => setError(String(e)));
    return window.atlasApi.onPackProgress(setProgress);
  }, []);
  const register = async (root?: string) => {
    setError('');
    try {
      root ??= await window.atlasApi.pickFolder('Register Asset Folder') ?? undefined;
      if (!root) return;
      setBusy(true); setProgress(null);
      setPacks(await window.atlasApi.registerPack(root));
    } catch (e) { setError(String(e)); }
    finally { setBusy(false); }
  };
  return <section style={{ padding: 12, borderTop: '1px solid var(--atlas-border)' }}>
    <strong>Asset folders</strong>{' '}
    <button disabled={busy} onClick={() => void register()}>Register folder</button>
    {busy && <div role="status">Indexing… {progress?.indexed ?? 0} images ({progress?.scanned ?? 0} checked)</div>}
    {error && <div role="alert">{error}</div>}
    {packs.map(p => <div key={p.id} style={{ marginTop: 10 }}>
      <div title={p.root}>{p.name} — {p.assets.length.toLocaleString()} images{p.skipped > 0 && `, ${p.skipped} unreadable`}</div>
      <label>Pixels per square <input aria-label={`${p.name} pixels per square`} type="number" min="1" defaultValue={p.pxPerSquare}
        onBlur={e => { void window.atlasApi.setPackScale(p.id, Number(e.target.value)).then(setPacks).catch(e => setError(String(e))); }} /></label>{' '}
      <button disabled={busy} onClick={() => void register(p.root)}>Reindex</button>
    </div>)}
  </section>;
}
