export interface Vec2 {
  x: number;
  y: number;
}

export type TileGrid = number[][];

export interface ScreenData {
  tiles: TileGrid;
}

export interface PlayerState {
  position: Vec2;
  velocity: Vec2;
  jumpHoldTime: number;
  animTime: number;
  isOnGround: boolean;
  isFacingRight: boolean;
}

export interface PlayerKeys {
  spaceDown: boolean;
  spaceReleased: boolean;
  leftDown: boolean;
  rightDown: boolean;
  leftPressed: boolean;
  rightPressed: boolean;
}

export interface FlyKeys {
  upDown: boolean;
  leftDown: boolean;
  rightDown: boolean;
  downDown: boolean;
  shiftDown: boolean;
}

export interface BoxOverlap {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
}

export interface ActiveScreenInfo {
  screenIndex: number;
  tiles: TileGrid;
  heightIndex: number;
  screenOffsetY: number;
}
