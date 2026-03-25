import { TILEMAP_SIZE_X, TILEMAP_SIZE_Y } from './constants';
import { screenTilemaps } from './tilemapData';
import { getAutotileFrameIndex } from './renderTiles';
import type { ScreenData } from './types';

function convertAsciiScreen(rows: string[]): ScreenData {
  const tiles: number[][] = [];
  for (let y = 0; y < TILEMAP_SIZE_Y; y++) {
    const row: number[] = [];
    for (let x = 0; x < TILEMAP_SIZE_X; x++) {
      row.push(getAutotileFrameIndex(rows, x, y));
    }
    tiles.push(row);
  }
  return { tiles };
}

export function createEmptyScreen(): ScreenData {
  return {
    tiles: Array.from({ length: TILEMAP_SIZE_Y }, () =>
      new Array<number>(TILEMAP_SIZE_X).fill(-1),
    ),
  };
}

export const screens: ScreenData[] = screenTilemaps.map(convertAsciiScreen);

export const SCREEN_COUNT = screens.length;
