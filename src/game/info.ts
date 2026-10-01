// Mobj info tables + state table (compact port of DOOM's info.c for the shareware roster, plus fallbacks).
import { MF } from '../types';
import type { MobjInfo } from '../types';

export interface StateDef {
  sprite: string;
  frame: number;
  tics: number;
  action: string | null;
  next: string;
  bright: boolean;
}

export const S_NULL = 'NULL';
export const STATES: Record<string, StateDef> = {};

/**
 * Define a sequence of states named `name`, `name_1`, `name_2`... One state per frame letter.
 * `tics`/`actions` may be a single value applied to every frame or per-frame arrays.
 * The last state's `next` is `next` (use the sequence's own name to loop, S_NULL to remove the mobj).
 */
export function seq(
  name: string, sprite: string, frames: string, tics: number | number[],
  actions: (string | null)[] | string | null, next: string, bright = false,
): string {
  const n = frames.length;
  for (let i = 0; i < n; i++) {
    const sname = i === 0 ? name : `${name}_${i}`;
    const nxt = i === n - 1 ? next : `${name}_${i + 1}`;
    const t = Array.isArray(tics) ? tics[i] : tics;
    const a = Array.isArray(actions) ? (actions[i] ?? null) : actions;
    STATES[sname] = { sprite, frame: frames.charCodeAt(i) - 65, tics: t, action: a, next: nxt, bright };
  }
  return name;
}

// DOOM flag not present in types.ts MF (value from mobjflag_t).
export const MF_INFLOAT = 0x200000;

const INFOS: MobjInfo[] = [];
const byNum = new Map<number, MobjInfo>();
const byName = new Map<string, MobjInfo>();
let internalNum = -1000;

type InfoInit = Partial<MobjInfo> & { name: string; sprite: string };

function def(p: InfoInit): MobjInfo {
  const info: MobjInfo = {
    name: p.name,
    doomednum: p.doomednum ?? internalNum--,
    sprite: p.sprite,
    health: p.health ?? 1000,
    speed: p.speed ?? 0,
    radius: p.radius ?? 20,
    height: p.height ?? 16,
    mass: p.mass ?? 100,
    painChance: p.painChance ?? 0,
    damage: p.damage ?? 0,
    flags: p.flags ?? 0,
    reactionTime: p.reactionTime ?? 8,
    seeSound: p.seeSound ?? null,
    attackSound: p.attackSound ?? null,
    painSound: p.painSound ?? null,
    deathSound: p.deathSound ?? null,
    activeSound: p.activeSound ?? null,
    states: p.states ?? {},
  };
  for (const k of Object.keys(p)) if (!(k in info)) (info as Record<string, unknown>)[k] = (p as Record<string, unknown>)[k];
  INFOS.push(info);
  if (info.doomednum > 0) byNum.set(info.doomednum, info);
  byName.set(info.name.toUpperCase(), info);
  return info;
}

export function infoFor(type: number | string): MobjInfo | null {
  if (typeof type === 'number') return byNum.get(type) ?? null;
  return byName.get(type.toUpperCase()) ?? null;
}
export function allInfos(): readonly MobjInfo[] { return INFOS; }

const SOLID_SHOOT = MF.SOLID | MF.SHOOTABLE;
const MONSTER = SOLID_SHOOT | MF.COUNTKILL;

// ------------------------------------------------------------------ player
def({
  name: 'PLAYER', sprite: 'PLAY', health: 100, radius: 16, height: 56, mass: 100, painChance: 255,
  flags: MF.SOLID | MF.SHOOTABLE | MF.DROPOFF | MF.PICKUP,
  painSound: 'DSPLPAIN', deathSound: ['DSPLDETH'],
  states: {
    spawn: seq('PLAY_STND', 'PLAY', 'A', -1, null, 'PLAY_STND'),
    see: seq('PLAY_RUN', 'PLAY', 'ABCD', 4, null, 'PLAY_RUN'),
    death: seq('PLAY_DIE', 'PLAY', 'HIJKLMN', [10, 10, 10, 10, 10, 10, -1], [null, 'A_Scream', 'A_Fall'], 'PLAY_DIE_6'),
    xdeath: seq('PLAY_XDIE', 'PLAY', 'OPQRSTUVW', [5, 5, 5, 5, 5, 5, 5, 5, -1], [null, 'A_XScream', 'A_Fall'], 'PLAY_XDIE_8'),
  },
});

