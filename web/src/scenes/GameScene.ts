import Phaser from 'phaser';
import {
  TILEMAP_SIZE_X,
  TILEMAP_SIZE_Y,
  TILE_PIXELS,
  PLAYER_SIZE,
  BACKGROUND_COLOR,
} from '../game/constants';
import { resolveBoxCollisionWithTilemap } from '../game/collision';
import { createPlayer, updatePlayer, updatePlayerDebugFly } from '../game/player';
import { getActiveScreen } from '../game/worldScreens';
import { getDebugTextResolution } from '../pixelScale';
import { isTouchLeftDown, isTouchRightDown, isTouchJumpDown, consumeTouchEdges } from '../game/touchControls';
import type { PlayerState, TileGrid } from '../game/types';

export class GameScene extends Phaser.Scene {
  private player!: PlayerState;
  private tileSprites!: Phaser.GameObjects.Image[][];
  private playerSprite!: Phaser.GameObjects.Sprite;

  private keySpace!: Phaser.Input.Keyboard.Key;
  private keyI!: Phaser.Input.Keyboard.Key;
  private keyPageUp!: Phaser.Input.Keyboard.Key;
  private keyPageDown!: Phaser.Input.Keyboard.Key;
  private keyLeft!: Phaser.Input.Keyboard.Key;
  private keyRight!: Phaser.Input.Keyboard.Key;
  private keyA!: Phaser.Input.Keyboard.Key;
  private keyD!: Phaser.Input.Keyboard.Key;
  private keyW!: Phaser.Input.Keyboard.Key;
  private keyS!: Phaser.Input.Keyboard.Key;
  private keyM!: Phaser.Input.Keyboard.Key;
  private keyShift!: Phaser.Input.Keyboard.Key;

  private spaceWasDown = false;
  private isDebugEnabled = true;

  private hudText!: Phaser.GameObjects.Text;
  private bgmAudio: HTMLAudioElement | null = null;

  constructor() {
    super('GameScene');
  }

  preload(): void {
    this.load.spritesheet('player', '/player.png', {
      frameWidth: TILE_PIXELS,
      frameHeight: TILE_PIXELS,
    });
    this.load.spritesheet('tilemap', '/tilemap.png', {
      frameWidth: TILE_PIXELS,
      frameHeight: TILE_PIXELS,
    });
  }

