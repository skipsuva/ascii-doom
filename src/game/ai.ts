// Monster AI: port of the essential parts of p_enemy.c.
import { MF, ML } from '../types';
import type { GameCtx, Line, Mobj, Sector } from '../types';
import { ANG45, TAU, angleDiff, approxDist, clamp, normAngle, pointToAngle, rnd255, rndSigned } from '../math';
import { MF_INFLOAT } from './info';
import {
  type ActionFn, BASETHRESHOLD, MELEERANGE, MISSILERANGE, damageMobj, inState, lineAttack, playAt,
  radiusAttack, registerActions, removeMobj, setState, spawnMissile, spawnMobj,
} from './mobj';
import { useSpecialLine, bossDeath } from './specials';

const DI_NODIR = 8;
const XSPEED = [1, 0.7071, 0, -0.7071, -1, -0.7071, 0, 0.7071];
const YSPEED = [0, 0.7071, 1, 0.7071, 0, -0.7071, -1, -0.7071];
const OPPOSITE = [4, 5, 6, 7, 0, 1, 2, 3, DI_NODIR];
const DIAGS = [3, 1, 5, 7]; // NW, NE, SW, SE indexed by ((dy<0)<<1) + (dx>0)
const FLOATSPEED = 4;
const SKULLSPEED = 20;

// ------------------------------------------------------------------ sound alert (P_NoiseAlert)
let soundValid = 1;
const soundTraversed = new Map<Sector, number>();

export function noiseAlert(ctx: GameCtx, emitter: Mobj): void {
  const start = emitter.sector ?? ctx.level.pointInSector(emitter.x, emitter.y);
  soundValid++;
  soundTraversed.clear();
  recursiveSound(start, 0, emitter);
}

function recursiveSound(sec: Sector, soundblocks: number, emitter: Mobj): void {
  if (sec.validcount === soundValid && (soundTraversed.get(sec) ?? 0) <= soundblocks + 1) return;
  sec.validcount = soundValid;
  soundTraversed.set(sec, soundblocks + 1);
  sec.soundTarget = emitter;
  for (const line of sec.lines) {
    if (!(line.flags & ML.TWOSIDED) || !line.backSector) continue;
    const other = line.frontSector === sec ? line.backSector : line.frontSector;
    if (Math.min(line.frontSector.ceilH, line.backSector.ceilH) - Math.max(line.frontSector.floorH, line.backSector.floorH) <= 0) continue;
    if (line.flags & ML.SOUNDBLOCK) {
      if (!soundblocks) recursiveSound(other, 1, emitter);
    } else {
      recursiveSound(other, soundblocks, emitter);
    }
  }
}

// ------------------------------------------------------------------ range checks
export function checkMeleeRange(ctx: GameCtx, m: Mobj): boolean {
  const t = m.target;
  if (!t) return false;
  const dist = approxDist(t.x - m.x, t.y - m.y);
  if (dist >= MELEERANGE - 20 + t.radius) return false;
  return ctx.geo.checkSight(m, t);
}

export function checkMissileRange(ctx: GameCtx, m: Mobj): boolean {
  const t = m.target;
  if (!t) return false;
  if (!ctx.geo.checkSight(m, t)) return false;
  if (m.flags & MF.JUSTHIT) { m.flags &= ~MF.JUSTHIT; return true; }
  if (m.reactiontime) return false;
  let dist = approxDist(m.x - t.x, m.y - t.y) - 64;
  if (!m.info.states.melee) dist -= 128;
  if (m.info.name === 'ARCHVILE' && dist > 14 * 64) return false;
  if (m.info.name === 'LOSTSOUL') dist /= 2;
  if (dist > 200) dist = 200;
  if (m.info.name === 'CYBERDEMON' && dist > 160) dist = 160;
  return rnd255() >= dist;
}