// ------------------------------------------------------------------ monsters
def({
  name: 'ZOMBIEMAN', doomednum: 3004, sprite: 'POSS', health: 20, speed: 8, radius: 20, height: 56, mass: 100, painChance: 200,
  flags: MONSTER, seeSound: ['DSPOSIT1', 'DSPOSIT2', 'DSPOSIT3'], painSound: 'DSPOPAIN',
  deathSound: ['DSPODTH1', 'DSPODTH2', 'DSPODTH3'], activeSound: 'DSPOSACT', drop: 2007,
  states: {
    spawn: seq('POSS_STND', 'POSS', 'AB', 10, 'A_Look', 'POSS_STND'),
    see: seq('POSS_RUN', 'POSS', 'AABBCCDD', 4, 'A_Chase', 'POSS_RUN'),
    missile: seq('POSS_ATK', 'POSS', 'EFE', [10, 8, 8], ['A_FaceTarget', 'A_PosAttack', null], 'POSS_RUN'),
    pain: seq('POSS_PAIN', 'POSS', 'GG', 3, [null, 'A_Pain'], 'POSS_RUN'),
    death: seq('POSS_DIE', 'POSS', 'HIJKL', [5, 5, 5, 5, -1], [null, 'A_Scream', 'A_Fall'], 'POSS_DIE_4'),
    xdeath: seq('POSS_XDIE', 'POSS', 'MNOPQRSTU', [5, 5, 5, 5, 5, 5, 5, 5, -1], [null, 'A_XScream', 'A_Fall'], 'POSS_XDIE_8'),
  },
});
def({
  name: 'SHOTGUNGUY', doomednum: 9, sprite: 'SPOS', health: 30, speed: 8, radius: 20, height: 56, mass: 100, painChance: 170,
  flags: MONSTER, seeSound: ['DSPOSIT1', 'DSPOSIT2', 'DSPOSIT3'], painSound: 'DSPOPAIN',
  deathSound: ['DSPODTH1', 'DSPODTH2', 'DSPODTH3'], activeSound: 'DSPOSACT', drop: 2001,
  states: {
    spawn: seq('SPOS_STND', 'SPOS', 'AB', 10, 'A_Look', 'SPOS_STND'),
    see: seq('SPOS_RUN', 'SPOS', 'AABBCCDD', 3, 'A_Chase', 'SPOS_RUN'),
    missile: seq('SPOS_ATK', 'SPOS', 'EFE', [10, 10, 10], ['A_FaceTarget', 'A_SPosAttack', null], 'SPOS_RUN'),
    pain: seq('SPOS_PAIN', 'SPOS', 'GG', 3, [null, 'A_Pain'], 'SPOS_RUN'),
    death: seq('SPOS_DIE', 'SPOS', 'HIJKL', [5, 5, 5, 5, -1], [null, 'A_Scream', 'A_Fall'], 'SPOS_DIE_4'),
    xdeath: seq('SPOS_XDIE', 'SPOS', 'MNOPQRSTU', [5, 5, 5, 5, 5, 5, 5, 5, -1], [null, 'A_XScream', 'A_Fall'], 'SPOS_XDIE_8'),
  },
});
def({
  name: 'IMP', doomednum: 3001, sprite: 'TROO', health: 60, speed: 8, radius: 20, height: 56, mass: 100, painChance: 200,
  flags: MONSTER, seeSound: ['DSBGSIT1', 'DSBGSIT2'], painSound: 'DSPOPAIN', deathSound: ['DSBGDTH1', 'DSBGDTH2'],
  activeSound: 'DSBGACT', missileType: 'BAL1',
  states: {
    spawn: seq('TROO_STND', 'TROO', 'AB', 10, 'A_Look', 'TROO_STND'),
    see: seq('TROO_RUN', 'TROO', 'AABBCCDD', 3, 'A_Chase', 'TROO_RUN'),
    melee: seq('TROO_ATK', 'TROO', 'EFG', [8, 8, 6], ['A_FaceTarget', 'A_FaceTarget', 'A_TroopAttack'], 'TROO_RUN'),
    missile: 'TROO_ATK',
    pain: seq('TROO_PAIN', 'TROO', 'HH', 2, [null, 'A_Pain'], 'TROO_RUN'),
    death: seq('TROO_DIE', 'TROO', 'IJKLM', [8, 8, 6, 6, -1], [null, 'A_Scream', null, 'A_Fall'], 'TROO_DIE_4'),
    xdeath: seq('TROO_XDIE', 'TROO', 'NOPQRSTU', [5, 5, 5, 5, 5, 5, 5, -1], [null, 'A_XScream', 'A_Fall'], 'TROO_XDIE_7'),
  },
});
const demonStates = {
  spawn: seq('SARG_STND', 'SARG', 'AB', 10, 'A_Look', 'SARG_STND'),
  see: seq('SARG_RUN', 'SARG', 'AABBCCDD', 2, 'A_Chase', 'SARG_RUN'),
  melee: seq('SARG_ATK', 'SARG', 'EFG', 8, ['A_FaceTarget', 'A_FaceTarget', 'A_SargAttack'], 'SARG_RUN'),
  pain: seq('SARG_PAIN', 'SARG', 'HH', 2, [null, 'A_Pain'], 'SARG_RUN'),
  death: seq('SARG_DIE', 'SARG', 'IJKLMN', [8, 8, 4, 4, 4, -1], [null, 'A_Scream', null, 'A_Fall'], 'SARG_DIE_5'),
};
def({
  name: 'DEMON', doomednum: 3002, sprite: 'SARG', health: 150, speed: 10, radius: 30, height: 56, mass: 400, painChance: 180,
  flags: MONSTER, seeSound: ['DSSGTSIT'], attackSound: 'DSSGTATK', painSound: 'DSDMPAIN', deathSound: ['DSSGTDTH'],
  activeSound: 'DSDMACT', states: demonStates,
});
def({
  name: 'SPECTRE', doomednum: 58, sprite: 'SARG', health: 150, speed: 10, radius: 30, height: 56, mass: 400, painChance: 180,
  flags: MONSTER | MF.SHADOW, seeSound: ['DSSGTSIT'], attackSound: 'DSSGTATK', painSound: 'DSDMPAIN', deathSound: ['DSSGTDTH'],
  activeSound: 'DSDMACT', states: demonStates,
});
def({
  name: 'LOSTSOUL', doomednum: 3006, sprite: 'SKUL', health: 100, speed: 8, radius: 16, height: 56, mass: 50, painChance: 256, damage: 3,
  flags: SOLID_SHOOT | MF.FLOAT | MF.NOGRAVITY, attackSound: 'DSSKLATK', painSound: 'DSDMPAIN', deathSound: ['DSFIRXPL'],
  activeSound: 'DSDMACT',
  states: {
    spawn: seq('SKUL_STND', 'SKUL', 'AB', 10, 'A_Look', 'SKUL_STND', true),
    see: seq('SKUL_RUN', 'SKUL', 'AABB', 6, 'A_Chase', 'SKUL_RUN', true),
    missile: seq('SKUL_ATK', 'SKUL', 'CD', [10, 4], ['A_FaceTarget', 'A_SkullAttack'], 'SKUL_FLY', true),
    pain: seq('SKUL_PAIN', 'SKUL', 'EE', 3, [null, 'A_Pain'], 'SKUL_RUN', true),
    death: seq('SKUL_DIE', 'SKUL', 'FGHIJK', 6, [null, 'A_Scream', null, 'A_Fall'], S_NULL, true),
  },
});
seq('SKUL_FLY', 'SKUL', 'CD', 4, null, 'SKUL_FLY', true);
def({
  name: 'CACODEMON', doomednum: 3005, sprite: 'HEAD', health: 400, speed: 8, radius: 31, height: 56, mass: 400, painChance: 128,
  flags: MONSTER | MF.FLOAT | MF.NOGRAVITY, seeSound: ['DSCACSIT'], painSound: 'DSDMPAIN', deathSound: ['DSCACDTH'],
  activeSound: 'DSDMACT', missileType: 'BAL2',
  states: {
    spawn: seq('HEAD_STND', 'HEAD', 'A', 10, 'A_Look', 'HEAD_STND'),
    see: seq('HEAD_RUN', 'HEAD', 'A', 3, 'A_Chase', 'HEAD_RUN'),
    melee: seq('HEAD_ATK', 'HEAD', 'BCD', 5, ['A_FaceTarget', 'A_FaceTarget', 'A_HeadAttack'], 'HEAD_RUN'),
    missile: 'HEAD_ATK',
    pain: seq('HEAD_PAIN', 'HEAD', 'EEF', [3, 3, 6], [null, 'A_Pain', null], 'HEAD_RUN'),
    death: seq('HEAD_DIE', 'HEAD', 'GHIJKL', [8, 8, 8, 8, 8, -1], [null, 'A_Scream', null, null, 'A_Fall'], 'HEAD_DIE_5'),
  },
});
def({
  name: 'BARON', doomednum: 3003, sprite: 'BOSS', health: 1000, speed: 8, radius: 24, height: 64, mass: 1000, painChance: 50,
  flags: MONSTER, seeSound: ['DSBRSSIT'], painSound: 'DSDMPAIN', deathSound: ['DSBRSDTH'], activeSound: 'DSDMACT',
  missileType: 'BAL7',
  states: {
    spawn: seq('BOSS_STND', 'BOSS', 'AB', 10, 'A_Look', 'BOSS_STND'),
    see: seq('BOSS_RUN', 'BOSS', 'AABBCCDD', 3, 'A_Chase', 'BOSS_RUN'),
    melee: seq('BOSS_ATK', 'BOSS', 'EFG', 8, ['A_FaceTarget', 'A_FaceTarget', 'A_BruisAttack'], 'BOSS_RUN'),
    missile: 'BOSS_ATK',
    pain: seq('BOSS_PAIN', 'BOSS', 'HH', 2, [null, 'A_Pain'], 'BOSS_RUN'),
    death: seq('BOSS_DIE', 'BOSS', 'IJKLMNO', [8, 8, 8, 8, 8, 8, -1], [null, 'A_Scream', null, 'A_Fall', null, null, 'A_BossDeath'], 'BOSS_DIE_6'),
  },
});
def({
  name: 'BARREL', doomednum: 2035, sprite: 'BAR1', health: 20, radius: 10, height: 42, mass: 100,
  flags: SOLID_SHOOT | MF.NOBLOOD, deathSound: ['DSBAREXP'],
  states: {
    spawn: seq('BAR1_STND', 'BAR1', 'AB', 6, null, 'BAR1_STND'),
    death: seq('BAR1_DIE', 'BEXP', 'ABCDE', [5, 5, 5, 10, 10], [null, 'A_Scream', null, 'A_Explode', null], S_NULL, true),
  },
});

