import Phaser from 'phaser';
import { TILEMAP_SIZE_X, TILEMAP_SIZE_Y, TILE_PIXELS } from '../game/constants';
import { TILEMAP_COLS, TILEMAP_ROWS, TOTAL_FRAMES } from '../game/tileDefinitions';
import { screens, createEmptyScreen } from '../game/levelData';
import type { ScreenData } from '../game/types';

const GRID_X = 0;
const GRID_Y = 0;
const PALETTE_X = TILEMAP_SIZE_X * TILE_PIXELS + TILE_PIXELS;
const PALETTE_Y = 0;

export const CANVAS_W = PALETTE_X + TILEMAP_COLS * TILE_PIXELS;
export const CANVAS_H = TILEMAP_SIZE_Y * TILE_PIXELS;

interface GridCell {
  x: number;
  y: number;
}

export class EditorScene extends Phaser.Scene {
  private editorScreens!: ScreenData[];
  private currentScreenIndex = 1;
  private selectedFrame = 8;
  private isPainting = false;
  private isErasing = false;

  private gridSprites!: Phaser.GameObjects.Image[][];
  private paletteSprites!: Phaser.GameObjects.Image[];
  private gridOverlay!: Phaser.GameObjects.Graphics;
  private paletteHighlight!: Phaser.GameObjects.Graphics;
  private gridHover!: Phaser.GameObjects.Graphics;
  private infoText!: Phaser.GameObjects.Text;

  constructor() {
    super('EditorScene');
  }

  preload(): void {
    this.load.spritesheet('tilemap', '/tilemap.png', {
      frameWidth: TILE_PIXELS,
      frameHeight: TILE_PIXELS,
    });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(0x1a1a2e);

    this.editorScreens = screens.map(s => ({
      tiles: s.tiles.map(row => [...row]),
    }));
    this.currentScreenIndex = 1;
    this.selectedFrame = 8;
    this.isPainting = false;
    this.isErasing = false;

    this.gridSprites = [];
    for (let y = 0; y < TILEMAP_SIZE_Y; y++) {
      const row: Phaser.GameObjects.Image[] = [];
      for (let x = 0; x < TILEMAP_SIZE_X; x++) {
        const im = this.add
          .image(GRID_X + x * TILE_PIXELS, GRID_Y + y * TILE_PIXELS, 'tilemap', 0)
          .setOrigin(0, 0);
        im.setVisible(false);
        row.push(im);
      }
      this.gridSprites.push(row);
    }

    this.paletteSprites = [];
    for (let i = 0; i < TOTAL_FRAMES; i++) {
      const col = i % TILEMAP_COLS;
      const row = Math.floor(i / TILEMAP_COLS);
      const im = this.add
        .image(PALETTE_X + col * TILE_PIXELS, PALETTE_Y + row * TILE_PIXELS, 'tilemap', i)
        .setOrigin(0, 0);
      this.paletteSprites.push(im);
    }

    this.gridOverlay = this.add.graphics();
    this.drawGridOverlay();

    this.paletteHighlight = this.add.graphics();
    this.gridHover = this.add.graphics();

    this.infoText = this.add.text(
      PALETTE_X,
      PALETTE_Y + TILEMAP_ROWS * TILE_PIXELS + 8,
      '',
      {
        fontFamily: 'monospace',
        fontSize: '7px',
        color: '#aaaacc',
        lineSpacing: 2,
      },
    );

    this.game.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

    this.input.on('pointerdown', this.onPointerDown, this);
    this.input.on('pointermove', this.onPointerMove, this);
    this.input.on('pointerup', this.onPointerUp, this);

    this.input.keyboard!.on('keydown-OPEN_BRACKET', () => this.switchScreen(-1));
    this.input.keyboard!.on('keydown-CLOSE_BRACKET', () => this.switchScreen(1));

    this.refreshGrid();
    this.updatePaletteHighlight();
    this.updateInfo();
    this.connectControls();
  }

