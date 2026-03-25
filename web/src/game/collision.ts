import { TILEMAP_SIZE_X, TILEMAP_SIZE_Y, BOUNCE_FACTOR_X } from './constants';
import { isTileSolid } from './tileDefinitions';
import type { Vec2, TileGrid, BoxOverlap } from './types';

function isCellSolid(tiles: TileGrid, x: number, y: number): boolean {
  if (x < 0 || x >= TILEMAP_SIZE_X) return true;
  if (y < 0 || y >= TILEMAP_SIZE_Y) return false;
  return isTileSolid(tiles[y][x]);
}

export function getTilesOverlappedByBox(center: Vec2, size: Vec2): BoxOverlap {
  const startX = Math.floor(center.x - size.x);
  const startY = Math.floor(center.y - size.y);
  const endX = Math.floor(center.x + size.x);
  const endY = Math.floor(center.y + size.y);
  return { startX, startY, endX, endY };
}

export function isBoxCollidingWithTilemap(
  tiles: TileGrid,
  tilemapHeight: number,
  center: Vec2,
  size: Vec2,
): boolean {
  const c = { x: center.x, y: center.y - tilemapHeight };
  const { startX, startY, endX, endY } = getTilesOverlappedByBox(c, size);

  for (let x = startX; x <= endX; x++) {
    for (let y = startY; y <= endY; y++) {
      if (!isCellSolid(tiles, x, y)) continue;

      const boxPos = { x: 0.5 + x, y: 0.5 + y };
      const sizeSum = { x: size.x + 0.5, y: size.y + 0.5 };
      const surfDist = {
        x: Math.abs(c.x - boxPos.x) - sizeSum.x,
        y: Math.abs(c.y - boxPos.y) - sizeSum.y,
      };

      if (surfDist.x > 0 || surfDist.y > 0) continue;
      return true;
    }
  }

  return false;
}

export function resolveBoxCollisionWithTilemap(
  tiles: TileGrid,
  tilemapHeight: number,
  center: Vec2,
  velocity: Vec2,
  size: Vec2,
): void {
  center.y -= tilemapHeight;

  const { startX, startY, endX, endY } = getTilesOverlappedByBox(center, size);

  for (let x = startX; x <= endX; x++) {
    for (let y = startY; y <= endY; y++) {
      if (!isCellSolid(tiles, x, y)) continue;

      const boxPos = { x: 0.5 + x, y: 0.5 + y };
      const sizeSum = { x: size.x + 0.5, y: size.y + 0.5 };
      const surfDist = {
        x: Math.abs(center.x - boxPos.x) - sizeSum.x,
        y: Math.abs(center.y - boxPos.y) - sizeSum.y,
      };

      if (surfDist.x > 0 || surfDist.y > 0) continue;

      const isXEmpty = !isCellSolid(tiles, x + (center.x > boxPos.x ? 1 : -1), y);
      const isYEmpty = !isCellSolid(tiles, x, y + (center.y > boxPos.y ? 1 : -1));

      if (!isXEmpty && !isYEmpty) continue;

      let isClipAxisX = isXEmpty;
      if (isXEmpty && isYEmpty) {
        isClipAxisX = surfDist.x > surfDist.y;
      }

      if (isClipAxisX) {
        if (center.x > boxPos.x) {
          center.x = boxPos.x + sizeSum.x;
          if (velocity.x < 0.0) {
            velocity.x = -velocity.x * BOUNCE_FACTOR_X;
          }
        } else {
          center.x = boxPos.x - sizeSum.x;
          if (velocity.x > 0.0) {
            velocity.x = -velocity.x * BOUNCE_FACTOR_X;
          }
        }
      } else {
        if (center.y > boxPos.y) {
          center.y = boxPos.y + sizeSum.y;
          velocity.y = Math.max(velocity.y, 0.0);
        } else {
          center.y = boxPos.y - sizeSum.y;
          velocity.y = Math.min(velocity.y, 0.0);
        }
      }
    }
  }

  center.y += tilemapHeight;
}
