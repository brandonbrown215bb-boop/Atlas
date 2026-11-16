import { validateAuthoredRivers } from './manualRivers';
import { drainTerrain } from './drainage';
import { bboxFromPoints } from '../../geom/hitTest';
import { z } from 'zod';
import { registerGenerator, type GeneratorInput } from '../framework';
import { buildTerrain, TerrainParamsSchema, terrainEntities } from './terrain';
import { buildClimate } from './climate';
import { buildRivers, riverEntities } from './rivers';
import { decorateWorld } from './decoration';

export const WorldParamsSchema = TerrainParamsSchema.extend({
  rivers: z.boolean().default(true),
  riverThreshold: z.number().min(2).max(200).default(12),
  density: z.number().min(0).max(3).default(1),
  settlements: z.number().int().min(0).max(50).default(12),
  renderSeed: z.number().int().optional(),
});
export type WorldParams = z.infer<typeof WorldParamsSchema>;
export function generateWorld(input: GeneratorInput<WorldParams>) {
  if(input.params.mode==='populate')validateAuthoredRivers(input.constraints);
  const terrain = buildTerrain(input);
  if (input.params.rivers) drainTerrain(terrain).forEach((next, i) => { terrain.cells[i]!.downstream = next; });
  const climate = buildClimate(terrain, input);
  // A populated region already has the world's rivers; only its larger streams are worth adding on top.
  const riverThreshold = input.params.riverThreshold * (input.mapKind === 'region' && input.params.mode === 'populate' ? 3 : 1);
  const rivers = input.params.rivers ? riverEntities(terrain, buildRivers(terrain, climate.values.map(v => v.moisture), riverThreshold), input.constraints) : [];
  const box=bboxFromPoints(input.region[0]!)!,x=box.minX,y=box.minY;
  input.terrainResult={algorithmVersion:input.params.algorithmVersion,seed:input.seed,bounds:{x,y,w:box.maxX-x,h:box.maxY-y},plates:terrain.plates??[],cells:terrain.cells.map(c=>({...c.point,elevation:c.elevation,land:c.land,plate:c.plate??0,downstream:c.downstream}))};
  return [...terrainEntities(terrain).filter(e=>input.params.mode!=='populate'||e.type==='area'&&e.role==='water'), ...climate.entities, ...rivers, ...decorateWorld(terrain, climate.values, input, rivers)];
}
registerGenerator({ type: 'world', title: 'World / continent', params: WorldParamsSchema, generate: generateWorld });
