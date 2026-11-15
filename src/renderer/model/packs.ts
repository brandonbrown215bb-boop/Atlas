import { z } from 'zod';

export const PackAssetSchema = z.object({
  id: z.string(), relativePath: z.string(), name: z.string(), tags: z.array(z.string()),
  themes: z.array(z.string()).default([]),
  biomes: z.array(z.string()).default([]),
  purposes: z.array(z.string()).default([]),
  size: z.number().nonnegative(), mtimeMs: z.number(),
  width: z.number().positive().int(), height: z.number().positive().int(),
});
export const PackSchema = z.object({
  id: z.string(), name: z.string(), root: z.string(),
  pxPerSquare: z.number().positive().finite(), assets: z.array(PackAssetSchema),
  skipped: z.number().nonnegative().int().default(0),
  tagVersion: z.number().int().nonnegative().default(0),
});
export const PacksSchema = z.array(PackSchema);
export type PackAsset = z.infer<typeof PackAssetSchema>;
export type Pack = z.infer<typeof PackSchema>;
export interface PackProgress { scanned: number; indexed: number; path: string }
export interface AssetQuery {
  query?: string; tag?: string;
  theme?: string; biome?: string; purpose?: string;
  packId?: string; folder?: string; offset?: number;
}
export interface AssetResult extends PackAsset { packId: string; packName: string; pxPerSquare: number }
export interface AssetFacetCount { value: string; count: number }
export interface AssetFacets {
  themes: AssetFacetCount[];
  biomes: AssetFacetCount[];
  purposes: AssetFacetCount[];
  untagged: { theme: number; biome: number; purpose: number };
}
export interface AssetPage {
  total: number; assets: AssetResult[]; folders: string[];
  packs: Array<{ id: string; name: string; count: number }>;
  facets?: AssetFacets;
}