// ------------------------------------------------------------------ Doom II monsters (generic fallback behaviour)
interface GenericMon {
  name: string; num: number; sprite: string; health: number; speed: number; radius: number; height: number;
  painChance: number; mass: number; attack: 'hitscan' | 'hitscan3' | 'fireball' | 'rocket' | 'melee' | 'none';
  see: string; pain: string; death: string; active?: string;
  seeFrames?: string; seeTics?: number; atkFrames?: string; atkTics?: number[]; painFrames?: string; painTics?: number;
  deathFrames: string; deathTics?: number; xdeath?: string; flags?: number; missile?: string; melee?: number;
}
function generic(g: GenericMon) {
  const s = g.sprite;
  const atkFrames = g.atkFrames ?? 'EFG';
  const atkTics = g.atkTics ?? atkFrames.split('').map(() => 8);
  const atkActions = atkFrames.split('').map((_, i) => (i === atkFrames.length - 1 ? 'A_GenericAttack' : 'A_FaceTarget'));
  const dTics = g.deathFrames.split('').map((_, i) => (i === g.deathFrames.length - 1 ? -1 : g.deathTics ?? 7));
  const dActions = g.deathFrames.split('').map((_, i) => (i === 1 ? 'A_Scream' : i === 3 ? 'A_Fall' : null));
  if (g.deathFrames.length < 4) dActions[g.deathFrames.length - 1] = 'A_Fall';
  const states: Record<string, string> = {
    spawn: seq(`${s}_STND`, s, 'AB', 10, 'A_Look', `${s}_STND`),
    see: seq(`${s}_RUN`, s, g.seeFrames ?? 'AABBCCDD', g.seeTics ?? 3, 'A_Chase', `${s}_RUN`),
    pain: seq(`${s}_PAIN`, s, g.painFrames ?? 'HH', g.painTics ?? 3, [null, 'A_Pain'], `${s}_RUN`),
    death: seq(`${s}_DIE`, s, g.deathFrames, dTics, dActions, `${s}_DIE_${g.deathFrames.length - 1}`),
  };
  if (g.attack !== 'none') {
    states.missile = seq(`${s}_ATK`, s, atkFrames, atkTics, atkActions, `${s}_RUN`);
    if (g.attack === 'melee' || g.melee) states.melee = states.missile;
    if (g.attack === 'melee') delete states.missile;
  }
  if (g.xdeath) {
    const xt = g.xdeath.split('').map((_, i) => (i === g.xdeath!.length - 1 ? -1 : 5));
    states.xdeath = seq(`${s}_XDIE`, s, g.xdeath, xt, [null, 'A_XScream', 'A_Fall'], `${s}_XDIE_${g.xdeath.length - 1}`);
  }
  def({
    name: g.name, doomednum: g.num, sprite: s, health: g.health, speed: g.speed, radius: g.radius, height: g.height,
    mass: g.mass, painChance: g.painChance, flags: MONSTER | (g.flags ?? 0), seeSound: [g.see], painSound: g.pain,
    deathSound: [g.death], activeSound: g.active ?? 'DSDMACT', attackKind: g.attack, missileType: g.missile ?? 'BAL1',
    meleeDamage: g.melee ?? 0, states, generic: true,
  });
}
generic({ name: 'CHAINGUNNER', num: 65, sprite: 'CPOS', health: 70, speed: 8, radius: 20, height: 56, painChance: 170, mass: 100, attack: 'hitscan', see: 'DSPOSIT2', pain: 'DSPOPAIN', death: 'DSPODTH2', active: 'DSPOSACT', atkFrames: 'EFEFE', atkTics: [10, 4, 4, 4, 4], painFrames: 'GG', deathFrames: 'HIJKLMN', deathTics: 5, xdeath: 'OPQRST' });
generic({ name: 'WOLFSS', num: 84, sprite: 'SSWV', health: 50, speed: 8, radius: 20, height: 56, painChance: 170, mass: 100, attack: 'hitscan', see: 'DSSSSIT', pain: 'DSPOPAIN', death: 'DSSSDTH', active: 'DSPOSACT', atkFrames: 'EFG', atkTics: [10, 10, 4], painFrames: 'HH', deathFrames: 'IJKLMN', deathTics: 5, xdeath: 'OPQRSTUV' });
generic({ name: 'HELLKNIGHT', num: 69, sprite: 'BOS2', health: 500, speed: 8, radius: 24, height: 64, painChance: 50, mass: 1000, attack: 'fireball', missile: 'BAL7', melee: 10, see: 'DSKNTSIT', pain: 'DSDMPAIN', death: 'DSKNTDTH', deathFrames: 'IJKLMNO', deathTics: 8 });
generic({ name: 'REVENANT', num: 66, sprite: 'SKEL', health: 300, speed: 10, radius: 20, height: 56, painChance: 100, mass: 500, attack: 'fireball', missile: 'BAL7', melee: 6, see: 'DSSKESIT', pain: 'DSPOPAIN', death: 'DSSKEDTH', active: 'DSSKEACT', seeFrames: 'AABBCCDDEEFF', seeTics: 2, atkFrames: 'JJK', atkTics: [0, 10, 10], painFrames: 'LL', painTics: 5, deathFrames: 'LMNOPQ' });
generic({ name: 'MANCUBUS', num: 67, sprite: 'FATT', health: 600, speed: 8, radius: 48, height: 64, painChance: 80, mass: 1000, attack: 'fireball', missile: 'BAL7', see: 'DSMANSIT', pain: 'DSMNPAIN', death: 'DSMANDTH', active: 'DSPOSACT', seeFrames: 'AABBCCDDEEFF', seeTics: 4, atkFrames: 'GHIGHI', atkTics: [20, 10, 5, 10, 10, 5], painFrames: 'JJ', deathFrames: 'KLMNOPQRST', deathTics: 6 });
generic({ name: 'ARACHNOTRON', num: 68, sprite: 'BSPI', health: 500, speed: 12, radius: 64, height: 64, painChance: 128, mass: 600, attack: 'fireball', missile: 'BAL2', see: 'DSBSPSIT', pain: 'DSDMPAIN', death: 'DSBSPDTH', active: 'DSBSPACT', seeFrames: 'AABBCCDDEEFF', seeTics: 3, atkFrames: 'AGH', atkTics: [20, 4, 4], painFrames: 'II', deathFrames: 'JKLMNOP', deathTics: 7 });
generic({ name: 'PAINELEMENTAL', num: 71, sprite: 'PAIN', health: 400, speed: 8, radius: 31, height: 56, painChance: 128, mass: 400, attack: 'fireball', missile: 'BAL2', see: 'DSPESIT', pain: 'DSPEPAIN', death: 'DSPEDTH', flags: MF.FLOAT | MF.NOGRAVITY, seeFrames: 'AABBCC', seeTics: 3, atkFrames: 'DEF', atkTics: [5, 5, 5], painFrames: 'GG', painTics: 6, deathFrames: 'HIJKLM', deathTics: 8 });
generic({ name: 'ARCHVILE', num: 64, sprite: 'VILE', health: 700, speed: 15, radius: 20, height: 56, painChance: 10, mass: 500, attack: 'fireball', missile: 'BAL7', see: 'DSVILSIT', pain: 'DSVIPAIN', death: 'DSVILDTH', active: 'DSVILACT', seeFrames: 'AABBCCDDEEFF', seeTics: 2, atkFrames: 'GHIJKL', atkTics: [5, 5, 5, 5, 5, 5], painFrames: 'QQ', painTics: 5, deathFrames: 'QRSTUVWXYZ', deathTics: 7 });
generic({ name: 'SPIDERMASTERMIND', num: 7, sprite: 'SPID', health: 3000, speed: 12, radius: 128, height: 100, painChance: 40, mass: 1000, attack: 'hitscan3', see: 'DSSPISIT', pain: 'DSDMPAIN', death: 'DSSPIDTH', seeFrames: 'AABBCCDDEEFF', seeTics: 3, atkFrames: 'AGHGH', atkTics: [20, 4, 4, 4, 4], painFrames: 'II', deathFrames: 'JKLMNOPQRS', deathTics: 10 });
generic({ name: 'CYBERDEMON', num: 16, sprite: 'CYBR', health: 4000, speed: 16, radius: 40, height: 110, painChance: 20, mass: 1000, attack: 'rocket', missile: 'MISL', see: 'DSCYBSIT', pain: 'DSDMPAIN', death: 'DSCYBDTH', seeFrames: 'AABBCCDD', seeTics: 3, atkFrames: 'EFEFEF', atkTics: [6, 12, 12, 12, 12, 12], painFrames: 'GG', painTics: 10, deathFrames: 'HIJKLMNOP', deathTics: 10 });
generic({ name: 'KEEN', num: 72, sprite: 'KEEN', health: 100, speed: 0, radius: 16, height: 72, painChance: 256, mass: 10000000, attack: 'none', see: 'DSKEENPN', pain: 'DSKEENPN', death: 'DSKEENDT', flags: MF.SPAWNCEILING | MF.NOGRAVITY, seeFrames: 'A', seeTics: -1, painFrames: 'MM', deathFrames: 'ABCDEFGHIJKL', deathTics: 6 });

