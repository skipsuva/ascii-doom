// Game state machine + fixed-step loop. Owns the GameCtx and wires player/weapons/world/renderer together.
import {
  MF, makeGrid, type Assets, type AudioBus, type CellGrid, type GameCtx, type Geo, type Level, type LevelStats,
  type Mobj, type MobjInfo, type Player, type RenderOptions, type View, type WorldSim,
} from '../types';
import type { Wads } from '../wad/wad';
import { loadLevel, createGeo, mapList, nextMap } from '../level/index';
import { Renderer, GlyphCanvas, drawAutomap, fillGrid } from '../render/index';
import { Input } from '../input';
import { clamp, deg2rad } from '../math';
import { createPlayer, carryOverPlayer, playerThink, VIEWHEIGHT } from './player';
import { tickWeapon, selectWeaponSlot, resetWeaponState } from './weapons';
import { drawHud, drawMessage } from './hud';
import { drawTitle, drawIntermission, drawVictory, drawDeathOverlay, drawPaused, type IntermissionInfo, type VictoryTotals } from './screens';

export type GameState = 'TITLE' | 'PLAYING' | 'INTERMISSION' | 'VICTORY';
export const TIC_MS = 1000 / 35;

export interface GameOptions {
  god?: boolean;
  noclip?: boolean;
  startPos?: { x: number; y: number; deg: number } | null;
  startMap?: string | null;
}

export interface Surface {
  gc: GlyphCanvas | null;
  grid: CellGrid;
  renderer: Renderer;
}

export interface GameDeps {
  wads: Wads;
  assets: Assets;
  world: WorldSim;
  input: Input;
  audio: AudioBus;
  surface: Surface;
  wadName: string;
}

export class Game {
  state: GameState = 'TITLE';
  ctx: GameCtx | null = null;
  level: Level | null = null;
  geo: Geo | null = null;
  player: Player | null = null;
  maps: string[];
  currentMap = '';
  automap = false;
  automapZoom = 2.5;
  colorMode = false;
  paused = false;
  titleTic = 0;
  private pendingExit: { secret: boolean } | null = null;
  private inter: IntermissionInfo | null = null;
  private nextMapName: string | null = null;
  private totals: VictoryTotals = { kills: 0, totalKills: 0, items: 0, totalItems: 0, secrets: 0, totalSecrets: 0, timeSec: 0, levels: 0 };
  private acc = 0;
  private last = -1;
  private mobjIdSeq = 100000;
  wads: Wads;
  assets: Assets;
  world: WorldSim;
  input: Input;
  audio: AudioBus;
  surface: Surface;
  wadName: string;

  constructor(deps: GameDeps, public opts: GameOptions = {}) {
    this.wads = deps.wads;
    this.assets = deps.assets;
    this.world = deps.world;
    this.input = deps.input;
    this.audio = deps.audio;
    this.surface = deps.surface;
    this.wadName = deps.wadName;
    this.maps = mapList(this.wads);
  }

  /** Swap the WAD stack (drag & drop). Returns to the title. */
  setWads(wads: Wads, assets: Assets, world: WorldSim, wadName: string, preferredMap: string | null): void {
    this.wads = wads;
    this.assets = assets;
    this.world = world;
    this.wadName = wadName;
    this.maps = mapList(wads);
    if (preferredMap && this.maps.includes(preferredMap)) this.opts.startMap = preferredMap;
    else this.opts.startMap = null;
    this.ctx = null; this.level = null; this.geo = null; this.player = null;
    this.state = 'TITLE';
  }

  setSurface(s: Surface): void {
    this.surface = s;
    if (this.level) s.renderer.setLevel(this.level);
  }

  get viewRows(): number {
    return Math.max(1, this.surface.grid.rows - 2);
  }

  /** Leave the title screen. */
  start(): void {
    const first = this.opts.startMap && this.maps.includes(this.opts.startMap) ? this.opts.startMap : this.maps[0];
    if (!first) throw new Error('No maps in the loaded WADs');
    this.totals = { kills: 0, totalKills: 0, items: 0, totalItems: 0, secrets: 0, totalSecrets: 0, timeSec: 0, levels: 0 };
    this.player = null;
    this.startLevel(first, true);
  }

