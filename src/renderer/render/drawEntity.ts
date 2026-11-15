import { Container, FillPattern, Graphics, Matrix, Sprite, Text, TilingSprite, type Texture } from 'pixi.js';
import type { AreaRole, Entity, MapKind, PathRole, Point } from '../model/schema';
import { getProceduralTexture } from './proceduralTextures';

function areaFillColor(role: AreaRole, customFill?: string): number {
  if (customFill && /^#[0-9a-fA-F]{6}$/.test(customFill)) {
    return Number.parseInt(customFill.slice(1), 16);
  }
  if (role === 'land') return 0xcbb994;
  if (role === 'water') return 0x46717e;
  if (role === 'plateau') return 0xa59272;
  if (role === 'district') return 0xb9aa8c;
  if (role === 'building') return 0x9e583e;
  if (role === 'floor') return 0xb6a587;
  return 0x7c8a5d; // biome:*
}

function pathColor(role: PathRole): number {
  switch (role) {
    case 'road':
      return 0xd8c69e;
    case 'river':
      return 0x4b879c;
    case 'cliff':
      return 0x6e5a47;
    case 'cityWall':
      return 0xa69b88;
    case 'trail':
      return 0xc6b089;
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
    cartographicRivers?: boolean;
    texture?: Texture;
    layerGmOnly?: boolean;
    mapKind?: MapKind;
  },
): Container {
  const container = new Container();
  container.eventMode = 'none';
  const strokeUnit = 1.5 / Math.max(1e-8, options.zoom);

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
        const isBiome = entity.role.startsWith('biome:');
        const isLand = entity.role === 'land';
        const isWater = entity.role === 'water';
        const isBuilding = entity.role === 'building';
        const isFloor = entity.role === 'floor';
        const isDistrict = entity.role === 'district';

        // Coastal shallow-water glow & wave ripples for world/region landmasses
        if (isLand) {
          drawPolygonPath(gfx, outer, origin.x, origin.y);
          gfx.stroke({ width: strokeUnit * 20, color: 0x6f999b, alpha: 0.12, join: 'round' });
          drawPolygonPath(gfx, outer, origin.x, origin.y);
          gfx.stroke({ width: strokeUnit * 11, color: 0x8eb5b2, alpha: 0.22, join: 'round' });
          drawPolygonPath(gfx, outer, origin.x, origin.y);
          gfx.stroke({ width: strokeUnit * 4.5, color: 0xd0dfd2, alpha: 0.36, join: 'round' });
        }

        // SE drop shadow for buildings
        if (isBuilding) {
          const shadowOff = Math.max(0.8, strokeUnit * 2.2);
          drawPolygonPath(gfx, outer, origin.x - shadowOff, origin.y - shadowOff);
          gfx.fill({ color: 0x1e150e, alpha: 0.34 });
        }

        drawPolygonPath(gfx, outer, origin.x, origin.y);
        if (options.texture && entity.texture) {
          const pattern = new FillPattern({ texture: options.texture, repetition: 'repeat', textureSpace: 'global' });
          const size = entity.texture.metersPerPixel;
          if (entity.texture.fitToArea && outer.length === 4) {
            const a=outer[0]!,b=outer[1]!,d=outer[3]!;
            pattern.setTransform(new Matrix((b.x-a.x)/options.texture.width,(b.y-a.y)/options.texture.width,
              (d.x-a.x)/options.texture.height,(d.y-a.y)/options.texture.height,0,0));
          } else pattern.setTransform(new Matrix().scale(size, size));
          gfx.fill({ fill: pattern });
        } else {
          const fillCol = areaFillColor(entity.role, entity.fill);
          const fillAlpha = isBiome ? 0.86 : isDistrict ? 0.72 : 0.94;
          gfx.fill({ color: fillCol, alpha: fillAlpha });

          // Subtle procedural painterly texture overlay
          const procKind = isWater
            ? 'water'
            : isFloor
              ? (options.mapKind === 'interior' ? 'wood' : 'stone')
              : (isLand || isBiome || isDistrict)
                ? 'watercolor'
                : null;
          const procTex = procKind ? getProceduralTexture(procKind) : null;
          if (procTex) {
            const pat = new FillPattern({ texture: procTex, repetition: 'repeat', textureSpace: 'global' });
            const scale = isFloor ? 0.025 : isDistrict ? 0.45 : 1 / Math.max(1e-5, options.zoom * 1.4);
            pat.setTransform(new Matrix().scale(scale, scale));
            drawPolygonPath(gfx, outer, origin.x, origin.y);
            gfx.fill({ fill: pat, alpha: isFloor ? 0.55 : isWater ? 0.42 : 0.24 });
          }
        }
        for (let h = 1; h < entity.rings.length; h++) {
          const hole = entity.rings[h]!;
          if (hole.length >= 3) {
            drawPolygonPath(gfx, hole, origin.x, origin.y);
            gfx.cut();
          }
        }

        if (isWater) {
          drawPolygonPath(gfx, outer, origin.x, origin.y);
          gfx.stroke({ width: strokeUnit * 2.4, color: 0xd5e3d8, alpha: 0.45, join: 'round' });
        }

        if (isFloor) {
          drawPolygonPath(gfx, outer, origin.x, origin.y);
          gfx.stroke({ width: strokeUnit * 2.5, color: 0x1c140c, alpha: 0.22, join: 'round' });
        }

        if (options.selected || (!isBiome && !isDistrict)) {
          drawPolygonPath(gfx, outer, origin.x, origin.y);
          gfx.stroke({
            width: options.selected ? strokeUnit * 2 : isLand ? strokeUnit * 1.5 : strokeUnit * 0.95,
            color: options.selected ? 0xfbbf24 : isLand ? 0x38291a : isWater ? 0x2b4a54 : 0x3b2c1d,
            alpha: options.selected ? 0.95 : isBuilding ? 0.88 : 0.78,
            join: 'round',
          });
        } else if (isDistrict) {
          drawPolygonPath(gfx, outer, origin.x, origin.y);
          gfx.stroke({ width: strokeUnit * 0.75, color: 0x5c4b37, alpha: 0.25, join: 'round' });
        }

        if (isBuilding && outer.length === 4 && !entity.texture) {
          // Pitched/hipped roof ridge and gable lines in warm dark sepia ink
          let [a,b,c,d]=outer as [Point,Point,Point,Point];
          if (Math.hypot(b.x-a.x,b.y-a.y)<Math.hypot(d.x-a.x,d.y-a.y)) [a,b,c,d]=[b,c,d,a];
          const left={x:(a.x+d.x)/2,y:(a.y+d.y)/2},right={x:(b.x+c.x)/2,y:(b.y+c.y)/2};
          const p={x:left.x*.8+right.x*.2,y:left.y*.8+right.y*.2},q={x:left.x*.2+right.x*.8,y:left.y*.2+right.y*.8};
          // Sunlit NW roof facet highlight
          gfx.moveTo(a.x-origin.x,a.y-origin.y).lineTo(b.x-origin.x,b.y-origin.y).lineTo(q.x-origin.x,q.y-origin.y).lineTo(p.x-origin.x,p.y-origin.y).closePath();
          gfx.fill({color:0xfff4dc, alpha:0.14});
          // Shaded SE roof facet
          gfx.moveTo(d.x-origin.x,d.y-origin.y).lineTo(c.x-origin.x,c.y-origin.y).lineTo(q.x-origin.x,q.y-origin.y).lineTo(p.x-origin.x,p.y-origin.y).closePath();
          gfx.fill({color:0x1a110a, alpha:0.16});
          // Ridge and hip lines
          gfx.moveTo(p.x-origin.x,p.y-origin.y).lineTo(q.x-origin.x,q.y-origin.y);
          for(const [v,r] of [[a,p],[d,p],[b,q],[c,q]]) gfx.moveTo(v!.x-origin.x,v!.y-origin.y).lineTo(r!.x-origin.x,r!.y-origin.y);
          gfx.stroke({color:0x2e2116,width:strokeUnit*.75,alpha:.68});
        }
      }
      container.addChild(gfx);
      break;
    }

    case 'path': {
      const origin = entity.points[0] ?? { x: 0, y: 0 };
      container.position.set(origin.x, origin.y);
      const gfx = new Graphics();
      gfx.eventMode = 'none';
      const w = entity.role === 'river' && options.cartographicRivers
        ? Math.min(5.5, 1.2 + Math.log2(1 + entity.width / 5)) / options.zoom
        : Math.max(entity.width, .5 / options.zoom);

      if (!options.selected && (entity.role === 'river' || entity.role === 'road' || entity.role === 'trail' || entity.role === 'cityWall')) {
        if (entity.role === 'cityWall') {
          const shadowOff = Math.max(0.6, w * 0.25);
          drawPolyline(gfx, entity.points, origin.x - shadowOff, origin.y - shadowOff, entity.closed);
          gfx.stroke({ width: w * 1.15, color: 0x1c140c, alpha: 0.35, cap: 'round', join: 'round' });
        }
        // Outer bank / ink border
        drawPolyline(gfx, entity.points, origin.x, origin.y, entity.closed);
        gfx.stroke({
          width: w * (entity.role === 'river' ? 1.45 : 1.24),
          color: entity.role === 'river' ? 0x2b4752 : entity.role === 'cityWall' ? 0x2c2116 : 0x5c4732,
          alpha: entity.role === 'river' ? 0.55 : 0.65,
          cap: 'round',
          join: 'round',
        });
      }

      drawPolyline(gfx, entity.points, origin.x, origin.y, entity.closed);
      gfx.stroke({
        width: w,
        color: options.selected ? 0xfbbf24 : pathColor(entity.role),
        cap: 'round',
        join: 'round',
      });

      if (!options.selected && entity.role === 'river') {
        drawPolyline(gfx, entity.points, origin.x, origin.y, entity.closed);
        gfx.stroke({ width: w * 0.32, color: 0xa4d0d6, alpha: 0.42, cap: 'round', join: 'round' });
      }
      if (!options.selected && entity.role === 'cityWall' && entity.closed) {
        const towerR = Math.max(w * 1.15, strokeUnit * 3.2);
        for (const pt of entity.points) {
          gfx.circle(pt.x - origin.x + w * 0.25, pt.y - origin.y + w * 0.25, towerR).fill({ color: 0x1c140c, alpha: 0.35 });
          gfx.circle(pt.x - origin.x, pt.y - origin.y, towerR).fill(0xb2a692).stroke({ color: 0x2c2116, width: strokeUnit * 0.9 });
          gfx.circle(pt.x - origin.x, pt.y - origin.y, towerR * 0.45).fill(0x8c7f6c);
        }
      }

      container.addChild(gfx);
      if (options.texture && entity.texture) drawTexturedLine(container, entity.points, entity.closed, entity.width, entity.texture.metersPerPixel, options.texture, origin);
      break;
    }

    case 'wall': {
      const origin = entity.points[0] ?? { x: 0, y: 0 };
      container.position.set(origin.x, origin.y);
      const gfx = new Graphics();
      gfx.eventMode = 'none';
      const wallW = Math.max(0.28, strokeUnit * 2.8);
      if (!options.selected) {
        const sOff = wallW * 0.45;
        drawPolyline(gfx, entity.points, origin.x - sOff, origin.y - sOff, false);
        gfx.stroke({ width: wallW * 1.15, color: 0x1a120a, alpha: 0.36, cap: 'round', join: 'round' });
      }
      drawPolyline(gfx, entity.points, origin.x, origin.y, false);
      gfx.stroke({
        width: wallW,
        color: options.selected ? 0xfbbf24 : 0x2b2016,
        cap: 'round',
        join: 'round',
      });
      if (!options.selected) {
        drawPolyline(gfx, entity.points, origin.x, origin.y, false);
        gfx.stroke({
          width: wallW * 0.52,
          color: 0xd9ccb2,
          cap: 'round',
          join: 'round',
        });
      }
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
      const dw = Math.max(0.32, strokeUnit * 3.0);
      gfx
        .moveTo(0, 0)
        .lineTo(dx, dy)
        .stroke({
          width: dw,
          color: options.selected ? 0xfbbf24 : 0x2b1c10,
        });
      if (!options.selected) {
        gfx
          .moveTo(0, 0)
          .lineTo(dx, dy)
          .stroke({
            width: dw * 0.58,
            color: entity.kind === 'secret' ? 0xb88b5a : 0x9c5e34,
          });
      }
      if (entity.kind === 'secret') {
        const mx = dx / 2;
        const my = dy / 2;
        const r = Math.max(0.25, strokeUnit * 3.5);
        gfx
          .moveTo(mx, my - r)
          .lineTo(mx + r, my)
          .lineTo(mx, my + r)
          .lineTo(mx - r, my)
          .closePath()
          .fill({ color: 0xc084fc, alpha: 0.85 })
          .stroke({ width: strokeUnit * 0.8, color: 0x2b1c10 });
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
      if (builtin === 'tree' || builtin === 'forest') {
        const variant = entity.id.split('').reduce((acc, ch) => (acc * 31 + ch.charCodeAt(0)) | 0, 0) & 3;
        gfx.ellipse(r * 0.22, r * 0.28, r * 0.88, r * 0.72).fill({ color: 0x1a2214, alpha: 0.34 });
        gfx.rect(-r * 0.08, r * 0.25, r * 0.16, r * 0.6).fill(0x5a422c);
        if (variant === 1) {
          // Conifer / pine silhouette
          for (const [yOff, halfW, col] of [
            [0.32, 0.78, 0x2f5334],
            [-0.02, 0.62, 0x3b653e],
            [-0.36, 0.44, 0x4b7849],
          ] as const) {
            gfx.moveTo(0, (yOff - 0.52) * r).lineTo(halfW * r, yOff * r).lineTo(-halfW * r, yOff * r).closePath()
              .fill(col).stroke({ color: 0x1d301c, width: r * 0.06, join: 'round' });
          }
          gfx.moveTo(0, -0.88 * r).lineTo(-0.22 * r, -0.4 * r).lineTo(0, -0.4 * r).closePath().fill({ color: 0x7ea35a, alpha: 0.55 });
        } else {
          // Lush deciduous oak / sage cluster
          const palette = variant === 2
            ? [0x516e3c, 0x466335, 0x628046, 0x9ab364] as const
            : [0x3b633d, 0x355b38, 0x4b7847, 0x89ab5f] as const;
          for (const [x, y, size, col] of [
            [-0.36, 0.12, 0.56, palette[0]],
            [0.36, 0.08, 0.58, palette[1]],
            [0, -0.34, 0.66, palette[2]],
          ] as const) {
            gfx.circle(x * r, y * r, size * r).fill({ color: col }).stroke({ color: 0x22361f, width: r * 0.065 });
          }
          gfx.circle(-r * 0.18, -r * 0.44, r * 0.34).fill({ color: palette[3], alpha: 0.65 });
        }
      } else if (builtin === 'mountain') {
        // SE shadow + dramatic inked twin-peak silhouette with lit NW face and SE shadow face
        gfx.ellipse(r * 0.2, r * 0.58, r * 0.95, r * 0.28).fill({ color: 0x261d14, alpha: 0.25 });
        gfx.moveTo(-r, r * 0.65).lineTo(-r * 0.42, -r * 0.28).lineTo(-r * 0.16, r * 0.08).lineTo(r * 0.22, -r).lineTo(r, r * 0.65).closePath()
          .fill(0xa89b84).stroke({ color: 0x36281c, width: r * 0.065, join: 'round' });
        // SE shadow facets
        gfx.moveTo(-r * 0.42, -r * 0.28).lineTo(-r * 0.38, r * 0.55).lineTo(-r * 0.16, r * 0.08).closePath().fill({ color: 0x4d3f32, alpha: 0.55 });
        gfx.moveTo(r * 0.22, -r).lineTo(r * 0.2, r * 0.65).lineTo(r, r * 0.65).closePath().fill({ color: 0x4d3f32, alpha: 0.62 });
        // Ridge ink line + warm parchment snowcap
        gfx.moveTo(r * 0.22, -r).lineTo(r * 0.18, r * 0.62).stroke({ color: 0x36281c, width: r * 0.05 });
        gfx.moveTo(r * 0.22, -r).lineTo(r * 0.08, -r * 0.46).lineTo(r * 0.24, -r * 0.52).lineTo(r * 0.44, -r * 0.4).closePath().fill(0xf3ebd6);
      } else if (builtin === 'hill') {
        // Pure curved cartographic mound arc with soft SE shadow (no flat bottom line)
        gfx.ellipse(r * 0.14, r * 0.22, r * 0.85, r * 0.32).fill({ color: 0x695f42, alpha: 0.28 });
        gfx.moveTo(-r * 0.9, r * 0.3).quadraticCurveTo(0, -r * 0.62, r * 0.9, r * 0.3)
          .stroke({ color: 0x443524, width: r * 0.08, cap: 'round' });
        gfx.moveTo(r * 0.12, -r * 0.08).quadraticCurveTo(r * 0.48, r * 0.04, r * 0.72, r * 0.3)
          .stroke({ color: 0x443524, width: r * 0.045, cap: 'round', alpha: 0.55 });
      } else if (builtin === 'rock') {
        gfx.ellipse(r * 0.16, r * 0.22, r * 0.85, r * 0.55).fill({ color: 0x1a140e, alpha: 0.28 });
        gfx.poly([-r * 0.85, r * 0.5, -r * 0.65, -r * 0.35, -r * 0.05, -r * 0.7, r * 0.65, -r * 0.2, r * 0.9, r * 0.5])
          .fill(0x8e8a7e).stroke({ color: 0x362e24, width: r * 0.08, join: 'round' });
        gfx.moveTo(-r * 0.5, -r * 0.25).lineTo(-r * 0.05, -r * 0.5).lineTo(r * 0.4, -r * 0.15).stroke({ color: 0xcbc7b8, width: r * 0.1 });
      } else if (builtin === 'table') {
        gfx.roundRect(-r * 0.78, -r * 0.52, r * 1.8, r * 1.3, r * 0.14).fill({ color: 0x18100a, alpha: 0.32 });
        gfx.roundRect(-r * 0.9, -r * 0.65, r * 1.8, r * 1.3, r * 0.13).fill(0x9e7147).stroke({ color: 0x3a2617, width: r * 0.09 });
        for (const x of [-0.68, 0.68]) for (const y of [-0.45, 0.45]) gfx.circle(x * r, y * r, r * 0.1).fill(0x4d3320);
        gfx.moveTo(-r * 0.72, -r * 0.18).lineTo(r * 0.72, -r * 0.18).moveTo(-r * 0.72, r * 0.18).lineTo(r * 0.72, r * 0.18)
          .stroke({ color: 0xb88b5b, width: r * 0.05 });
      } else if (builtin === 'chair') {
        gfx.rect(-r * 0.44, -r * 0.24, r * 1.1, r * 1.1).fill({ color: 0x18100a, alpha: 0.28 });
        gfx.rect(-r * 0.55, -r * 0.35, r * 1.1, r * 1.1).fill(0xb38756).stroke({ color: 0x3c2819, width: r * 0.09 });
        gfx.roundRect(-r * 0.7, -r * 0.8, r * 1.4, r * 0.45, r * 0.08).fill(0x63442b).stroke({ color: 0x3c2819, width: r * 0.07 });
      } else if (builtin === 'barrel') {
        gfx.ellipse(r * 0.12, r * 0.14, r * 0.66, r).fill({ color: 0x18100a, alpha: 0.3 });
        gfx.ellipse(0, 0, r * 0.65, r).fill(0x93693f).stroke({ color: 0x38271a, width: r * 0.08 });
        for (const y of [-0.55, 0.55]) gfx.moveTo(-r * 0.57, y * r).lineTo(r * 0.57, y * r).stroke({ color: 0x3b4042, width: r * 0.16 });
        gfx.ellipse(0, -r * 0.72, r * 0.48, r * 0.16).stroke({ color: 0xc99f65, width: r * 0.06 });
      } else if (builtin === 'crate') {
        gfx.rect(-r * 0.68, -r * 0.68, r * 1.6, r * 1.6).fill({ color: 0x18100a, alpha: 0.3 });
        gfx.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 1.6).fill(0xa38050).stroke({ color: 0x3c2b1a, width: r * 0.12 });
        gfx.moveTo(-r * 0.65, -r * 0.65).lineTo(r * 0.65, r * 0.65).moveTo(r * 0.65, -r * 0.65).lineTo(-r * 0.65, r * 0.65)
          .stroke({ color: 0x5c4327, width: r * 0.14 });
      } else if (builtin === 'altar') {
        gfx.rect(-r * 0.88, -r * 0.43, r * 2, r * 1.1).fill({ color: 0x18100a, alpha: 0.32 });
        gfx.rect(-r, -r * 0.55, r * 2, r * 1.1).fill(0xb0aa9c).stroke({ color: 0x3f3a32, width: r * 0.09 });
        gfx.rect(-r * 0.25, -r * 0.4, r * 0.5, r * 0.8).fill(0x873c46);
        for (const x of [-0.7, 0.7]) gfx.circle(x * r, -r * 0.15, r * 0.12).fill(0xf9de85);
      } else if (builtin === 'settlement') {
        gfx.ellipse(r * 0.14, r * 0.78, r * 0.85, r * 0.28).fill({ color: 0x261d14, alpha: 0.28 });
        gfx.rect(-r * 0.68, -r * 0.05, r * 1.36, r * 0.95).fill(0xe8dcc2).stroke({ color: 0x36271a, width: r * 0.07 });
        gfx.moveTo(-r * 0.92, -r * 0.05).lineTo(0, -r * 0.92).lineTo(r * 0.92, -r * 0.05).closePath()
          .fill(entity.suggestedSettlement ? 0xc2863a : 0x9c4c36).stroke({ color: 0x36271a, width: r * 0.07, join: 'round' });
        gfx.rect(-r * 0.18, r * 0.38, r * 0.36, r * 0.52).fill(0x4a382b);
      } else if (builtin === 'bed') {
        gfx.rect(-r * 0.88, -r * 0.88, r * 2, r * 2).fill({ color: 0x18100a, alpha: 0.28 });
        gfx.rect(-r, -r, r * 2, r * 2).fill(0x7c463c).stroke({ color: 0x38241a, width: r * 0.08 });
        gfx.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 0.5).fill(0xeee7d7);
      } else if (builtin === 'bridge') {
        gfx.rect(-r * 0.92, -r * 0.92, r * 2, r * 2).fill({ color: 0x18100a, alpha: 0.28 });
        gfx.rect(-r, -r, r * 2, r * 2).fill(0xa98150).stroke({ color: 0x3d2a19, width: r * 0.07 });
        for (let i = 1; i < 8; i++) gfx.moveTo(-r + i * r / 4, -r).lineTo(-r + i * r / 4, r).stroke({ color: 0x5c3e24, width: r * 0.055 });
      } else if (builtin === 'hearth') {
        // Stone fireplace with warm glowing embers & un-squashed circular firelight halo
        const sx = (entity.w ?? 1.3) / 1.3, sy = (entity.h ?? 1.3) / 1.3;
        gfx.ellipse(0, r * 0.25, (r * 2.2) / sx, (r * 2.2) / sy).fill({ color: 0xff8c2b, alpha: 0.16 });
        gfx.roundRect(-r * 0.95, -r * 0.65, r * 1.9, r * 1.3, r * 0.12).fill(0x5c554d).stroke({ color: 0x2a231c, width: r * 0.09 });
        gfx.roundRect(-r * 0.65, -r * 0.35, r * 1.3, r * 0.78, r * 0.1).fill(0x281c14);
        gfx.ellipse(0, r * 0.04, r * 0.48, r * 0.28).fill(0xe85a1b);
        gfx.ellipse(0, r * 0.04, r * 0.28, r * 0.16).fill(0xffcf56);
      } else if (builtin === 'bar') {
        // Long timber tavern bar counter with brass trim & mugs
        gfx.roundRect(-r * 0.88, -r * 0.52, r * 1.9, r * 1.18, r * 0.1).fill({ color: 0x18100a, alpha: 0.32 });
        gfx.roundRect(-r, -r * 0.62, r * 2, r * 1.15, r * 0.1).fill(0x7c4e29).stroke({ color: 0x331f10, width: r * 0.08 });
        gfx.roundRect(-r * 0.9, -r * 0.45, r * 1.8, r * 0.8, r * 0.06).fill(0x9b683b);
        for (const x of [-0.55, 0.1, 0.6]) gfx.circle(x * r, 0, r * 0.12).fill(0xd9b86c).stroke({ color: 0x452d14, width: r * 0.04 });
      } else if (builtin === 'rug') {
        // Woven tapestry rug with fringe and inner border
        gfx.roundRect(-r * 0.92, -r * 0.72, r * 1.84, r * 1.44, r * 0.08).fill(0x7e2f2b).stroke({ color: 0x3d1714, width: r * 0.06 });
        gfx.rect(-r * 0.76, -r * 0.56, r * 1.52, r * 1.12).stroke({ color: 0xd9b36c, width: r * 0.06 });
        gfx.rect(-r * 0.52, -r * 0.34, r * 1.04, r * 0.68).fill({ color: 0x9c453a, alpha: 0.75 });
      } else if (builtin === 'pillar') {
        // Carved stone column with SE shadow
        gfx.circle(r * 0.18, r * 0.22, r * 0.88).fill({ color: 0x18100a, alpha: 0.34 });
        gfx.circle(0, 0, r * 0.85).fill(0x8e8679).stroke({ color: 0x2d261e, width: r * 0.09 });
        gfx.circle(-r * 0.1, -r * 0.1, r * 0.55).fill(0xa8a092);
      } else if (builtin === 'campfire') {
        // Ring of stones, crossed logs, warm fire & glow
        gfx.circle(0, 0, r * 2.1).fill({ color: 0xff9233, alpha: 0.15 });
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          gfx.circle(Math.cos(a) * r * 0.68, Math.sin(a) * r * 0.68, r * 0.22).fill(0x7c766c).stroke({ color: 0x332d26, width: r * 0.05 });
        }
        gfx.moveTo(-r * 0.45, -r * 0.3).lineTo(r * 0.45, r * 0.3).moveTo(-r * 0.45, r * 0.3).lineTo(r * 0.45, -r * 0.3).stroke({ color: 0x4e321a, width: r * 0.18, cap: 'round' });
        gfx.circle(0, 0, r * 0.42).fill(0xe85d1a);
        gfx.circle(0, 0, r * 0.24).fill(0xffd252);
      } else if (builtin === 'bush') {
        gfx.ellipse(r * 0.12, r * 0.16, r * 0.72, r * 0.62).fill({ color: 0x1a2214, alpha: 0.24 });
        for (const [bx, by, br, col] of [[-0.25, 0.1, 0.42, 0x3f6435], [0.25, 0.05, 0.4, 0x35572c], [0, -0.2, 0.45, 0x4d7540]] as const) {
          gfx.circle(bx * r, by * r, br * r).fill(col).stroke({ color: 0x21351c, width: r * 0.06 });
        }
      } else if (builtin) gfx.roundRect(-r, -r, r * 2, r * 2, 0.1).fill({ color: 0x997151 }).stroke({ color: 0x3b2a1c, width: r * 0.07 });
      else gfx.circle(0, 0, r).fill({ color: 0x38bdf8, alpha: 0.8 });
      if (builtin) gfx.scale.set((entity.w ?? 1.3)/1.3, (entity.h ?? 1.3)/1.3);
      container.addChild(gfx);
      if (options.selected) {
        const hw = (entity.w ?? 1.3) / 2, hh = (entity.h ?? 1.3) / 2;
        const outline = new Graphics().rect(-hw, -hh, hw * 2, hh * 2).stroke({ width: 1.5 / (options.zoom * entity.scale), color: 0xfbbf24 });
        outline.eventMode = 'none'; container.addChild(outline);
      }
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
          fontSize: Math.max(14, entity.size),
          fill: options.selected ? 0xfbbf24 : 0x261a10,
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontWeight: 'bold',
          stroke: { color: 0xf4ead2, width: 3.5 },
        },
      });
      text.anchor.set(0.5);
      text.eventMode = 'none';
      text.scale.set(1 / Math.max(1e-8, options.zoom * 1.35));
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
    if (entity.type === 'prop' && entity.suggestedSettlement) {
      const ringR = Math.max(0.55, (entity.w ?? 1.3) * 0.65);
      gmBadge.circle(0, 0, ringR).stroke({ width: strokeUnit * 1.1, color: 0xd99b38, alpha: 0.72 });
    } else {
      const r = Math.max(0.25, strokeUnit * 3.5);
      gmBadge
        .moveTo(0, -r)
        .lineTo(r, 0)
        .lineTo(0, r)
        .lineTo(-r, 0)
        .closePath()
        .fill({ color: 0xc084fc, alpha: 0.9 })
        .stroke({ width: strokeUnit, color: 0x111827 });
    }
    container.addChild(gmBadge);
  }

  return container;
}