// ------------------------------------------------------------------ missiles & effects
def({ name: 'BAL1', sprite: 'BAL1', health: 1000, speed: 10, radius: 6, height: 8, damage: 3, flags: MF.NOBLOCKMAP | MF.MISSILE | MF.DROPOFF | MF.NOGRAVITY,
  seeSound: ['DSFIRSHT'], deathSound: ['DSFIRXPL'],
  states: { spawn: seq('BAL1_FLY', 'BAL1', 'AB', 4, null, 'BAL1_FLY', true), death: seq('BAL1_DIE', 'BAL1', 'CDE', 6, null, S_NULL, true) } });
def({ name: 'BAL2', sprite: 'BAL2', health: 1000, speed: 10, radius: 6, height: 8, damage: 5, flags: MF.NOBLOCKMAP | MF.MISSILE | MF.DROPOFF | MF.NOGRAVITY,
  seeSound: ['DSFIRSHT'], deathSound: ['DSFIRXPL'],
  states: { spawn: seq('BAL2_FLY', 'BAL2', 'AB', 4, null, 'BAL2_FLY', true), death: seq('BAL2_DIE', 'BAL2', 'CDE', 6, null, S_NULL, true) } });
def({ name: 'BAL7', sprite: 'BAL7', health: 1000, speed: 15, radius: 6, height: 8, damage: 8, flags: MF.NOBLOCKMAP | MF.MISSILE | MF.DROPOFF | MF.NOGRAVITY,
  seeSound: ['DSFIRSHT'], deathSound: ['DSFIRXPL'],
  states: { spawn: seq('BAL7_FLY', 'BAL7', 'AB', 4, null, 'BAL7_FLY', true), death: seq('BAL7_DIE', 'BAL7', 'CDE', 6, null, S_NULL, true) } });
