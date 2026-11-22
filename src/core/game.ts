// Wires every system together and runs the fixed-timestep loop (SPEC §11: 60 Hz sim, render decoupled).

import * as THREE from 'three';
import { Sfx } from '../audio/sfx';
import { FirstPersonCamera } from '../camera/firstPerson';
import { LANDING, PHYSICS } from '../config/gameplay';
import { PRESETS, type Settings, saveSettings } from '../config/settings';
import { Input } from '../input/input';
import { FreeRoamMode, type GameMode, type ModeContext } from '../modes/gameMode';
import { Arms } from '../player/arms';
import { PlayerController } from '../player/controller';
import { newPlayerState, type GameEvent } from '../player/state';
import type { RenderPipeline } from '../render/pipeline';
import { Sky } from '../render/sky';
import { Hud } from '../ui/hud';
import type { Menu } from '../ui/menu';
import { launchVelocity, predictImpact } from '../webs/ballistics';
import { Tethers } from '../webs/tethers';
import { Props } from '../world/props';
import { LineVisuals } from '../webs/lineVisuals';
import type { CityData } from '../world/cityGen';
import { buildCity } from '../world/cityWorld';
import type { Physics } from './physics';

const TICK = 1 / PHYSICS.tickRate;

export class Game {
  private scene = new THREE.Scene();
  private cam: FirstPersonCamera;
  private sky: Sky;
  private input: Input;
  private player: PlayerController;
  private props: Props;
  private tethers: Tethers;
  private arms: Arms;
  private lineVisuals: LineVisuals;
  private hud = new Hud();
  private sfx = new Sfx();
  private mode: GameMode = new FreeRoamMode();
  private ctx: ModeContext;
  private playing = false;
  private acc = 0;
  private last = 0;
  private time = 0;
  /** Debug only: slow-motion factor for automated frame captures. */
  debugTimeScale = 1;
  private renderPos = new THREE.Vector3();
  private eye = new THREE.Vector3();
  private launchVel = new THREE.Vector3();
  private wrists: [THREE.Vector3, THREE.Vector3] = [new THREE.Vector3(), new THREE.Vector3()];

  constructor(
    private pipeline: RenderPipeline,
    private physics: Physics,
    city: CityData,
    private settings: Settings,
    private menu: Menu,
    canvas: HTMLCanvasElement,
  ) {
    const preset = PRESETS[settings.preset];
    this.cam = new FirstPersonCamera(1, preset.drawDistance * 1.2);
    this.scene.add(this.cam.camera);
    this.sky = new Sky(this.scene);
    this.sky.applyPreset(preset, this.scene);

    buildCity(city, this.scene, physics, preset.anisotropy);
    this.props = new Props(city, this.scene, physics);
    this.player = new PlayerController(physics, city, newPlayerState(city.spawn.x, city.spawn.y, city.spawn.z));
    this.player.props = this.props;
    this.tethers = new Tethers(this.scene, physics, this.props);
    physics.finalize();
    this.props.sleepAll();
    physics.step();

    this.arms = new Arms(this.cam.camera);
    this.lineVisuals = new LineVisuals(pipeline.overlayScene);
    this.input = new Input(canvas);
    this.input.onPause = () => this.pause();

    this.ctx = {
      player: this.player,
      city,
      setYaw: (yaw) => {
        this.cam.yaw = yaw;
        this.cam.pitch = -0.15;
        this.cam.updateAim();
      },
    };
    this.mode.start(this.ctx);

    menu.onPlay = () => this.play(canvas);
    menu.onSettingsChange = (s) => this.applySettings(s);
    document.addEventListener('pointerlockchange', () => {
      if (document.pointerLockElement !== canvas && this.playing) this.pause();
    });
    window.addEventListener('resize', () => this.resize());
    this.resize();
    this.applySettings(settings);
    this.hud.show(false);
  }

  /** Debug helper for screenshots: put the player/camera at a fixed pose. */
  debugPose(x: number, y: number, z: number, yawDeg: number, pitchDeg: number): void {
    this.player.teleport(x, y, z);
    this.cam.yaw = THREE.MathUtils.degToRad(yawDeg);
    this.cam.pitch = THREE.MathUtils.degToRad(pitchDeg);
    this.cam.updateAim();
  }

  /** Debug helper for automated tests: run the simulation without pointer lock. */
  debugPlay(): void {
    this.playing = true;
    this.input.enabled = true;
    this.menu.hideAll();
    this.hud.show(true);
  }

  /** Debug helper for screenshots: attach both lines to whatever is ±25° either side of the view. */
  debugAttachLines(): void {
    const s = this.player.state;
    const eye = this.player.eyePosition(new THREE.Vector3());
    ([0, 1] as const).forEach((hand) => {
      const yaw = this.cam.yaw + (hand === 0 ? 0.45 : -0.45);
      const dir = new THREE.Vector3(-Math.sin(yaw) * Math.cos(0.5), Math.sin(0.5), -Math.cos(yaw) * Math.cos(0.5));
      const hit = this.physics.raycast(eye, dir, 150, this.player.collider);
      if (!hit) return;
      const l = s.lines[hand];
      l.kind = 'attached';
      l.target.copy(hit.point);
      l.length = s.pos.distanceTo(hit.point) * 0.9;
    });
  }

