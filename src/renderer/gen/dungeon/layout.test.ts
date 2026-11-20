import { describe, expect, it } from 'vitest';
import { EntitySchema, MapDocSchema, type Entity, type Point } from '../../model/schema';
import { distanceToSegment, pointInPolygon } from '../../geom/hitTest';
import { auditDungeonTopology } from './audit';
import { dungeonLayout, generateDungeon, DungeonParamsSchema } from './layout';

const region=[[{x:0,y:0},{x:30,y:0},{x:30,y:24},{x:0,y:24}]];
function reachable(entities: Entity[], rings: Point[][]) {
  const floors=entities.filter((e):e is Extract<Entity,{type:'area'}>=>e.type==='area'&&e.role==='floor');
  const walls=entities.filter((e):e is Extract<Entity,{type:'wall'}>=>e.type==='wall');
  const doors=entities.filter((e):e is Extract<Entity,{type:'door'}>=>e.type==='door');
  const cells=new Map<string,Point>();
  for(let y=0.5;y<24;y++) for(let x=0.5;x<30;x++) if(floors.some(f=>pointInPolygon({x,y},f.rings))) cells.set(`${x},${y}`,{x,y});
  const entrance=doors.find(d=>rings.some(r=>r.some((p,i)=>distanceToSegment({x:(d.a.x+d.b.x)/2,y:(d.a.y+d.b.y)/2},p,r[(i+1)%r.length]!)<0.01)));
  expect(entrance,'has an exterior entrance').toBeDefined();
  const mid={x:(entrance!.a.x+entrance!.b.x)/2,y:(entrance!.a.y+entrance!.b.y)/2};
  const start=[...cells.values()].sort((a,b)=>Math.hypot(a.x-mid.x,a.y-mid.y)-Math.hypot(b.x-mid.x,b.y-mid.y))[0]!;
  const queue=[start], seen=new Set([`${start.x},${start.y}`]);
  for(let i=0;i<queue.length;i++) for(const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const a=queue[i]!, n=cells.get(`${a.x+dx!},${a.y+dy!}`); if(!n||seen.has(`${n.x},${n.y}`)) continue;
    const p={x:(a.x+n.x)/2,y:(a.y+n.y)/2};
    if(walls.some(w=>w.points.slice(1).some((b,j)=>distanceToSegment(p,w.points[j]!,b)<0.01)) && !doors.some(d=>distanceToSegment(p,d.a,d.b)<0.01)) continue;
    seen.add(`${n.x},${n.y}`);queue.push(n);
  }
  for(const floor of floors) expect([...seen].some(k=>pointInPolygon(cells.get(k)!,floor.rings)),floor.id).toBe(true);
  expect(seen.size).toBe(cells.size);
}

