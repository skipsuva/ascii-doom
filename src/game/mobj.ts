// Mobj lifecycle: spawn/remove/state machine/movement/damage. (P_MobjThinker, P_DamageMobj, P_SpawnMissile ...)
import { MF, SKY_FLAT } from '../types';
import type { GameCtx, Mobj, MobjInfo, MoveHooks } from '../types';
import { ANG45, TAU, approxDist, pointToAngle, rnd255, rndSigned } from '../math';
import { STATES, S_NULL, infoFor, MF_INFLOAT } from './info';
import type { StateDef } from './info';

export type ActionFn = (ctx: GameCtx, m: Mobj) => void;
const ACTIONS: Record<string, ActionFn> = {};
export function registerActions(map: Record<string, ActionFn>): void {
  Object.assign(ACTIONS, map);
}

/** z sentinels for spawn(): NaN or -Infinity = on floor, +Infinity = on ceiling. */
export const ONFLOORZ = Number.NEGATIVE_INFINITY;
export const ONCEILINGZ = Number.POSITIVE_INFINITY;

const GRAVITY = 1;
const MAXMOVE = 30;
const FRICTION = 0.90625;
const STOPSPEED = 0.0625;
const FLOATSPEED = 4;
const MELEERANGE = 64;
export const MISSILERANGE = 32 * 64;
export const BASETHRESHOLD = 100;

let nextId = 1;

export function stateName(m: Mobj): string {
  return (m.state as string) ?? S_NULL;
}
export function stateDef(m: Mobj): StateDef | undefined {
  return STATES[stateName(m)];
}
export function inState(m: Mobj, entry: string | undefined): boolean {
  if (!entry) return false;
  const s = stateName(m);
  return s === entry || s.startsWith(entry + '_');
}

/** P_SetMobjState. Returns false if the mobj was removed. */
export function setState(ctx: GameCtx, m: Mobj, name: string | undefined): boolean {
  let n = name;
  do {
    if (!n || n === S_NULL) { removeMobj(ctx, m); return false; }
    const st = STATES[n];
    if (!st) { console.warn(`unknown state ${n}`); return true; }
    m.state = n;
    m.tics = st.tics;
    m.sprite = st.sprite;
    m.frame = st.frame;
    m.fullbright = st.bright;
    if (st.action) {
      const fn = ACTIONS[st.action];
      if (fn) fn(ctx, m); else console.warn(`unknown action ${st.action}`);
      if (m.removed) return false;
    }
    n = st.next;
  } while (m.tics === 0);
  return true;
}

export function spawnMobj(ctx: GameCtx, type: number | string, x: number, y: number, z: number, angle = 0): Mobj | null {
  const info = infoFor(type);
  if (!info) return null;
  return spawnWithInfo(ctx, info, x, y, z, angle);
}

export function spawnWithInfo(ctx: GameCtx, info: MobjInfo, x: number, y: number, z: number, angle = 0): Mobj {
  const m: Mobj = {
    id: nextId++,
    type: info.doomednum,
    info,
    x, y, z: Number.isFinite(z) ? z : 0,
    angle,
    momx: 0, momy: 0, momz: 0,
    radius: info.radius,
    height: info.height,
    floorz: 0, ceilingz: 0, dropoffz: 0,
    health: info.health,
    flags: info.flags,
    sprite: info.sprite,
    frame: 0,
    fullbright: false,
    state: null,
    tics: -1,
    target: null,
    tracer: null,
    reactiontime: info.reactionTime,
    movedir: 0,
    movecount: 0,
    threshold: 0,
    lastlook: 0,
    subsector: null,
    sector: null,
    blockIndex: -1,
    player: null,
    spawnPoint: null,
    removed: false,
  };
  ctx.geo.setThingPosition(m);
  ctx.geo.updateFloorCeiling(m);
  if (Number.isNaN(z) || z === ONFLOORZ) m.z = m.floorz;
  else if (z === ONCEILINGZ) m.z = m.ceilingz - m.height;
  ctx.mobjs.add(m);
  setState(ctx, m, info.states.spawn ?? S_NULL);
  return m;
}

