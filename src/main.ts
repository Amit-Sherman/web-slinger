import './style.css';
import { PHYSICS } from './config/gameplay';
import { detectPreset, loadSettings } from './config/settings';
import { Game } from './core/game';
import { Physics } from './core/physics';
import { RenderPipeline } from './render/pipeline';
import { Menu } from './ui/menu';
import { generateCity } from './world/cityGen';

async function boot(): Promise<void> {
  const canvas = document.getElementById('game') as HTMLCanvasElement;
  const pipeline = new RenderPipeline(canvas);
  const settings = loadSettings(detectPreset(pipeline.gl));
  const menu = new Menu(settings);
  menu.setLoading('Loading physics…');

  const physics = await Physics.create(1 / PHYSICS.tickRate);
  menu.setLoading('Building city…');
  await new Promise((r) => setTimeout(r, 0)); // let the loading text paint

  const seedParam = Number(new URLSearchParams(location.search).get('seed'));
  const seed = Number.isFinite(seedParam) && seedParam > 0 ? seedParam : 1337;
  const city = generateCity(seed);

  const game = new Game(pipeline, physics, city, settings, menu, canvas);
  menu.setLoading(null);
  game.start();

  // Debug: ?shot hides the start overlay; &cam=x,y,z,yawDeg,pitchDeg places the camera.
  const params = new URLSearchParams(location.search);
  if (params.has('shot')) {
    menu.hideAll();
    const cam = params.get('cam')?.split(',').map(Number);
    if (cam && cam.length === 5) game.debugPose(cam[0], cam[1], cam[2], cam[3], cam[4]);
    (window as unknown as { __ready: boolean }).__ready = true;
  }
}

boot().catch((err) => {
  console.error(err);
  const el = document.getElementById('start-hint');
  if (el) el.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
