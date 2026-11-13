import { z } from 'zod';
import { translateEntityPatch } from '../geom/transform';
import {
  EntitySchema,
  LayerSchema,
  MapDocSchema,
  MapKindSchema,
  type Entity,
  type Layer,
  type MapDoc,
  type WorldMeta,
} from './schema';

export interface WorldDocument {
  meta: WorldMeta;
  maps: Record<string, MapDoc>;
}

export interface CommandDef<TInput = unknown, TResult = unknown> {
  name: string;
  description: string;
  input: z.ZodType<TInput>;
  run: (draft: WorldDocument, input: TInput) => TResult;
}

const registry = new Map<string, CommandDef<any, any>>();

export function registerCommand<TInput, TResult>(
  def: CommandDef<TInput, TResult>,
): CommandDef<TInput, TResult> {
  registry.set(def.name, def);
  return def;
}

export function getCommand(name: string): CommandDef | undefined {
  return registry.get(name);
}

export function listCommands(): Array<{
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}> {
  return Array.from(registry.values()).map((cmd) => ({
    name: cmd.name,
    description: cmd.description,
    inputSchema: z.toJSONSchema(cmd.input) as Record<string, unknown>,
  }));
}

export function executeCommandOnDraft(
  draft: WorldDocument,
  name: string,
  rawInput: unknown,
): unknown {
  const cmd = registry.get(name);
  if (!cmd) {
    throw new Error(`Unknown command: ${name}`);
  }
  const parsed = cmd.input.parse(rawInput);
  return cmd.run(draft, parsed);
}

function getMapOrThrow(draft: WorldDocument, mapId: string): MapDoc {
  const map = draft.maps[mapId];
  if (!map) {
    throw new Error(`Map not found: ${mapId}`);
  }
  return map;
}

// --- Core Entity Commands ---

const EntityAddInputSchema = z.object({
  mapId: z.string().min(1),
  entity: EntitySchema,
});

registerCommand({
  name: 'entity.add',
  description: 'Add a new entity to a map.',
  input: EntityAddInputSchema,
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId);
    if (map.entities[input.entity.id]) {
      throw new Error(`Entity already exists: ${input.entity.id}`);
    }
    map.revision += 1;
    const entity: Entity = {
      ...input.entity,
      rev: map.revision,
    };
    map.entities[entity.id] = entity;
    delete map.deleted[entity.id];
    return { id: entity.id };
  },
});

const EntityUpdateInputSchema = z.object({
  mapId: z.string().min(1),
  entityId: z.string().min(1),
  patch: z.record(z.string(), z.unknown()),
});

registerCommand({
  name: 'entity.update',
  description: 'Update fields on an existing entity. Marks generated/inherited entities as manual.',
  input: EntityUpdateInputSchema,
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId);
    const existing = map.entities[input.entityId];
    if (!existing) {
      throw new Error(`Entity not found: ${input.entityId}`);
    }
    map.revision += 1;
    const candidate = {
      ...existing,
      ...input.patch,
      id: existing.id,
      type: existing.type,
      origin: existing.origin === 'manual' ? 'manual' : 'manual',
      rev: map.revision,
    };
    const validated = EntitySchema.parse(candidate);
    map.entities[existing.id] = validated;
    return { id: validated.id };
  },
});

const EntityDeleteInputSchema = z.object({
  mapId: z.string().min(1),
  entityId: z.string().min(1),
});

registerCommand({
  name: 'entity.delete',
  description: 'Delete an entity from a map and record its deletion revision.',
  input: EntityDeleteInputSchema,
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId);
    if (!map.entities[input.entityId]) {
      throw new Error(`Entity not found: ${input.entityId}`);
    }
    map.revision += 1;
    delete map.entities[input.entityId];
    map.deleted[input.entityId] = map.revision;
    return { id: input.entityId };
  },
});

const EntityDuplicateInputSchema = z.object({
  mapId: z.string().min(1),
  entityIds: z.array(z.string().min(1)).min(1),
  dx: z.number().finite().default(1),
  dy: z.number().finite().default(1),
});

registerCommand({
  name: 'entity.duplicate',
  description: 'Duplicate one or more entities on a map with an optional offset.',
  input: EntityDuplicateInputSchema,
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId);
    const createdIds: string[] = [];
    map.revision += 1;
    for (const sourceId of input.entityIds) {
      const existing = map.entities[sourceId];
      if (!existing) {
        throw new Error(`Entity not found: ${sourceId}`);
      }
      const newId = crypto.randomUUID();
      const offsetPatch = translateEntityPatch(existing, input.dx, input.dy);
      const clone = EntitySchema.parse({
        ...existing,
        ...offsetPatch,
        id: newId,
        origin: 'manual',
        genId: undefined,
        inheritedFrom: undefined,
        rev: map.revision,
      });
      map.entities[newId] = clone;
      createdIds.push(newId);
    }
    return { ids: createdIds };
  },
});