// ------------------------------------------------------------------ movement
function pMove(ctx: GameCtx, m: Mobj): boolean {
  if (m.movedir === DI_NODIR) return false;
  const tryx = m.x + m.info.speed * XSPEED[m.movedir];
  const tryy = m.y + m.info.speed * YSPEED[m.movedir];
  const res = ctx.geo.checkPosition(m, tryx, tryy);
  if (!res.ok || !ctx.geo.tryMove(m, tryx, tryy)) {
    // float up/down to reach the target height
    if ((m.flags & MF.FLOAT) && !res.blockingThing && res.ceilingz - res.floorz >= m.height) {
      if (m.z < res.floorz) m.z += FLOATSPEED; else m.z -= FLOATSPEED;
      m.flags |= MF_INFLOAT;
      return true;
    }
    // try opening a door we bumped into
    const candidates: Line[] = [];
    if (res.blockingLine) candidates.push(res.blockingLine);
    for (const l of res.specLines) if (!candidates.includes(l)) candidates.push(l);
    let good = false;
    for (const l of candidates) {
      if (l.special && useSpecialLine(ctx, l, 0, m)) good = true;
    }
    if (good) m.movedir = DI_NODIR;
    return good;
  }
  m.flags &= ~MF_INFLOAT;
  if (!(m.flags & MF.FLOAT)) m.z = m.floorz;
  return true;
}

function tryWalk(ctx: GameCtx, m: Mobj): boolean {
  if (!pMove(ctx, m)) return false;
  m.movecount = rnd255() & 15;
  return true;
}

function newChaseDir(ctx: GameCtx, m: Mobj): void {
  const t = m.target;
  if (!t) return;
  const olddir = m.movedir;
  const turnaround = OPPOSITE[olddir];
  const deltax = t.x - m.x, deltay = t.y - m.y;
  let d1 = deltax > 10 ? 0 : deltax < -10 ? 4 : DI_NODIR;
  let d2 = deltay < -10 ? 6 : deltay > 10 ? 2 : DI_NODIR;
  if (d1 !== DI_NODIR && d2 !== DI_NODIR) {
    m.movedir = DIAGS[((deltay < 0 ? 1 : 0) << 1) + (deltax > 0 ? 1 : 0)];
    if (m.movedir !== turnaround && tryWalk(ctx, m)) return;
  }
  if (rnd255() > 200 || Math.abs(deltay) > Math.abs(deltax)) { const tmp = d1; d1 = d2; d2 = tmp; }
  if (d1 === turnaround) d1 = DI_NODIR;
  if (d2 === turnaround) d2 = DI_NODIR;
  if (d1 !== DI_NODIR) { m.movedir = d1; if (tryWalk(ctx, m)) return; }
  if (d2 !== DI_NODIR) { m.movedir = d2; if (tryWalk(ctx, m)) return; }
  if (olddir !== DI_NODIR) { m.movedir = olddir; if (tryWalk(ctx, m)) return; }
  if (rnd255() & 1) {
    for (let tdir = 0; tdir <= 7; tdir++) {
      if (tdir !== turnaround) { m.movedir = tdir; if (tryWalk(ctx, m)) return; }
    }
  } else {
    for (let tdir = 7; tdir >= 0; tdir--) {
      if (tdir !== turnaround) { m.movedir = tdir; if (tryWalk(ctx, m)) return; }
    }
  }
  if (turnaround !== DI_NODIR) { m.movedir = turnaround; if (tryWalk(ctx, m)) return; }
  m.movedir = DI_NODIR;
}

function lookForPlayers(ctx: GameCtx, m: Mobj, allaround: boolean): boolean {
  const p = ctx.player;
  if (!p || !p.mo || p.health <= 0 || p.mo.removed) return false;
  if (!ctx.geo.checkSight(m, p.mo)) return false;
  if (!allaround) {
    const an = angleDiff(pointToAngle(p.mo.x - m.x, p.mo.y - m.y), m.angle);
    if (Math.abs(an) > Math.PI / 2) {
      const dist = approxDist(p.mo.x - m.x, p.mo.y - m.y);
      if (dist > MELEERANGE) return false;
    }
  }
  m.target = p.mo;
  return true;
}

// ------------------------------------------------------------------ actions
function seeYou(ctx: GameCtx, m: Mobj): void {
  const full = m.info.name === 'SPIDERMASTERMIND' || m.info.name === 'CYBERDEMON';
  playAt(ctx, m.info.seeSound, m, full);
  setState(ctx, m, m.info.states.see);
}

