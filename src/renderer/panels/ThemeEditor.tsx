import { useState } from 'react';
import { useStore } from 'zustand';
import { worldStore } from '../model/store';
import { viewStore } from '../model/viewStore';
import { themeRoles } from '../model/themes';
import { executeAssetCommands } from '../assets/commands';

export function ThemeEditor() {
  const world = useStore(worldStore,s=>s.world);
  const selected = useStore(viewStore,s=>s.selectedPackAssetId);
  const builtin = useStore(viewStore,s=>s.selectedBuiltin);
  const index = useStore(viewStore,s=>s.assetsIndex);
  const [name,setName]=useState('default');
  const [role,setRole]=useState('tree');
  const [customRole,setCustomRole]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const [status,setStatus]=useState('');
  if (!world) return <p>Open a world to edit its themes.</p>;
  const theme=world.meta.themes[name] ?? {};
  const roles=themeRoles(theme);
  if (!roles.includes(role)) roles.push(role);
  const assets=theme[role] ?? [];
  const assign = async () => {
    if (!selected && !builtin) return;
    setBusy(true); setError('');
    try { await executeAssetCommands([{name:'theme.setRole',input:{themeName:name,role,assetIds:builtin ? [...assets,`builtin:${builtin}`] : assets,packAssetIds:selected ? [selected] : []}}]); }
    catch(e) { setError(String(e)); }
    finally {setBusy(false);}
  };
  const remove = (id:string) => {
    try { worldStore.getState().execute('theme.setRole',{themeName:name,role,assetIds:assets.filter(a=>a!==id)}); setError(''); }
    catch(e) {setError(String(e));}
  };
  const addLibraryArt = async () => {
    const themeName = name.trim();
    const worldId = world.meta.id;
    const worldPath = worldStore.getState().worldPath;
    setName(themeName);
    setBusy(true);
    setError('');
    setStatus('');
    try {
      const picks = Object.entries(await window.atlasApi.libraryArt());
      const { world: current, worldPath: currentPath } = worldStore.getState();
      if (current?.meta.id !== worldId || worldPath !== currentPath) throw new Error('The open world changed.');
      if (!picks.length) throw new Error('No matching artwork in the registered packs.');
      const calls = picks.filter(([role]) => !current.meta.themes[themeName]?.[role]?.length)
        .map(([role, packAssetIds]) => ({ name: 'theme.setRole',
          input: { themeName, role, packAssetIds, onlyIfEmpty: true } }));
      if (!calls.length) {
        setStatus(`Library art is already assigned in ${themeName}.`);
        return;
      }
      await executeAssetCommands(calls, 'Add library art');
      setStatus(`Added library art for ${calls.length} roles in ${themeName}.`);
    } catch (error) {
      setError(String(error));
    } finally {
      setBusy(false);
    }
  };
  return <section className="theme-editor" data-testid="theme-editor">
    <strong>World theme</strong>
    <label>Theme <input aria-label="Theme name" list="atlas-theme-names" value={name} onChange={e=>setName(e.target.value)} onBlur={()=>{if(!name.trim())setName('default');}} /></label>
    <datalist id="atlas-theme-names">{Object.keys(world.meta.themes).map(n=><option key={n} value={n}/>)}</datalist>
    <label>Role <select aria-label="Theme role" value={role} onChange={e=>setRole(e.target.value)}>{roles.map(r=><option key={r}>{r}</option>)}</select></label>
    <div><input aria-label="Custom theme role" placeholder="Custom role" value={customRole} onChange={e=>setCustomRole(e.target.value)} />{' '}
      <button disabled={!customRole.trim()} onClick={()=>{setRole(customRole.trim());setCustomRole('');}}>Use role</button></div>
    <button disabled={(!selected && !builtin) || !name.trim() || busy} onClick={()=>void assign()}>Add selected asset to role</button>
    <button disabled={!name.trim() || busy} onClick={()=>void addLibraryArt()}>Fill empty roles from library</button>
    {assets.length===0 ? <p data-testid="theme-placeholder">Built-in flat placeholder: {role}</p> : <ul>{assets.map(id=><li key={id}>
      {index[id]?.originalName ?? id}{' '}<button aria-label={`Remove ${index[id]?.originalName ?? id} from role`} disabled={busy} onClick={()=>remove(id)}>Remove</button>
    </li>)}</ul>}
    {error && <div role="alert">{error}</div>}
    {status && <div role="status">{status}</div>}
  </section>;
}