  private makePlayerInfo(): MobjInfo {
    return {
      name: 'PLAYER', doomednum: 1, sprite: 'PLAY', health: 100, speed: 0, radius: 16, height: 56, mass: 100,
      painChance: 255, damage: 0, flags: MF.SOLID | MF.SHOOTABLE | MF.DROPOFF | MF.PICKUP, reactionTime: 0,
      seeSound: null, attackSound: null, painSound: 'DSPLPAIN', deathSound: ['DSPLDETH'], activeSound: null, states: {},
    };
  }

  private makePlayerMobj(ctx: GameCtx, x: number, y: number, z: number, angle: number): Mobj {
    const info = this.makePlayerInfo();
    const mo: Mobj = {
      id: this.mobjIdSeq++, type: 1, info, x, y, z, angle, momx: 0, momy: 0, momz: 0, radius: 16, height: 56,
      floorz: z, ceilingz: z + 1000, dropoffz: z, health: 100, flags: info.flags, sprite: 'PLAY', frame: 0,
      fullbright: false, state: null, tics: -1, target: null, tracer: null, reactiontime: 0, movedir: 0, movecount: 0,
      threshold: 0, lastlook: 0, subsector: null, sector: null, blockIndex: -1, player: null, spawnPoint: null, removed: false,
    };
    ctx.geo.setThingPosition(mo);
    ctx.geo.updateFloorCeiling(mo);
    mo.z = mo.floorz;
    ctx.mobjs.add(mo);
    return mo;
  }

  startLevel(name: string, pistolStart = false): void {
    const level = loadLevel(this.wads, name);
    const geo = createGeo(level);
    this.surface.renderer.setLevel(level);
    const player = pistolStart || !this.player ? createPlayer() : carryOverPlayer(this.player);
    if (this.opts.god) player.cheats.god = true;
    if (this.opts.noclip) player.cheats.noclip = true;
    const world = this.world;
    const audio = this.audio;
    const stats: LevelStats = { totalKills: 0, totalItems: 0, totalSecrets: 0 };
    const ctx: GameCtx = {
      level, geo, assets: this.assets, audio, player, mobjs: new Set<Mobj>(),
      anim: { textureAlias: new Map(), flatAlias: new Map() },
      tic: 0, skill: 3, stats,
      rnd: () => (Math.random() * 256) | 0,
      spawn: (type, x, y, z, angle = 0) => world.spawn(ctx, type, x, y, z, angle),
      remove: (m) => world.remove(ctx, m),
      damage: (target, inflictor, source, amount) => world.damage(ctx, target, inflictor, source, amount),
      message: (text) => { player.message = text; player.messageTics = 35 * 4; },
      exitLevel: (secret) => { this.pendingExit = { secret }; },
      noiseAlert: (m) => world.noiseAlert(ctx, m),
      flash: (kind, amount) => {
        if (kind === 'damage') player.damagecount = Math.min(100, player.damagecount + amount);
        else player.bonuscount = Math.min(100, player.bonuscount + amount);
      },
      playSound: (n, origin) => audio.play(n, origin ? { x: origin.x, y: origin.y } : null),
    };

    // player start
    let start = level.things.find(t => t.type === 1) ?? level.things.find(t => t.type >= 1 && t.type <= 4) ?? null;
    let sx: number, sy: number, sangle: number;
    if (start) { sx = start.x; sy = start.y; sangle = deg2rad(start.angle); }
    else { sx = (level.bounds.minx + level.bounds.maxx) / 2; sy = (level.bounds.miny + level.bounds.maxy) / 2; sangle = 0; }
    if (this.opts.startPos) {
      sx = this.opts.startPos.x; sy = this.opts.startPos.y; sangle = deg2rad(this.opts.startPos.deg);
      this.opts.startPos = null; // only for the first level
    }
    const sector = level.pointInSector(sx, sy);
    let mo = world.spawn(ctx, 'PLAYER', sx, sy, sector.floorH, sangle);
    if (!mo) mo = this.makePlayerMobj(ctx, sx, sy, sector.floorH, sangle);
    mo.player = player;
    player.mo = mo;
    mo.health = player.health;
    mo.angle = sangle;
    if (mo.sector === null) geo.setThingPosition(mo);
    geo.updateFloorCeiling(mo);
    mo.z = mo.floorz;
    player.viewz = mo.z + VIEWHEIGHT;
    player.viewheight = VIEWHEIGHT;
    resetWeaponState(player);
    if (player.cheats.noclip) mo.flags |= MF.NOCLIP;

    world.init(ctx);

    // stats fallback if the world didn't fill them
    if (stats.totalKills === 0) for (const m of ctx.mobjs) if (m.flags & MF.COUNTKILL) stats.totalKills++;
    if (stats.totalItems === 0) for (const m of ctx.mobjs) if (m.flags & MF.COUNTITEM) stats.totalItems++;
    if (stats.totalSecrets === 0) stats.totalSecrets = level.sectors.filter(s => s.special === 9).length;

    this.ctx = ctx;
    this.level = level;
    this.geo = geo;
    this.player = player;
    this.currentMap = name;
    this.state = 'PLAYING';
    this.automap = false;
    this.paused = false;
    this.pendingExit = null;
    this.audio.setListener(mo.x, mo.y, mo.angle);
  }

