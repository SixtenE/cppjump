import {
  TILEMAP_SIZE_X,
  TILEMAP_SIZE_Y,
  TILE_EMPTY,
  TILE_ZERO,
  TILE_FULL,
  OUTSIDE_TILE_HORIZONTAL,
  OUTSIDE_TILE_VERTICAL,
} from './constants';

export function tilemapGetTile(tilemapRows: string[], x: number, y: number): number {
  if (x < 0 || x >= TILEMAP_SIZE_X) return OUTSIDE_TILE_HORIZONTAL;
  if (y < 0 || y >= TILEMAP_SIZE_Y) return OUTSIDE_TILE_VERTICAL;
  return tilemapRows[y].charCodeAt(x);
}

export function tilemapGetTileFullOutside(tilemapRows: string[], x: number, y: number): number {
  if (x < 0 || x >= TILEMAP_SIZE_X) return TILE_FULL;
  if (y < 0 || y >= TILEMAP_SIZE_Y) return TILE_FULL;
  return tilemapRows[y].charCodeAt(x);
}

export function tilemapIsTileFull(tilemapRows: string[], x: number, y: number): boolean {
  const tile = tilemapGetTile(tilemapRows, x, y);
  if (tile === TILE_EMPTY || tile === TILE_ZERO) return false;
  return true;
}
