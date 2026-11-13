import type { Entity, Point } from '../model/schema';

export function rotatePoint(pt: Point, pivot: Point, angleRad: number): Point {
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const dx = pt.x - pivot.x;
  const dy = pt.y - pivot.y;
  return {
    x: pivot.x + dx * cos - dy * sin,
    y: pivot.y + dx * sin + dy * cos,
  };
}

export function scalePoint(
  pt: Point,
  pivot: Point,
  sx: number,
  sy: number,
): Point {
  return {
    x: pivot.x + (pt.x - pivot.x) * sx,
    y: pivot.y + (pt.y - pivot.y) * sy,
  };
}

export function translateEntityPatch(
  entity: Entity,
  dx: number,
  dy: number,
): Record<string, unknown> {
  switch (entity.type) {
    case 'image':
    case 'prop':
    case 'light':
    case 'label':
    case 'portal':
      return { x: entity.x + dx, y: entity.y + dy };
    case 'area':
      return {
        rings: entity.rings.map((ring) =>
          ring.map((p) => ({ x: p.x + dx, y: p.y + dy })),
        ),
      };
    case 'path':
    case 'wall':
      return {
        points: entity.points.map((p) => ({ x: p.x + dx, y: p.y + dy })),
      };
    case 'door':
      return {
        a: { x: entity.a.x + dx, y: entity.a.y + dy },
        b: { x: entity.b.x + dx, y: entity.b.y + dy },
      };
    case 'place':
      return {};
  }
}

export function rotateEntityPatch(
  entity: Entity,
  pivot: Point,
  angleRad: number,
): Record<string, unknown> {
  switch (entity.type) {
    case 'image':
    case 'prop': {
      const pos = rotatePoint({ x: entity.x, y: entity.y }, pivot, angleRad);
      return {
        x: pos.x,
        y: pos.y,
        rotation: entity.rotation + angleRad,
      };
    }
    case 'light':
    case 'label':
    case 'portal': {
      const pos = rotatePoint({ x: entity.x, y: entity.y }, pivot, angleRad);
      return { x: pos.x, y: pos.y };
    }
    case 'area':
      return {
        rings: entity.rings.map((ring) =>
          ring.map((p) => rotatePoint(p, pivot, angleRad)),
        ),
      };
    case 'path':
    case 'wall':
      return {
        points: entity.points.map((p) => rotatePoint(p, pivot, angleRad)),
      };
    case 'door':
      return {
        a: rotatePoint(entity.a, pivot, angleRad),
        b: rotatePoint(entity.b, pivot, angleRad),
      };
    case 'place':
      return {};
  }
}

export function scaleEntityPatch(
  entity: Entity,
  pivot: Point,
  sx: number,
  sy: number,
): Record<string, unknown> {
  const avgScale = (Math.abs(sx) + Math.abs(sy)) / 2;
  switch (entity.type) {
    case 'image': {
      const pos = scalePoint({ x: entity.x, y: entity.y }, pivot, sx, sy);
      return {
        x: pos.x,
        y: pos.y,
        w: Math.max(0.05, entity.w * Math.abs(sx)),
        h: Math.max(0.05, entity.h * Math.abs(sy)),
      };
    }
    case 'prop': {
      const pos = scalePoint({ x: entity.x, y: entity.y }, pivot, sx, sy);
      return {
        x: pos.x,
        y: pos.y,
        scale: Math.max(0.05, entity.scale * avgScale),
      };
    }
    case 'light': {
      const pos = scalePoint({ x: entity.x, y: entity.y }, pivot, sx, sy);
      return {
        x: pos.x,
        y: pos.y,
        radius: Math.max(0.05, entity.radius * avgScale),
      };
    }
    case 'label': {
      const pos = scalePoint({ x: entity.x, y: entity.y }, pivot, sx, sy);
      return {
        x: pos.x,
        y: pos.y,
        size: Math.max(1, entity.size * avgScale),
      };
    }
    case 'portal': {
      const pos = scalePoint({ x: entity.x, y: entity.y }, pivot, sx, sy);
      return { x: pos.x, y: pos.y };
    }
    case 'area':
      return {
        rings: entity.rings.map((ring) =>
          ring.map((p) => scalePoint(p, pivot, sx, sy)),
        ),
      };
    case 'path':
      return {
        points: entity.points.map((p) => scalePoint(p, pivot, sx, sy)),
        width: Math.max(0.05, entity.width * avgScale),
      };
    case 'wall':
      return {
        points: entity.points.map((p) => scalePoint(p, pivot, sx, sy)),
      };
    case 'door':
      return {
        a: scalePoint(entity.a, pivot, sx, sy),
        b: scalePoint(entity.b, pivot, sx, sy),
      };
    case 'place':
      return {};
  }
}

export function applyEntityPatch(
  entity: Entity,
  patch: Record<string, unknown>,
): Entity {
  return {
    ...entity,
    ...patch,
    id: entity.id,
    type: entity.type,
    origin: 'manual',
  } as Entity;
}