def({ name: 'MISL', sprite: 'MISL', health: 1000, speed: 20, radius: 11, height: 8, damage: 20, flags: MF.NOBLOCKMAP | MF.MISSILE | MF.DROPOFF | MF.NOGRAVITY,
  seeSound: ['DSRLAUNC'], deathSound: ['DSBAREXP'], explodeRadius: 128,
  states: { spawn: seq('MISL_FLY', 'MISL', 'A', 1, null, 'MISL_FLY', true), death: seq('MISL_DIE', 'MISL', 'BCD', [8, 6, 4], ['A_Explode', null, null], S_NULL, true) } });
def({ name: 'PLSS', sprite: 'PLSS', health: 1000, speed: 25, radius: 13, height: 8, damage: 5, flags: MF.NOBLOCKMAP | MF.MISSILE | MF.DROPOFF | MF.NOGRAVITY,
  seeSound: ['DSPLASMA'], deathSound: ['DSFIRXPL'],
  states: { spawn: seq('PLSS_FLY', 'PLSS', 'AB', 6, null, 'PLSS_FLY', true), death: seq('PLSS_DIE', 'PLSE', 'ABCDE', 4, null, S_NULL, true) } });
def({ name: 'PUFF', sprite: 'PUFF', radius: 20, height: 16, flags: MF.NOBLOCKMAP | MF.NOGRAVITY,
  states: { spawn: seq('PUFF', 'PUFF', 'ABCD', 4, null, S_NULL) } });
