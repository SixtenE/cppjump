export const TILEMAP_SIZE_X = 16;
export const TILEMAP_SIZE_Y = 12;
export const TILE_PIXELS = 16;

export const TILE_EMPTY = ' '.charCodeAt(0);
export const TILE_ZERO = 0;
export const TILE_FULL = '#'.charCodeAt(0);

export const OUTSIDE_TILE_HORIZONTAL: number = TILE_FULL;
export const OUTSIDE_TILE_VERTICAL: number = TILE_EMPTY;

export const BOUNCE_FACTOR_X = 0.45;

export const VIEW_PIXELS_X = TILEMAP_SIZE_X * TILE_PIXELS;
export const VIEW_PIXELS_Y = TILEMAP_SIZE_Y * TILE_PIXELS;

export const BACKGROUND_COLOR = 0x0f052d;

export const PLAYER_SIZE = { x: 0.3, y: 0.4 } as const;
export const PLAYER_GRAVITY = 30.0;
export const PLAYER_SPEED = 200.0;
export const PLAYER_GROUND_FRICTION_X = 70.0;
export const PLAYER_JUMP_STRENGTH = 15.0;

/** Tile-units per second (same max magnitude cap as normal movement). */
export const DEBUG_FLY_SPEED = 14.0;