  private connectControls(): void {
    document.getElementById('btn-prev-screen')?.addEventListener('click', () => this.switchScreen(-1));
    document.getElementById('btn-next-screen')?.addEventListener('click', () => this.switchScreen(1));

    document.getElementById('btn-add-screen')?.addEventListener('click', () => {
      this.editorScreens.push(createEmptyScreen());
      this.currentScreenIndex = this.editorScreens.length - 1;
      this.afterScreenChange();
    });

    document.getElementById('btn-delete-screen')?.addEventListener('click', () => {
      if (this.editorScreens.length <= 1) return;
      this.editorScreens.splice(this.currentScreenIndex, 1);
      if (this.currentScreenIndex >= this.editorScreens.length) {
        this.currentScreenIndex = this.editorScreens.length - 1;
      }
      this.afterScreenChange();
    });

    document.getElementById('btn-export')?.addEventListener('click', () => this.exportJSON());

    document.getElementById('btn-import')?.addEventListener('click', () => {
      (document.getElementById('file-import') as HTMLInputElement | null)?.click();
    });

    document.getElementById('file-import')?.addEventListener('change', (e) => {
      const input = e.target as HTMLInputElement;
      const file = input.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          this.importJSON(ev.target?.result as string);
        } catch (err) {
          alert('Invalid JSON: ' + (err instanceof Error ? err.message : String(err)));
        }
      };
      reader.readAsText(file);
      input.value = '';
    });
  }

  private switchScreen(dir: number): void {
    const next = this.currentScreenIndex + dir;
    if (next < 0 || next >= this.editorScreens.length) return;
    this.currentScreenIndex = next;
    this.afterScreenChange();
  }

  private afterScreenChange(): void {
    this.refreshGrid();
    this.updateInfo();
    this.updateScreenLabel();
  }

  private updateScreenLabel(): void {
    const el = document.getElementById('screen-label');
    if (el) el.textContent = `Screen ${this.currentScreenIndex + 1} / ${this.editorScreens.length}`;
  }

  private getGridCell(pointer: Phaser.Input.Pointer): GridCell | null {
    const x = Math.floor((pointer.x - GRID_X) / TILE_PIXELS);
    const y = Math.floor((pointer.y - GRID_Y) / TILE_PIXELS);
    if (x >= 0 && x < TILEMAP_SIZE_X && y >= 0 && y < TILEMAP_SIZE_Y) return { x, y };
    return null;
  }

  private getPaletteFrame(pointer: Phaser.Input.Pointer): number | null {
    const col = Math.floor((pointer.x - PALETTE_X) / TILE_PIXELS);
    const row = Math.floor((pointer.y - PALETTE_Y) / TILE_PIXELS);
    if (col >= 0 && col < TILEMAP_COLS && row >= 0 && row < TILEMAP_ROWS) {
      return row * TILEMAP_COLS + col;
    }
    return null;
  }

  private onPointerDown(pointer: Phaser.Input.Pointer): void {
    const frame = this.getPaletteFrame(pointer);
    if (frame !== null) {
      this.selectedFrame = frame;
      this.updatePaletteHighlight();
      this.updateInfo();
      return;
    }

    const cell = this.getGridCell(pointer);
    if (!cell) return;

    if (pointer.middleButtonDown()) {
      const picked = this.editorScreens[this.currentScreenIndex]?.tiles[cell.y]?.[cell.x];
      if (picked != null && picked >= 0) {
        this.selectedFrame = picked;
        this.updatePaletteHighlight();
        this.updateInfo();
      }
      return;
    }

    if (pointer.rightButtonDown()) {
      this.isErasing = true;
      this.paintCell(cell.x, cell.y, -1);
    } else {
      this.isPainting = true;
      this.paintCell(cell.x, cell.y, this.selectedFrame);
    }
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    const cell = this.getGridCell(pointer);
    this.updateGridHover(cell);
    this.updateInfo(cell);

    if (!cell) return;
    if (this.isErasing) this.paintCell(cell.x, cell.y, -1);
    else if (this.isPainting) this.paintCell(cell.x, cell.y, this.selectedFrame);
  }

  private onPointerUp(): void {
    this.isPainting = false;
    this.isErasing = false;
  }

  private paintCell(x: number, y: number, frame: number): void {
    const screen = this.editorScreens[this.currentScreenIndex];
    if (!screen) return;
    screen.tiles[y][x] = frame;
    this.refreshGridCell(x, y, screen);
  }

  private refreshGrid(): void {
    const screen = this.editorScreens[this.currentScreenIndex];
    for (let y = 0; y < TILEMAP_SIZE_Y; y++) {
      for (let x = 0; x < TILEMAP_SIZE_X; x++) {
        this.refreshGridCell(x, y, screen);
      }
    }
    this.updateScreenLabel();
  }

  private refreshGridCell(x: number, y: number, screen?: ScreenData): void {
    if (!screen) screen = this.editorScreens[this.currentScreenIndex];
    const im = this.gridSprites[y][x];
    const frame = screen.tiles[y][x];
    if (frame < 0) {
      im.setVisible(false);
    } else {
      im.setVisible(true);
      im.setFrame(frame);
    }
  }

  private drawGridOverlay(): void {
    const g = this.gridOverlay;
    g.lineStyle(1, 0x444466, 0.4);
    const gw = TILEMAP_SIZE_X * TILE_PIXELS;
    const gh = TILEMAP_SIZE_Y * TILE_PIXELS;
    for (let x = 0; x <= TILEMAP_SIZE_X; x++) {
      g.lineBetween(GRID_X + x * TILE_PIXELS, GRID_Y, GRID_X + x * TILE_PIXELS, GRID_Y + gh);
    }
    for (let y = 0; y <= TILEMAP_SIZE_Y; y++) {
      g.lineBetween(GRID_X, GRID_Y + y * TILE_PIXELS, GRID_X + gw, GRID_Y + y * TILE_PIXELS);
    }
    g.lineStyle(1, 0x666688, 0.6);
    g.strokeRect(PALETTE_X - 1, PALETTE_Y - 1, TILEMAP_COLS * TILE_PIXELS + 2, TILEMAP_ROWS * TILE_PIXELS + 2);
  }

  private updatePaletteHighlight(): void {
    const g = this.paletteHighlight;
    g.clear();
    const col = this.selectedFrame % TILEMAP_COLS;
    const row = Math.floor(this.selectedFrame / TILEMAP_COLS);
    g.lineStyle(2, 0xffff00, 1);
    g.strokeRect(
      PALETTE_X + col * TILE_PIXELS - 1,
      PALETTE_Y + row * TILE_PIXELS - 1,
      TILE_PIXELS + 2,
      TILE_PIXELS + 2,
    );
  }

  private updateGridHover(cell: GridCell | null): void {
    const g = this.gridHover;
    g.clear();
    if (!cell) return;
    g.lineStyle(1, 0xffffff, 0.6);
    g.strokeRect(
      GRID_X + cell.x * TILE_PIXELS,
      GRID_Y + cell.y * TILE_PIXELS,
      TILE_PIXELS,
      TILE_PIXELS,
    );
  }

  private updateInfo(cell?: GridCell | null): void {
    const lines = [
      `Frame: ${this.selectedFrame}`,
    ];
    if (cell) {
      const f = this.editorScreens[this.currentScreenIndex]?.tiles[cell.y]?.[cell.x] ?? -1;
      lines.push(`Cell [${cell.x},${cell.y}]: ${f}`);
    }
    lines.push('LMB paint  RMB erase');
    lines.push('MMB pick   [ ] screens');
    this.infoText.setText(lines.join('\n'));
  }

  private exportJSON(): void {
    const data = {
      tileSize: TILE_PIXELS,
      gridWidth: TILEMAP_SIZE_X,
      gridHeight: TILEMAP_SIZE_Y,
      screens: this.editorScreens.map((s) => ({
        tiles: s.tiles.map((row) => [...row]),
      })),
    };
    const json = JSON.stringify(data, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'level.json';
    a.click();
    URL.revokeObjectURL(url);
  }

  private importJSON(jsonString: string): void {
    const data = JSON.parse(jsonString) as {
      screens?: { tiles: number[][] }[];
    };
    if (!Array.isArray(data.screens)) throw new Error('Missing screens array');
    this.editorScreens = data.screens.map((s) => ({
      tiles: s.tiles.map((row) => [...row]),
    }));
    this.currentScreenIndex = Math.min(this.currentScreenIndex, this.editorScreens.length - 1);
    this.afterScreenChange();
  }
}
