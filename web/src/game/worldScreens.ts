import { TILEMAP_SIZE_Y } from './constants';
import { screens, SCREEN_COUNT } from './levelData';
import type { ActiveScreenInfo } from './types';

export function getScreenHeightIndex(height: number): number {
  return Math.floor(-height / TILEMAP_SIZE_Y);
}

export function getActiveScreen(playerY: number): ActiveScreenInfo {
  let screenIndex = SCREEN_COUNT - getScreenHeightIndex(playerY) - 2;
  if (screenIndex < 0 || screenIndex > SCREEN_COUNT) {
    screenIndex = 0;
  }

  const heightIndex = getScreenHeightIndex(playerY);
  const screenOffsetY = -(heightIndex + 1) * TILEMAP_SIZE_Y;
  const tiles = screens[screenIndex % SCREEN_COUNT].tiles;

  return { screenIndex, tiles, heightIndex, screenOffsetY };
}