  exitLevel(secret = false): void {
    if (this.state !== 'PLAYING' || !this.ctx) return;
    this.pendingExit = { secret };
    this.doExit();
  }

  private doExit(): void {
    const ctx = this.ctx;
    if (!ctx || !this.pendingExit) return;
    const secret = this.pendingExit.secret;
    this.pendingExit = null;
    const p = ctx.player;
    const s = ctx.stats;
    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 100);
    const timeSec = Math.floor(ctx.tic / 35);
    this.nextMapName = nextMap(this.currentMap, secret, this.maps);
    this.inter = {
      finished: this.currentMap, next: this.nextMapName,
      killsPct: pct(p.killcount, s.totalKills), itemsPct: pct(p.itemcount, s.totalItems), secretsPct: pct(p.secretcount, s.totalSecrets), timeSec,
    };
    this.totals.kills += p.killcount; this.totals.totalKills += s.totalKills;
    this.totals.items += p.itemcount; this.totals.totalItems += s.totalItems;
    this.totals.secrets += p.secretcount; this.totals.totalSecrets += s.totalSecrets;
    this.totals.timeSec += timeSec; this.totals.levels++;
    this.state = 'INTERMISSION';
    this.input.releaseAll();
  }

  teleport(x: number, y: number, deg?: number): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const mo = ctx.player.mo;
    if (!ctx.geo.teleportMove(mo, x, y)) {
      ctx.geo.unsetThingPosition(mo);
      mo.x = x; mo.y = y;
      ctx.geo.setThingPosition(mo);
      ctx.geo.updateFloorCeiling(mo);
    }
    mo.z = mo.floorz;
    mo.momx = mo.momy = mo.momz = 0;
    if (deg !== undefined) mo.angle = deg2rad(deg);
    ctx.player.viewz = mo.z + ctx.player.viewheight;
  }

  /** One game tic (35/s). */
  tick(): void {
    const input = this.input.poll();
    if (input.mute) this.audio.muted = !this.audio.muted;
    if (input.color) this.colorMode = !this.colorMode;
    this.titleTic++;

    switch (this.state) {
      case 'TITLE':
        if (input.enter) this.start();
        return;
      case 'INTERMISSION':
        if (input.enter) {
          if (this.nextMapName) this.startLevel(this.nextMapName, false);
          else this.state = 'VICTORY';
        }
        return;
      case 'VICTORY':
        if (input.enter) { this.state = 'TITLE'; }
        return;
      case 'PLAYING':
        break;
    }

    const ctx = this.ctx;
    if (!ctx) return;
    const p = ctx.player;
    if (input.escape) this.paused = !this.paused;
    if (input.automap) this.automap = !this.automap;
    if (input.zoomIn) this.automapZoom = Math.min(8, this.automapZoom * 1.25);
    if (input.zoomOut) this.automapZoom = Math.max(0.125, this.automapZoom / 1.25);
    if (this.paused) return;

    ctx.tic++;
    if (input.weaponSlot >= 0) selectWeaponSlot(p, input.weaponSlot);
    playerThink(ctx, this.world, p, input, () => this.startLevel(this.currentMap, true));
    if (this.ctx !== ctx) return; // restarted
    tickWeapon(ctx, this.world, p, input.fire && !p.dead);
    this.world.tick(ctx);
    this.world.playerInSpecialSector(ctx);
    if (p.messageTics > 0 && --p.messageTics === 0) p.message = null;
    if (p.damagecount > 0) p.damagecount--;
    if (p.bonuscount > 0) p.bonuscount--;
    this.audio.setListener(p.mo.x, p.mo.y, p.mo.angle);
    if (this.pendingExit) this.doExit();
  }

  /** Run n tics synchronously (tests). */
  runTics(n: number): void {
    for (let i = 0; i < n; i++) this.tick();
  }

  /** rAF driver: accumulate time, tick, render. */
  frame(now: number): void {
    if (this.last < 0) this.last = now;
    const dt = Math.min(250, now - this.last);
    this.last = now;
    this.acc += dt;
    let n = 0;
    while (this.acc >= TIC_MS && n < 5) {
      this.tick();
      this.acc -= TIC_MS;
      n++;
    }
    if (this.acc > TIC_MS * 5) this.acc = 0;
    this.render();
  }

  render(): void {
    const g = this.surface.grid;
    const tic = this.ctx ? this.ctx.tic : this.titleTic;
    let tint = 0;
    let tintAmount = 0;
    switch (this.state) {
      case 'TITLE':
        drawTitle(g, this.assets, this.titleTic, this.wadName, this.colorMode);
        break;
      case 'INTERMISSION':
        if (this.inter) drawIntermission(g, this.assets, this.inter, this.titleTic, this.colorMode);
        break;
      case 'VICTORY':
        drawVictory(g, this.assets, this.totals, this.titleTic, this.colorMode);
        break;
      case 'PLAYING': {
        const ctx = this.ctx!;
        const p = ctx.player;
        const mo = p.mo;
        fillGrid(g, 32, 0xc8c8c8);
        if (this.automap) {
          drawAutomap(g, ctx.level, p, this.automapZoom, false);
        } else {
          const view: View = {
            x: mo.x, y: mo.y, z: p.viewz, angle: mo.angle,
            sector: mo.sector ?? ctx.level.pointInSector(mo.x, mo.y),
            extralight: p.extralight, fixedColormap: 0,
          };
          const opts: RenderOptions = { anim: ctx.anim, things: ctx.mobjs, psprites: p.psprites, tic: ctx.tic, skip: mo };
          this.surface.renderer.render(view, opts, g, 0, this.colorMode);
        }
        drawHud(g, p, this.currentMap, ctx.stats);
        drawMessage(g, p);
        if (p.dead) drawDeathOverlay(g, this.viewRows, tic);
        if (this.paused) drawPaused(g, this.viewRows);
        if (p.damagecount > 0) { tint = 0xff3020; tintAmount = clamp(p.damagecount / 100, 0.08, 0.75); }
        else if (p.bonuscount > 0) { tint = 0xffe060; tintAmount = clamp(p.bonuscount / 24, 0.05, 0.4); }
        break;
      }
    }
    if (this.surface.gc) this.surface.gc.draw(g, { scanlines: true, tint, tintAmount });
  }

  /** Text dump of the current grid (for tests/screenshots). */
  ascii(): string {
    const g = this.surface.grid;
    const rows: string[] = [];
    for (let y = 0; y < g.rows; y++) {
      let s = '';
      const o = y * g.cols;
      for (let x = 0; x < g.cols; x++) s += String.fromCharCode(g.ch[o + x] || 32);
      rows.push(s.replace(/\s+$/, ''));
    }
    return rows.join('\n');
  }
}

/** Convenience for creating a surface. */
export function makeSurface(assets: Assets, gc: GlyphCanvas | null, cols: number, rows: number, cellAspect: number): Surface {
  const grid = makeGrid(cols, rows);
  const renderer = new Renderer(assets, cols, Math.max(1, rows - 2), cellAspect);
  return { gc, grid, renderer };
}