export function removeMobj(ctx: GameCtx, m: Mobj): void {
  if (m.removed) return;
  ctx.geo.unsetThingPosition(m);
  m.removed = true;
  m.flags &= ~(MF.SOLID | MF.SHOOTABLE | MF.SPECIAL);
  ctx.mobjs.delete(m);
  if (m.sector) m.sector.things.delete(m);
}

export function playAt(ctx: GameCtx, name: string | string[] | null | undefined, m: Mobj | null, fullVolume = false): void {
  if (!name) return;
  const n = Array.isArray(name) ? name[rnd255() % name.length] : name;
  ctx.playSound(n, fullVolume ? null : m);
}

// ------------------------------------------------------------------ movement
let lastMissileHit: Mobj | null = null;

function missileHooks(ctx: GameCtx): MoveHooks {
  return {
    onMissileHit(missile, target) {
      if (target === missile.target) return false; // don't hit the shooter
      if (target.player && missile.target?.player) return false;
      // vertical overlap
      if (missile.z > target.z + target.height) return false;
      if (missile.z + missile.height < target.z) return false;
      if (missile.target && target.type === missile.target.type && !target.player) {
        lastMissileHit = target; // same species: explode, no damage
        return true;
      }
      if (!(target.flags & MF.SHOOTABLE)) {
        if (target.flags & MF.SOLID) { lastMissileHit = target; return true; }
        return false;
      }
      const damage = ((rnd255() % 8) + 1) * missile.info.damage;
      ctx.damage(target, missile, missile.target, damage);
      lastMissileHit = target;
      return true;
    },
  };
}

export function explodeMissile(ctx: GameCtx, m: Mobj): void {
  m.momx = m.momy = m.momz = 0;
  m.flags &= ~MF.MISSILE;
  if (!setState(ctx, m, m.info.states.death)) return;
  m.tics -= rnd255() & 3;
  if (m.tics < 1) m.tics = 1;
  playAt(ctx, m.info.deathSound, m);
}

function xyMovement(ctx: GameCtx, m: Mobj): void {
  if (m.momx === 0 && m.momy === 0) {
    if (m.flags & MF.SKULLFLY) {
      m.flags &= ~MF.SKULLFLY;
      m.momz = 0;
      setState(ctx, m, m.info.states.spawn);
    }
    return;
  }
  if (m.momx > MAXMOVE) m.momx = MAXMOVE; else if (m.momx < -MAXMOVE) m.momx = -MAXMOVE;
  if (m.momy > MAXMOVE) m.momy = MAXMOVE; else if (m.momy < -MAXMOVE) m.momy = -MAXMOVE;
  let xmove = m.momx, ymove = m.momy;
  const hooks = m.flags & MF.MISSILE ? missileHooks(ctx) : undefined;
  do {
    let ptryx: number, ptryy: number;
    if (xmove > MAXMOVE / 2 || ymove > MAXMOVE / 2 || xmove < -MAXMOVE / 2 || ymove < -MAXMOVE / 2) {
      ptryx = m.x + xmove / 2; ptryy = m.y + ymove / 2;
      xmove /= 2; ymove /= 2;
    } else {
      ptryx = m.x + xmove; ptryy = m.y + ymove;
      xmove = ymove = 0;
    }
    lastMissileHit = null;
    if (!ctx.geo.tryMove(m, ptryx, ptryy, hooks)) {
      if (m.flags & MF.SKULLFLY) {
        const res = ctx.geo.checkPosition(m, ptryx, ptryy);
        const hit = res.blockingThing;
        if (hit && hit !== m && (hit.flags & MF.SHOOTABLE)) {
          ctx.damage(hit, m, m, ((rnd255() % 8) + 1) * m.info.damage);
        }
        m.flags &= ~MF.SKULLFLY;
        m.momx = m.momy = m.momz = 0;
        setState(ctx, m, m.info.states.spawn);
        return;
      }
      if (m.flags & MF.MISSILE) {
        if (!lastMissileHit) {
          const res = ctx.geo.checkPosition(m, ptryx, ptryy);
          const line = res.blockingLine;
          if (line && line.backSector && line.backSector.ceilFlat === SKY_FLAT && line.frontSector.ceilFlat === SKY_FLAT) {
            removeMobj(ctx, m); // hit the sky
            return;
          }
        }
        explodeMissile(ctx, m);
        return;
      }
      m.momx = m.momy = 0;
      return;
    }
  } while ((xmove !== 0 || ymove !== 0) && !m.removed);

  if (m.removed) return;
  if (m.flags & (MF.MISSILE | MF.SKULLFLY)) return; // no friction for missiles
  if (m.z > m.floorz) return; // no friction in the air
  if (m.flags & MF.CORPSE) {
    // do not stop sliding if halfway off a step with some momentum
    if (m.momx > 0.25 || m.momx < -0.25 || m.momy > 0.25 || m.momy < -0.25) {
      if (m.floorz !== m.sector?.floorH) return;
    }
  }
  if (Math.abs(m.momx) < STOPSPEED && Math.abs(m.momy) < STOPSPEED) {
    m.momx = m.momy = 0;
  } else {
    m.momx *= FRICTION;
    m.momy *= FRICTION;
  }
}

