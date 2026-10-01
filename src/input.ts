// Keyboard / mouse input. DOM-free core (setKey/poll) so tests can drive it; attach() wires DOM events.

export interface InputFrame {
  /** -1..1 */
  forward: number;
  /** -1..1 (positive = strafe right) */
  side: number;
  /** -1..1 (positive = turn right / clockwise) */
  turn: number;
  run: boolean;
  use: boolean;
  fire: boolean;
  /** weapon slot pressed this poll (0..6) or -1 */
  weaponSlot: number;
  automap: boolean;
  zoomIn: boolean;
  zoomOut: boolean;
  mute: boolean;
  color: boolean;
  enter: boolean;
  escape: boolean;
  /** accumulated mouse x movement in pixels since last poll */
  mouseDx: number;
}

const GAME_CODES = new Set([
  'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyM', 'KeyC', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
  'ShiftLeft', 'ShiftRight', 'Space', 'ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'Tab', 'Equal', 'Minus',
  'Enter', 'NumpadEnter', 'Escape', 'Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7',
]);

export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();
  private mouseDx = 0;
  private mouseFire = false;
  pointerLocked = false;
  /** invoked on first user gesture (used to unlock audio) */
  onGesture: (() => void) | null = null;

  setKey(code: string, isDown: boolean): void {
    if (isDown) {
      if (!this.down.has(code)) this.pressed.add(code);
      this.down.add(code);
    } else {
      this.down.delete(code);
    }
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  addMouse(dx: number): void {
    this.mouseDx += dx;
  }

  setMouseFire(v: boolean): void {
    this.mouseFire = v;
  }

  releaseAll(): void {
    this.down.clear();
    this.pressed.clear();
    this.mouseFire = false;
  }

  attach(canvas: HTMLCanvasElement): void {
    const gesture = () => { if (this.onGesture) this.onGesture(); };
    window.addEventListener('keydown', (e) => {
      if (e.repeat) { if (GAME_CODES.has(e.code)) e.preventDefault(); return; }
      this.setKey(e.code, true);
      if (GAME_CODES.has(e.code)) e.preventDefault();
      gesture();
    });
    window.addEventListener('keyup', (e) => {
      this.setKey(e.code, false);
      if (GAME_CODES.has(e.code)) e.preventDefault();
    });
    window.addEventListener('blur', () => this.releaseAll());
    canvas.addEventListener('mousedown', (e) => {
      gesture();
      if (e.button === 0) {
        if (!this.pointerLocked && canvas.requestPointerLock) {
          try { void (canvas.requestPointerLock() as unknown as Promise<void> | undefined)?.catch?.(() => {}); } catch { /* ignore */ }
        }
        this.mouseFire = true;
      }
    });
    window.addEventListener('mouseup', (e) => { if (e.button === 0) this.mouseFire = false; });
    window.addEventListener('mousemove', (e) => { if (this.pointerLocked) this.mouseDx += e.movementX; });
    document.addEventListener('pointerlockchange', () => {
      this.pointerLocked = document.pointerLockElement === canvas;
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  poll(): InputFrame {
    const d = (c: string) => this.down.has(c);
    const p = (c: string) => this.pressed.has(c);
    const alt = d('AltLeft') || d('AltRight');
    let forward = 0, side = 0, turn = 0;
    if (d('KeyW') || d('ArrowUp')) forward += 1;
    if (d('KeyS') || d('ArrowDown')) forward -= 1;
    if (d('KeyD')) side += 1;
    if (d('KeyA')) side -= 1;
    if (alt) {
      if (d('ArrowRight')) side += 1;
      if (d('ArrowLeft')) side -= 1;
    } else {
      if (d('ArrowRight')) turn += 1;
      if (d('ArrowLeft')) turn -= 1;
    }
    let weaponSlot = -1;
    for (let i = 1; i <= 7; i++) if (p('Digit' + i)) weaponSlot = i - 1;
    const frame: InputFrame = {
      forward: Math.max(-1, Math.min(1, forward)),
      side: Math.max(-1, Math.min(1, side)),
      turn: Math.max(-1, Math.min(1, turn)),
      run: d('ShiftLeft') || d('ShiftRight'),
      use: d('Space') || d('KeyE'),
      fire: d('ControlLeft') || d('ControlRight') || this.mouseFire,
      weaponSlot,
      automap: p('Tab'),
      zoomIn: p('Equal'),
      zoomOut: p('Minus'),
      mute: p('KeyM'),
      color: p('KeyC'),
      enter: p('Enter') || p('NumpadEnter'),
      escape: p('Escape'),
      mouseDx: this.mouseDx,
    };
    this.pressed.clear();
    this.mouseDx = 0;
    return frame;
  }
}
