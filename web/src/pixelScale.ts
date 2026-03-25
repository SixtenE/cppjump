import { VIEW_PIXELS_X, VIEW_PIXELS_Y } from './game/constants';

export function getIntegerPixelScale(parent: HTMLElement | null): number {
  if (!parent) return 1;
  const zw = Math.floor(parent.clientWidth / VIEW_PIXELS_X);
  const zh = Math.floor(parent.clientHeight / VIEW_PIXELS_Y);
  return Math.max(1, Math.min(zw, zh));
}

export function getDebugTextResolution(parent: HTMLElement | null): number {
  const z = getIntegerPixelScale(parent);
  const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
  return Math.max(2, Math.min(8, Math.ceil(z * dpr)));
}
