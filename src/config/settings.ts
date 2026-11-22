// Player-facing settings, persisted in localStorage (SPEC §12.2).

export type GraphicsPreset = 'low' | 'medium' | 'high';

export interface Settings {
  preset: GraphicsPreset;
  renderScale: number;
  fov: number;
  sensitivity: number;
  invertY: boolean;
  motionEffects: boolean;
  cameraRoll: boolean;
  masterVolume: number;
  sfxVolume: number;
  headTracking: boolean;
  headGain: number;
  headParallax: number;
}

export interface PresetValues {
  shadowMapSize: number;
  shadowExtent: number;
  drawDistance: number;
  renderScale: number;
  anisotropy: number;
}

export const PRESETS: Record<GraphicsPreset, PresetValues> = {
  low: { shadowMapSize: 1024, shadowExtent: 90, drawDistance: 1000, renderScale: 0.75, anisotropy: 1 },
  medium: { shadowMapSize: 2048, shadowExtent: 140, drawDistance: 1600, renderScale: 1, anisotropy: 4 },
  high: { shadowMapSize: 4096, shadowExtent: 200, drawDistance: 2200, renderScale: 1, anisotropy: 8 },
};

const KEY = 'web-slinger.settings.v1';

export function defaultSettings(preset: GraphicsPreset): Settings {
  return {
    preset,
    renderScale: PRESETS[preset].renderScale,
    fov: 85,
    sensitivity: 1,
    invertY: false,
    motionEffects: true,
    cameraRoll: true,
    masterVolume: 0.8,
    sfxVolume: 1,
    headTracking: false, // SPEC §3.2: off by default
    headGain: 1.6,
    headParallax: 1,
  };
}

export function loadSettings(detected: GraphicsPreset): Settings {
  const defaults = defaultSettings(detected);
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaults;
    return { ...defaults, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return defaults;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings just won't persist */
  }
}

/** Guess a preset from the GPU name (SPEC §13: auto-detected on first launch). */
export function detectPreset(gl: WebGL2RenderingContext): GraphicsPreset {
  const ext = gl.getExtension('WEBGL_debug_renderer_info');
  const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)).toLowerCase();
  if (/swiftshader|llvmpipe|softpipe|software|mali-4|adreno \(tm\) [1-5]/.test(name)) return 'low';
  if (/rtx|gtx 1[0-9]{3}|radeon rx|radeon pro|arc a[0-9]|apple m[1-9] (pro|max|ultra)/.test(name)) return 'high';
  return 'medium';
}
