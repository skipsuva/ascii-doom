// Player weapons: psprite state sequences, firing (hitscan / missiles), switching, auto-switch on empty.
import { AMMO, MF, WEAPON, type GameCtx, type HitResult, type Mobj, type Player, type WorldSim } from '../types';
import { normAngle, pointToAngle, rnd255, rndSigned, TAU } from '../math';

interface Step { f: number; t: number; a?: 'fire' | 'refire' | 'flash' }
interface WeaponDef {
  name: string;
  slot: number;
  ammo: number;
  perShot: number;
  sprite: string;
  readyFrame: number;
  attack: Step[];
  flashSprite: string | null;
  flash: Step[];
  /** rocket/bfg need a fresh press per shot */
  noAutoFire?: boolean;
}

const S = (f: number, t: number, a?: Step['a']): Step => ({ f, t, a });

export const WEAPONS: Record<number, WeaponDef> = {
  [WEAPON.FIST]: { name: 'FIST', slot: 0, ammo: AMMO.NONE, perShot: 0, sprite: 'PUNG', readyFrame: 0,
    attack: [S(1, 4), S(2, 4, 'fire'), S(3, 5), S(2, 4), S(1, 5, 'refire')], flashSprite: null, flash: [] },
  [WEAPON.PISTOL]: { name: 'PISTOL', slot: 1, ammo: AMMO.BULLETS, perShot: 1, sprite: 'PISG', readyFrame: 0,
    attack: [S(1, 4), S(2, 6, 'fire'), S(1, 4), S(1, 5, 'refire')], flashSprite: 'PISF', flash: [S(0, 7)] },
  [WEAPON.SHOTGUN]: { name: 'SHOTGUN', slot: 2, ammo: AMMO.SHELLS, perShot: 1, sprite: 'SHTG', readyFrame: 0,
    attack: [S(0, 3), S(0, 7, 'fire'), S(1, 5), S(2, 5), S(3, 4), S(2, 5), S(1, 5), S(0, 3), S(0, 7, 'refire')],
    flashSprite: 'SHTF', flash: [S(0, 4), S(1, 3)] },
  [WEAPON.CHAINGUN]: { name: 'CHAINGUN', slot: 3, ammo: AMMO.BULLETS, perShot: 1, sprite: 'CHGG', readyFrame: 0,
    attack: [S(0, 4, 'fire'), S(1, 4, 'fire'), S(1, 0, 'refire')], flashSprite: 'CHGF', flash: [S(0, 5)] },
  [WEAPON.ROCKET]: { name: 'ROCKET LAUNCHER', slot: 4, ammo: AMMO.ROCKETS, perShot: 1, sprite: 'MISG', readyFrame: 0,
    attack: [S(1, 8, 'flash'), S(1, 12, 'fire'), S(1, 0, 'refire')], flashSprite: 'MISF',
    flash: [S(0, 3), S(1, 4), S(2, 4), S(3, 4)], noAutoFire: true },
  [WEAPON.PLASMA]: { name: 'PLASMA GUN', slot: 5, ammo: AMMO.CELLS, perShot: 1, sprite: 'PLSG', readyFrame: 0,
    attack: [S(0, 3, 'fire'), S(1, 20, 'refire')], flashSprite: 'PLSF', flash: [S(0, 4)] },
  [WEAPON.BFG]: { name: 'BFG9000', slot: 6, ammo: AMMO.CELLS, perShot: 40, sprite: 'BFGG', readyFrame: 0,
    attack: [S(0, 20), S(1, 10, 'flash'), S(1, 10, 'fire'), S(1, 20, 'refire')], flashSprite: 'BFGF',
    flash: [S(0, 11), S(1, 6)], noAutoFire: true },
  [WEAPON.CHAINSAW]: { name: 'CHAINSAW', slot: 0, ammo: AMMO.NONE, perShot: 0, sprite: 'SAWG', readyFrame: 2,
    attack: [S(0, 4, 'fire'), S(1, 4, 'fire'), S(1, 0, 'refire')], flashSprite: null, flash: [] },
};

export function weaponName(w: number): string {
  return WEAPONS[w]?.name ?? '?';
}

interface WeaponRuntime {
  phase: 'ready' | 'lower' | 'raise' | 'attack';
  seq: Step[] | null;
  idx: number;
  tics: number;
  flashSeq: Step[] | null;
  flashIdx: number;
  flashTics: number;
  fireStep: number;
  sawIdle: number;
}

const runtimes = new WeakMap<Player, WeaponRuntime>();

function rt(p: Player): WeaponRuntime {
  let r = runtimes.get(p);
  if (!r) {
    r = { phase: 'ready', seq: null, idx: 0, tics: 0, flashSeq: null, flashIdx: 0, flashTics: 0, fireStep: 0, sawIdle: 0 };
    runtimes.set(p, r);
  }
  return r;
}

