import { Container, Graphics, Sprite, Text, type Texture } from 'pixi.js';
import type { AreaRole, Entity, PathRole, Point } from '../model/schema';

function areaFillColor(role: AreaRole, customFill?: string): number {
  if (customFill && /^#[0-9a-fA-F]{6}$/.test(customFill)) {
    return Number.parseInt(customFill.slice(1), 16);
  }
  if (role === 'land') return 0x3b5249;
  if (role === 'water') return 0x1d4e89;
  if (role === 'plateau') return 0x6b5b4b;
  if (role === 'district') return 0x4a4e69;
  if (role === 'building') return 0x8d6e63;
  if (role === 'floor') return 0x52525b;
  return 0x4b6b50; // biome:*
}

function pathColor(role: PathRole): number {
  switch (role) {
    case 'road':
      return 0xc2b280;
    case 'river':
      return 0x2b7de9;
    case 'cliff':
      return 0x7a6a58;
    case 'cityWall':
      return 0x9ca3af;
    case 'trail':
      return 0xa1887f;
  }
}

function drawPolygonPath(gfx: Graphics, ring: readonly Point[], ox: number, oy: number): void {
  const first = ring[0];
  if (!first) return;
  gfx.moveTo(first.x - ox, first.y - oy);
  for (let i = 1; i < ring.length; i++) {
    const pt = ring[i]!;
    gfx.lineTo(pt.x - ox, pt.y - oy);
  }
  gfx.closePath();
}

function drawPolyline(
  gfx: Graphics,
  points: readonly Point[],
  ox: number,
  oy: number,
  closed: boolean,
): void {
  const first = points[0];
  if (!first) return;
  gfx.moveTo(first.x - ox, first.y - oy);
  for (let i = 1; i < points.length; i++) {
    const pt = points[i]!;
    gfx.lineTo(pt.x - ox, pt.y - oy);
  }
  if (closed) {
    gfx.closePath();
  }
}