  create(): void {
    this.cameras.main.setBackgroundColor(BACKGROUND_COLOR);
    this.cameras.main.setRoundPixels(true);

    const textRes = getDebugTextResolution(this.game.canvas.parentElement);

    this.player = createPlayer();

    this.tileSprites = [];
    for (let y = 0; y < TILEMAP_SIZE_Y; y++) {
      const row: Phaser.GameObjects.Image[] = [];
      for (let x = 0; x < TILEMAP_SIZE_X; x++) {
        const im = this.add.image(x * TILE_PIXELS, y * TILE_PIXELS, 'tilemap', 0).setOrigin(0, 0);
        im.setVisible(false);
        row.push(im);
      }
      this.tileSprites.push(row);
    }

    this.playerSprite = this.add.sprite(0, 0, 'player', 0).setOrigin(0, 0);

    const kb = this.input.keyboard!;
    this.keySpace = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.keyI = kb.addKey(Phaser.Input.Keyboard.KeyCodes.I);
    this.keyPageUp = kb.addKey(Phaser.Input.Keyboard.KeyCodes.PAGE_UP);
    this.keyPageDown = kb.addKey(Phaser.Input.Keyboard.KeyCodes.PAGE_DOWN);

    this.keyLeft = kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT);
    this.keyRight = kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT);
    this.keyA = kb.addKey(Phaser.Input.Keyboard.KeyCodes.A);
    this.keyD = kb.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    this.keyW = kb.addKey(Phaser.Input.Keyboard.KeyCodes.W);
    this.keyS = kb.addKey(Phaser.Input.Keyboard.KeyCodes.S);
    this.keyM = kb.addKey(Phaser.Input.Keyboard.KeyCodes.M);
    this.keyShift = kb.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT);

    kb.addCapture([
      Phaser.Input.Keyboard.KeyCodes.SPACE,
      Phaser.Input.Keyboard.KeyCodes.UP,
      Phaser.Input.Keyboard.KeyCodes.DOWN,
      Phaser.Input.Keyboard.KeyCodes.LEFT,
      Phaser.Input.Keyboard.KeyCodes.RIGHT,
      Phaser.Input.Keyboard.KeyCodes.W,
      Phaser.Input.Keyboard.KeyCodes.S,
      Phaser.Input.Keyboard.KeyCodes.A,
      Phaser.Input.Keyboard.KeyCodes.D,
      Phaser.Input.Keyboard.KeyCodes.M,
    ]);

    this.spaceWasDown = false;
    this.isDebugEnabled = false;

    this.hudText = this.add
      .text(2, 2, '', {
        fontFamily: 'monospace',
        fontSize: '11px',
        color: '#ffffff',
        resolution: textRes,
      })
      .setDepth(1002);

    this.hudText.setVisible(this.isDebugEnabled);

    const removeMusicUnlockListeners = (): void => {
      this.input.off('pointerdown', startMusic);
      this.input.keyboard?.off('keydown', startMusic);
      window.removeEventListener('keydown', startMusic);
    };

    this.bgmAudio = new Audio('/bgm.m4a');
    this.bgmAudio.loop = true;
    this.bgmAudio.volume = 0.35;

    const startMusic = async (): Promise<void> => {
      if (!this.bgmAudio) return;
      if (!this.bgmAudio.paused) {
        removeMusicUnlockListeners();
        return;
      }

      try {
        await this.bgmAudio.play();
        removeMusicUnlockListeners();
      } catch {
        // Autoplay can be blocked until a valid user gesture; listeners stay active.
      }
    };

    this.input.on('pointerdown', startMusic);
    this.input.keyboard?.on('keydown', startMusic);
    window.addEventListener('keydown', startMusic);
    void startMusic();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      removeMusicUnlockListeners();
      if (this.bgmAudio) {
        this.bgmAudio.pause();
        this.bgmAudio.currentTime = 0;
      }
      this.bgmAudio = null;
    });
  }

  refreshDebugTextResolution(): void {
    const r = getDebugTextResolution(this.game.canvas.parentElement);
    this.hudText.setResolution(r);
  }

  update(): void {
    const rawMs = this.game.loop.delta;
    const delta = Math.max(0.0001, Math.min(0.1, rawMs / 1000));
    const touchEdges = consumeTouchEdges();

    const { screenIndex, tiles, screenOffsetY } = getActiveScreen(this.player.position.y);

    if (Phaser.Input.Keyboard.JustDown(this.keyI)) {
      this.isDebugEnabled = !this.isDebugEnabled;
      this.toggleDebugVisibility();
    }
    if (Phaser.Input.Keyboard.JustDown(this.keyM) || touchEdges.mutePressed) {
      this.toggleMusicMute();
    }

    if (this.isDebugEnabled) {
      if (Phaser.Input.Keyboard.JustDown(this.keyPageUp)) {
        this.player.position.y -= TILEMAP_SIZE_Y;
      }
      if (Phaser.Input.Keyboard.JustDown(this.keyPageDown)) {
        this.player.position.y += TILEMAP_SIZE_Y;
      }
    }

    if (this.isDebugEnabled) {
      const wasdPressed =
        Phaser.Input.Keyboard.JustDown(this.keyA) ||
        Phaser.Input.Keyboard.JustDown(this.keyD) ||
        Phaser.Input.Keyboard.JustDown(this.keyW) ||
        Phaser.Input.Keyboard.JustDown(this.keyS);
      if (wasdPressed) this.player.animTime = 0;

      updatePlayerDebugFly(this.player, tiles, screenOffsetY, delta, {
        upDown: this.keyW.isDown,
        leftDown: this.keyA.isDown,
        rightDown: this.keyD.isDown,
        downDown: this.keyS.isDown,
        shiftDown: this.keyShift.isDown,
      });
    } else {
      const spaceDown = this.keySpace.isDown || isTouchJumpDown();
      const spaceReleased = (this.spaceWasDown && !spaceDown) || touchEdges.jumpReleased;
      this.spaceWasDown = spaceDown;

      const leftDown = this.keyLeft.isDown || this.keyA.isDown || isTouchLeftDown();
      const rightDown = this.keyRight.isDown || this.keyD.isDown || isTouchRightDown();
      const leftPressed = Phaser.Input.Keyboard.JustDown(this.keyLeft) || Phaser.Input.Keyboard.JustDown(this.keyA) || touchEdges.leftPressed;
      const rightPressed = Phaser.Input.Keyboard.JustDown(this.keyRight) || Phaser.Input.Keyboard.JustDown(this.keyD) || touchEdges.rightPressed;

      updatePlayer(this.player, tiles, screenOffsetY, delta, {
        spaceDown,
        spaceReleased,
        leftDown,
        rightDown,
        leftPressed,
        rightPressed,
      });
    }

    resolveBoxCollisionWithTilemap(tiles, screenOffsetY, this.player.position, this.player.velocity, PLAYER_SIZE);

    this.redrawTiles(tiles);
    this.redrawPlayer(screenOffsetY);
    this.redrawDebug(screenIndex, screenOffsetY);
  }

  private toggleDebugVisibility(): void {
    this.hudText.setVisible(this.isDebugEnabled);
  }

  private toggleMusicMute(): void {
    if (!this.bgmAudio) return;

    this.bgmAudio.muted = !this.bgmAudio.muted;
    if (!this.bgmAudio.muted && this.bgmAudio.paused) {
      this.bgmAudio.play().catch(() => {
        // Playback may still be blocked until user interacts with the page.
      });
    }

    const muteBtn = document.getElementById('touch-mute');
    if (muteBtn) muteBtn.textContent = this.bgmAudio.muted ? '🔇' : '🔊';
  }

  private redrawTiles(tiles: TileGrid): void {
    for (let y = 0; y < TILEMAP_SIZE_Y; y++) {
      for (let x = 0; x < TILEMAP_SIZE_X; x++) {
        const im = this.tileSprites[y][x];
        const frame = tiles[y][x];
        if (frame < 0) {
          im.setVisible(false);
        } else {
          im.setVisible(true);
          im.setFrame(frame);
        }
      }
    }
  }

  private redrawPlayer(screenOffsetY: number): void {
    const p = this.player;
    p.animTime += this.game.loop.delta / 1000;

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

    this.playerSprite.setFrame(sprite);
    const px = p.position.x * TILE_PIXELS - 8;
    const py = (p.position.y - screenOffsetY) * TILE_PIXELS - 10;
    this.playerSprite.setPosition(px, py);
    this.playerSprite.setFlipX(!p.isFacingRight);
  }

  private redrawDebug(screenIndex: number, screenOffsetY: number): void {
    if (!this.isDebugEnabled) return;

    this.hudText.setText(
      [
        `FPS: ${Math.round(this.game.loop.actualFps)}`,
        `WASD: fly (Shift: fast)`,
        `player.position = [${this.player.position.x.toFixed(3)}, ${this.player.position.y.toFixed(3)}]`,
        `player.jumpHoldTime = ${this.player.jumpHoldTime.toFixed(3)}`,
        `screenOffsetY = ${screenOffsetY}`,
        `screenIndex = ${screenIndex}`,
      ].join('\n'),
    );
  }
}
