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
});
export type WorldParams = z.infer<typeof WorldParamsSchema>;
export function generateWorld(input: GeneratorInput<WorldParams>) {
  const terrain = buildTerrain(input), climate = buildClimate(terrain, input);
  const rivers = input.params.rivers ? riverEntities(terrain, buildRivers(terrain, climate.values.map(v => v.moisture), input.params.riverThreshold)) : [];
  return [...terrainEntities(terrain), ...climate.entities, ...rivers, ...decorateWorld(terrain, climate.values, input, rivers)];
}
registerGenerator({ type: 'world', title: 'World / continent', params: WorldParamsSchema, generate: generateWorld });
