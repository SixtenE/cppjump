import { TILE_FULL } from './constants';
import { tilemapGetTileFullOutside, tilemapIsTileFull } from './tilemap';

export function getAutotileSpriteCoords(
  tilemapRows: string[],
  x: number,
  y: number,
): { spriteX: number; spriteY: number } {
  const tile = tilemapGetTileFullOutside(tilemapRows, x, y);

  const top = tilemapGetTileFullOutside(tilemapRows, x, y - 1);
  const bottom = tilemapGetTileFullOutside(tilemapRows, x, y + 1);
  const right = tilemapGetTileFullOutside(tilemapRows, x + 1, y);
  const left = tilemapGetTileFullOutside(tilemapRows, x - 1, y);
  const topRight = tilemapGetTileFullOutside(tilemapRows, x + 1, y - 1);
  const bottomRight = tilemapGetTileFullOutside(tilemapRows, x + 1, y + 1);
  const topLeft = tilemapGetTileFullOutside(tilemapRows, x - 1, y - 1);
  const bottomLeft = tilemapGetTileFullOutside(tilemapRows, x - 1, y + 1);

  let spriteX = 0;
  let spriteY = 0;

  switch (tile) {
    case TILE_FULL: {
      spriteX = 1;
      spriteY = 1;
      if (top === TILE_FULL) spriteY += 1;
      if (bottom === TILE_FULL) spriteY -= 1;
      if (right === TILE_FULL) spriteX -= 1;
      if (left === TILE_FULL) spriteX += 1;

      if (top !== TILE_FULL && bottom !== TILE_FULL && right !== TILE_FULL && left !== TILE_FULL) {
        spriteX = 3;
        spriteY = 3;
      }

      if (left !== TILE_FULL && right !== TILE_FULL && spriteX === 1) spriteX = 3;
      if (top !== TILE_FULL && bottom !== TILE_FULL && spriteY === 1) spriteY = 3;

      if (spriteX === 1 && spriteY === 1) {
        if (
          topRight !== TILE_FULL &&
          bottomRight === TILE_FULL &&
          topLeft === TILE_FULL &&
          bottomLeft === TILE_FULL
        ) {
          spriteX = 4;
          spriteY = 2;
        }

        if (
          topRight === TILE_FULL &&
          bottomRight !== TILE_FULL &&
          topLeft === TILE_FULL &&
          bottomLeft === TILE_FULL
        ) {
          spriteX = 4;
          spriteY = 0;
        }

        if (
          topRight === TILE_FULL &&
          bottomRight === TILE_FULL &&
          topLeft !== TILE_FULL &&
          bottomLeft === TILE_FULL
        ) {
          spriteX = 6;
          spriteY = 2;
        }

        if (
          topRight === TILE_FULL &&
          bottomRight === TILE_FULL &&
          topLeft === TILE_FULL &&
          bottomLeft !== TILE_FULL
        ) {
          spriteX = 6;
          spriteY = 0;
        }
      }
      break;
    }
    default:
      break;
  }

  return { spriteX, spriteY };
}

export function getAutotileFrameIndex(tilemapRows: string[], x: number, y: number): number {
  if (!tilemapIsTileFull(tilemapRows, x, y)) return -1;
  const { spriteX, spriteY } = getAutotileSpriteCoords(tilemapRows, x, y);
  const cols = 7;
  return spriteY * cols + spriteX;
}
