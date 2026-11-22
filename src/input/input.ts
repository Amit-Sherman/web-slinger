import { type Action, DEFAULT_BINDINGS } from './actions';

/** Per-tick snapshot of the player's intent. Plain data, so it could be sent over a network later (SPEC §11). */
export interface InputSnapshot {
  down: Record<Action, boolean>;
  pressed: Record<Action, boolean>;
  released: Record<Action, boolean>;
}

const ALL_ACTIONS = Object.keys(DEFAULT_BINDINGS) as Action[];

function emptyRecord(): Record<Action, boolean> {
  const r = {} as Record<Action, boolean>;
  for (const a of ALL_ACTIONS) r[a] = false;
  return r;
}

export class Input {
  private codeToActions = new Map<string, Action[]>();
  private codesDown = new Set<string>();
  private pressedSinceTick = emptyRecord();
  private releasedSinceTick = emptyRecord();

  /** Accumulated mouse delta since last read (pixels). */
  mouseDX = 0;
  mouseDY = 0;
  enabled = false;
  onPause: (() => void) | null = null;

  constructor(private target: HTMLElement) {
    for (const a of ALL_ACTIONS) {
      for (const code of DEFAULT_BINDINGS[a]) {
        const list = this.codeToActions.get(code) ?? [];
        list.push(a);
        this.codeToActions.set(code, list);
      }
    }
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    target.addEventListener('mousedown', (e) => this.onButton(e, true));
    window.addEventListener('mouseup', (e) => this.onButton(e, false));
    target.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('mousemove', (e) => {
      if (!this.enabled) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
    });
    window.addEventListener('blur', () => this.releaseAll());
  }

  private onKey(e: KeyboardEvent, isDown: boolean): void {
    if (e.code === 'Escape' && isDown) {
      this.onPause?.();
      return;
    }
    if (!this.enabled) return;
    if (this.codeToActions.has(e.code)) e.preventDefault();
    if (e.repeat) return;
    this.setCode(e.code, isDown);
  }

  private onButton(e: MouseEvent, isDown: boolean): void {
    if (!this.enabled) return;
    e.preventDefault();
    this.setCode(`Mouse${e.button}`, isDown);
  }

  private setCode(code: string, isDown: boolean): void {
    const wasDown = this.codesDown.has(code);
    if (isDown === wasDown) return;
    if (isDown) this.codesDown.add(code);
    else this.codesDown.delete(code);
    for (const a of this.codeToActions.get(code) ?? []) {
      const nowDown = this.isActionDown(a);
      if (isDown && nowDown) this.pressedSinceTick[a] = true;
      if (!isDown && !nowDown) this.releasedSinceTick[a] = true;
    }
  }

  private isActionDown(a: Action): boolean {
    return DEFAULT_BINDINGS[a].some((c) => this.codesDown.has(c));
  }

  releaseAll(): void {
    for (const code of [...this.codesDown]) this.setCode(code, false);
  }

  /** Build the snapshot for one simulation tick and clear edge events. */
  snapshot(): InputSnapshot {
    const down = emptyRecord();
    for (const a of ALL_ACTIONS) down[a] = this.isActionDown(a);
    const snap = { down, pressed: this.pressedSinceTick, released: this.releasedSinceTick };
    this.pressedSinceTick = emptyRecord();
    this.releasedSinceTick = emptyRecord();
    return snap;
  }

  consumeMouse(): [number, number] {
    const d: [number, number] = [this.mouseDX, this.mouseDY];
    this.mouseDX = 0;
    this.mouseDY = 0;
    return d;
  }

  get element(): HTMLElement {
    return this.target;
  }
}