STATES['PUFF'].bright = true; STATES['PUFF_1'].bright = true;
def({ name: 'BLUD', sprite: 'BLUD', radius: 20, height: 16, flags: MF.NOBLOCKMAP,
  states: { spawn: seq('BLUD', 'BLUD', 'CBA', 8, null, S_NULL) } });
def({ name: 'TFOG', sprite: 'TFOG', radius: 20, height: 16, flags: MF.NOBLOCKMAP | MF.NOGRAVITY,
  states: { spawn: seq('TFOG', 'TFOG', 'ABABCDEFGHIJ', 6, null, S_NULL, true) } });
def({ name: 'IFOG', sprite: 'IFOG', radius: 20, height: 16, flags: MF.NOBLOCKMAP | MF.NOGRAVITY,
  states: { spawn: seq('IFOG', 'IFOG', 'ABABCDE', 6, null, S_NULL, true) } });
def({ name: 'TELEPORTDEST', doomednum: 14, sprite: 'TFOG', radius: 20, height: 16, flags: MF.NOBLOCKMAP | MF.NOSECTOR,
  states: { spawn: seq('TDEST', 'TFOG', 'A', -1, null, 'TDEST') } });

// ------------------------------------------------------------------ items
interface ItemDef { name: string; num: number; sprite: string; pickup: string; frames?: string; tics?: number; bright?: boolean; count?: boolean; flags?: number }
function item(i: ItemDef) {
  const frames = i.frames ?? 'A';
  const tics = frames.length === 1 ? -1 : i.tics ?? 6;
  def({
    name: i.name, doomednum: i.num, sprite: i.sprite, radius: 20, height: 16,
    flags: MF.SPECIAL | (i.count ? MF.COUNTITEM : 0) | (i.flags ?? 0), pickup: i.pickup,
    states: { spawn: seq(`${i.sprite}_ITEM`, i.sprite, frames, tics, null, `${i.sprite}_ITEM`, i.bright ?? false) },
  });
}
item({ name: 'ARMORBONUS', num: 2015, sprite: 'BON2', pickup: 'armorbonus', frames: 'ABCDCB', count: true });
item({ name: 'HEALTHBONUS', num: 2014, sprite: 'BON1', pickup: 'healthbonus', frames: 'ABCDCB', count: true });
item({ name: 'STIMPACK', num: 2011, sprite: 'STIM', pickup: 'stimpack' });
item({ name: 'MEDIKIT', num: 2012, sprite: 'MEDI', pickup: 'medikit' });
item({ name: 'SOULSPHERE', num: 2013, sprite: 'SOUL', pickup: 'soulsphere', frames: 'ABCDCB', bright: true, count: true });
item({ name: 'MEGASPHERE', num: 83, sprite: 'MEGA', pickup: 'megasphere', frames: 'ABCD', bright: true, count: true });
item({ name: 'GREENARMOR', num: 2018, sprite: 'ARM1', pickup: 'greenarmor', frames: 'AB', tics: 6 });
item({ name: 'BLUEARMOR', num: 2019, sprite: 'ARM2', pickup: 'bluearmor', frames: 'AB', tics: 6 });
item({ name: 'CLIP', num: 2007, sprite: 'CLIP', pickup: 'clip' });
item({ name: 'CLIPBOX', num: 2048, sprite: 'AMMO', pickup: 'clipbox' });
item({ name: 'SHELLS', num: 2008, sprite: 'SHEL', pickup: 'shells' });
item({ name: 'SHELLBOX', num: 2049, sprite: 'SBOX', pickup: 'shellbox' });
item({ name: 'ROCKET', num: 2010, sprite: 'ROCK', pickup: 'rocket' });
item({ name: 'ROCKETBOX', num: 2046, sprite: 'BROK', pickup: 'rocketbox' });
item({ name: 'CELL', num: 2047, sprite: 'CELL', pickup: 'cell' });
item({ name: 'CELLPACK', num: 17, sprite: 'CELP', pickup: 'cellpack' });
item({ name: 'BACKPACK', num: 8, sprite: 'BPAK', pickup: 'backpack' });
item({ name: 'SHOTGUN', num: 2001, sprite: 'SHOT', pickup: 'shotgun' });
item({ name: 'SUPERSHOTGUN', num: 82, sprite: 'SGN2', pickup: 'supershotgun' });
item({ name: 'CHAINGUN', num: 2002, sprite: 'MGUN', pickup: 'chaingun' });
item({ name: 'ROCKETLAUNCHER', num: 2003, sprite: 'LAUN', pickup: 'rocketlauncher' });
item({ name: 'PLASMARIFLE', num: 2004, sprite: 'PLAS', pickup: 'plasma' });
item({ name: 'BFG', num: 2006, sprite: 'BFUG', pickup: 'bfg' });
item({ name: 'CHAINSAW', num: 2005, sprite: 'CSAW', pickup: 'chainsaw' });
item({ name: 'BLUECARD', num: 5, sprite: 'BKEY', pickup: 'bluecard', frames: 'AB', tics: 10, flags: MF.NOTDMATCH });
item({ name: 'YELLOWCARD', num: 6, sprite: 'YKEY', pickup: 'yellowcard', frames: 'AB', tics: 10, flags: MF.NOTDMATCH });
item({ name: 'REDCARD', num: 13, sprite: 'RKEY', pickup: 'redcard', frames: 'AB', tics: 10, flags: MF.NOTDMATCH });
item({ name: 'BLUESKULL', num: 40, sprite: 'BSKU', pickup: 'blueskull', frames: 'AB', tics: 10, flags: MF.NOTDMATCH });
item({ name: 'YELLOWSKULL', num: 39, sprite: 'YSKU', pickup: 'yellowskull', frames: 'AB', tics: 10, flags: MF.NOTDMATCH });
item({ name: 'REDSKULL', num: 38, sprite: 'RSKU', pickup: 'redskull', frames: 'AB', tics: 10, flags: MF.NOTDMATCH });
item({ name: 'BERSERK', num: 2023, sprite: 'PSTR', pickup: 'berserk', bright: true, count: true });
item({ name: 'INVULNERABILITY', num: 2022, sprite: 'PINV', pickup: 'invuln', frames: 'ABCD', bright: true, count: true });
item({ name: 'INVISIBILITY', num: 2024, sprite: 'PINS', pickup: 'invis', frames: 'ABCD', bright: true, count: true });
item({ name: 'RADSUIT', num: 2025, sprite: 'SUIT', pickup: 'radsuit', bright: true });
item({ name: 'COMPUTERMAP', num: 2026, sprite: 'PMAP', pickup: 'map', frames: 'ABCDCB', bright: true, count: true });
item({ name: 'LIGHTAMP', num: 2045, sprite: 'PVIS', pickup: 'lightamp', frames: 'AB', bright: true, count: true });

