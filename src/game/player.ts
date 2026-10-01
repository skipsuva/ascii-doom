// Player movement, view height/bob, use, death handling (P_PlayerThink / P_CalcHeight / P_DeathThink).
import { MF, WEAPON, type GameCtx, type Mobj, type MoveHooks, type Player, type WorldSim } from '../types';
import { angleDiff, clamp, normAngle, pointToAngle, TAU, DEG } from '../math';
import type { InputFrame } from '../input';
import { playerMaxAmmo, touchSpecial } from './pickups';

export const VIEWHEIGHT = 41;
const MAXMOVE = 30;
const FRICTION = 0.90625;
const STOPSPEED = 0.0625;
const GRAVITY = 1;
const MOUSE_SENS = 0.0022;

export function createPlayer(): Player {
  return {
    mo: null as unknown as Mobj,
    health: 100,
    armor: 0,
    armorType: 0,
    ammo: [50, 0, 0, 0],
    maxAmmo: playerMaxAmmo(false),
    weapons: [true, true, false, false, false, false, false, false],
    readyWeapon: WEAPON.PISTOL,
    pendingWeapon: -1,
    keys: { blue: false, yellow: false, red: false },
    backpack: false,
    berserk: 0,
    bob: 0,
    viewz: VIEWHEIGHT,
    viewheight: VIEWHEIGHT,
    deltaviewheight: 0,
    psprites: [
      { sprite: 'PISG', frame: 0, sx: 1, sy: 32, fullbright: false },
      { sprite: null, frame: 0, sx: 1, sy: 32, fullbright: true },
    ],
    attackdown: false,
    usedown: false,
    refire: 0,
    damagecount: 0,
    bonuscount: 0,
    extralight: 0,
    killcount: 0,
    itemcount: 0,
    secretcount: 0,
    message: null,
    messageTics: 0,
    cheats: { god: false, noclip: false },
    dead: false,
    attacker: null,
  };
}

/** New level: keep health/armor/ammo/weapons (DOOM), drop keys and per-level counters. */
export function carryOverPlayer(prev: Player): Player {
  const p = createPlayer();
  p.health = Math.max(1, prev.health);
  p.armor = prev.armor;
  p.armorType = prev.armorType;
  p.ammo = prev.ammo.slice();
  p.backpack = prev.backpack;
  p.maxAmmo = playerMaxAmmo(prev.backpack);
  p.weapons = prev.weapons.slice();
  p.readyWeapon = prev.readyWeapon;
  p.cheats = { ...prev.cheats };
  return p;
}

interface PlayerRuntime { turnHeld: number; deathTics: number }
const runtimes = new WeakMap<Player, PlayerRuntime>();
function rt(p: Player): PlayerRuntime {
  let r = runtimes.get(p);
  if (!r) { r = { turnHeld: 0, deathTics: 0 }; runtimes.set(p, r); }
  return r;
}

function makeHooks(ctx: GameCtx, world: WorldSim): MoveHooks {
  return {
    onCross: (line, side, mover) => world.crossSpecialLine(ctx, line, side, mover),
    onTouchSpecial: (item, toucher) => { touchSpecial(ctx, item, toucher); },
  };
}

function xyMovement(ctx: GameCtx, mo: Mobj, hooks: MoveHooks, noclip: boolean, moving: boolean): void {
  mo.momx = clamp(mo.momx, -MAXMOVE, MAXMOVE);
  mo.momy = clamp(mo.momy, -MAXMOVE, MAXMOVE);
  if (mo.momx === 0 && mo.momy === 0) return;
  const geo = ctx.geo;
  if (noclip) {
    geo.unsetThingPosition(mo);
    mo.x += mo.momx;
    mo.y += mo.momy;
    geo.setThingPosition(mo);
    geo.updateFloorCeiling(mo);
  } else {
    geo.slideMove(mo, hooks);
  }
  if (mo.z > mo.floorz && !noclip) return; // airborne: no friction
  if (Math.abs(mo.momx) < STOPSPEED && Math.abs(mo.momy) < STOPSPEED && !moving) {
    mo.momx = 0;
    mo.momy = 0;
  } else {
    mo.momx *= FRICTION;
    mo.momy *= FRICTION;
  }
}

function zMovement(ctx: GameCtx, p: Player, mo: Mobj): void {
  // smooth step up
  if (mo.z < mo.floorz) {
    p.viewheight -= mo.floorz - mo.z;
    p.deltaviewheight = (VIEWHEIGHT - p.viewheight) / 8;
  }
  mo.z += mo.momz;
  if (mo.z <= mo.floorz) {
    if (mo.momz < 0) {
      if (mo.momz < -GRAVITY * 8) {
        p.deltaviewheight = mo.momz / 8;
        ctx.playSound('DSOOF', mo);
      }
      mo.momz = 0;
    }
    mo.z = mo.floorz;
  } else if (!(mo.flags & MF.NOGRAVITY)) {
    if (mo.momz === 0) mo.momz = -GRAVITY * 2;
    else mo.momz -= GRAVITY;
  }
  if (mo.z + mo.height > mo.ceilingz) {
    if (mo.momz > 0) mo.momz = 0;
    mo.z = mo.ceilingz - mo.height;
  }
}

