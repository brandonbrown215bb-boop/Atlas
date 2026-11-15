import { expect, it } from 'vitest';
import { Delaunay } from 'd3-delaunay';
import { rectRing } from '../../geom/fog';
import { buildTerrain, TerrainParamsSchema } from './terrain';
import { buildClimate } from './climate';
import { buildRivers, riverEntities } from './rivers';

it('accumulates flow downhill and rounds river bends without crossing higher cells', () => {
  for (const seed of [2, 9, 21]) {
    const input = { seed, params: TerrainParamsSchema.parse({ cells: 1500 }), region: [rectRing({ x: 0, y: 0, w: 1000000, h: 800000 })], constraints: [], theme: {}, grid: 100 };
    const terrain = buildTerrain(input), climate = buildClimate(terrain, input);
    const delaunay = Delaunay.from(terrain.cells.map(c => [c.point.x, c.point.y]));
    const rain = climate.values.map(v => v.moisture), rivers = buildRivers(terrain, rain, 5);
    expect(rivers.length).toBeGreaterThan(0);
    expect(rivers).toEqual(buildRivers(terrain, rain, 5));
    for (const river of rivers) {
      for (let i = 1; i < river.cells.length; i++) expect(terrain.cells[river.cells[i]!]!.elevation).toBeLessThan(terrain.cells[river.cells[i - 1]!]!.elevation);
      for (let i = 1; i < river.elevations.length; i++) expect(river.elevations[i]).toBeLessThanOrEqual(river.elevations[i - 1]!);
      let previous = Infinity;
      for (let i = 1; i < river.points.length; i++) for (let t = .1; t <= 1; t += .2) {
        const a = river.points[i - 1]!, b = river.points[i]!, p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        const nearest = terrain.cells[delaunay.find(p.x, p.y)]!;
        expect(nearest.elevation).toBeLessThanOrEqual(previous + 1e-8); previous = nearest.elevation;
      }
    }
    expect(riverEntities(terrain, rivers).length).toBeGreaterThan(0);
    expect(buildRivers(terrain, rain, 100000)).toEqual([]);
  }
});

it('every drainage chain reaches water or the boundary and every confluence is exact',()=>{
  for(const seed of [1,11,28]){
    const input={seed,params:TerrainParamsSchema.parse({cells:450}),region:[rectRing({x:-400000,y:-250000,w:839000,h:558000})],constraints:[],theme:{},grid:100};
    const t=buildTerrain(input),routes=buildRivers(t,t.cells.map(()=>.7),3);
    for(let i=0;i<t.cells.length;i++){
      const seen=new Set<number>();let at=i;
      while(t.cells[at]!.downstream!>=0){expect(seen.has(at)).toBe(false);seen.add(at);at=t.cells[at]!.downstream!;}
      const c=t.cells[at]!;
      expect(!c.land||c.ring.some(p=>p.x<1e-9||p.y<1e-9||p.x>=1-1e-9||p.y>=558/839-1e-9)).toBe(true);
    }
    for(const route of routes){
      const last=route.cells[route.cells.length-1]!,downstream=routes.find(r=>r.cells[0]===last);
      if(downstream)expect(route.points[route.points.length-1]).toEqual(downstream.points[0]);
    }
  }
});