// ------------------------------------------------------------------ decorations
interface DecoDef { name: string; num: number; sprite: string; frames?: string; frame?: number; tics?: number; bright?: boolean; solid?: boolean; radius?: number; height?: number; ceiling?: boolean; float?: boolean }
function deco(d: DecoDef) {
  let frames = d.frames ?? 'A';
  if (d.frame !== undefined) frames = String.fromCharCode(65 + d.frame);
  const tics = frames.length === 1 ? -1 : d.tics ?? 6;
  const flags = (d.solid ? MF.SOLID : 0) | (d.ceiling ? MF.SPAWNCEILING | MF.NOGRAVITY : 0) | (d.float ? MF.FLOAT | MF.NOGRAVITY : 0);
  const key = `${d.sprite}_${d.num}`;
  def({
    name: d.name, doomednum: d.num, sprite: d.sprite, radius: d.radius ?? 16, height: d.height ?? 16, flags,
    decoration: true,
    states: { spawn: seq(`DECO_${key}`, d.sprite, frames, tics, null, `DECO_${key}`, d.bright ?? false) },
  });
}
deco({ name: 'TECHCOLUMN', num: 48, sprite: 'ELEC', solid: true, height: 128 });
deco({ name: 'TALLGREENCOLUMN', num: 30, sprite: 'COL1', solid: true, height: 48 });
deco({ name: 'SHORTGREENCOLUMN', num: 31, sprite: 'COL2', solid: true, height: 40 });
deco({ name: 'TALLREDCOLUMN', num: 32, sprite: 'COL3', solid: true, height: 48 });
deco({ name: 'SHORTREDCOLUMN', num: 33, sprite: 'COL4', solid: true, height: 40 });
deco({ name: 'CANDLE', num: 34, sprite: 'CAND', bright: true, radius: 20, height: 16 });
deco({ name: 'CANDELABRA', num: 35, sprite: 'CBRA', solid: true, bright: true, height: 60 });
deco({ name: 'SKULLCOLUMN', num: 36, sprite: 'COL5', frames: 'AB', tics: 14, solid: true, height: 40 });
deco({ name: 'REDSKULLCOLUMN', num: 37, sprite: 'COL6', solid: true, height: 40 });
deco({ name: 'EVILEYE', num: 41, sprite: 'CEYE', frames: 'ABCB', tics: 6, bright: true, solid: true, height: 54 });
deco({ name: 'FLOATINGSKULL', num: 42, sprite: 'FSKU', frames: 'ABC', tics: 6, bright: true, solid: true, float: true, height: 26 });
deco({ name: 'TORCHTREE', num: 43, sprite: 'TRE1', solid: true, height: 64 });
deco({ name: 'BLUETORCH', num: 44, sprite: 'TBLU', frames: 'ABCD', tics: 4, bright: true, solid: true, height: 68 });
deco({ name: 'GREENTORCH', num: 45, sprite: 'TGRN', frames: 'ABCD', tics: 4, bright: true, solid: true, height: 68 });
deco({ name: 'REDTORCH', num: 46, sprite: 'TRED', frames: 'ABCD', tics: 4, bright: true, solid: true, height: 68 });
deco({ name: 'STALAGMITE', num: 47, sprite: 'SMIT', solid: true, height: 40 });
deco({ name: 'BIGTREE', num: 54, sprite: 'TRE2', solid: true, radius: 32, height: 108 });
deco({ name: 'SHORTBLUETORCH', num: 55, sprite: 'SMBT', frames: 'ABCD', tics: 4, bright: true, solid: true, height: 37 });
deco({ name: 'SHORTGREENTORCH', num: 56, sprite: 'SMGT', frames: 'ABCD', tics: 4, bright: true, solid: true, height: 37 });
deco({ name: 'SHORTREDTORCH', num: 57, sprite: 'SMRT', frames: 'ABCD', tics: 4, bright: true, solid: true, height: 37 });
deco({ name: 'TECHLAMP', num: 85, sprite: 'TLMP', frames: 'ABCD', tics: 4, bright: true, solid: true, height: 80 });
deco({ name: 'TECHLAMP2', num: 86, sprite: 'TLP2', frames: 'ABCD', tics: 4, bright: true, solid: true, height: 60 });
deco({ name: 'FLOORLAMP', num: 2028, sprite: 'COLU', bright: true, solid: true, height: 48 });
deco({ name: 'BURNINGBARREL', num: 70, sprite: 'FCAN', frames: 'ABC', tics: 4, bright: true, solid: true, height: 42, radius: 10 });
deco({ name: 'IMPALEDHUMAN', num: 25, sprite: 'POL1', solid: true });
deco({ name: 'TWITCHINGIMPALED', num: 26, sprite: 'POL6', frames: 'AB', tics: 6, solid: true });
deco({ name: 'SKULLONPOLE', num: 27, sprite: 'POL4', solid: true });
deco({ name: 'FIVESKULLS', num: 28, sprite: 'POL2', solid: true });
deco({ name: 'SKULLPILE', num: 29, sprite: 'POL3', frames: 'AB', tics: 6, bright: true, solid: true });
deco({ name: 'BLOODPOOL', num: 24, sprite: 'POL5' });
deco({ name: 'HANGINGBLOODY', num: 49, sprite: 'GOR1', frames: 'ABCB', tics: 10, solid: true, ceiling: true, height: 68 });
deco({ name: 'HANGINGARMSOUT', num: 50, sprite: 'GOR2', solid: true, ceiling: true, height: 84 });
deco({ name: 'HANGINGONELEG', num: 51, sprite: 'GOR3', solid: true, ceiling: true, height: 84 });
deco({ name: 'HANGINGTORSO', num: 52, sprite: 'GOR4', solid: true, ceiling: true, height: 68 });
deco({ name: 'HANGINGLEG', num: 53, sprite: 'GOR5', solid: true, ceiling: true, height: 52 });
deco({ name: 'HANGINGARMSOUT2', num: 59, sprite: 'GOR2', ceiling: true, height: 84 });
deco({ name: 'HANGINGLEG2', num: 60, sprite: 'GOR4', ceiling: true, height: 68 });
deco({ name: 'HANGINGONELEG2', num: 61, sprite: 'GOR3', ceiling: true, height: 52 });
deco({ name: 'HANGINGTORSO2', num: 62, sprite: 'GOR5', ceiling: true, height: 52 });
deco({ name: 'HANGINGBLOODY2', num: 63, sprite: 'GOR1', frames: 'ABCB', ceiling: true, height: 68 });
deco({ name: 'HANGNOGUTS', num: 73, sprite: 'HDB1', solid: true, ceiling: true, height: 88 });
deco({ name: 'HANGBNOBRAIN', num: 74, sprite: 'HDB2', solid: true, ceiling: true, height: 88 });
deco({ name: 'HANGTLOOKDN', num: 75, sprite: 'HDB3', solid: true, ceiling: true, height: 64 });
deco({ name: 'HANGTSKULL', num: 76, sprite: 'HDB4', solid: true, ceiling: true, height: 64 });
deco({ name: 'HANGTLOOKUP', num: 77, sprite: 'HDB5', solid: true, ceiling: true, height: 64 });
deco({ name: 'HANGTNOBRAIN', num: 78, sprite: 'HDB6', solid: true, ceiling: true, height: 64 });
deco({ name: 'COLONGIBS', num: 79, sprite: 'POB1' });
deco({ name: 'SMALLPOOL', num: 80, sprite: 'POB2' });
deco({ name: 'BRAINSTEM', num: 81, sprite: 'BRS1' });
deco({ name: 'DEADPLAYER', num: 15, sprite: 'PLAY', frame: 13 });
deco({ name: 'GIBS', num: 10, sprite: 'PLAY', frame: 22 });
deco({ name: 'GIBS2', num: 12, sprite: 'PLAY', frame: 22 });
deco({ name: 'DEADZOMBIE', num: 18, sprite: 'POSS', frame: 11 });
deco({ name: 'DEADSHOTGUNGUY', num: 19, sprite: 'SPOS', frame: 11 });
deco({ name: 'DEADIMP', num: 20, sprite: 'TROO', frame: 12 });
deco({ name: 'DEADDEMON', num: 21, sprite: 'SARG', frame: 13 });
deco({ name: 'DEADCACO', num: 22, sprite: 'HEAD', frame: 11 });
deco({ name: 'DEADLOSTSOUL', num: 23, sprite: 'SKUL', frame: 10 });

STATES[S_NULL] = { sprite: 'PUFF', frame: 0, tics: -1, action: null, next: S_NULL, bright: false };