// --- Layer Commands ---

const LayerAddInputSchema = z.object({
  mapId: z.string().min(1),
  layer: LayerSchema,
  index: z.number().int().nonnegative().optional(),
});

registerCommand({
  name: 'layer.add',
  description: 'Add a layer to a map.',
  input: LayerAddInputSchema,
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId);
    if (map.layers.some((l) => l.id === input.layer.id)) {
      throw new Error(`Layer already exists: ${input.layer.id}`);
    }
    map.revision += 1;
    const layer: Layer = { ...input.layer };
    if (input.index !== undefined && input.index <= map.layers.length) {
      map.layers.splice(input.index, 0, layer);
    } else {
      map.layers.push(layer);
    }
    return { id: layer.id };
  },
});

const LayerUpdateInputSchema = z.object({
  mapId: z.string().min(1),
  layerId: z.string().min(1),
  patch: LayerSchema.omit({ id: true }).partial(),
});

registerCommand({
  name: 'layer.update',
  description: 'Update layer visibility, lock, name, or gmOnly flag.',
  input: LayerUpdateInputSchema,
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId);
    const layer = map.layers.find((l) => l.id === input.layerId);
    if (!layer) {
      throw new Error(`Layer not found: ${input.layerId}`);
    }
    map.revision += 1;
    Object.assign(layer, input.patch);
    return { id: layer.id };
  },
});

const LayerDeleteInputSchema = z.object({
  mapId: z.string().min(1),
  layerId: z.string().min(1),
});

registerCommand({
  name: 'layer.delete',
  description: 'Delete a layer from a map.',
  input: LayerDeleteInputSchema,
  run(draft, input) {
    const map = getMapOrThrow(draft, input.mapId);
    const idx = map.layers.findIndex((l) => l.id === input.layerId);
    if (idx === -1) {
      throw new Error(`Layer not found: ${input.layerId}`);
    }
    if (map.layers.length <= 1) {
      throw new Error('Cannot delete the last layer of a map');
    }
    map.revision += 1;
    map.layers.splice(idx, 1);
    return { id: input.layerId };
  },
});

// --- Map Commands ---

const MapCreateInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: MapKindSchema,
  parentId: z.string().min(1).optional(),
  bounds: z
    .object({
      x: z.number().finite(),
      y: z.number().finite(),
      w: z.number().positive().finite(),
      h: z.number().positive().finite(),
    })
    .optional(),
  gridSize: z.number().positive().finite().optional(),
});

registerCommand({
  name: 'map.create',
  description: 'Create a new map in the world.',
  input: MapCreateInputSchema,
  run(draft, input) {
    if (draft.maps[input.id]) {
      throw new Error(`Map already exists: ${input.id}`);
    }
    const defaultGrid =
      input.kind === 'interior' || input.kind === 'site' ? 1.524 : 100;
    const map = MapDocSchema.parse({
      formatVersion: 1,
      id: input.id,
      name: input.name,
      kind: input.kind,
      parent: input.parentId
        ? { mapId: input.parentId, x: 0, y: 0, rotation: 0 }
        : undefined,
      bounds: input.bounds ?? { x: 0, y: 0, w: 1000, h: 1000 },
      grid: {
        size: input.gridSize ?? defaultGrid,
        visible: input.kind === 'interior' || input.kind === 'site',
      },
      layers: [
        {
          id: 'layer-base',
          name: 'Base',
          visible: true,
          locked: false,
          gmOnly: false,
        },
      ],
      entities: {},
      generators: {},
      revision: 1,
      deleted: {},
      fog: { enabled: false, revealed: [] },
    });
    draft.maps[map.id] = map;
    draft.meta.maps.push({
      id: map.id,
      name: map.name,
      kind: map.kind,
      parentId: input.parentId,
    });
    return { id: map.id };
  },
});

const ThemeSetRoleInputSchema = z.object({
  themeName: z.string().min(1).default('default'),
  role: z.string().min(1),
  assetIds: z.array(z.string().min(1)),
});

registerCommand({
  name: 'theme.setRole',
  description: 'Assign asset ids to a generator role in a world theme.',
  input: ThemeSetRoleInputSchema,
  run(draft, input) {
    const theme = (draft.meta.themes[input.themeName] ??= {});
    theme[input.role] = [...input.assetIds];
    return { themeName: input.themeName, role: input.role };
  },
});
