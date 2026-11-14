import { describe, expect, it } from 'vitest';
import { createWorldStore } from './store';
import { THEME_ROLES, themeAssets } from './themes';

describe('world themes',()=>{
  it('provides flat placeholders for every standard and custom role',()=>{
    for(const role of [...THEME_ROLES,'custom statue']) expect(themeAssets({},role)).toEqual([`builtin:${role}`]);
    expect(themeAssets({tree:[]},'tree')).toEqual(['builtin:tree']);
    expect(themeAssets({tree:['oak','pine']},'tree')).toEqual(['oak','pine']);
  });
  it('keeps assignments in world metadata with undo and redo',()=>{
    const s=createWorldStore();
    s.getState().loadWorld({formatVersion:1,id:'w',name:'Test',maps:[],themes:{}},{});
    s.getState().execute('theme.setRole',{themeName:'Forest',role:'tree',assetIds:['oak','oak','pine']});
    expect(s.getState().world!.meta.themes.Forest!.tree).toEqual(['oak','pine']);
    expect(s.getState().dirtyWorld).toBe(true);
    s.getState().undo();expect(s.getState().world!.meta.themes).toEqual({});
    s.getState().redo();expect(s.getState().world!.meta.themes.Forest!.tree).toEqual(['oak','pine']);
  });
});