describe('dungeon layouts', () => {
  it('defaults to ten feet and maintains two-square floor clearance through corridor bends',()=>{
    const params=DungeonParamsSchema.parse({mode:'dungeon',density:0});expect(params.corridorWidth).toBe(2);
    for(const seed of [2,7,11]){
      const g=1.524,shape=[[{x:0,y:0},{x:45.72,y:0},{x:45.72,y:36.576},{x:0,y:36.576}]];
      const result=generateDungeon({seed,params,region:shape,constraints:[],theme:{},grid:g});
      const floors=result.filter((e):e is Extract<Entity,{type:'area'}>=>e.type==='area'&&e.role==='floor');
      const onFloor=(x:number,y:number)=>floors.some(e=>pointInPolygon({x:(x+.5)*g,y:(y+.5)*g},e.rings));
      for(let y=0;y<24;y++)for(let x=0;x<30;x++)if(floors.some(e=>e.name==='Corridor'&&pointInPolygon({x:(x+.5)*g,y:(y+.5)*g},e.rings))){
        expect([-1,0].some(dx=>[-1,0].some(dy=>[0,1].every(a=>[0,1].every(b=>onFloor(x+dx+a,y+dy+b)))))).toBe(true);
      }
      expect(floors.filter(f=>f.name!=='Corridor').every(f=>!!f.roomPurpose)).toBe(true);
    }
  });
  it('mirrors the layout left/right without moving the footprint',()=>{
    const input={seed:5,params:DungeonParamsSchema.parse({mode:'dungeon'}),region,constraints:[],theme:{},grid:1};
    const normal=dungeonLayout(input), mirrored=dungeonLayout({...input,params:{...input.params,mirror:true}});
    const floorPoints=(items:Entity[])=>items.filter((e):e is Extract<Entity,{type:'area'}>=>e.type==='area').flatMap(e=>e.rings.flat()).map(p=>`${p.x},${p.y}`).sort();
    const reflected=normal.map(e=>e.type==='area'?{...e,rings:e.rings.map(r=>r.map(p=>({x:30-p.x,y:p.y})))}:e);
    expect(floorPoints(mirrored)).toEqual(floorPoints(reflected));
  });
  for(const mode of ['building','dungeon','chamber','cave'] as const) it(`${mode} is deterministic and every room is reachable from an entrance`, () => {
    for(let seed=1;seed<=8;seed++) {
      const input={seed,params:DungeonParamsSchema.parse({mode}),region,constraints:[],theme:{},grid:1};
      const result=dungeonLayout(input);
      expect(result).toEqual(dungeonLayout(input));
      expect(result.every(e=>EntitySchema.safeParse(e).success&&e.origin==='generated')).toBe(true);
      reachable(result,region);
    }
  });
  it('keeps holes empty, follows diagonal footprint walls, and rejects disconnected footprints', () => {
    const shape=[[{x:0,y:0},{x:30,y:0},{x:22,y:24},{x:0,y:24}], [{x:5,y:5},{x:8,y:5},{x:8,y:8},{x:5,y:8}]];
    const result=dungeonLayout({seed:2,params:DungeonParamsSchema.parse({mode:'building'}),region:shape,constraints:[],theme:{},grid:1});
    expect(result.filter(e=>e.type==='area').every(e=>!pointInPolygon({x:6,y:6},e.rings))).toBe(true);
    expect(result.some(e=>e.type==='wall'&&e.points[0]!.x!==e.points[1]!.x&&e.points[0]!.y!==e.points[1]!.y)).toBe(true);
    reachable(result,shape);
    expect(()=>dungeonLayout({seed:1,params:DungeonParamsSchema.parse({}),region:[region[0]!,[{x:14,y:-1},{x:16,y:-1},{x:16,y:25},{x:14,y:25}]],constraints:[],theme:{},grid:1})).toThrow('disconnected');
  });
  it('builds around manual walls and uses their door without modifying them', () => {
    const constraints:Entity[]=[{id:'w',type:'wall',origin:'manual',layerId:'base',rev:3,points:[{x:15,y:0},{x:15,y:24}],blocksMove:true,blocksSight:true},
      {id:'d',type:'door',origin:'manual',layerId:'base',rev:4,a:{x:15,y:11},b:{x:15,y:12},kind:'door',open:false}];
    const snapshot=structuredClone(constraints);
    const result=dungeonLayout({seed:1,params:DungeonParamsSchema.parse({}),region,constraints,theme:{},grid:1});
    expect(constraints).toEqual(snapshot);
    reachable([...result,...constraints],region);
    expect(()=>dungeonLayout({seed:1,params:DungeonParamsSchema.parse({}),region,constraints:constraints.slice(0,1),theme:{},grid:1})).toThrow('manual wall seals');
  });
  it('injects flanking loops in building mode instead of a pure spanning tree', () => {
    const result=dungeonLayout({seed:4,params:DungeonParamsSchema.parse({mode:'building',rooms:8}),region,constraints:[],theme:{},grid:1});
    const floors=result.filter(e=>e.type==='area'&&e.role==='floor');
    const doors=result.filter(e=>e.type==='door');
    // 1 exterior entrance + (rooms - 1) tree doors + at least 1 loop door => doors.length > floors.length
    expect(doors.length).toBeGreaterThan(floors.length);
  });
  it('generates curved terrain walls in cave mode and honors blueprint keepouts', () => {
    const blueprintKeepout: Entity = {
      id: 'bp-pillar',
      type: 'area',
      role: 'plateau',
      usage: 'blueprint',
      origin: 'manual',
      layerId: 'base',
      rev: 0,
      rings: [[{ x: 13, y: 9 }, { x: 17, y: 9 }, { x: 17, y: 14 }, { x: 13, y: 14 }]],
    };
    const cave = dungeonLayout({
      seed: 11,
      params: DungeonParamsSchema.parse({ mode: 'cave', rooms: 5 }),
      region,
      constraints: [blueprintKeepout],
      theme: {},
      grid: 1,
    });
    const curvedWall = cave.find((e) => e.type === 'wall' && e.wallKind === 'terrain' && e.points.length > 4);
    expect(curvedWall).toBeDefined();
    expect(
      cave.filter((e): e is Extract<Entity, { type: 'area' }> => e.type === 'area' && e.role === 'floor').every((e) => !pointInPolygon({ x: 15, y: 11.5 }, e.rings)),
    ).toBe(true);
  });
  it('audits loops and single-secret choke risks', () => {
    const base = { origin: 'manual' as const, layerId: 'base', rev: 0 };
    const map = MapDocSchema.parse({
      id: 'crypt',
      name: 'Crypt',
      kind: 'site',
      bounds: { x: 0, y: 0, w: 30, h: 20 },
      grid: { size: 1, visible: true },
      layers: [{ id: 'base', name: 'Base', visible: true, locked: false, gmOnly: false }],
      entities: {
        r1: { ...base, id: 'r1', type: 'area', role: 'floor', name: 'Entry', rings: [[{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }]] },
        r2: { ...base, id: 'r2', type: 'area', role: 'floor', name: 'Sanctum', rings: [[{ x: 10, y: 0 }, { x: 20, y: 0 }, { x: 20, y: 10 }, { x: 10, y: 10 }]] },
        sec: { ...base, id: 'sec', type: 'door', name: 'Hidden Panel', a: { x: 10, y: 3 }, b: { x: 10, y: 7 }, kind: 'secret', open: false },
      },
      generators: {},
      revision: 1,
      deleted: {},
      fog: { enabled: false, revealed: [] },
    });
    const audit = auditDungeonTopology(map);
    expect(audit.singleSecretChokes).toEqual(['Hidden Panel']);
    expect(audit.sevenPillars).toHaveLength(7);
    expect(audit.sevenPillars.find((p) => p.id === 'secrets')?.passed).toBe(false);
    expect(audit.fakeForks).toEqual([]);
    expect(audit.threeClueCount).toBe(0);
    expect(audit.stockingCounts.Empty).toBe(0);

    // Verify generated dungeons emit Moldvay room Place records and at least one vertical portal.
    const gen = generateDungeon({
      seed: 19,
      params: DungeonParamsSchema.parse({ mode: 'dungeon', rooms: 8, density: 1 }),
      region: [[{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }, { x: 0, y: 60 }]],
      grid: 2,
      theme: {},
      constraints: [],
    });
    expect(gen.some((e) => e.type === 'place' && e.stockingRole !== undefined)).toBe(true);
    expect(gen.some((e) => e.type === 'portal')).toBe(true);

    // Verify auditDungeonTopology reports new oneWayValves, windowPeeks, and factionCount metrics.
    const genMap = MapDocSchema.parse({
      id: 'gen-audit',
      name: 'Audit Crypt',
      kind: 'site',
      bounds: { x: 0, y: 0, w: 60, h: 60 },
      grid: { size: 2, visible: true },
      layers: [{ id: 'base', name: 'Base', visible: true, locked: false, gmOnly: false }],
      entities: Object.fromEntries(gen.map((e) => [e.id, e])),
      generators: {},
      revision: 1,
      deleted: {},
      fog: { enabled: false, revealed: [] },
    });
    const genAudit = auditDungeonTopology(genMap);
    expect(genAudit.factionCount).toBeGreaterThanOrEqual(2);
    expect(genAudit.oneWayValves).toBeGreaterThanOrEqual(0);
    expect(genAudit.windowPeeks).toBeGreaterThanOrEqual(0);

    // Window peek grates appear across seeded multi-room stone dungeons with sight unobstructed.
    const peekWall = [11, 19, 27, 33, 45].flatMap((seed) =>
      generateDungeon({
        seed,
        params: DungeonParamsSchema.parse({ mode: 'dungeon', rooms: 12, purpose: 'crypt', density: 1 }),
        region: [[{ x: 0, y: 0 }, { x: 60, y: 0 }, { x: 60, y: 60 }, { x: 0, y: 60 }]],
        grid: 2,
        theme: {},
        constraints: [],
      }),
    ).find((e): e is Extract<Entity, { type: 'wall' }> => e.type === 'wall' && e.wallKind === 'window');
    expect(peekWall).toBeDefined();
    expect(peekWall?.blocksMove).toBe(true);
    expect(peekWall?.blocksSight).toBe(false);
  });
});