/** Reset the weapon runtime when a new level starts (weapon appears raised). */
export function resetWeaponState(p: Player): void {
  runtimes.delete(p);
  const w = WEAPONS[p.readyWeapon] ?? WEAPONS[WEAPON.PISTOL];
  p.psprites[0] = { sprite: w.sprite, frame: w.readyFrame, sx: 1, sy: 32, fullbright: false };
  p.psprites[1] = { sprite: null, frame: 0, sx: 1, sy: 32, fullbright: true };
  p.pendingWeapon = -1;
  p.attackdown = false;
  p.refire = 0;
}

export function hasAmmoFor(p: Player, weapon: number): boolean {
  const w = WEAPONS[weapon];
  if (!w) return false;
  return w.ammo === AMMO.NONE || p.ammo[w.ammo] >= w.perShot;
}

/** DOOM P_CheckAmmo preference order. */
export function bestWeapon(p: Player): number {
  const has = (w: number) => p.weapons[w] && hasAmmoFor(p, w);
  if (has(WEAPON.PLASMA)) return WEAPON.PLASMA;
  if (has(WEAPON.CHAINGUN)) return WEAPON.CHAINGUN;
  if (has(WEAPON.SHOTGUN)) return WEAPON.SHOTGUN;
  if (has(WEAPON.PISTOL)) return WEAPON.PISTOL;
  if (p.weapons[WEAPON.CHAINSAW]) return WEAPON.CHAINSAW;
  if (has(WEAPON.ROCKET)) return WEAPON.ROCKET;
  if (has(WEAPON.BFG)) return WEAPON.BFG;
  return WEAPON.FIST;
}

/** Handle a weapon slot key (0..6). */
export function selectWeaponSlot(p: Player, slot: number): void {
  if (p.dead) return;
  let w = -1;
  switch (slot) {
    case 0:
      w = p.weapons[WEAPON.CHAINSAW] && p.readyWeapon !== WEAPON.CHAINSAW ? WEAPON.CHAINSAW : WEAPON.FIST;
      break;
    case 1: w = WEAPON.PISTOL; break;
    case 2: w = WEAPON.SHOTGUN; break;
    case 3: w = WEAPON.CHAINGUN; break;
    case 4: w = WEAPON.ROCKET; break;
    case 5: w = WEAPON.PLASMA; break;
    case 6: w = WEAPON.BFG; break;
  }
  if (w < 0 || !p.weapons[w] || w === p.readyWeapon) return;
  p.pendingWeapon = w;
}

function setReadySprite(p: Player): void {
  const w = WEAPONS[p.readyWeapon] ?? WEAPONS[WEAPON.FIST];
  const psp = p.psprites[0];
  psp.sprite = w.sprite;
  psp.frame = w.readyFrame;
  psp.fullbright = false;
}

function checkAmmo(p: Player, r: WeaponRuntime): boolean {
  if (hasAmmoFor(p, p.readyWeapon)) return true;
  p.pendingWeapon = bestWeapon(p);
  r.phase = 'lower';
  r.seq = null;
  return false;
}

function startFlash(p: Player, r: WeaponRuntime, w: WeaponDef): void {
  if (!w.flashSprite || w.flash.length === 0) return;
  r.flashSeq = w.flash;
  r.flashIdx = 0;
  r.flashTics = w.flash[0].t;
  const fl = p.psprites[1];
  fl.sprite = w.flashSprite;
  // chaingun alternates flash frame with the attack step
  fl.frame = p.readyWeapon === WEAPON.CHAINGUN ? Math.min(r.fireStep, 1) : w.flash[0].f;
  fl.fullbright = true;
}

function spawnPuff(ctx: GameCtx, x: number, y: number, z: number): void {
  const m = ctx.spawn('PUFF', x, y, z + rndSigned() / 64);
  if (m) m.momz = 1;
}

function spawnBlood(ctx: GameCtx, x: number, y: number, z: number): void {
  const m = ctx.spawn('BLUD', x, y, z + rndSigned() / 64);
  if (m) m.momz = 2;
}

function applyHit(ctx: GameCtx, world: WorldSim, shooter: Mobj, angle: number, hit: HitResult, dmg: number): boolean {
  if (hit.kind === 'thing') {
    ctx.damage(hit.thing, null, shooter, dmg);
    if (hit.thing.flags & MF.NOBLOOD) spawnPuff(ctx, hit.x, hit.y, hit.z);
    else spawnBlood(ctx, hit.x, hit.y, hit.z);
    return true;
  }
  if (hit.kind === 'wall') {
    const bx = hit.x - 4 * Math.cos(angle);
    const by = hit.y - 4 * Math.sin(angle);
    spawnPuff(ctx, bx, by, hit.z);
    const side = ctx.geo.pointOnLineSide(shooter.x, shooter.y, hit.line);
    if (hit.line.special) world.shootSpecialLine(ctx, hit.line, side, shooter);
  }
  return false;
}