export function buildEntityDisplay(
  entity: Entity,
  options: { selected: boolean; zoom: number; texture?: Texture },
): Container {
  const container = new Container();
  container.eventMode = 'none';
  const strokeUnit = Math.max(0.05, 1.5 / Math.max(0.0005, options.zoom));

  switch (entity.type) {
    case 'image': {
      container.position.set(entity.x, entity.y);
      container.rotation = entity.rotation;
      if (options.texture) {
        const sprite = new Sprite(options.texture);
        sprite.eventMode = 'none';
        sprite.width = entity.w;
        sprite.height = entity.h;
        container.addChild(sprite);
      } else {
        const gfx = new Graphics();
        gfx.eventMode = 'none';
        gfx.rect(0, 0, entity.w, entity.h).fill({ color: 0x22272e, alpha: 0.7 });
        container.addChild(gfx);
      }
      if (options.selected) {
        const outline = new Graphics();
        outline.eventMode = 'none';
        outline.rect(0, 0, entity.w, entity.h).stroke({
          width: strokeUnit * 2,
          color: 0xfbbf24,
        });
        container.addChild(outline);
      }
      break;
    }

    case 'area': {
      const origin = entity.rings[0]?.[0] ?? { x: 0, y: 0 };
      container.position.set(origin.x, origin.y);
      const gfx = new Graphics();
      gfx.eventMode = 'none';
      const outer = entity.rings[0];
      if (outer && outer.length >= 3) {
        drawPolygonPath(gfx, outer, origin.x, origin.y);
        gfx.fill({ color: areaFillColor(entity.role, entity.fill), alpha: 0.75 });
        for (let h = 1; h < entity.rings.length; h++) {
          const hole = entity.rings[h]!;
          if (hole.length >= 3) {
            drawPolygonPath(gfx, hole, origin.x, origin.y);
            gfx.cut();
          }
        }
        drawPolygonPath(gfx, outer, origin.x, origin.y);
        gfx.stroke({
          width: options.selected ? strokeUnit * 2 : strokeUnit,
          color: options.selected ? 0xfbbf24 : 0x111827,
          alpha: 0.85,
        });
      }
      container.addChild(gfx);
      break;
    }

    case 'path': {
      const origin = entity.points[0] ?? { x: 0, y: 0 };
      container.position.set(origin.x, origin.y);
      const gfx = new Graphics();
      gfx.eventMode = 'none';
      drawPolyline(gfx, entity.points, origin.x, origin.y, entity.closed);
      gfx.stroke({
        width: Math.max(entity.width, strokeUnit),
        color: options.selected ? 0xfbbf24 : pathColor(entity.role),
        cap: 'round',
        join: 'round',
      });
      container.addChild(gfx);
      break;
    }

    case 'wall': {
      const origin = entity.points[0] ?? { x: 0, y: 0 };
      container.position.set(origin.x, origin.y);
      const gfx = new Graphics();
      gfx.eventMode = 'none';
      drawPolyline(gfx, entity.points, origin.x, origin.y, false);
      gfx.stroke({
        width: Math.max(0.2, strokeUnit * 2),
        color: options.selected ? 0xfbbf24 : 0xe5e7eb,
        cap: 'square',
        join: 'miter',
      });
      container.addChild(gfx);
      break;
    }

    case 'door': {
      container.position.set(entity.a.x, entity.a.y);
      const gfx = new Graphics();
      gfx.eventMode = 'none';
      gfx
        .moveTo(0, 0)
        .lineTo(entity.b.x - entity.a.x, entity.b.y - entity.a.y)
        .stroke({
          width: Math.max(0.25, strokeUnit * 2.5),
          color: options.selected
            ? 0xfbbf24
            : entity.kind === 'secret'
              ? 0xc084fc
              : 0xd97706,
        });
      container.addChild(gfx);
      break;
    }

    case 'prop': {
      container.position.set(entity.x, entity.y);
      container.rotation = entity.rotation;
      container.scale.set(entity.flipX ? -entity.scale : entity.scale, entity.scale);
      const gfx = new Graphics();
      gfx.eventMode = 'none';
      const r = Math.max(0.5, strokeUnit * 6);
      gfx.circle(0, 0, r).fill({ color: 0x38bdf8, alpha: 0.8 });
      if (options.selected) {
        gfx.circle(0, 0, r * 1.3).stroke({ width: strokeUnit * 1.5, color: 0xfbbf24 });
      }
      container.addChild(gfx);
      break;
    }

    case 'light': {
      container.position.set(entity.x, entity.y);
      const gfx = new Graphics();
      gfx.eventMode = 'none';
      const colorNum = /^#[0-9a-fA-F]{6}$/.test(entity.color)
        ? Number.parseInt(entity.color.slice(1), 16)
        : 0xfde047;
      gfx.circle(0, 0, entity.radius).fill({ color: colorNum, alpha: 0.16 });
      gfx.circle(0, 0, Math.max(0.3, strokeUnit * 4)).fill({ color: colorNum, alpha: 0.9 });
      if (options.selected) {
        gfx.circle(0, 0, entity.radius).stroke({ width: strokeUnit, color: 0xfbbf24 });
      }
      container.addChild(gfx);
      break;
    }

    case 'label': {
      container.position.set(entity.x, entity.y);
      const text = new Text({
        text: entity.text,
        style: {
          fontSize: Math.max(12, entity.size),
          fill: options.selected ? 0xfbbf24 : 0xf3f4f6,
          fontFamily: 'system-ui, sans-serif',
        },
      });
      text.eventMode = 'none';
      text.scale.set(1 / Math.max(0.01, options.zoom * 1.5));
      container.addChild(text);
      break;
    }

    case 'portal': {
      container.position.set(entity.x, entity.y);
      const gfx = new Graphics();
      gfx.eventMode = 'none';
      const r = Math.max(0.6, strokeUnit * 7);
      gfx
        .moveTo(0, -r)
        .lineTo(r, 0)
        .lineTo(0, r)
        .lineTo(-r, 0)
        .closePath()
        .fill({ color: 0xa855f7, alpha: 0.85 });
      if (options.selected) {
        gfx.circle(0, 0, r * 1.4).stroke({ width: strokeUnit, color: 0xfbbf24 });
      }
      container.addChild(gfx);
      break;
    }

    case 'place': {
      // Places group other entities and carry notes; no standalone geometry.
      break;
    }
  }

  return container;
}
