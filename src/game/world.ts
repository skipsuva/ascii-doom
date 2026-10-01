// World simulation entry point (WorldSim): monsters, missiles, sector specials. Agent D2.
import { MF, MTF } from '../types';
import type { GameCtx, Mobj, MobjInfo, WorldSim } from '../types';
import { deg2rad, rnd255 } from '../math';
import { infoFor } from './info';
import {
  ONCEILINGZ, ONFLOORZ, damageMobj, radiusAttack, removeMobj, spawnMobj, tickMobjs,
} from './mobj';
import { noiseAlert } from './ai';
import {
  crossSpecialLine, initSpecials, playerInSpecialSector, shootSpecialLine, tickSpecials, useSpecialLine,
} from './specials';
import './ai'; // registers actions

export { ONFLOORZ, ONCEILINGZ } from './mobj';
export { spawnPlayerMissile, lineAttack, spawnPuff, spawnBlood, setState } from './mobj';
export { infoFor, STATES } from './info';

const warned = new Set<number>();

function skillBit(skill: number): number {
  return skill <= 2 ? MTF.EASY : skill === 3 ? MTF.NORMAL : MTF.HARD;
}

export function createWorld(): WorldSim {
  const world: WorldSim = {
    init(ctx) {
      ctx.stats.totalKills = 0;
      ctx.stats.totalItems = 0;
      ctx.stats.totalSecrets = 0;
      const bit = skillBit(ctx.skill);
      for (const t of ctx.level.things) {
        if (t.type === 11 || (t.type >= 1 && t.type <= 4) || t.type === 14) continue;
        if (t.flags & MTF.NOTSINGLE) continue;
        if (!(t.flags & bit)) continue;
        const info = infoFor(t.type);
        if (!info) {
          if (!warned.has(t.type)) { warned.add(t.type); console.warn(`unknown thing type ${t.type}, skipped`); }
          continue;
        }
        if (info.flags & MF.COUNTKILL && !ctx.assets.sprite(info.sprite)) {
          if (!warned.has(t.type)) { warned.add(t.type); console.warn(`no sprite ${info.sprite} for thing ${t.type}, skipped`); }
          continue;
        }
        const z = info.flags & MF.SPAWNCEILING ? ONCEILINGZ : ONFLOORZ;
        const m = spawnMobj(ctx, t.type, t.x, t.y, z, deg2rad(t.angle));
        if (!m) continue;
        m.spawnPoint = t;
        if (t.flags & MTF.AMBUSH) m.flags |= MF.AMBUSH;
        if (m.tics > 0) m.tics = 1 + (rnd255() % m.tics);
        if (m.flags & MF.COUNTKILL) ctx.stats.totalKills++;
        if (m.flags & MF.COUNTITEM) ctx.stats.totalItems++;
      }
      initSpecials(ctx);
    },
    tick(ctx) {
      tickMobjs(ctx);
      tickSpecials(ctx);
    },
    spawn(ctx, type, x, y, z, angle) {
      return spawnMobj(ctx, type, x, y, z, angle);
    },
    remove(ctx, m) {
      removeMobj(ctx, m);
    },
    damage(ctx, target, inflictor, source, amount) {
      damageMobj(ctx, target, inflictor, source, amount);
    },
    useSpecialLine(ctx, line, side, user) {
      return useSpecialLine(ctx, line, side, user);
    },
    crossSpecialLine(ctx, line, side, thing) {
      crossSpecialLine(ctx, line, side, thing);
    },
    shootSpecialLine(ctx, line, side, shooter) {
      shootSpecialLine(ctx, line, side, shooter);
    },
    noiseAlert(ctx, emitter) {
      noiseAlert(ctx, emitter);
    },
    playerInSpecialSector(ctx) {
      playerInSpecialSector(ctx);
    },
    radiusAttack(ctx, spot, source, damage) {
      radiusAttack(ctx, spot, source, damage);
    },
    infoFor(type): MobjInfo | null {
      return infoFor(type);
    },
  };
  return world;
}

export type { Mobj, GameCtx };
