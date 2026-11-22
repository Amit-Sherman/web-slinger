// Pluggable game modes (SPEC §10). Modes use the core systems without modifying them.
// Future modes (races, crime, collectibles) implement the same interface.

import type { PlayerController } from '../player/controller';
import type { CityData } from '../world/cityGen';

export interface ModeContext {
  player: PlayerController;
  city: CityData;
  /** Sets the camera heading (used on spawn / respawn). */
  setYaw(yaw: number): void;
}

export interface GameMode {
  readonly name: string;
  start(ctx: ModeContext): void;
  /** Called once per simulation tick, after the player has moved. */
  tick(ctx: ModeContext, dt: number): void;
}

export class FreeRoamMode implements GameMode {
  readonly name = 'Free Roam';

  start(ctx: ModeContext): void {
    this.spawn(ctx);
  }

  tick(ctx: ModeContext): void {
    // Safety net: if anything ever falls out of the world, put the player back on the spawn roof.
    const p = ctx.player.state.pos;
    if (p.y < -40 || Math.abs(p.x) > ctx.city.halfSize + 50 || Math.abs(p.z) > ctx.city.halfSize + 50) this.spawn(ctx);
  }

  private spawn(ctx: ModeContext): void {
    const s = ctx.city.spawn;
    ctx.player.teleport(s.x, s.y, s.z);
    ctx.setYaw(s.yaw);
  }
}