const A_Look: ActionFn = (ctx, m) => {
  m.threshold = 0;
  const targ = m.sector?.soundTarget;
  let seen = false;
  if (targ && (targ.flags & MF.SHOOTABLE) && !targ.removed && targ.health > 0) {
    m.target = targ;
    if (m.flags & MF.AMBUSH) {
      if (ctx.geo.checkSight(m, targ)) seen = true;
    } else seen = true;
  }
  if (!seen && !lookForPlayers(ctx, m, false)) return;
  seeYou(ctx, m);
};

const A_Chase: ActionFn = (ctx, m) => {
  if (m.reactiontime) m.reactiontime--;
  if (m.threshold) {
    if (!m.target || m.target.health <= 0) m.threshold = 0; else m.threshold--;
  }
  if (m.movedir < 8) {
    const want = m.movedir * ANG45;
    m.angle = normAngle(m.angle + clamp(angleDiff(want, m.angle), -ANG45, ANG45));
  }
  if (!m.target || !(m.target.flags & MF.SHOOTABLE) || m.target.removed) {
    if (lookForPlayers(ctx, m, true)) return;
    setState(ctx, m, m.info.states.spawn);
    return;
  }
  if (m.flags & MF.JUSTATTACKED) {
    m.flags &= ~MF.JUSTATTACKED;
    newChaseDir(ctx, m);
    return;
  }
  if (m.info.states.melee && checkMeleeRange(ctx, m)) {
    playAt(ctx, m.info.attackSound, m);
    setState(ctx, m, m.info.states.melee);
    return;
  }
  if (m.info.states.missile && m.movecount === 0 && checkMissileRange(ctx, m)) {
    setState(ctx, m, m.info.states.missile);
    m.flags |= MF.JUSTATTACKED;
    return;
  }
  if (--m.movecount < 0 || !pMove(ctx, m)) newChaseDir(ctx, m);
  if (m.info.activeSound && rnd255() < 3) playAt(ctx, m.info.activeSound, m);
};

const A_FaceTarget: ActionFn = (_ctx, m) => {
  if (!m.target) return;
  m.flags &= ~MF.AMBUSH;
  m.angle = pointToAngle(m.target.x - m.x, m.target.y - m.y);
  if (m.target.flags & MF.SHADOW) m.angle = normAngle(m.angle + rndSigned() * (TAU / 2048));
};

function bulletSpread(): number { return rndSigned() * (TAU / 4096); }

const A_PosAttack: ActionFn = (ctx, m) => {
  if (!m.target) return;
  A_FaceTarget(ctx, m);
  playAt(ctx, 'DSPISTOL', m);
  const damage = ((rnd255() % 5) + 1) * 3;
  lineAttack(ctx, m, m.angle + bulletSpread(), MISSILERANGE, damage);
};

const A_SPosAttack: ActionFn = (ctx, m) => {
  if (!m.target) return;
  playAt(ctx, 'DSSHOTGN', m);
  A_FaceTarget(ctx, m);
  for (let i = 0; i < 3; i++) {
    const damage = ((rnd255() % 5) + 1) * 3;
    lineAttack(ctx, m, m.angle + bulletSpread(), MISSILERANGE, damage);
  }
};

const A_CPosAttack: ActionFn = (ctx, m) => {
  if (!m.target) return;
  playAt(ctx, 'DSSHOTGN', m);
  A_FaceTarget(ctx, m);
  const damage = ((rnd255() % 5) + 1) * 3;
  lineAttack(ctx, m, m.angle + bulletSpread(), MISSILERANGE, damage);
};

function meleeOrMissile(ctx: GameCtx, m: Mobj, meleeDamage: () => number, meleeSound: string | null, missile: string): void {
  if (!m.target) return;
  A_FaceTarget(ctx, m);
  if (checkMeleeRange(ctx, m)) {
    if (meleeSound) playAt(ctx, meleeSound, m);
    damageMobj(ctx, m.target, m, m, meleeDamage());
    return;
  }
  spawnMissile(ctx, m, m.target, missile);
}

