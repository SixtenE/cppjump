import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { VIEW_PIXELS_X, VIEW_PIXELS_Y, BACKGROUND_COLOR } from './game/constants';
import { setupTouchControls } from './game/touchControls';

function applyResponsiveScale(game: Phaser.Game): void {
  const parent = game.canvas.parentElement;
  if (!parent) return;

  // Use the available viewport. The game is a fixed 4:3 (VIEW_PIXELS_X x
  // VIEW_PIXELS_Y). Fit it so the whole canvas is visible without cropping:
  //   - Wide viewports (desktop): fit to HEIGHT, derive width.
  //   - Narrow viewports (mobile portrait): fit to WIDTH, derive height.
  const availW = window.innerWidth;
  const availH = window.innerHeight;
  const gameAspect = VIEW_PIXELS_X / VIEW_PIXELS_Y;
  const viewAspect = availW / availH;

  let w: number;
  let h: number;
  if (viewAspect > gameAspect) {
    // Viewport is wider than the game -> height is the binding constraint.
    h = availH;
    w = Math.round(h * gameAspect);
  } else {
    // Viewport is narrower than the game -> width is the binding constraint.
    w = availW;
    h = Math.round(w / gameAspect);
  }

  game.registry.set('integerPixelScale', Math.max(1, Math.floor(w / VIEW_PIXELS_X)));
  const canvas = game.canvas;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
}

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: VIEW_PIXELS_X,
  height: VIEW_PIXELS_Y,
  parent: 'app',
  pixelArt: true,
  backgroundColor: BACKGROUND_COLOR,
  scene: [GameScene],
  fps: {
    target: 120,
    forceSetTimeOut: false,
  },
};

const game = new Phaser.Game(config);
applyResponsiveScale(game);
setupTouchControls();

function onResize(): void {
  applyResponsiveScale(game);
  const scene = game.scene.getScene('GameScene');
  if (scene && scene.scene.isActive() && scene instanceof GameScene) {
    scene.refreshDebugTextResolution();
  }
}

window.addEventListener('resize', onResize);
requestAnimationFrame(() => onResize());