  start(): void {
    this.last = performance.now();
    const frame = (now: number): void => {
      this.frame(now);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  private play(canvas: HTMLCanvasElement): void {
    this.sfx.unlock();
    this.sfx.setVolume(this.settings.masterVolume, this.settings.sfxVolume);
    const req = canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    req?.catch?.(() => this.menu.showPause()); // browser cooldown after Esc: click again
    this.playing = true;
    this.input.enabled = true;
    this.input.consumeMouse();
    this.menu.hideAll();
    this.hud.show(true);
  }

  private pause(): void {
    if (!this.playing) return;
    this.playing = false;
    this.input.enabled = false;
    this.input.releaseAll();
    if (document.pointerLockElement) document.exitPointerLock();
    this.sfx.suspend();
    this.menu.showPause();
    this.hud.show(false);
  }

  private applySettings(s: Settings): void {
    const preset = PRESETS[s.preset];
    this.sky.applyPreset(preset, this.scene);
    this.cam.camera.far = preset.drawDistance * 1.2;
    this.pipeline.setSize(window.innerWidth, window.innerHeight, s.renderScale);
    this.sfx.setVolume(s.masterVolume, s.sfxVolume);
    saveSettings(s);
  }

  private resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.pipeline.setSize(w, h, this.settings.renderScale);
    this.cam.camera.aspect = w / h;
    this.cam.camera.updateProjectionMatrix();
    this.lineVisuals.setResolution(w, h);
    this.tethers?.setResolution(w, h);
  }

  private frame(now: number): void {
    const dt = Math.min(0.1, (now - this.last) / 1000) * this.debugTimeScale;
    this.last = now;
    const s = this.player.state;

    if (this.playing) {
      this.time += dt;
      const [dx, dy] = this.input.consumeMouse();
      this.cam.look(dx, dy, this.settings);
      this.acc += dt;
      let steps = 0;
      while (this.acc >= TICK && steps < PHYSICS.maxStepsPerFrame) {
        const snap = this.input.snapshot();
        this.player.tick(snap, this.cam.aim, this.cam.yaw, TICK);
        this.tethers.tick(s, snap, this.player.eyePosition(this.eye), this.cam.aim, this.player.collider, TICK);
        this.physics.step();
        this.mode.tick(this.ctx, TICK);
        this.acc -= TICK;
        steps++;
      }
      if (steps === PHYSICS.maxStepsPerFrame) this.acc = 0;
    }

    // Interpolate between the last two sim states for smooth rendering
    const alpha = this.acc / TICK;
    this.renderPos.copy(s.prevPos).lerp(s.pos, alpha);
    this.player.eyePosition(this.eye, this.renderPos);

    for (const e of s.events) this.handleEvent(e);
    s.events.length = 0;

    const speed = s.vel.length();
    this.cam.update(this.eye, s.vel, this.playing ? dt : 0, this.settings);
    this.props.sync();
    this.arms.update(s.lines, s.pull, this.tethers.shot.kind !== 'idle' ? this.tethers.shot : this.tethers.self, speed, s.mode === 'ground', dt);
    this.arms.wristWorld(0, this.wrists[0]);
    this.arms.wristWorld(1, this.wrists[1]);
    const tetherShot = this.tethers.shot;
    this.lineVisuals.update(
      [s.lines[0], s.lines[1], s.pull, tetherShot, this.tethers.self],
      [this.wrists[0], this.wrists[1], this.wrists[1], this.wrists[0], this.wrists[0]],
      this.renderPos, this.cam.aim, s.vel, this.playing ? dt : 0,
    );
    this.tethers.render(this.wrists[0], this.playing ? dt : 0);
    this.sky.update(this.cam.camera.position, this.renderPos, this.cam.camera.far);
    this.sfx.update(this.playing ? speed : 0, s.lines);

    if (this.playing) {
      // Where would a stream fired right now land? (ballistic drop + inherited velocity)
      const impact = predictImpact(this.eye, launchVelocity(this.launchVel, this.cam.aim, s.vel), this.physics, this.player.collider);
      this.hud.update(impact, this.cam.camera, s.lines, [s.pos.distanceTo(s.lines[0].target), s.pos.distanceTo(s.lines[1].target)], speed, s.pos.y, s.pull, this.tethers.status);
    }

    const speedLines = this.settings.motionEffects ? THREE.MathUtils.clamp((speed - 30) / 35, 0, 1) : 0;
    this.pipeline.render(this.scene, this.cam.camera, PRESETS[this.settings.preset].drawDistance, speedLines, this.time);
  }

  private handleEvent(e: GameEvent): void {
    this.sfx.play(e);
    switch (e.type) {
      case 'fire':
        this.arms.fired(e.hand);
        break;
      case 'pullFire':
        this.arms.fired(1);
        break;
      case 'tetherFire':
        this.arms.fired(0);
        break;
      case 'land':
        if (e.impact > LANDING.heavyImpactSpeed) {
          this.cam.addTrauma(Math.min(0.8, e.impact / 50));
          this.cam.addDip(Math.min(3, e.impact * 0.06));
        } else if (e.impact > 6) {
          this.cam.addDip(e.impact * 0.03);
        }
        break;
      case 'stagger':
        this.cam.addTrauma(0.7);
        break;
      case 'wallStick':
        if (e.impact > 10) this.cam.addTrauma(0.15);
        break;
    }
  }
}
