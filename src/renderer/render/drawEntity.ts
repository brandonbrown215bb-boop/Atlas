import { Container, FillPattern, Graphics, Matrix, Sprite, Text, TilingSprite, type Texture } from 'pixi.js';
import './strokeGuard';
import { pointInPolygon } from '../geom/hitTest';
import type { AreaRole, Entity, FloorMaterial, MapKind, PathRole, Point } from '../model/schema';
import {
  drawBuildingRoof,
  drawConnectorSymbol,
  drawDashedPolyline,
  drawDoorStyled,
  drawWallStyled,
  isSpecialWall,
} from './drawPrimitives';
import { getProceduralTexture } from './proceduralTextures';

function areaFillColor(role: AreaRole, customFill?: string, floorMaterial?: FloorMaterial): number {
  if (customFill && /^#[0-9a-fA-F]{6}$/.test(customFill)) {
    return Number.parseInt(customFill.slice(1), 16);
  }
  if (role === 'land') return 0xcbb994;
  if (role === 'water') return 0x46717e;
  if (role === 'plateau') return 0xa59272;
  if (role === 'district') return 0xb9aa8c;
  if (role === 'building') return 0x9e583e;
  if (role === 'floor') {
    if (floorMaterial === 'stone') return 0x8c877c;
    if (floorMaterial === 'earth') return 0x937f60;
    if (floorMaterial === 'wood') return 0xa77d54;
    return 0xb6a587;
  }
  if (role === 'biome:dense-canopy') return 0x264225;
  if (role === 'biome:frontier') return 0x993228;
  if (role === 'biome:faction') return 0x4b5c8a;
  if (role === 'biome:rumor') return 0x8c6239;
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

function drawTexturedLine(container: Container, points: Point[], closed: boolean, width: number, mpp: number, texture: Texture, origin: Point, opacity = 1) {
  const line = closed ? [...points, points[0]!] : points;
  let distance = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i-1]!, b = line[i]!;
    const length = Math.hypot(b.x-a.x, b.y-a.y);
    if (length === 0) continue;
    const strip = new TilingSprite({ texture, width: length, height: width });
    strip.eventMode = 'none'; strip.anchor.set(0,0.5);
    strip.alpha = opacity;
    strip.position.set(a.x-origin.x, a.y-origin.y); strip.rotation = Math.atan2(b.y-a.y,b.x-a.x);
    strip.tileScale.set(mpp); strip.tilePosition.set(-distance,0);
    container.addChild(strip); distance += length;
  }
}

/** Returns a bedrock probe so Dyson wall hatching only draws on the un-floored void side and skips wooden building interiors. */
export function createWallHatchTest(
  entities: readonly Entity[],
  generators?: Record<string, { type: string; params?: Record<string, unknown> }>,
): false | ((pt: Point) => boolean) {
  const isWoodBuilding = generators
    ? Object.values(generators).some((g) => g.type === 'dungeon' && g.params?.mode === 'building')
    : false;
  const floors = entities.filter(
    (e): e is Extract<Entity, { type: 'area' }> =>
      e.type === 'area' && (e.role === 'floor' || e.role === 'water'),
  );
  if (isWoodBuilding || floors.some((f) => f.floorMaterial === 'wood') || !floors.length) return false;
  return (pt: Point) => floors.some((f) => pointInPolygon(pt, f.rings));
}

/** Draws pooled underlay borders for all non-dashed roads/trails and site Clearings so intersections & glade mouths fuse seamlessly. */
export function buildPathOutlineOverlay(
  entities: readonly Entity[],
  zoom: number,
  mapKind?: MapKind,
): Graphics {
  const gfx = new Graphics();
  gfx.eventMode = 'none';
  const strokeUnit = Math.max(0.05, 0.85 / Math.max(1e-8, zoom));
  for (const e of entities) {
    if (e.type === 'area' && e.role === 'land' && mapKind === 'site' && e.name?.startsWith('Clearing ')) {
      const outer = e.rings[0];
      if (outer && outer.length >= 3) {
        drawPolygonPath(gfx, outer, 0, 0);
        gfx.stroke({ width: strokeUnit * 2.8, color: 0x38291a, alpha: 0.88, join: 'round' });
      }
      continue;
    }
    if (e.type !== 'path' || (e.role !== 'road' && e.role !== 'trail')) continue;
    const tier = e.routeTier;
    if (tier === 'track' || tier === 'gameTrail' || tier === 'secret' || tier === 'sewer') continue;
    const w = Math.max(e.width, 0.5 / zoom);
    const capStyle = !e.closed && mapKind === 'settlement' ? 'butt' : 'round';
    drawPolyline(gfx, e.points, 0, 0, e.closed);
    gfx.stroke({
      width: (tier === 'highway' ? w * 1.15 : w) * 1.24,
      color: 0x5c4732,
      alpha: 0.72,
      cap: capStyle,
      join: 'round',
    });
  }
  return gfx;
}

