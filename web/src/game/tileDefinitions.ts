export const TILEMAP_COLS = 7;
export const TILEMAP_ROWS = 6;
export const TOTAL_FRAMES = TILEMAP_COLS * TILEMAP_ROWS;

const nonSolidFrames = new Set<number>([
  // Add decorative / non-collision frame indices here as needed
]);

export function isTileSolid(frameIndex: number): boolean {
  if (frameIndex < 0) return false;
  return !nonSolidFrames.has(frameIndex);
}
