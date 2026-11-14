import { Container, FillPattern, Graphics, Matrix, Sprite, Text, TilingSprite, type Texture } from 'pixi.js';
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

function drawTexturedLine(container: Container, points: Point[], closed: boolean, width: number, mpp: number, texture: Texture, origin: Point) {
  const line = closed ? [...points, points[0]!] : points;
  let distance = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i-1]!, b = line[i]!;
    const length = Math.hypot(b.x-a.x, b.y-a.y);
    if (length === 0) continue;
    const strip = new TilingSprite({ texture, width: length, height: width });
    strip.eventMode = 'none'; strip.anchor.set(0,0.5);
    strip.position.set(a.x-origin.x, a.y-origin.y); strip.rotation = Math.atan2(b.y-a.y,b.x-a.x);
    strip.tileScale.set(mpp); strip.tilePosition.set(-distance,0);
    container.addChild(strip); distance += length;
  }
}

export function buildEntityDisplay(
  entity: Entity,
  options: {
    selected: boolean;
    zoom: number;
    texture?: Texture;
    layerGmOnly?: boolean;
  },
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
        if (options.texture && entity.texture) {
          const pattern = new FillPattern({ texture: options.texture, repetition: 'repeat', textureSpace: 'global' });
          const size = entity.texture.metersPerPixel;
          pattern.setTransform(new Matrix().scale(size, size));
          gfx.fill({ fill: pattern });
        } else gfx.fill({ color: areaFillColor(entity.role, entity.fill), alpha: 0.75 });
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
      if (options.texture && entity.texture) drawTexturedLine(container, entity.points, entity.closed, entity.width, entity.texture.metersPerPixel, options.texture, origin);
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
      if (options.texture && entity.texture) drawTexturedLine(container, entity.points, false, Math.max(0.2, options.texture.height * entity.texture.metersPerPixel), entity.texture.metersPerPixel, options.texture, origin);
      break;
    }

    case 'door': {
      container.position.set(entity.a.x, entity.a.y);
      const dx = entity.b.x - entity.a.x;
      const dy = entity.b.y - entity.a.y;
      const gfx = new Graphics();
      gfx.eventMode = 'none';
      gfx
        .moveTo(0, 0)
        .lineTo(dx, dy)
        .stroke({
          width: Math.max(0.25, strokeUnit * 2.5),
          color: options.selected
            ? 0xfbbf24
            : entity.kind === 'secret'
              ? 0xc084fc
              : 0xd97706,
        });
      if (entity.kind === 'secret') {
        const mx = dx / 2;
        const my = dy / 2;
        const r = Math.max(0.3, strokeUnit * 4.5);
        gfx
          .moveTo(mx, my - r)
          .lineTo(mx + r, my)
          .lineTo(mx, my + r)
          .lineTo(mx - r, my)
          .closePath()
          .fill({ color: 0xc084fc })
          .stroke({ width: strokeUnit, color: 0x111827 });
      }
      container.addChild(gfx);
      break;
    }

    case 'prop': {
      container.position.set(entity.x, entity.y);
      container.rotation = entity.rotation;
      container.scale.set(entity.flipX ? -entity.scale : entity.scale, entity.scale);
      if (options.texture && entity.w && entity.h) {
        const sprite = new Sprite(options.texture);
        sprite.eventMode = 'none'; sprite.anchor.set(0.5); sprite.width = entity.w; sprite.height = entity.h;
        container.addChild(sprite);
        if (options.selected) {
          const outline = new Graphics().rect(-entity.w / 2, -entity.h / 2, entity.w, entity.h)
            .stroke({ color: 0xfbbf24, width: strokeUnit / entity.scale });
          outline.eventMode = 'none'; container.addChild(outline);
        }
        break;
      }
      const gfx = new Graphics();
      gfx.eventMode = 'none';
      const r = entity.builtin ? 0.65 : Math.max(0.5, strokeUnit * 6);
      const builtin = entity.builtin?.replace(/^builtin:/,'');
      if (builtin === 'tree' || builtin === 'forest') gfx.circle(0,0,r).fill({color:0x38764b}).circle(-r/3,-r/3,r/2).fill({color:0x5a9b60});
      else if (builtin === 'rock' || builtin === 'mountain' || builtin === 'hill') gfx.moveTo(-r,r).lineTo(0,-r).lineTo(r,r).closePath().fill({color:0x93949b});
      else if (builtin === 'settlement') {
        gfx.rect(-r*.7,-r*.1,r*1.4,r*1.1).fill({color:0xe6d4a9});
        gfx.moveTo(-r,-r*.1).lineTo(0,-r).lineTo(r,-r*.1).closePath().fill({color:entity.suggestedSettlement?0xd9a544:0x955844});
        gfx.rect(-r*.18,r*.4,r*.36,r*.6).fill({color:0x514338});
      }
      else if (builtin === 'bed') gfx.rect(-r,-r,r*2,r*2).fill({color:0x725246}).rect(-r*0.8,-r*0.8,r*1.6,r*0.5).fill({color:0xe5e7eb});
      else if (builtin === 'bridge') {
        gfx.rect(-r,-r,r*2,r*2).fill({color:0xa98150});
        for (let i=1;i<8;i++) gfx.moveTo(-r+i*r/4,-r).lineTo(-r+i*r/4,r).stroke({color:0x62452c,width:r*.055});
      }
      else if (builtin) gfx.roundRect(-r,-r,r*2,r*2,0.1).fill({color:0x997151});
      else gfx.circle(0, 0, r).fill({ color: 0x38bdf8, alpha: 0.8 });
      if (builtin) gfx.scale.set((entity.w ?? 1.3)/1.3, (entity.h ?? 1.3)/1.3);
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

  const isGmOnly = Boolean(entity.gmOnly || options.layerGmOnly);
  if (isGmOnly && entity.type !== 'place' && !(entity.type === 'door' && entity.kind === 'secret')) {
    const gmBadge = new Graphics();
    gmBadge.eventMode = 'none';
    const r = Math.max(0.25, strokeUnit * 4);
    gmBadge
      .moveTo(0, -r)
      .lineTo(r, 0)
      .lineTo(0, r)
      .lineTo(-r, 0)
      .closePath()
      .fill({ color: 0xc084fc, alpha: 0.95 })
      .stroke({ width: strokeUnit, color: 0x111827 });
    container.addChild(gmBadge);
  }

  return container;
}