function zMovement(ctx: GameCtx, m: Mobj): void {
  m.z += m.momz;
  if ((m.flags & MF.FLOAT) && m.target && !(m.flags & MF.SKULLFLY) && !(m.flags & MF_INFLOAT)) {
    const dist = approxDist(m.x - m.target.x, m.y - m.target.y);
    const delta = m.target.z + m.height / 2 - m.z;
    if (delta < 0 && dist < -(delta * 3)) m.z -= FLOATSPEED;
    else if (delta > 0 && dist < delta * 3) m.z += FLOATSPEED;
  }
  if (m.z <= m.floorz) {
    if (m.flags & MF.SKULLFLY) m.momz = -m.momz;
    if (m.momz < 0) m.momz = 0;
    m.z = m.floorz;
    if ((m.flags & MF.MISSILE) && !(m.flags & MF.NOCLIP)) { explodeMissile(ctx, m); return; }
  } else if (!(m.flags & MF.NOGRAVITY)) {
    m.momz = m.momz === 0 ? -GRAVITY * 2 : m.momz - GRAVITY;
  }
  if (m.z + m.height > m.ceilingz) {
    if (m.momz > 0) m.momz = 0;
    m.z = m.ceilingz - m.height;
    if (m.flags & MF.SKULLFLY) m.momz = -m.momz;
    if ((m.flags & MF.MISSILE) && !(m.flags & MF.NOCLIP)) { explodeMissile(ctx, m); return; }
  }
}

/** Advance every non-player mobj; player mobjs only get state tics (D1 moves the player). */
export function tickMobjs(ctx: GameCtx): void {
  const list = Array.from(ctx.mobjs);
  for (const m of list) {
    if (m.removed) continue;
    if (!m.player) {
      if (m.momx !== 0 || m.momy !== 0 || (m.flags & MF.SKULLFLY)) xyMovement(ctx, m);
      if (m.removed) continue;
      if (m.z !== m.floorz || m.momz !== 0) zMovement(ctx, m);
      if (m.removed) continue;
    }
    if (m.tics !== -1) {
      m.tics--;
      if (m.tics <= 0) {
        const st = stateDef(m);
        setState(ctx, m, st ? st.next : S_NULL);
      }
    }
  }
}