const A_TroopAttack: ActionFn = (ctx, m) => meleeOrMissile(ctx, m, () => ((rnd255() % 8) + 1) * 3, 'DSCLAW', 'BAL1');
const A_SargAttack: ActionFn = (ctx, m) => {
  if (!m.target) return;
  A_FaceTarget(ctx, m);
  if (checkMeleeRange(ctx, m)) damageMobj(ctx, m.target, m, m, ((rnd255() % 10) + 1) * 4);
};
const A_HeadAttack: ActionFn = (ctx, m) => meleeOrMissile(ctx, m, () => ((rnd255() % 6) + 1) * 10, null, 'BAL2');
const A_BruisAttack: ActionFn = (ctx, m) => meleeOrMissile(ctx, m, () => ((rnd255() % 8) + 1) * 10, 'DSCLAW', 'BAL7');

const A_SkullAttack: ActionFn = (ctx, m) => {
  if (!m.target) return;
  const dest = m.target;
  m.flags |= MF.SKULLFLY;
  playAt(ctx, m.info.attackSound, m);
  A_FaceTarget(ctx, m);
  m.momx = SKULLSPEED * Math.cos(m.angle);
  m.momy = SKULLSPEED * Math.sin(m.angle);
  let dist = approxDist(dest.x - m.x, dest.y - m.y) / SKULLSPEED;
  if (dist < 1) dist = 1;
  m.momz = (dest.z + dest.height / 2 - m.z) / dist;
};

/** Fallback attack for Doom II monsters: hitscan or fireball based on info.attackKind. */
const A_GenericAttack: ActionFn = (ctx, m) => {
  if (!m.target) return;
  const kind = m.info.attackKind as string;
  const missile = (m.info.missileType as string) ?? 'BAL1';
  const melee = (m.info.meleeDamage as number) ?? 0;
  if (kind === 'hitscan' || kind === 'hitscan3') {
    playAt(ctx, 'DSSHOTGN', m);
    A_FaceTarget(ctx, m);
    const n = kind === 'hitscan3' ? 3 : 1;
    for (let i = 0; i < n; i++) lineAttack(ctx, m, m.angle + bulletSpread(), MISSILERANGE, ((rnd255() % 5) + 1) * 3);
    return;
  }
  if (kind === 'melee') {
    A_FaceTarget(ctx, m);
    if (checkMeleeRange(ctx, m)) damageMobj(ctx, m.target, m, m, ((rnd255() % 8) + 1) * (melee || 3));
    return;
  }
  if (melee) meleeOrMissile(ctx, m, () => ((rnd255() % 8) + 1) * melee, 'DSCLAW', missile);
  else { A_FaceTarget(ctx, m); spawnMissile(ctx, m, m.target, missile); }
};

const A_Scream: ActionFn = (ctx, m) => {
  const full = m.info.name === 'SPIDERMASTERMIND' || m.info.name === 'CYBERDEMON';
  playAt(ctx, m.info.deathSound, m, full);
};
const A_XScream: ActionFn = (ctx, m) => playAt(ctx, 'DSSLOP', m);
const A_Pain: ActionFn = (ctx, m) => playAt(ctx, m.info.painSound, m);
const A_Fall: ActionFn = (_ctx, m) => { m.flags &= ~MF.SOLID; };
const A_Explode: ActionFn = (ctx, m) => radiusAttack(ctx, m, m.target, 128);
const A_BossDeath: ActionFn = (ctx, m) => bossDeath(ctx, m);

registerActions({
  A_Look, A_Chase, A_FaceTarget, A_PosAttack, A_SPosAttack, A_CPosAttack, A_TroopAttack, A_SargAttack, A_HeadAttack,
  A_BruisAttack, A_SkullAttack, A_GenericAttack, A_Scream, A_XScream, A_Pain, A_Fall, A_Explode, A_BossDeath,
});

export const aiActions = { A_Look, A_Chase, A_FaceTarget, newChaseDir, lookForPlayers, pMove };
export { BASETHRESHOLD, inState, removeMobj, spawnMobj };