function shotZ(mo: Mobj): number {
  return mo.z + mo.height / 2 + 8;
}

function bullet(ctx: GameCtx, world: WorldSim, mo: Mobj, angle: number): void {
  const dmg = 5 * ((rnd255() % 3) + 1);
  const hit = ctx.geo.hitscan(mo, angle, 2048, shotZ(mo));
  applyHit(ctx, world, mo, angle, hit, dmg);
}

/** ±5.6 degrees like (P_Random()-P_Random())<<18 */
function spread(): number {
  return (rndSigned() / 255) * (5.625 * Math.PI / 180);
}

function melee(ctx: GameCtx, world: WorldSim, p: Player, saw: boolean): void {
  const mo = p.mo;
  const angle = normAngle(mo.angle + spread());
  let dmg = 2 * ((rnd255() % 10) + 1);
  if (!saw && p.berserk > 0) dmg *= 10;
  const hit = ctx.geo.hitscan(mo, angle, saw ? 65 : 64, shotZ(mo));
  if (hit.kind === 'thing') {
    ctx.damage(hit.thing, null, mo, dmg);
    if (hit.thing.flags & MF.NOBLOOD) spawnPuff(ctx, hit.x, hit.y, hit.z);
    else spawnBlood(ctx, hit.x, hit.y, hit.z);
    ctx.playSound(saw ? 'DSSAWHIT' : 'DSPUNCH', mo);
    mo.angle = pointToAngle(hit.thing.x - mo.x, hit.thing.y - mo.y);
  } else {
    if (saw) ctx.playSound('DSSAWFUL', mo);
    if (hit.kind === 'wall') applyHit(ctx, world, mo, angle, hit, dmg);
  }
}

function fireMissile(ctx: GameCtx, world: WorldSim, mo: Mobj, name: string, speed: number): void {
  const m = ctx.spawn(name, mo.x, mo.y, mo.z + 32, mo.angle);
  if (m) {
    m.target = mo;
    m.angle = mo.angle;
    m.momx = speed * Math.cos(mo.angle);
    m.momy = speed * Math.sin(mo.angle);
    m.momz = 0;
  } else {
    // world doesn't know this missile: degrade to a strong hitscan
    const hit = ctx.geo.hitscan(mo, mo.angle, 2048, shotZ(mo));
    applyHit(ctx, world, mo, mo.angle, hit, 20 * ((rnd255() % 8) + 1));
  }
}

function fire(ctx: GameCtx, world: WorldSim, p: Player, r: WeaponRuntime, w: WeaponDef): void {
  const mo = p.mo;
  if (w.ammo !== AMMO.NONE) {
    if (p.ammo[w.ammo] < w.perShot) return;
    p.ammo[w.ammo] -= w.perShot;
  }
  startFlash(p, r, w);
  ctx.noiseAlert(mo);
  switch (p.readyWeapon) {
    case WEAPON.FIST: melee(ctx, world, p, false); break;
    case WEAPON.CHAINSAW: melee(ctx, world, p, true); break;
    case WEAPON.PISTOL:
      ctx.playSound('DSPISTOL', mo);
      bullet(ctx, world, mo, normAngle(mo.angle + (p.refire > 0 ? spread() : 0)));
      break;
    case WEAPON.SHOTGUN:
      ctx.playSound('DSSHOTGN', mo);
      for (let i = 0; i < 7; i++) bullet(ctx, world, mo, normAngle(mo.angle + spread()));
      break;
    case WEAPON.CHAINGUN:
      ctx.playSound('DSPISTOL', mo);
      bullet(ctx, world, mo, normAngle(mo.angle + (p.refire > 0 ? spread() : 0)));
      break;
    case WEAPON.ROCKET:
      ctx.playSound('DSRLAUNC', mo);
      fireMissile(ctx, world, mo, 'MISL', 20);
      break;
    case WEAPON.PLASMA:
      ctx.playSound('DSPLASMA', mo);
      fireMissile(ctx, world, mo, 'PLSS', 25);
      break;
    case WEAPON.BFG:
      ctx.playSound('DSBFG', mo);
      fireMissile(ctx, world, mo, 'BFS1', 25);
      break;
  }
}

function startAttack(p: Player, r: WeaponRuntime, w: WeaponDef): void {
  r.phase = 'attack';
  r.seq = w.attack;
  r.idx = -1;
  r.tics = 0;
  p.psprites[0].sprite = w.sprite;
}

