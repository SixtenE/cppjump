import {
  PLAYER_SIZE,
  PLAYER_GRAVITY,
  PLAYER_SPEED,
  PLAYER_JUMP_STRENGTH,
  DEBUG_FLY_SPEED,
  TILEMAP_SIZE_X,
  TILEMAP_SIZE_Y,
  TILE_PIXELS,
} from './constants';
import { isBoxCollidingWithTilemap } from './collision';
import type { Vec2, TileGrid, PlayerState, PlayerKeys, FlyKeys } from './types';

function vecLength(v: Vec2): number {
  return Math.hypot(v.x, v.y);
}

function vecNormalize(v: Vec2): Vec2 {
  const l = vecLength(v);
  if (l <= 0) return { x: 0, y: 0 };
  return { x: v.x / l, y: v.y / l };
}

function vecScale(v: Vec2, s: number): Vec2 {
  return { x: v.x * s, y: v.y * s };
}

function vecAdd(a: Vec2, b: Vec2): Vec2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

export function createPlayer(): PlayerState {
  return {
    position: {
      x: (TILEMAP_SIZE_X * TILE_PIXELS) / (2 * TILE_PIXELS),
      y: (TILEMAP_SIZE_Y * TILE_PIXELS) / (2 * TILE_PIXELS),
    },
    velocity: { x: 0, y: 0 },
    jumpHoldTime: 0,
    animTime: 0,
    isOnGround: false,
    isFacingRight: true,
  };
}

export function computePlayerSprite(p: PlayerState): number {
  let sprite = 0;
  if (p.isOnGround) {
    sprite = 0;
    if (Math.abs(p.velocity.x) > 0.01) {
      sprite = 1 + (Math.floor(p.animTime * 6.0) % 2);
    }
    if (p.jumpHoldTime > 0.001) {
      sprite = 4;
    }
  } else {
    sprite = p.velocity.y > 0 ? 5 : 6;
  }
  return sprite;
}

export function updatePlayer(
  player: PlayerState,
  tiles: TileGrid,
  tilemapHeight: number,
  delta: number,
  keys: PlayerKeys,
): void {
  player.velocity.y += PLAYER_GRAVITY * delta;
  const isOnGround = isBoxCollidingWithTilemap(tiles, tilemapHeight, {
    x: player.position.x,
    y: player.position.y + PLAYER_SIZE.y,
  }, { x: 0.1, y: 0.05 });

  player.isOnGround = isOnGround;

  if (isOnGround) {
    player.velocity.x = 0;

    if (keys.spaceReleased) {
      const jumpStrength = clamp(player.jumpHoldTime * 2.6, 1.1, 2.0) / 2.0;

      let dir: Vec2 = { x: 0.0, y: -1.0 };
      const xMoveStrength = 0.75 - jumpStrength * 0.5;
      if (keys.rightDown) dir.x += xMoveStrength;
      if (keys.leftDown) dir.x -= xMoveStrength;
      dir = vecNormalize(dir);
      dir = vecScale(dir, jumpStrength * PLAYER_JUMP_STRENGTH);
      player.velocity = dir;
    }

    if (keys.spaceDown) {
      player.jumpHoldTime += delta;
    } else {
      player.jumpHoldTime = 0.0;
      if (keys.rightDown) {
        player.velocity.x += PLAYER_SPEED * delta;
        player.isFacingRight = true;
      }
      if (keys.leftDown) {
        player.velocity.x -= PLAYER_SPEED * delta;
        player.isFacingRight = false;
      }

      if (keys.leftPressed || keys.rightPressed) {
        player.animTime = 0;
      }
    }
  } else {
    player.jumpHoldTime = 0.0;
  }

  let vel = vecLength(player.velocity);
  if (vel > 25.0) vel = 25.0;
  const n = vecNormalize(player.velocity);
  player.velocity = vecScale(n, vel);

  player.position = vecAdd(player.position, vecScale(player.velocity, delta));
}

export function updatePlayerDebugFly(
  player: PlayerState,
  _tiles: TileGrid,
  tilemapHeight: number,
  delta: number,
  keys: FlyKeys,
): void {
  let vx = 0;
  let vy = 0;
  if (keys.rightDown) vx += 1;
  if (keys.leftDown) vx -= 1;
  if (keys.downDown) vy += 1;
  if (keys.upDown) vy -= 1;

  const len = Math.hypot(vx, vy);
  if (len > 1e-6) {
    vx /= len;
    vy /= len;
  }

  const flySpeed = keys.shiftDown ? DEBUG_FLY_SPEED : DEBUG_FLY_SPEED * 0.5;
  player.velocity.x = vx * flySpeed;
  player.velocity.y = vy * flySpeed;

  if (keys.rightDown) player.isFacingRight = true;
  if (keys.leftDown) player.isFacingRight = false;

  player.jumpHoldTime = 0;

  player.isOnGround = isBoxCollidingWithTilemap(_tiles, tilemapHeight, {
    x: player.position.x,
    y: player.position.y + PLAYER_SIZE.y,
  }, { x: 0.1, y: 0.05 });

  let vel = vecLength(player.velocity);
  if (vel > 25.0) vel = 25.0;
  player.velocity = vecScale(vecNormalize(player.velocity), vel);

  player.position = vecAdd(player.position, vecScale(player.velocity, delta));
}
