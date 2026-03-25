import Phaser from 'phaser';
import { EditorScene, CANVAS_W, CANVAS_H } from './EditorScene';

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  width: CANVAS_W,
  height: CANVAS_H,
  parent: 'editor-canvas',
  pixelArt: true,
  backgroundColor: 0x1a1a2e,
  scene: [EditorScene],
  audio: { noAudio: true },
};

const game = new Phaser.Game(config);

function applyEditorScale(): void {
  const parent = document.getElementById('editor-canvas');
  if (!parent) return;
  const canvas = parent.querySelector('canvas');
  if (!canvas) return;
  const maxW = window.innerWidth - 40;
  const maxH = window.innerHeight - 120;
  const scale = Math.max(1, Math.min(Math.floor(maxW / CANVAS_W), Math.floor(maxH / CANVAS_H)));
  canvas.style.width = `${CANVAS_W * scale}px`;
  canvas.style.height = `${CANVAS_H * scale}px`;
}

applyEditorScale();
window.addEventListener('resize', applyEditorScale);
requestAnimationFrame(applyEditorScale);

void game;