/** Pooled 3-pass rendering for solid non-selected walls so L-corners and T-junctions fuse without shadow blotches or seam ticks. */
export function buildWallNetworkOverlay(
  entities: readonly Entity[],
  zoom: number,
  wallHatch: boolean | ((pt: Point) => boolean),
): Graphics {
  const gfx = new Graphics();
  gfx.eventMode = 'none';
  const strokeUnit = Math.max(0.05, 0.85 / Math.max(1e-8, zoom));
  const walls = entities.filter((e): e is Extract<Entity, { type: 'wall' }> => e.type === 'wall' && !isSpecialWall(e));
  const origin = { x: 0, y: 0 };
  for (const pass of ['shadow', 'casing', 'core'] as const) {
    for (const w of walls) {
      drawWallStyled(gfx, w, origin, strokeUnit, false, wallHatch, pass);
    }
  }
  return gfx;
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
    roofMode?: 'detailed' | 'simple' | 'hidden';
    wallHatch?: boolean | ((pt: Point) => boolean);
    separatePathOutline?: boolean;
    separateWallPass?: boolean;
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

        const isDenseCanopy = entity.role === 'biome:dense-canopy';
        const isFrontier = entity.role === 'biome:frontier';
        const isFactionZone = entity.role === 'biome:faction';
        const isRumorZone = entity.role === 'biome:rumor';
        const isDashedOverlay = isFrontier || isFactionZone || isRumorZone;
        const isPlateau = entity.role === 'plateau';
        const isSiteRidge = isPlateau && (options.mapKind === 'site' || options.mapKind === 'interior');
        // Coastal shallow-water glow & crisp cartographic wave contour rings for world/region landmasses only
        const isWorldCoast = isLand && (options.mapKind === 'world' || options.mapKind === 'region');
        if (isWorldCoast) {
          drawPolygonPath(gfx, outer, origin.x, origin.y);
          gfx.stroke({ width: strokeUnit * 44, color: 0x5c8b91, alpha: 0.24, join: 'round' });
          drawPolygonPath(gfx, outer, origin.x, origin.y);
          gfx.stroke({ width: strokeUnit * 26, color: 0x82b2b3, alpha: 0.34, join: 'round' });
          drawPolygonPath(gfx, outer, origin.x, origin.y);
          gfx.stroke({ width: strokeUnit * 12, color: 0xb7d8ce, alpha: 0.48, join: 'round' });
          drawPolygonPath(gfx, outer, origin.x, origin.y);
          gfx.stroke({ width: strokeUnit * 4.2, color: 0xe6f1e3, alpha: 0.68, join: 'round' });
        }

        const roofHidden =
          isBuilding &&
          (options.roofMode === 'hidden' || (options.mapKind === 'interior' && entity.usage === 'boundary'));

        // SE drop shadow for buildings & elevated site ridges
        if ((isBuilding && !roofHidden) || isSiteRidge) {
          const shadowOff = Math.max(0.8, strokeUnit * (isSiteRidge ? 2.6 : 2.2));
          drawPolygonPath(gfx, outer, origin.x - shadowOff, origin.y - shadowOff);
          gfx.fill({ color: 0x1e150e, alpha: isSiteRidge ? 0.28 : 0.34 });
        }

        if (!roofHidden) {
          // Separate base fill + cut and procedural overlay + cut so Pixi's 2-instruction cut() lookback never doubles holes.
          const fillGfx = new Graphics();
          fillGfx.eventMode = 'none';
          const cutHoles = (target: Graphics) => {
            for (let h = 1; h < entity.rings.length; h++) {
              const hole = entity.rings[h]!;
              if (hole.length >= 3) {
                drawPolygonPath(target, hole, origin.x, origin.y);
                target.cut();
              }
            }
          };
          const fillCol = areaFillColor(entity.role, entity.fill ?? entity.roofColor, entity.floorMaterial);
          const fillAlpha = isRumorZone ? 0.04 : isFactionZone ? 0.06 : isFrontier ? 0.05 : isDenseCanopy ? 0.56 : isBiome ? 0.86 : isDistrict ? 0.72 : 0.94;
          drawPolygonPath(fillGfx, outer, origin.x, origin.y);
          if (options.texture && entity.texture) {
            const opacity = entity.texture.opacity ?? 1;
            if (opacity < 1) {
              const baseGfx = new Graphics();
              baseGfx.eventMode = 'none';
              drawPolygonPath(baseGfx, outer, origin.x, origin.y);
              baseGfx.fill({ color: fillCol, alpha: fillAlpha });
              cutHoles(baseGfx);
              container.addChild(baseGfx);
            }
            const pattern = new FillPattern({ texture: options.texture, repetition: 'repeat', textureSpace: 'global' });
            const size = entity.texture.metersPerPixel;
            if (entity.texture.fitToArea && outer.length === 4) {
              const a=outer[0]!,b=outer[1]!,d=outer[3]!;
              pattern.setTransform(new Matrix((b.x-a.x)/options.texture.width,(b.y-a.y)/options.texture.width,
                (d.x-a.x)/options.texture.height,(d.y-a.y)/options.texture.height,0,0));
            } else pattern.setTransform(new Matrix().scale(size, size));
            fillGfx.fill({ fill: pattern, alpha: opacity });
            cutHoles(fillGfx);
            container.addChild(fillGfx);
          } else {
            fillGfx.fill({ color: fillCol, alpha: fillAlpha });
            cutHoles(fillGfx);
            container.addChild(fillGfx);

            // Subtle procedural painterly texture overlay in its own isolated Graphics so holes stay crisp
            const floorProc =
              entity.floorMaterial === 'earth'
                ? 'parchment'
                : entity.floorMaterial === 'stone'
                  ? 'stone'
                  : entity.floorMaterial === 'wood'
                    ? 'wood'
                    : options.mapKind === 'interior'
                      ? 'wood'
                      : 'stone';
            const procKind = isWater
              ? 'water'
              : isFloor
                ? floorProc
                : (!isDenseCanopy && !isDashedOverlay && (isLand || isBiome || isDistrict))
                  ? 'watercolor'
                  : null;
            const procTex = procKind ? getProceduralTexture(procKind) : null;
            if (procTex) {
              const pat = new FillPattern({ texture: procTex, repetition: 'repeat', textureSpace: 'global' });
              const scale = isFloor ? 0.025 : isDistrict ? 0.45 : 1 / Math.max(1e-5, options.zoom * 1.4);
              pat.setTransform(new Matrix().scale(scale, scale));
              const procGfx = new Graphics();
              procGfx.eventMode = 'none';
              drawPolygonPath(procGfx, outer, origin.x, origin.y);
              procGfx.fill({ fill: pat, alpha: isFloor ? 0.55 : isWater ? 0.42 : 0.24 });
              cutHoles(procGfx);
              container.addChild(procGfx);
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

          const isSiteClearing = Boolean(options.separatePathOutline && isLand && options.mapKind === 'site' && entity.name?.startsWith('Clearing '));
          if (options.selected || (!isBiome && !isDistrict && !isSiteClearing)) {
            drawPolygonPath(gfx, outer, origin.x, origin.y);
            gfx.stroke({
              width: options.selected ? strokeUnit * 2 : isLand ? strokeUnit * 1.5 : strokeUnit * 0.95,
              color: options.selected ? 0xfbbf24 : isLand ? 0x38291a : isWater ? 0x2b4a54 : 0x3b2c1d,
              alpha: options.selected ? 0.95 : isBuilding ? 0.88 : 0.78,
              join: 'round',
            });
          } else if (isDenseCanopy) {
            drawPolygonPath(gfx, outer, origin.x, origin.y);
            gfx.stroke({ width: strokeUnit * 1.6, color: 0x182b18, alpha: 0.85, join: 'round' });
          } else if (isFrontier) {
            drawDashedPolyline(gfx, outer, origin, strokeUnit * 8, strokeUnit * 6, true);
            gfx.stroke({ width: strokeUnit * 1.35, color: 0x8f3328, alpha: 0.42, cap: 'round' });
          } else if (isFactionZone) {
            drawDashedPolyline(gfx, outer, origin, strokeUnit * 10, strokeUnit * 5, true);
            gfx.stroke({ width: strokeUnit * 1.45, color: fillCol, alpha: 0.48, cap: 'round' });
          } else if (isRumorZone) {
            drawDashedPolyline(gfx, outer, origin, strokeUnit * 5, strokeUnit * 5, true);
            gfx.stroke({ width: strokeUnit * 1.15, color: 0x8c6239, alpha: 0.55, cap: 'round' });
          } else if (isDistrict) {
            drawPolygonPath(gfx, outer, origin.x, origin.y);
            gfx.stroke({ width: strokeUnit * 0.75, color: 0x5c4b37, alpha: 0.25, join: 'round' });
          }

          if (isSiteRidge) {
            // Downhill cliff hachure ticks along tactical ridge rim
            for (let i = 0; i < outer.length; i++) {
              const a = outer[i]!, b = outer[(i + 1) % outer.length]!;
              const segLen = Math.hypot(b.x - a.x, b.y - a.y);
              if (segLen < strokeUnit * 2) continue;
              const nx = -(b.y - a.y) / segLen, ny = (b.x - a.x) / segLen;
              const steps = Math.max(1, Math.floor(segLen / Math.max(0.7, strokeUnit * 3)));
              for (let s = 0; s < steps; s++) {
                const t = (s + 0.5) / steps;
                const mx = a.x + (b.x - a.x) * t - origin.x;
                const my = a.y + (b.y - a.y) * t - origin.y;
                gfx.moveTo(mx, my).lineTo(mx + nx * strokeUnit * 2.2, my + ny * strokeUnit * 2.2);
              }
            }
            gfx.stroke({ width: strokeUnit * 0.7, color: 0x36281a, alpha: 0.72, cap: 'round' });
          }
        }

        if (isBuilding && (!entity.texture || !options.texture)) {
          drawBuildingRoof(gfx, entity, outer, origin, strokeUnit, options.roofMode ?? 'detailed');
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
      const tier = entity.routeTier;
      const isDashedTier =
        tier === 'track' || tier === 'gameTrail' || tier === 'secret' || tier === 'sewer';

      if (!options.selected && entity.role === 'river' && options.cartographicRivers) {
        // Feathered alluvial valley buffer along large rivers so highland intersections feel cushioned
        drawPolyline(gfx, entity.points, origin.x, origin.y, entity.closed);
        gfx.stroke({ width: w * 3.8, color: 0xcbbda0, alpha: 0.24, cap: 'round', join: 'round' });
      }

      if (isDashedTier) {
        const dash = Math.max(w * 2.2, strokeUnit * 4.5);
        const gap = Math.max(w * 1.4, strokeUnit * 3.0);
        const tierColor = options.selected
          ? 0xfbbf24
          : tier === 'sewer'
            ? 0x3b6963
            : tier === 'secret'
              ? 0xa855f7
              : (tier === 'track' && (options.mapKind === 'world' || options.mapKind === 'region'))
                ? 0x664526
                : pathColor(entity.role);
        drawDashedPolyline(gfx, entity.points, origin, dash, gap, entity.closed);
        gfx.stroke({
          width: tier === 'gameTrail' ? Math.max(w * 0.72, strokeUnit * 1.2) : w * 0.9,
          color: tierColor,
          alpha: tier === 'sewer' ? 0.78 : 0.85,
          cap: 'round',
        });
      } else {
        const capStyle = !entity.closed && options.mapKind === 'settlement' ? 'butt' : 'round';
        const skipMergedOutline = Boolean(options.separatePathOutline && (entity.role === 'road' || entity.role === 'trail'));
        if (!options.selected && !skipMergedOutline && (entity.role === 'river' || entity.role === 'road' || entity.role === 'trail' || entity.role === 'cityWall')) {
          if (entity.role === 'cityWall') {
            const shadowOff = Math.max(0.6, w * 0.25);
            drawPolyline(gfx, entity.points, origin.x - shadowOff, origin.y - shadowOff, entity.closed);
            gfx.stroke({ width: w * 1.15, color: 0x1c140c, alpha: 0.35, cap: 'round', join: 'round' });
          }
          // Outer bank / ink border
          drawPolyline(gfx, entity.points, origin.x, origin.y, entity.closed);
          gfx.stroke({
            width: w * (entity.role === 'river' ? 1.45 : tier === 'highway' ? 1.42 : 1.24),
            color: entity.role === 'river' ? 0x2b4752 : entity.role === 'cityWall' ? 0x2c2116 : 0x5c4732,
            alpha: entity.role === 'river' ? 0.55 : tier === 'highway' ? 0.82 : 0.65,
            cap: capStyle,
            join: 'round',
          });
        }

        drawPolyline(gfx, entity.points, origin.x, origin.y, entity.closed);
        gfx.stroke({
          width: tier === 'highway' ? w * 1.15 : w,
          color: options.selected ? 0xfbbf24 : pathColor(entity.role),
          cap: capStyle,
          join: 'round',
        });
      }

      if (!options.selected && entity.role === 'river') {
        drawPolyline(gfx, entity.points, origin.x, origin.y, entity.closed);
        gfx.stroke({ width: w * 0.32, color: 0xa4d0d6, alpha: 0.42, cap: 'round', join: 'round' });
      }
      if (!options.selected && entity.role === 'cityWall') {
        const towerR = Math.max(w * 1.15, strokeUnit * 3.2);
        const placedTowers: Point[] = [];
        const gateEndpoints = entity.closed ? [] : [entity.points[0]!, entity.points[entity.points.length - 1]!];
        for (const [pi, pt] of entity.points.entries()) {
          const isGate = !entity.closed && (pi === 0 || pi === entity.points.length - 1);
          if (!isGate && gateEndpoints.some((g) => Math.hypot(pt.x - g.x, pt.y - g.y) < towerR * 2.9)) continue;
          if (placedTowers.some((t) => Math.hypot(pt.x - t.x, pt.y - t.y) < towerR * 2.6)) continue;
          placedTowers.push(pt);
          const rCur = isGate ? towerR * 1.25 : towerR;
          gfx.circle(pt.x - origin.x + w * 0.25, pt.y - origin.y + w * 0.25, rCur).fill({ color: 0x1c140c, alpha: 0.35 });
          gfx.circle(pt.x - origin.x, pt.y - origin.y, rCur).fill(0xb2a692).stroke({ color: 0x2c2116, width: strokeUnit * 0.9 });
          gfx.circle(pt.x - origin.x, pt.y - origin.y, rCur * 0.45).fill(0x8c7f6c);
        }
      }

      container.addChild(gfx);
      // Pointcrawl 'S' (secret) and 'G' (game trail) badges near path midpoints
      if (!options.selected && (entity.routeTier === 'secret' || entity.routeTier === 'gameTrail') && entity.points.length >= 2) {
        const midPt = entity.points[Math.floor(entity.points.length / 2)]!;
        const tag = new Text({
          text: entity.routeTier === 'secret' ? 'S' : 'G',
          style: {
            fontSize: 11,
            fontFamily: 'Georgia, serif',
            fontWeight: 'bold',
            fill: entity.routeTier === 'secret' ? 0x7e22ce : 0x5c3e24,
            stroke: { color: 0xf4ead2, width: 3 },
          },
        });
        tag.anchor.set(0.5);
        tag.position.set(midPt.x - origin.x, midPt.y - origin.y);
        tag.scale.set(1 / Math.max(1e-8, options.zoom * 1.35));
        tag.eventMode = 'none';
        container.addChild(tag);
      }
      if (options.texture && entity.texture) drawTexturedLine(container, entity.points, entity.closed, entity.width, entity.texture.metersPerPixel, options.texture, origin, entity.texture.opacity);
      break;
    }

    case 'wall': {
      const origin = entity.points[0] ?? { x: 0, y: 0 };
      container.position.set(origin.x, origin.y);
      const hatchMode = options.wallHatch !== undefined
        ? options.wallHatch
        : (options.mapKind === 'interior' || options.mapKind === 'site');
      if (!options.separateWallPass || options.selected || isSpecialWall(entity)) {
        const gfx = new Graphics();
        gfx.eventMode = 'none';
        drawWallStyled(gfx, entity, origin, strokeUnit, options.selected, hatchMode);
        container.addChild(gfx);
      }
      if (options.texture && entity.texture) drawTexturedLine(container, entity.points, false, Math.max(0.2, options.texture.height * entity.texture.metersPerPixel), entity.texture.metersPerPixel, options.texture, origin, entity.texture.opacity);
      break;
    }

    case 'door': {
      container.position.set(entity.a.x, entity.a.y);
      const gfx = new Graphics();
      gfx.eventMode = 'none';
      drawDoorStyled(gfx, entity, strokeUnit, options.selected);
      container.addChild(gfx);
      break;
    }

    case 'prop': {
      container.position.set(entity.x, entity.y);
      container.rotation = entity.rotation;
      container.scale.set(entity.flipX ? -entity.scale : entity.scale, entity.scale);
      if (options.texture && entity.w && entity.h) {
        if (entity.builtin === 'hearth') {
          const glow = new Graphics().circle(0, entity.h * 0.2, entity.w).fill({ color: 0xff8c2b, alpha: 0.16 });
          glow.eventMode = 'none';
          container.addChild(glow);
        }
        const sprite = new Sprite(options.texture);
        sprite.eventMode = 'none';
        sprite.anchor.set(0.5);
        const spansFootprint = entity.builtin === 'bridge' || entity.builtin === 'dock' || entity.builtin === 'boat';
        if (entity.tacticalTag === 'feature' || spansFootprint) {
          const { width, height } = options.texture;
          const straight = Math.min(entity.w / width, entity.h / height);
          const sideways = Math.min(entity.w / height, entity.h / width);
          const turn = sideways > straight * 1.1;
          if (turn) sprite.rotation = Math.PI / 2;
          if (spansFootprint) {
            // Long props use the generated direction and span, with either source image orientation.
            sprite.width = turn ? entity.h : entity.w;
            sprite.height = turn ? entity.w : entity.h;
          } else sprite.scale.set(turn ? sideways : straight);
        } else if (entity.builtin) {
          sprite.scale.set(Math.min(entity.w / options.texture.width, entity.h / options.texture.height));
        } else {
          sprite.width = entity.w;
          sprite.height = entity.h;
        }
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
        // Softened sepia/parchment twin-peak silhouette so labels and rivers remain dominant
        gfx.ellipse(r * 0.2, r * 0.58, r * 0.95, r * 0.28).fill({ color: 0x261d14, alpha: 0.18 });
        gfx.moveTo(-r, r * 0.65).lineTo(-r * 0.42, -r * 0.28).lineTo(-r * 0.16, r * 0.08).lineTo(r * 0.22, -r).lineTo(r, r * 0.65).closePath()
          .fill(0xb2a58e).stroke({ color: 0x4d3d2e, alpha: 0.78, width: r * 0.055, join: 'round' });
        // SE shadow facets
        gfx.moveTo(-r * 0.42, -r * 0.28).lineTo(-r * 0.38, r * 0.55).lineTo(-r * 0.16, r * 0.08).closePath().fill({ color: 0x5c4c3c, alpha: 0.44 });
        gfx.moveTo(r * 0.22, -r).lineTo(r * 0.2, r * 0.65).lineTo(r, r * 0.65).closePath().fill({ color: 0x5c4c3c, alpha: 0.48 });
        // Ridge ink line + muted warm parchment snowcap
        gfx.moveTo(r * 0.22, -r).lineTo(r * 0.18, r * 0.62).stroke({ color: 0x4d3d2e, alpha: 0.72, width: r * 0.045 });
        gfx.moveTo(r * 0.22, -r).lineTo(r * 0.08, -r * 0.46).lineTo(r * 0.24, -r * 0.52).lineTo(r * 0.44, -r * 0.4).closePath().fill({ color: 0xefe7d3, alpha: 0.72 });
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
      } else if (builtin === 'sarcophagus') {
        const coffin = (x: number, y: number) => gfx
          .moveTo(x - .92 * r, y - .57 * r).lineTo(x - .56 * r, y - .88 * r)
          .lineTo(x + .86 * r, y - .62 * r).lineTo(x + .95 * r, y + .59 * r)
          .lineTo(x - .56 * r, y + .86 * r).lineTo(x - .92 * r, y + .53 * r).closePath();
        coffin(.09 * r, .13 * r).fill({ color: 0x18100a, alpha: .46 });
        coffin(0, 0).fill(0xc4b69e).stroke({ color: 0x3a2d24, width: r * .075, join: 'round' });
        gfx.circle(-.55 * r, -.02 * r, .16 * r).fill(0x8f7f6a);
        gfx.ellipse(.08 * r, 0, .43 * r, .30 * r).fill(0x9e8e76).stroke({ color: 0x6e5d4b, width: r * .05 });
        gfx.moveTo(-.16 * r, -.27 * r).lineTo(.25 * r, .25 * r)
          .moveTo(-.16 * r, .27 * r).lineTo(.25 * r, -.25 * r).stroke({ color: 0xe4d4b8, width: r * .065 });
      } else if (builtin === 'burialBell') {
        gfx.circle(.08 * r, .13 * r, .76 * r).fill({ color: 0x17110b, alpha: .42 });
        gfx.circle(0, 0, .76 * r).fill(0xb38b51).stroke({ color: 0x473323, width: r * .09 });
        gfx.circle(0, 0, .58 * r).fill(0x6d4d30).stroke({ color: 0xe4bb69, width: r * .075 });
        gfx.circle(-.07 * r, 0, .17 * r).fill(0xd5b271);
      } else if (builtin === 'pumpWheel' || builtin === 'winch') {
        const body = builtin === 'pumpWheel' ? 0x43776d : 0x71533f;
        gfx.roundRect(-.83 * r, -.69 * r, 1.8 * r, 1.55 * r, .11 * r).fill({ color: 0x18100a, alpha: .43 });
        gfx.roundRect(-.93 * r, -.81 * r, 1.8 * r, 1.55 * r, .11 * r).fill(body)
          .stroke({ color: 0x252a24, width: r * .09 });
        gfx.circle(-.05 * r, -.04 * r, .55 * r).stroke({ color: 0xdec087, width: r * .13 });
        for (let i = 0; i < 4; i++) {
          const a = i * Math.PI / 4;
          gfx.moveTo((-0.05 - Math.cos(a) * .52) * r, (-.04 - Math.sin(a) * .52) * r)
            .lineTo((-0.05 + Math.cos(a) * .52) * r, (-.04 + Math.sin(a) * .52) * r)
            .stroke({ color: 0xc39c63, width: r * .075 });
        }
        gfx.circle(-.05 * r, -.04 * r, .12 * r).fill(0x3a352e);
      } else if (builtin === 'barricade') {
        for (let i = 0; i < 4; i++) {
          const x = (-.95 + i * .46) * r, y = (i % 2 === 0 ? -.66 : -.45) * r;
          gfx.roundRect(x, y, .52 * r, 1.1 * r, .06 * r).fill(i % 2 === 0 ? 0x84674b : 0x6b523b)
            .stroke({ color: 0x3d2c20, width: r * .065 });
        }
        gfx.roundRect(-.98 * r, -.10 * r, 1.96 * r, .33 * r, .045 * r).fill(0x9c7750)
          .stroke({ color: 0x3d2c20, width: r * .065 });
      } else if (builtin === 'strongbox') {
        gfx.roundRect(-.93 * r, -.50 * r, 1.98 * r, 1.25 * r, .11 * r).fill({ color: 0x17110b, alpha: .46 });
        gfx.roundRect(-r, -.63 * r, 2 * r, 1.25 * r, .11 * r).fill(0x795239)
          .stroke({ color: 0x34261f, width: r * .09 });
        for (const x of [-.72, .57]) gfx.rect(x * r, -.63 * r, .15 * r, 1.25 * r).fill(0x343d39);
        gfx.moveTo(-.95 * r, .15 * r).lineTo(.95 * r, .15 * r).stroke({ color: 0xc39960, width: r * .08 });
        gfx.circle(0, .17 * r, .16 * r).fill(0xd1a359);
      } else if (builtin === 'settlement') {
        gfx.ellipse(r * 0.14, r * 0.78, r * 0.85, r * 0.28).fill({ color: 0x261d14, alpha: 0.28 });
        gfx.rect(-r * 0.68, -r * 0.05, r * 1.36, r * 0.95).fill(0xe8dcc2).stroke({ color: 0x36271a, width: r * 0.07 });
        gfx.moveTo(-r * 0.92, -r * 0.05).lineTo(0, -r * 0.92).lineTo(r * 0.92, -r * 0.05).closePath()
          .fill(entity.suggestedSettlement ? 0xc2863a : 0x9c4c36).stroke({ color: 0x36271a, width: r * 0.07, join: 'round' });
        gfx.rect(-r * 0.18, r * 0.38, r * 0.36, r * 0.52).fill(0x4a382b);
      } else if (builtin === 'stronghold') {
        gfx.ellipse(r * 0.12, r * 0.8, r * 0.85, r * 0.25).fill({ color: 0x1e2024, alpha: 0.3 });
        gfx.rect(-r * 0.65, -r * 0.45, r * 1.3, r * 1.3).fill(0x9ca3af).stroke({ color: 0x27272a, width: r * 0.08 });
        for (const bx of [-0.65, -0.15, 0.35]) {
          gfx.rect(bx * r, -r * 0.75, r * 0.3, r * 0.3).fill(0x9ca3af).stroke({ color: 0x27272a, width: r * 0.07 });
        }
        gfx.rect(-r * 0.2, r * 0.3, r * 0.4, r * 0.55).fill(0x3f3f46);
      } else if (builtin === 'ruin') {
        gfx.ellipse(r * 0.1, r * 0.78, r * 0.85, r * 0.25).fill({ color: 0x1e2024, alpha: 0.28 });
        gfx.rect(-r * 0.65, -r * 0.35, r * 0.34, r * 1.15).fill(0xa8a29e).stroke({ color: 0x44403c, width: r * 0.07 });
        gfx.rect(r * 0.31, -r * 0.1, r * 0.34, r * 0.9).fill(0xa8a29e).stroke({ color: 0x44403c, width: r * 0.07 });
        gfx.moveTo(-r * 0.75, -r * 0.35).lineTo(r * 0.15, -r * 0.55).lineTo(r * 0.15, -r * 0.25).lineTo(-r * 0.75, -r * 0.15).closePath()
          .fill(0x78716c).stroke({ color: 0x44403c, width: r * 0.06 });
      } else if (builtin === 'lair') {
        gfx.moveTo(-r * 0.95, r * 0.8).lineTo(-r * 0.2, -r * 0.85).lineTo(r * 0.45, -r * 0.55).lineTo(r * 0.95, r * 0.8).closePath()
          .fill(0x6b655e).stroke({ color: 0x292524, width: r * 0.08, join: 'round' });
        gfx.arc(0, r * 0.8, r * 0.45, Math.PI, 0).closePath().fill(0x1c1917);
      } else if (builtin === 'sacred') {
        gfx.ellipse(0, 0, r * 0.85, r * 0.85).fill({ color: 0xfde68a, alpha: 0.18 });
        gfx.moveTo(-r * 0.35, r * 0.85).lineTo(-r * 0.25, -r * 0.75).lineTo(0, -r * 0.95).lineTo(r * 0.25, -r * 0.75).lineTo(r * 0.35, r * 0.85).closePath()
          .fill(0xd6d3d1).stroke({ color: 0x44403c, width: r * 0.07 });
        gfx.circle(0, -r * 0.2, r * 0.18).fill(0xf59e0b);
      } else if (builtin === 'travel') {
        gfx.ellipse(0, r * 0.75, r * 0.7, r * 0.22).fill({ color: 0x261d14, alpha: 0.25 });
        gfx.moveTo(0, -r * 0.85).lineTo(r * 0.75, 0).lineTo(0, r * 0.75).lineTo(-r * 0.75, 0).closePath()
          .fill(0x60a5fa).stroke({ color: 0x1e3a8a, width: r * 0.08, join: 'round' });
        gfx.circle(0, -r * 0.05, r * 0.2).fill(0xfef3c7);
      } else if (builtin === 'bed') {
        gfx.rect(-r * 0.88, -r * 0.88, r * 2, r * 2).fill({ color: 0x18100a, alpha: 0.28 });
        gfx.rect(-r, -r, r * 2, r * 2).fill(0x7c463c).stroke({ color: 0x38241a, width: r * 0.08 });
        gfx.rect(-r * 0.8, -r * 0.8, r * 1.6, r * 0.5).fill(0xeee7d7);
      } else if (builtin === 'fallenLog') {
        gfx.ellipse(0, r * 0.14, r * 0.96, r * 0.68).fill({ color: 0x18100a, alpha: 0.28 });
        gfx.roundRect(-r * 0.98, -r * 0.56, r * 1.96, r * 1.12, r * 0.45).fill(0x704e2e).stroke({ color: 0x2e1f12, width: r * 0.08 });
        for (const bx of [-0.5, 0.15, 0.65]) {
          gfx.moveTo(bx * r, -r * 0.32).lineTo((bx + 0.18) * r, r * 0.25).stroke({ color: 0x452d17, width: r * 0.06, cap: 'round' });
        }
        gfx.circle(-r * 0.35, -r * 0.28, r * 0.26).fill({ color: 0x4d733d, alpha: 0.78 });
      } else if (builtin === 'steppingStones') {
        for (const [sx, sy, sr, col] of [
          [-0.65, -0.1, 0.34, 0x8d887d], [-0.22, 0.18, 0.3, 0x9b9589],
          [0.2, -0.15, 0.35, 0x827d73], [0.64, 0.12, 0.32, 0x938d82],
        ] as const) {
          gfx.ellipse(sx * r, sy * r, sr * r, sr * r * 0.82).fill(col).stroke({ color: 0x332e27, width: r * 0.07 });
        }
      } else if (builtin === 'bridge') {
        // Stone shoreline abutments + bevelled oak deck planks + heavy side parapet rails
        gfx.rect(-r * 0.95, -r * 0.9, r * 1.98, r * 1.9).fill({ color: 0x18100a, alpha: 0.28 });
        for (const ax of [-1.02, 0.84]) {
          gfx.roundRect(ax * r, -r * 1.02, r * 0.2, r * 2.04, r * 0.04).fill(0x7a7468).stroke({ color: 0x332d26, width: r * 0.065 });
        }
        gfx.rect(-r * 0.92, -r * 0.88, r * 1.84, r * 1.76).fill(0xaa7f4b).stroke({ color: 0x3d2a19, width: r * 0.07 });
        for (let i = 1; i < 8; i++) {
          const px = -r * 0.92 + (i * r * 1.84) / 8;
          gfx.moveTo(px, -r * 0.84).lineTo(px, r * 0.84).stroke({ color: 0x5c3e24, width: r * 0.055 });
        }
        for (const ry of [-0.94, 0.78]) {
          gfx.rect(-r * 0.96, ry * r, r * 1.92, r * 0.18).fill(0x6e4a2a).stroke({ color: 0x2e1f12, width: r * 0.05 });
        }
        for (const px of [-0.92, 0, 0.92]) {
          for (const py of [-0.88, 0.88]) {
            gfx.circle(px * r, py * r, r * 0.1).fill(0x523922).stroke({ color: 0x24170c, width: r * 0.035 });
          }
        }
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
      } else if (builtin === 'dock') {
        // Full-frame harbor pier: shore stone bulkhead, planked timber deck, mooring pilings, and cargo crates
        gfx.rect(-r * 0.9, -r * 0.82, r * 1.92, r * 1.82).fill({ color: 0x162226, alpha: 0.28 });
        gfx.rect(-r, -r * 0.92, r * 2, r * 1.84).fill(0x8e653c).stroke({ color: 0x2e1f12, width: r * 0.075 });
        gfx.rect(-r, -r, r * 0.34, r * 2).fill(0x7c7466).stroke({ color: 0x332d26, width: r * 0.07 });
        for (let px = -0.65; px <= 0.88; px += 0.22) {
          gfx.moveTo(px * r, -r * 0.88).lineTo(px * r, r * 0.88).stroke({ color: 0x4b3420, width: r * 0.05 });
        }
        for (const mx of [-0.55, 0.25, 0.88]) {
          for (const my of [-0.9, 0.9]) {
            gfx.circle(mx * r, my * r, r * 0.14).fill(0x47311d).stroke({ color: 0x24170c, width: r * 0.045 });
          }
        }
        gfx.rect(-r * 0.5, -r * 0.52, r * 0.34, r * 0.48).fill(0xb38a55).stroke({ color: 0x3b2816, width: r * 0.045 });
      } else if (builtin === 'boat') {
        // Full-frame harbor merchant vessel: pointed oak hull, deck planks, cabins & angled canvas sail yard
        gfx.ellipse(r * 0.08, r * 0.18, r * 0.95, r * 0.82).fill({ color: 0x182b33, alpha: 0.28 });
        gfx.moveTo(-r * 0.96, 0)
          .quadraticCurveTo(-r * 0.35, -r * 0.92, r * 0.96, 0)
          .quadraticCurveTo(-r * 0.35, r * 0.92, -r * 0.96, 0)
          .closePath()
          .fill(0x9e7144)
          .stroke({ color: 0x382414, width: r * 0.075 });
        gfx.moveTo(-r * 0.72, 0).lineTo(r * 0.7, 0).stroke({ color: 0x5c3e22, width: r * 0.065 });
        for (const tx of [-0.4, 0.28]) {
          gfx.moveTo(tx * r, -r * 0.58).lineTo(tx * r, r * 0.58).stroke({ color: 0x4b331e, width: r * 0.06 });
        }
        gfx.rect(-r * 0.7, -r * 0.42, r * 0.34, r * 0.84).fill(0x6e4d2e).stroke({ color: 0x2e1f12, width: r * 0.045 });
        // Cream sail & dark spar angled across mid-deck
        gfx.moveTo(-r * 0.04, -r * 0.86)
          .quadraticCurveTo(r * 0.26, 0, -r * 0.04, r * 0.86)
          .lineTo(-r * 0.18, r * 0.82)
          .quadraticCurveTo(r * 0.08, 0, -r * 0.18, -r * 0.82)
          .closePath()
          .fill(0xf2e8cf)
          .stroke({ color: 0x523e28, width: r * 0.05 });
        gfx.circle(r * 0.02, 0, r * 0.1).fill(0x3b2816);
      } else if (builtin === 'manhole') {
        gfx.circle(0, 0, r * 0.55).fill(0x3a4745).stroke({ color: 0x1b2422, width: r * 0.09 });
        gfx.moveTo(-r * 0.3, -r * 0.2).lineTo(r * 0.3, -r * 0.2)
          .moveTo(-r * 0.32, 0).lineTo(r * 0.32, 0)
          .moveTo(-r * 0.3, r * 0.2).lineTo(r * 0.3, r * 0.2)
          .stroke({ color: 0x1b2422, width: r * 0.06 });
      } else if (builtin === 'tuft') {
        for (const [dx, dy, h] of [[-0.36, 0.15, 0.38], [-0.05, 0.22, 0.48], [0.28, 0.18, 0.36]] as const) {
          gfx.moveTo(dx * r, dy * r)
            .quadraticCurveTo((dx - 0.06) * r, (dy - h * 0.6) * r, (dx + 0.04) * r, (dy - h) * r)
            .stroke({ color: 0x4f6338, alpha: 0.72, width: r * 0.055, cap: 'round' });
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
      // Soft multi-stop feathered radial falloff (avoids harsh flat spotlight rings)
      gfx.circle(0, 0, entity.radius).fill({ color: colorNum, alpha: 0.045 });
      gfx.circle(0, 0, entity.radius * 0.68).fill({ color: colorNum, alpha: 0.055 });
      gfx.circle(0, 0, entity.radius * 0.38).fill({ color: colorNum, alpha: 0.075 });
      gfx.circle(0, 0, Math.max(0.24, strokeUnit * 3.2)).fill({ color: colorNum, alpha: 0.78 });
      if (options.selected) {
        gfx.circle(0, 0, entity.radius).stroke({ width: strokeUnit, color: 0xfbbf24 });
      }
      container.addChild(gfx);
      break;
    }

    case 'label': {
      container.position.set(entity.x, entity.y);
      const fontSize = entity.id.startsWith('gm-cue-') || entity.id.startsWith('gm-title-')
        ? Math.max(9, entity.size)
        : Math.max(14, entity.size);
      const labelScale = 1 / Math.max(1e-8, options.zoom * 1.35);
      const isSeaLabel = entity.id.startsWith('label-ocean') || entity.text === entity.text.toUpperCase() && entity.text.length >= 6;
      const isRegionLabel = entity.id.startsWith('label-mountains') || entity.id.startsWith('label-forest') || entity.id.startsWith('label-subregion-');
      const isGmCue = entity.id.startsWith('gm-cue-') || entity.id.startsWith('gm-title-');
      const haloColor = isSeaLabel ? 0xc7e0e2 : 0xf4ead2;
      const textFill = options.selected ? 0xfbbf24 : isGmCue ? 0x5b21b6 : isSeaLabel ? 0x162d3b : isRegionLabel ? 0x3a2614 : 0x261a10;
      const fontStyle = isSeaLabel || isRegionLabel || entity.id.startsWith('gm-cue-') ? 'italic' : 'normal';
      // Soft wide translucent halo underlay before crisp serif text
      const halo = new Text({
        text: entity.text,
        style: {
          fontSize,
          fill: haloColor,
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontStyle,
          fontWeight: 'bold',
          letterSpacing: isSeaLabel ? 3 : isRegionLabel ? 1 : 0,
          stroke: { color: haloColor, width: 7.5 },
        },
      });
      halo.anchor.set(0.5);
      halo.eventMode = 'none';
      halo.alpha = isSeaLabel ? 0.3 : 0.42;
      halo.scale.set(labelScale);
      container.addChild(halo);

      const text = new Text({
        text: entity.text,
        style: {
          fontSize,
          fill: textFill,
          fontFamily: 'Georgia, "Times New Roman", serif',
          fontStyle,
          fontWeight: 'bold',
          letterSpacing: isSeaLabel ? 3 : isRegionLabel ? 1 : 0,
          stroke: { color: haloColor, width: 1.8 },
        },
      });
      text.anchor.set(0.5);
      text.eventMode = 'none';
      text.scale.set(labelScale);
      container.addChild(text);
      break;
    }

    case 'portal': {
      container.position.set(entity.x, entity.y);
      const gfx = new Graphics();
      gfx.eventMode = 'none';
      drawConnectorSymbol(gfx, entity, strokeUnit, options.zoom, options.selected);
      container.addChild(gfx);
      break;
    }

    case 'place': {
      // Places group other entities and carry notes; no standalone geometry.
      break;
    }
  }

  const isGmOnly = Boolean(entity.gmOnly || options.layerGmOnly);
  if (isGmOnly && entity.type !== 'place' && entity.type !== 'area' && entity.type !== 'path' && !(entity.type === 'door' && entity.kind === 'secret')) {
    const gmBadge = new Graphics();
    gmBadge.eventMode = 'none';
    if (entity.type === 'label') {
      // Mark GM-only labels with a subtle dashed underline clear of glyphs (never stamp a diamond over text)
      const labelScale = 1 / Math.max(1e-8, options.zoom * 1.35);
      const halfW = Math.max(12, entity.text.length * Math.max(14, entity.size) * 0.28) * labelScale;
      const uy = Math.max(14, entity.size) * 0.56 * labelScale;
      drawDashedPolyline(
        gmBadge,
        [{ x: -halfW, y: uy }, { x: halfW, y: uy }],
        { x: 0, y: 0 },
        strokeUnit * 3.5,
        strokeUnit * 2.5,
        false,
      );
      gmBadge.stroke({ width: strokeUnit * 0.9, color: 0x7e22ce, alpha: 0.65 });
    } else if (entity.type === 'prop') {
      const ringR = Math.max(0.55, (entity.w ?? 1.3) * 0.68);
      const col = entity.suggestedSettlement ? 0xd99b38 : 0xa855f7;
      gmBadge.circle(0, 0, ringR).stroke({ width: strokeUnit * 1.05, color: col, alpha: 0.72 });
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
