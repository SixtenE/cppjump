const down = { left: false, right: false, jump: false };
let _leftPressed = false;
let _rightPressed = false;
let _jumpReleased = false;
let _mutePressed = false;

export function isTouchLeftDown(): boolean {
  return down.left;
}
export function isTouchRightDown(): boolean {
  return down.right;
}
export function isTouchJumpDown(): boolean {
  return down.jump;
}

export interface TouchEdges {
  leftPressed: boolean;
  rightPressed: boolean;
  jumpReleased: boolean;
  mutePressed: boolean;
}

export function consumeTouchEdges(): TouchEdges {
  const edges: TouchEdges = {
    leftPressed: _leftPressed,
    rightPressed: _rightPressed,
    jumpReleased: _jumpReleased,
    mutePressed: _mutePressed,
  };
  _leftPressed = false;
  _rightPressed = false;
  _jumpReleased = false;
  _mutePressed = false;
  return edges;
}

function bindButton(el: HTMLElement, key: 'left' | 'right' | 'jump'): void {
  const onDown = (e: PointerEvent): void => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    if (!down[key]) {
      down[key] = true;
      if (key === 'left') _leftPressed = true;
      if (key === 'right') _rightPressed = true;
    }
    el.classList.add('active');
  };

  const onUp = (): void => {
    if (down[key]) {
      if (key === 'jump') _jumpReleased = true;
      down[key] = false;
    }
    el.classList.remove('active');
  };

  el.addEventListener('pointerdown', onDown);
  el.addEventListener('pointerup', (e) => {
    e.preventDefault();
    onUp();
  });
  el.addEventListener('pointercancel', onUp);
  el.addEventListener('contextmenu', (e) => e.preventDefault());
}

export function setupTouchControls(): void {
  const style = document.createElement('style');
  style.textContent = `
    #touch-controls {
      position: fixed;
      bottom: 0;
      left: 0;
      right: 0;
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      padding: 16px 20px;
      padding-bottom: max(16px, env(safe-area-inset-bottom));
      pointer-events: none;
      z-index: 1000;
      user-select: none;
      -webkit-user-select: none;
    }
    #touch-controls .tc-group {
      display: flex;
      gap: 10px;
      pointer-events: auto;
    }
    #touch-controls button {
      pointer-events: auto;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
      border: 2px solid rgba(255, 255, 255, 0.25);
      background: rgba(255, 255, 255, 0.12);
      color: rgba(255, 255, 255, 0.7);
      font-size: 26px;
      border-radius: 14px;
      width: 72px;
      height: 72px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      transition: background 0.05s;
    }
    #touch-controls button.active {
      background: rgba(255, 255, 255, 0.35);
      border-color: rgba(255, 255, 255, 0.5);
    }
    #touch-controls .tc-jump {
      width: 90px;
      height: 90px;
      font-size: 30px;
      border-radius: 50%;
    }
    #touch-mute {
      position: fixed;
      top: 12px;
      right: 12px;
      pointer-events: auto;
      touch-action: none;
      user-select: none;
      -webkit-user-select: none;
      border: 2px solid rgba(255, 255, 255, 0.25);
      background: rgba(255, 255, 255, 0.12);
      color: rgba(255, 255, 255, 0.7);
      font-size: 20px;
      border-radius: 10px;
      width: 48px;
      height: 48px;
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      -webkit-tap-highlight-color: transparent;
      z-index: 1000;
    }
  `;
  document.head.appendChild(style);

  const container = document.createElement('div');
  container.id = 'touch-controls';

  const dpad = document.createElement('div');
  dpad.className = 'tc-group';

  const leftBtn = document.createElement('button');
  leftBtn.textContent = '◀';
  leftBtn.setAttribute('aria-label', 'Move left');
  bindButton(leftBtn, 'left');

  const rightBtn = document.createElement('button');
  rightBtn.textContent = '▶';
  rightBtn.setAttribute('aria-label', 'Move right');
  bindButton(rightBtn, 'right');

  dpad.appendChild(leftBtn);
  dpad.appendChild(rightBtn);

  const jumpGroup = document.createElement('div');
  jumpGroup.className = 'tc-group';

  const jumpBtn = document.createElement('button');
  jumpBtn.className = 'tc-jump';
  jumpBtn.textContent = '▲';
  jumpBtn.setAttribute('aria-label', 'Jump');
  bindButton(jumpBtn, 'jump');

  jumpGroup.appendChild(jumpBtn);

  container.appendChild(dpad);
  container.appendChild(jumpGroup);
  document.body.appendChild(container);

  const muteBtn = document.createElement('button');
  muteBtn.id = 'touch-mute';
  muteBtn.textContent = '🔊';
  muteBtn.setAttribute('aria-label', 'Toggle music');
  muteBtn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    _mutePressed = true;
  });
  muteBtn.addEventListener('contextmenu', (e) => e.preventDefault());
  document.body.appendChild(muteBtn);
}