// ------------------------------------------------------------------ damage
export function damageMobj(ctx: GameCtx, target: Mobj, inflictor: Mobj | null, source: Mobj | null, damage: number): void {
  if (!(target.flags & MF.SHOOTABLE)) return;
  if (target.health <= 0 || target.removed) return;
  if (target.flags & MF.SKULLFLY) target.momx = target.momy = target.momz = 0;
  const player = target.player;
  damage = Math.floor(damage);
  if (damage <= 0) return;

  // thrust away from the inflictor
  if (inflictor && !(target.flags & MF.NOCLIP) && !(source && source.player && source.player.readyWeapon === 7)) {
    let ang = pointToAngle(target.x - inflictor.x, target.y - inflictor.y);
    let thrust = (damage * 12.5) / Math.max(1, target.info.mass);
    if (damage < 40 && damage > target.health && target.z - inflictor.z > 64 && (rnd255() & 1)) {
      ang += Math.PI;
      thrust *= 4;
    }
    target.momx += thrust * Math.cos(ang);
    target.momy += thrust * Math.sin(ang);
  }

  if (player) {
    if (target.sector && target.sector.special === 11 && damage >= target.health) damage = target.health - 1;
    if (player.cheats.god) return;
    if (player.armorType) {
      let saved = player.armorType === 1 ? Math.floor(damage / 3) : Math.floor(damage / 2);
      if (player.armor <= saved) { saved = player.armor; player.armorType = 0; }
      player.armor -= saved;
      damage -= saved;
    }
    player.health -= damage;
    if (player.health < 0) player.health = 0;
    player.attacker = source;
    ctx.flash('damage', damage);
    if (damage > 0 && player.health > 0) playAt(ctx, 'DSPLPAIN', target);
  }

  target.health -= damage;
  if (target.health <= 0) { killMobj(ctx, source, target); return; }

  if (rnd255() < target.info.painChance && !(target.flags & MF.SKULLFLY)) {
    target.flags |= MF.JUSTHIT;
    if (target.info.states.pain && !player) setState(ctx, target, target.info.states.pain);
  }
  target.reactiontime = 0;
  if (!target.threshold && source && source !== target && !(source.info.name === 'ARCHVILE')) {
    target.target = source;
    target.threshold = BASETHRESHOLD;
    if (!player && inState(target, target.info.states.spawn) && target.info.states.see) {
      setState(ctx, target, target.info.states.see);
    }
  }
}

export function killMobj(ctx: GameCtx, source: Mobj | null, target: Mobj): void {
  target.flags &= ~(MF.SHOOTABLE | MF.FLOAT | MF.SKULLFLY);
  if (target.info.name !== 'LOSTSOUL') target.flags &= ~MF.NOGRAVITY;
  target.flags |= MF.CORPSE | MF.DROPOFF;
  target.height /= 4;
  if (target.flags & MF.COUNTKILL) {
    // single player: every monster death counts
    ctx.player.killcount++;
  }
  if (target.player) {
    target.flags &= ~MF.SOLID;
    target.player.dead = true;
    target.player.health = Math.min(target.player.health, 0);
    playAt(ctx, target.health < -50 ? 'DSPDIEHI' : 'DSPLDETH', target);
    setState(ctx, target, target.info.states.death);
    return;
  }
  const xdeath = target.info.states.xdeath;
  if (target.health < -target.info.health && xdeath) setState(ctx, target, xdeath);
  else setState(ctx, target, target.info.states.death);
  if (target.removed) return;
  target.tics -= rnd255() & 3;
  if (target.tics < 1) target.tics = 1;
  const drop = target.info.drop as number | string | undefined;
  if (drop) {
    const mo = spawnMobj(ctx, drop, target.x, target.y, ONFLOORZ, 0);
    if (mo) mo.flags |= MF.DROPPED;
  }
  void source;
}

/** P_RadiusAttack */
export function radiusAttack(ctx: GameCtx, spot: Mobj, source: Mobj | null, damage: number): void {
  ctx.geo.thingsInRadius(spot.x, spot.y, damage + 64, m => {
    if (!(m.flags & MF.SHOOTABLE) || m.removed) return;
    if (m.info.name === 'CYBERDEMON' || m.info.name === 'SPIDERMASTERMIND') return;
    const dx = Math.abs(m.x - spot.x), dy = Math.abs(m.y - spot.y);
    let dist = (dx > dy ? dx : dy) - m.radius;
    if (dist < 0) dist = 0;
    if (dist >= damage) return;
    if (ctx.geo.checkSight(m, spot)) ctx.damage(m, spot, source, damage - dist);
  });
}

