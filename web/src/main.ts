import Phaser from 'phaser';
import { GameScene } from './scenes/GameScene';
import { VIEW_PIXELS_X, VIEW_PIXELS_Y, BACKGROUND_COLOR } from './game/constants';
import { setupTouchControls } from './game/touchControls';

function applyFullWidthScale(game: Phaser.Game): void {
  const parent = game.canvas.parentElement;
  if (!parent) return;
  const w = parent.clientWidth;
  const h = Math.round(w * (VIEW_PIXELS_Y / VIEW_PIXELS_X));
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
applyFullWidthScale(game);
setupTouchControls();

function onResize(): void {
  applyFullWidthScale(game);
  const scene = game.scene.getScene('GameScene');
  if (scene && scene.scene.isActive() && scene instanceof GameScene) {
    scene.refreshDebugTextResolution();
  }
}

window.addEventListener('resize', onResize);
requestAnimationFrame(() => onResize());