function calcHeight(ctx: GameCtx, p: Player, mo: Mobj): void {
  p.bob = Math.min(16, (mo.momx * mo.momx + mo.momy * mo.momy) / 4);
  const onground = mo.z <= mo.floorz;
  if (!onground) {
    p.viewz = mo.z + p.viewheight;
    if (p.viewz > mo.ceilingz - 4) p.viewz = mo.ceilingz - 4;
    return;
  }
  const bob = (p.bob / 2) * Math.sin((TAU * ctx.tic) / 20);
  if (!p.dead) {
    p.viewheight += p.deltaviewheight;
    if (p.viewheight > VIEWHEIGHT) { p.viewheight = VIEWHEIGHT; p.deltaviewheight = 0; }
    if (p.viewheight < VIEWHEIGHT / 2) { p.viewheight = VIEWHEIGHT / 2; if (p.deltaviewheight <= 0) p.deltaviewheight = 1 / 65536; }
    if (p.deltaviewheight) {
      p.deltaviewheight += 0.25;
      if (!p.deltaviewheight) p.deltaviewheight = 1 / 65536;
    }
  }
  p.viewz = mo.z + p.viewheight + bob;
  if (p.viewz > mo.ceilingz - 4) p.viewz = mo.ceilingz - 4;
}

function useLines(ctx: GameCtx, world: WorldSim, p: Player): void {
  const res = ctx.geo.useTrace(p.mo);
  if (res === 'noway') {
    ctx.playSound('DSNOWAY', p.mo);
  } else if (res) {
    world.useSpecialLine(ctx, res.line, res.side, p.mo);
  }
}

function deathThink(ctx: GameCtx, world: WorldSim, p: Player, input: InputFrame, onRestart: () => void): void {
  const mo = p.mo;
  const r = rt(p);
  const hooks = makeHooks(ctx, world);
  xyMovement(ctx, mo, hooks, false, false);
  zMovement(ctx, p, mo);
  p.deltaviewheight = 0;
  if (p.viewheight > 6) p.viewheight -= 1;
  if (p.viewheight < 6) p.viewheight = 6;
  p.viewz = mo.z + p.viewheight;
  if (p.attacker && p.attacker !== mo && !p.attacker.removed) {
    const ang = pointToAngle(p.attacker.x - mo.x, p.attacker.y - mo.y);
    const d = angleDiff(ang, mo.angle);
    if (Math.abs(d) < 5 * DEG) mo.angle = ang;
    else mo.angle = normAngle(mo.angle + Math.sign(d) * 5 * DEG);
  }
  r.deathTics++;
  if (input.use) {
    if (!p.usedown) {
      p.usedown = true;
      if (r.deathTics > 35) onRestart();
    }
  } else {
    p.usedown = false;
  }
}

/** One tic of player logic (movement, use). Weapons are ticked separately (weapons.ts). */
export function playerThink(ctx: GameCtx, world: WorldSim, p: Player, input: InputFrame, onRestart: () => void): void {
  const mo = p.mo;
  if (p.dead) {
    deathThink(ctx, world, p, input, onRestart);
    return;
  }
  const r = rt(p);
  r.deathTics = 0;
  if (p.cheats.noclip) mo.flags |= MF.NOCLIP; else mo.flags &= ~MF.NOCLIP;
  const noclip = (mo.flags & MF.NOCLIP) !== 0;
  const onground = mo.z <= mo.floorz;

  // turning
  if (input.turn !== 0) r.turnHeld++; else r.turnHeld = 0;
  if (input.turn !== 0) {
    const tspeed = r.turnHeld < 6 ? 320 : input.run ? 1280 : 640;
    mo.angle = normAngle(mo.angle - input.turn * (tspeed / 65536) * TAU);
  }
  if (input.mouseDx !== 0) mo.angle = normAngle(mo.angle - input.mouseDx * MOUSE_SENS);

  // thrust
  if (onground || noclip) {
    const fwd = input.forward * (input.run ? 50 : 25);
    const side = input.side * (input.run ? 40 : 24);
    if (fwd !== 0) {
      mo.momx += (fwd / 32) * Math.cos(mo.angle);
      mo.momy += (fwd / 32) * Math.sin(mo.angle);
    }
    if (side !== 0) {
      const a = mo.angle - Math.PI / 2;
      mo.momx += (side / 32) * Math.cos(a);
      mo.momy += (side / 32) * Math.sin(a);
    }
  }
  xyMovement(ctx, mo, makeHooks(ctx, world), noclip, input.forward !== 0 || input.side !== 0);
  zMovement(ctx, p, mo);
  calcHeight(ctx, p, mo);

  if (input.use) {
    if (!p.usedown) {
      p.usedown = true;
      useLines(ctx, world, p);
    }
  } else {
    p.usedown = false;
  }
  mo.health = p.health;
}
