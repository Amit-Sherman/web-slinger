// Action map (SPEC §6): raw keys/buttons → named actions. Gameplay code only sees actions,
// so rebinding and gamepad support can be added without touching gameplay systems.

export type Action =
  | 'forward' | 'back' | 'left' | 'right'
  | 'jump' | 'sprint' | 'crouch'
  | 'fireLeft' | 'fireRight'
  | 'reelLeft' | 'reelRight' | 'modifier'
  | 'tether' | 'pull'
  | 'recenterHead' | 'pause';

/** KeyboardEvent.code values, or `Mouse0`/`Mouse1`/`Mouse2` for mouse buttons. */
export const DEFAULT_BINDINGS: Record<Action, string[]> = {
  forward: ['KeyW'],
  back: ['KeyS'],
  left: ['KeyA'],
  right: ['KeyD'],
  jump: ['Space'],
  sprint: ['ShiftLeft', 'ShiftRight'],
  // Ctrl is the decided binding; C is an alias because browsers don't let pages
  // block Ctrl+W (close tab) outside fullscreen keyboard lock.
  crouch: ['ControlLeft', 'KeyC'],
  fireLeft: ['Mouse0'],
  fireRight: ['Mouse2'],
  reelLeft: ['KeyQ'],
  reelRight: ['KeyE'],
  modifier: ['ShiftLeft', 'ShiftRight'], // Shift+Q / Shift+E = let line out
  tether: ['KeyF'],
  pull: ['Mouse1'],
  recenterHead: ['KeyH'],
  pause: ['Escape'],
};

export const ACTION_LABELS: [string, string][] = [
  ['Mouse', 'Look'],
  ['Left mouse (hold)', 'Fire & hold left line, release to detach'],
  ['Right mouse (hold)', 'Fire & hold right line, release to detach'],
  ['Q / Shift+Q', 'Reel left line in / let it out'],
  ['E / Shift+E', 'Reel right line in / let it out'],
  ['W A S D', 'Move · air-steer · crawl on walls'],
  ['Space', 'Jump · wall-jump'],
  ['Shift', 'Sprint · wall-run (hold when hitting a wall fast)'],
  ['Ctrl or C', 'Crouch · drop off a wall'],
  ['Middle mouse (hold)', 'Pull line: yank objects to you (release to throw), or yank yourself to heavy/fixed things'],
  ['F, then F', 'Tether: web two things together (props, walls, poles)'],
  ['F, then Shift+F', 'Tether something to yourself · F again cuts it'],
  ['Esc', 'Pause & settings'],
];