// ------------------------------------------------------------------ missiles & hitscan helpers
export function spawnMissile(ctx: GameCtx, source: Mobj, dest: Mobj, type: string): Mobj | null {
  const th = spawnMobj(ctx, type, source.x, source.y, source.z + 32, 0);
  if (!th) return null;
  playAt(ctx, th.info.seeSound, th);
  th.target = source;
  let an = pointToAngle(dest.x - source.x, dest.y - source.y);
  if (dest.flags & MF.SHADOW) an += rndSigned() * (TAU / 4096);
  th.angle = an;
  th.momx = th.info.speed * Math.cos(an);
  th.momy = th.info.speed * Math.sin(an);
  let dist = approxDist(dest.x - source.x, dest.y - source.y) / th.info.speed;
  if (dist < 1) dist = 1;
  th.momz = (dest.z + dest.height / 2 - th.z) / dist;
  checkMissileSpawn(ctx, th);
  return th;
}

/** Player-fired missile (D1 may call): aims along angle with vertical slope. */
export function spawnPlayerMissile(ctx: GameCtx, source: Mobj, angle: number, slope: number, type: string): Mobj | null {
  const th = spawnMobj(ctx, type, source.x, source.y, source.z + 32, angle);
  if (!th) return null;
  playAt(ctx, th.info.seeSound, th);
  th.target = source;
  th.momx = th.info.speed * Math.cos(angle);
  th.momy = th.info.speed * Math.sin(angle);
  th.momz = th.info.speed * slope;
  checkMissileSpawn(ctx, th);
  return th;
}

function checkMissileSpawn(ctx: GameCtx, th: Mobj): void {
  th.tics -= rnd255() & 3;
  if (th.tics < 1) th.tics = 1;
  th.z += th.momz / 2;
  lastMissileHit = null;
  if (!ctx.geo.tryMove(th, th.x + th.momx / 2, th.y + th.momy / 2, missileHooks(ctx))) explodeMissile(ctx, th);
}

/** Hitscan attack from a mobj: damages the first thing hit, spawns puffs/blood. Returns the hit result kind. */
export function lineAttack(ctx: GameCtx, shooter: Mobj, angle: number, range: number, damage: number,
  onWall?: (line: import('../types').Line, side: 0 | 1) => void): 'thing' | 'wall' | 'none' {
  const z = shooter.z + shooter.height / 2 + 8;
  const hit = ctx.geo.hitscan(shooter, angle, range, z);
  if (hit.kind === 'thing') {
    const t = hit.thing;
    if (t.flags & MF.NOBLOOD) spawnPuff(ctx, hit.x, hit.y, hit.z);
    else spawnBlood(ctx, hit.x, hit.y, hit.z, damage);
    ctx.damage(t, shooter, shooter, damage);
    return 'thing';
  }
  if (hit.kind === 'wall') {
    const line = hit.line;
    if (line.special && onWall) onWall(line, ctx.geo.pointOnLineSide(shooter.x, shooter.y, line));
    // no puff on sky
    if (line.frontSector.ceilFlat === SKY_FLAT && hit.z > line.frontSector.ceilH) return 'wall';
    // pull the puff slightly back toward the shooter
    const bx = hit.x - Math.cos(angle) * 4, by = hit.y - Math.sin(angle) * 4;
    spawnPuff(ctx, bx, by, hit.z);
    return 'wall';
  }
  return 'none';
}

export function spawnPuff(ctx: GameCtx, x: number, y: number, z: number): void {
  z += rndSigned() / 64;
  const th = spawnMobj(ctx, 'PUFF', x, y, z, 0);
  if (!th) return;
  th.momz = 1;
  th.tics -= rnd255() & 3;
  if (th.tics < 1) th.tics = 1;
}

export function spawnBlood(ctx: GameCtx, x: number, y: number, z: number, damage: number): void {
  z += rndSigned() / 64;
  const th = spawnMobj(ctx, 'BLUD', x, y, z, 0);
  if (!th) return;
  th.momz = 2;
  th.tics -= rnd255() & 3;
  if (th.tics < 1) th.tics = 1;
  if (damage <= 12 && damage >= 9) setState(ctx, th, 'BLUD_1');
  else if (damage < 9) setState(ctx, th, 'BLUD_2');
}

export { MELEERANGE, FLOATSPEED, ANG45 };