/** Advance the player's weapon one tic. fireHeld = attack button currently down. */
export function tickWeapon(ctx: GameCtx, world: WorldSim, p: Player, fireHeld: boolean): void {
  const r = rt(p);
  const psp = p.psprites[0];
  const fl = p.psprites[1];
  const w = WEAPONS[p.readyWeapon] ?? WEAPONS[WEAPON.FIST];

  // muzzle flash sequence
  if (r.flashSeq) {
    r.flashTics--;
    if (r.flashTics <= 0) {
      r.flashIdx++;
      if (r.flashIdx >= r.flashSeq.length) {
        r.flashSeq = null;
        fl.sprite = null;
      } else {
        const s = r.flashSeq[r.flashIdx];
        if (p.readyWeapon !== WEAPON.CHAINGUN) fl.frame = s.f;
        r.flashTics = s.t;
      }
    }
  }
  p.extralight = r.flashSeq ? 2 : 0;

  if (p.dead) {
    // drop the weapon out of view
    r.seq = null;
    r.flashSeq = null;
    fl.sprite = null;
    r.phase = 'lower';
    psp.sy = Math.min(128, psp.sy + 6);
    fl.sx = psp.sx; fl.sy = psp.sy;
    return;
  }

  switch (r.phase) {
    case 'lower':
      psp.sy += 6;
      if (psp.sy >= 128) {
        psp.sy = 128;
        if (p.pendingWeapon >= 0 && p.weapons[p.pendingWeapon]) p.readyWeapon = p.pendingWeapon;
        p.pendingWeapon = -1;
        setReadySprite(p);
        r.phase = 'raise';
      }
      break;
    case 'raise':
      psp.sy -= 6;
      if (psp.sy <= 32) {
        psp.sy = 32;
        r.phase = 'ready';
        setReadySprite(p);
      }
      break;
    case 'attack': {
      if (!r.seq) { r.phase = 'ready'; setReadySprite(p); break; }
      if (r.tics > 0) r.tics--;
      let guard = 0;
      while (r.tics <= 0 && r.phase === 'attack' && guard++ < 16) {
        r.idx++;
        if (!r.seq || r.idx >= r.seq.length) {
          r.phase = 'ready';
          r.seq = null;
          setReadySprite(p);
          break;
        }
        const s = r.seq[r.idx];
        psp.frame = s.f;
        psp.fullbright = false;
        r.tics = s.t;
        if (s.a === 'fire') {
          r.fireStep = r.idx;
          fire(ctx, world, p, r, w);
        } else if (s.a === 'flash') {
          startFlash(p, r, w);
        } else if (s.a === 'refire') {
          if (fireHeld && p.pendingWeapon < 0 && !w.noAutoFire && hasAmmoFor(p, p.readyWeapon)) {
            p.refire++;
            startAttack(p, r, w);
            r.tics = 0; // process first step immediately
          } else {
            p.refire = 0;
            if (!checkAmmo(p, r)) break;
            if (s.t === 0) { r.phase = 'ready'; r.seq = null; setReadySprite(p); }
          }
        }
        if (s.t === 0 && r.phase === 'attack' && s.a !== 'refire') continue;
      }
      break;
    }
    case 'ready':
    default: {
      setReadySprite(p);
      if (p.readyWeapon === WEAPON.CHAINSAW) {
        psp.frame = 2 + ((ctx.tic >> 2) & 1);
        if (++r.sawIdle >= 35 * 2) { r.sawIdle = 0; ctx.playSound('DSSAWIDL', p.mo); }
      }
      const a = (TAU * ctx.tic) / 64;
      psp.sx = 1 + p.bob * Math.cos(a);
      psp.sy = 32 + p.bob * Math.abs(Math.sin(a));
      if (p.pendingWeapon >= 0) {
        if (p.pendingWeapon !== p.readyWeapon && p.weapons[p.pendingWeapon]) { r.phase = 'lower'; break; }
        p.pendingWeapon = -1;
      }
      if (fireHeld) {
        if (!p.attackdown || !w.noAutoFire) {
          p.attackdown = true;
          if (checkAmmo(p, r)) {
            startAttack(p, r, w);
            // enter first step now
            r.tics = 0;
            const s = r.seq![++r.idx];
            psp.frame = s.f;
            r.tics = s.t;
            if (s.a === 'fire') { r.fireStep = r.idx; fire(ctx, world, p, r, w); }
            else if (s.a === 'flash') startFlash(p, r, w);
          }
        }
      } else {
        p.attackdown = false;
        p.refire = 0;
      }
      break;
    }
  }
  fl.sx = psp.sx;
  fl.sy = psp.sy;
}
