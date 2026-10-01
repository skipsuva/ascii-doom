// Linedef/sector specials: doors, plats, floors, ceilings, stairs, lights, teleports, exits, switches, animations.
import { MF, ML } from '../types';
import type { GameCtx, Line, Mobj, Sector, Side, ThingSpawn } from '../types';
import { deg2rad, rnd255 } from '../math';
import { ONFLOORZ, damageMobj, removeMobj, setState, spawnMobj } from './mobj';

export interface Thinker { tick(ctx: GameCtx): boolean } // return false to remove

interface Button { side: Side; key: 'top' | 'mid' | 'bottom'; texture: string; timer: number; org: { x: number; y: number } }
interface TeleDest extends ThingSpawn { sector: Sector }

class SpecialsState {
  thinkers = new Set<Thinker>();
  buttons: Button[] = [];
  animIndex = 0;
  teleDests: TeleDest[] = [];
  centroids = new Map<Sector, { x: number; y: number }>();
}
let S = new SpecialsState();

export function addThinker(t: Thinker): void { S.thinkers.add(t); }

// ------------------------------------------------------------------ sector helpers
export function sectorCenter(sec: Sector): { x: number; y: number } {
  let c = S.centroids.get(sec);
  if (c) return c;
  let sx = 0, sy = 0, n = 0;
  for (const l of sec.lines) { sx += l.v1.x + l.v2.x; sy += l.v1.y + l.v2.y; n += 2; }
  c = n ? { x: sx / n, y: sy / n } : { x: 0, y: 0 };
  S.centroids.set(sec, c);
  return c;
}
function lineCenter(line: Line): { x: number; y: number } {
  return { x: (line.v1.x + line.v2.x) / 2, y: (line.v1.y + line.v2.y) / 2 };
}
function neighbors(sec: Sector): Sector[] {
  if (sec.neighbors && sec.neighbors.length) return sec.neighbors;
  const out: Sector[] = [];
  for (const l of sec.lines) {
    if (!l.backSector) continue;
    const o = l.frontSector === sec ? l.backSector : l.frontSector;
    if (o !== sec && !out.includes(o)) out.push(o);
  }
  return out;
}
function lowestFloorSurrounding(sec: Sector): number {
  let h = sec.floorH;
  for (const n of neighbors(sec)) if (n.floorH < h) h = n.floorH;
  return h;
}
function highestFloorSurrounding(sec: Sector): number {
  let h = -500;
  for (const n of neighbors(sec)) if (n.floorH > h) h = n.floorH;
  return h;
}
function nextHighestFloor(sec: Sector, current: number): number {
  let min = Infinity;
  for (const n of neighbors(sec)) if (n.floorH > current && n.floorH < min) min = n.floorH;
  return min === Infinity ? current : min;
}
function lowestCeilingSurrounding(sec: Sector): number {
  let h = Infinity;
  for (const n of neighbors(sec)) if (n.ceilH < h) h = n.ceilH;
  return h === Infinity ? sec.ceilH : h;
}
function highestCeilingSurrounding(sec: Sector): number {
  let h = 0;
  for (const n of neighbors(sec)) if (n.ceilH > h) h = n.ceilH;
  return h;
}
function minLightSurrounding(sec: Sector, max: number): number {
  let min = max;
  for (const n of neighbors(sec)) if (n.light < min) min = n.light;
  return min;
}
function sectorsWithTag(ctx: GameCtx, tag: number): Sector[] {
  return ctx.level.sectors.filter(s => s.tag === tag);
}
function sound(ctx: GameCtx, name: string, sec: Sector): void {
  ctx.playSound(name, sectorCenter(sec));
}

// ------------------------------------------------------------------ plane movement (T_MovePlane)
const OK = 0, CRUSHED = 1, PASTDEST = 2;
type PlaneRes = 0 | 1 | 2;

function thingHeightClip(ctx: GameCtx, m: Mobj): boolean {
  const onfloor = m.z <= m.floorz + 0.001;
  ctx.geo.updateFloorCeiling(m);
  if (onfloor) m.z = m.floorz;
  else if (m.z + m.height > m.ceilingz) m.z = m.ceilingz - m.height;
  if (m.player) m.player.viewz = m.z + m.player.viewheight;
  return m.ceilingz - m.floorz >= m.height;
}

/** P_ChangeSector: returns true if something doesn't fit (crushed). */
function changeSector(ctx: GameCtx, sec: Sector, crush: boolean): boolean {
  let nofit = false;
  for (const m of Array.from(sec.things)) {
    if (m.removed) continue;
    if (thingHeightClip(ctx, m)) continue;
    if (m.health <= 0 && !m.player) {
      // crunch bodies to giblets
      setState(ctx, m, 'DECO_POL5_24');
      m.flags &= ~MF.SOLID;
      m.height = 0; m.radius = 0;
      continue;
    }
    if (m.flags & MF.DROPPED) { removeMobj(ctx, m); continue; }
    if (!(m.flags & MF.SHOOTABLE)) continue;
    nofit = true;
    if (crush && !(ctx.tic & 3)) {
      damageMobj(ctx, m, null, null, 10);
      const b = spawnMobj(ctx, 'BLUD', m.x, m.y, m.z + m.height / 2, 0);
      if (b) { b.momx = (rnd255() - 128) / 16; b.momy = (rnd255() - 128) / 16; }
    }
  }
  return nofit;
}

function movePlane(ctx: GameCtx, sec: Sector, speed: number, dest: number, crush: boolean, plane: 'floor' | 'ceiling', dir: -1 | 1): PlaneRes {
  const get = () => (plane === 'floor' ? sec.floorH : sec.ceilH);
  const set = (v: number) => { if (plane === 'floor') sec.floorH = v; else sec.ceilH = v; };
  const last = get();
  if (dir === -1) {
    if (last - speed < dest) {
      set(dest);
      if (changeSector(ctx, sec, crush)) { set(last); changeSector(ctx, sec, crush); }
      return PASTDEST;
    }
    set(last - speed);
    if (changeSector(ctx, sec, crush)) {
      if (plane === 'ceiling' && crush) return CRUSHED;
      set(last); changeSector(ctx, sec, crush);
      return CRUSHED;
    }
    return OK;
  }
  if (last + speed > dest) {
    set(dest);
    if (changeSector(ctx, sec, crush)) { set(last); changeSector(ctx, sec, crush); }
    return PASTDEST;
  }
  set(last + speed);
  if (changeSector(ctx, sec, crush)) {
    if (plane === 'floor' && crush) return CRUSHED;
    if (plane === 'floor') { set(last); changeSector(ctx, sec, crush); return CRUSHED; }
  }
  return OK;
}

// ------------------------------------------------------------------ doors
type DoorType = 'normal' | 'close30ThenOpen' | 'close' | 'open' | 'raiseIn5Mins' | 'blazeRaise' | 'blazeOpen' | 'blazeClose';
interface Door extends Thinker { kind: 'door'; sector: Sector; type: DoorType; topheight: number; speed: number; direction: -1 | 0 | 1 | 2; topwait: number; topcountdown: number }

const VDOORSPEED = 2, VDOORWAIT = 150;

function makeDoor(ctx: GameCtx, sec: Sector, type: DoorType): Door {
  const blaze = type.startsWith('blaze');
  const door: Door = {
    kind: 'door', sector: sec, type, topheight: sec.ceilH, speed: blaze ? VDOORSPEED * 4 : VDOORSPEED,
    direction: 1, topwait: VDOORWAIT, topcountdown: 0,
    tick(c) { return tickDoor(c, this); },
  };
  sec.specialData = door;
  addThinker(door);
  return door;
}

function tickDoor(ctx: GameCtx, d: Door): boolean {
  const sec = d.sector;
  const done = () => { sec.specialData = null; return false; };
  switch (d.direction) {
    case 0: // waiting at top
      if (--d.topcountdown <= 0) {
        if (d.type === 'blazeRaise') { d.direction = -1; sound(ctx, 'DSBDCLS', sec); }
        else if (d.type === 'normal') { d.direction = -1; sound(ctx, 'DSDORCLS', sec); }
        else if (d.type === 'close30ThenOpen') { d.direction = 1; sound(ctx, 'DSDOROPN', sec); }
      }
      return true;
    case 2: // initial wait
      if (--d.topcountdown <= 0 && d.type === 'raiseIn5Mins') { d.direction = 1; d.type = 'normal'; sound(ctx, 'DSDOROPN', sec); }
      return true;
    case -1: { // down
      const res = movePlane(ctx, sec, d.speed, sec.floorH, false, 'ceiling', -1);
      if (res === PASTDEST) {
        if (d.type === 'close30ThenOpen') { d.direction = 0; d.topcountdown = 35 * 30; return true; }
        return done();
      }
      if (res === CRUSHED) {
        if (d.type !== 'blazeClose' && d.type !== 'close') { d.direction = 1; sound(ctx, 'DSDOROPN', sec); }
      }
      return true;
    }
    case 1: { // up
      const res = movePlane(ctx, sec, d.speed, d.topheight, false, 'ceiling', 1);
      if (res === PASTDEST) {
        if (d.type === 'blazeRaise' || d.type === 'normal') { d.direction = 0; d.topcountdown = d.topwait; return true; }
        return done();
      }
      return true;
    }
  }
  return true;
}

const KEY_MSG_DOOR = { blue: 'You need a blue key to open this door', yellow: 'You need a yellow key to open this door', red: 'You need a red key to open this door' };
const KEY_MSG_OBJ = { blue: 'You need a blue key to activate this object', yellow: 'You need a yellow key to activate this object', red: 'You need a red key to activate this object' };

function keyFor(special: number): 'blue' | 'yellow' | 'red' | null {
  switch (special) {
    case 26: case 32: case 99: case 133: return 'blue';
    case 27: case 34: case 136: case 137: return 'yellow';
    case 28: case 33: case 134: case 135: return 'red';
  }
  return null;
}

function hasKey(ctx: GameCtx, user: Mobj, special: number, door: boolean): boolean {
  const k = keyFor(special);
  if (!k) return true;
  const p = user.player;
  if (!p) return false;
  if (p.keys[k]) return true;
  ctx.message((door ? KEY_MSG_DOOR : KEY_MSG_OBJ)[k]);
  ctx.playSound('DSOOF', null);
  return false;
}

/** EV_VerticalDoor: manual (DR/D1) doors. */
function verticalDoor(ctx: GameCtx, line: Line, user: Mobj): boolean {
  if (!hasKey(ctx, user, line.special, true)) return false;
  const sec = line.backSector;
  if (!sec) return false;
  const active = sec.specialData as (Door | { kind?: string }) | null;
  if (active) {
    if ((active as Door).kind !== 'door') return false;
    const door = active as Door;
    if (line.special === 1 || line.special === 26 || line.special === 27 || line.special === 28 || line.special === 117) {
      if (door.direction === -1) door.direction = 1; // go back up
      else {
        if (!user.player) return false; // monsters never close doors
        door.direction = -1;
      }
    }
    return true;
  }
  let type: DoorType = 'normal';
  switch (line.special) {
    case 1: case 26: case 27: case 28: type = 'normal'; break;
    case 31: case 32: case 33: case 34: type = 'open'; line.special = 0; break;
    case 117: type = 'blazeRaise'; break;
    case 118: type = 'blazeOpen'; line.special = 0; break;
  }
  sound(ctx, type.startsWith('blaze') ? 'DSBDOPN' : 'DSDOROPN', sec);
  const door = makeDoor(ctx, sec, type);
  door.topheight = lowestCeilingSurrounding(sec) - 4;
  return true;
}

/** EV_DoDoor: tagged doors. */
function doDoor(ctx: GameCtx, line: Line, type: DoorType): boolean {
  let rtn = false;
  for (const sec of sectorsWithTag(ctx, line.tag)) {
    if (sec.specialData) continue;
    rtn = true;
    const door = makeDoor(ctx, sec, type);
    switch (type) {
      case 'blazeClose':
        door.topheight = lowestCeilingSurrounding(sec) - 4; door.direction = -1; sound(ctx, 'DSBDCLS', sec); break;
      case 'close':
        door.topheight = lowestCeilingSurrounding(sec) - 4; door.direction = -1; sound(ctx, 'DSDORCLS', sec); break;
      case 'close30ThenOpen':
        door.topheight = sec.ceilH; door.direction = -1; sound(ctx, 'DSDORCLS', sec); break;
      case 'blazeRaise': case 'blazeOpen':
        door.direction = 1; door.topheight = lowestCeilingSurrounding(sec) - 4;
        if (door.topheight !== sec.ceilH) sound(ctx, 'DSBDOPN', sec);
        break;
      default:
        door.direction = 1; door.topheight = lowestCeilingSurrounding(sec) - 4;
        if (door.topheight !== sec.ceilH) sound(ctx, 'DSDOROPN', sec);
    }
  }
  return rtn;
}

function doLockedDoor(ctx: GameCtx, line: Line, type: DoorType, user: Mobj): boolean {
  if (!user.player) return false;
  if (!hasKey(ctx, user, line.special, false)) return false;
  return doDoor(ctx, line, type);
}

// ------------------------------------------------------------------ plats
type PlatType = 'perpetualRaise' | 'downWaitUpStay' | 'raiseAndChange' | 'raiseToNearestAndChange' | 'blazeDWUS';
type PlatStatus = 'up' | 'down' | 'waiting' | 'inStasis';
interface Plat extends Thinker { kind: 'plat'; sector: Sector; speed: number; low: number; high: number; wait: number; count: number; status: PlatStatus; oldstatus: PlatStatus; crush: boolean; tag: number; type: PlatType }

const PLATSPEED = 1, PLATWAIT = 3 * 35;

function tickPlat(ctx: GameCtx, p: Plat): boolean {
  const sec = p.sector;
  switch (p.status) {
    case 'up': {
      const res = movePlane(ctx, sec, p.speed, p.high, p.crush, 'floor', 1);
      if ((p.type === 'raiseAndChange' || p.type === 'raiseToNearestAndChange') && !(ctx.tic & 7)) sound(ctx, 'DSSTNMOV', sec);
      if (res === CRUSHED && !p.crush) { p.count = p.wait; p.status = 'down'; sound(ctx, 'DSPSTART', sec); }
      else if (res === PASTDEST) {
        p.count = p.wait; p.status = 'waiting'; sound(ctx, 'DSPSTOP', sec);
        if (p.type === 'raiseAndChange' || p.type === 'raiseToNearestAndChange') { sec.specialData = null; return false; }
      }
      return true;
    }
    case 'down': {
      const res = movePlane(ctx, sec, p.speed, p.low, false, 'floor', -1);
      if (res === PASTDEST) { p.count = p.wait; p.status = 'waiting'; sound(ctx, 'DSPSTOP', sec); }
      return true;
    }
    case 'waiting':
      if (--p.count <= 0) {
        p.status = sec.floorH === p.low ? 'up' : 'down';
        sound(ctx, 'DSPSTART', sec);
        if (p.type === 'downWaitUpStay' || p.type === 'blazeDWUS') {
          if (p.status === 'up') p.type = 'perpetualRaise'; // becomes a "return trip"; finished at top
          if (sec.floorH === p.high) { sec.specialData = null; return false; }
        }
      }
      return true;
    case 'inStasis':
      return true;
  }
  return true;
}

function doPlat(ctx: GameCtx, line: Line, type: PlatType, amount: number): boolean {
  let rtn = false;
  for (const sec of sectorsWithTag(ctx, line.tag)) {
    if (sec.specialData) continue;
    rtn = true;
    const plat: Plat = {
      kind: 'plat', sector: sec, speed: PLATSPEED, low: sec.floorH, high: sec.floorH, wait: 0, count: 0,
      status: 'up', oldstatus: 'up', crush: false, tag: line.tag, type,
      tick(c) { return tickPlatWrapper(c, this); },
    };
    sec.specialData = plat;
    addThinker(plat);
    switch (type) {
      case 'raiseToNearestAndChange':
        plat.speed = PLATSPEED / 2; sec.floorFlat = line.frontSector.floorFlat; plat.high = nextHighestFloor(sec, sec.floorH);
        plat.wait = 0; plat.status = 'up'; sec.special = 0; sound(ctx, 'DSSTNMOV', sec); break;
      case 'raiseAndChange':
        plat.speed = PLATSPEED / 2; sec.floorFlat = line.frontSector.floorFlat; plat.high = sec.floorH + amount;
        plat.wait = 0; plat.status = 'up'; sound(ctx, 'DSSTNMOV', sec); break;
      case 'downWaitUpStay':
        plat.speed = PLATSPEED * 4; plat.low = Math.min(lowestFloorSurrounding(sec), sec.floorH); plat.high = sec.floorH;
        plat.wait = PLATWAIT; plat.status = 'down'; sound(ctx, 'DSPSTART', sec); break;
      case 'blazeDWUS':
        plat.speed = PLATSPEED * 8; plat.low = Math.min(lowestFloorSurrounding(sec), sec.floorH); plat.high = sec.floorH;
        plat.wait = PLATWAIT; plat.status = 'down'; sound(ctx, 'DSPSTART', sec); break;
      case 'perpetualRaise':
        plat.speed = PLATSPEED; plat.low = Math.min(lowestFloorSurrounding(sec), sec.floorH);
        plat.high = Math.max(highestFloorSurrounding(sec), sec.floorH); plat.wait = PLATWAIT;
        plat.status = rnd255() & 1 ? 'down' : 'up'; sound(ctx, 'DSPSTART', sec); break;
    }
  }
  return rtn;
}

// down-wait-up-stay finishes when it returns to the top
function tickPlatWrapper(ctx: GameCtx, p: Plat): boolean {
  const sec = p.sector;
  if ((p.type === 'downWaitUpStay' || p.type === 'blazeDWUS') && p.status === 'up') {
    const res = movePlane(ctx, sec, p.speed, p.high, false, 'floor', 1);
    if (res === CRUSHED) { p.count = p.wait; p.status = 'down'; sound(ctx, 'DSPSTART', sec); return true; }
    if (res === PASTDEST) { sound(ctx, 'DSPSTOP', sec); sec.specialData = null; return false; }
    return true;
  }
  if ((p.type === 'downWaitUpStay' || p.type === 'blazeDWUS') && p.status === 'waiting') {
    if (--p.count <= 0) { p.status = 'up'; sound(ctx, 'DSPSTART', sec); }
    return true;
  }
  return tickPlat(ctx, p);
}

function stopPlats(ctx: GameCtx, tag: number): void {
  for (const t of S.thinkers) {
    const p = t as Plat;
    if (p.kind === 'plat' && p.tag === tag && p.status !== 'inStasis') { p.oldstatus = p.status; p.status = 'inStasis'; }
  }
  void ctx;
}
function activateInStasis(tag: number): void {
  for (const t of S.thinkers) {
    const p = t as Plat;
    if (p.kind === 'plat' && p.tag === tag && p.status === 'inStasis') p.status = p.oldstatus;
  }
}

// ------------------------------------------------------------------ floors
type FloorType = 'lowerFloor' | 'lowerFloorToLowest' | 'turboLower' | 'raiseFloor' | 'raiseFloorToNearest' | 'raiseToTexture'
  | 'lowerAndChange' | 'raiseFloor24' | 'raiseFloor24AndChange' | 'raiseFloorCrush' | 'raiseFloorTurbo' | 'donutRaise' | 'raiseFloor512' | 'buildStair';
interface FloorMove extends Thinker { kind: 'floor'; sector: Sector; type: FloorType; crush: boolean; direction: -1 | 1; newspecial: number; texture: string | null; dest: number; speed: number }

const FLOORSPEED = 1;

function tickFloor(ctx: GameCtx, f: FloorMove): boolean {
  const sec = f.sector;
  const res = movePlane(ctx, sec, f.speed, f.dest, f.crush, 'floor', f.direction);
  if (!(ctx.tic & 7)) sound(ctx, 'DSSTNMOV', sec);
  if (res === PASTDEST) {
    sec.specialData = null;
    if (f.texture !== null && ((f.direction === 1 && f.type === 'donutRaise') || (f.direction === -1 && f.type === 'lowerAndChange'))) {
      sec.special = f.newspecial; sec.floorFlat = f.texture;
    }
    sound(ctx, 'DSPSTOP', sec);
    return false;
  }
  return true;
}

export function startFloor(ctx: GameCtx, sec: Sector, type: FloorType, line: Line | null, speed = FLOORSPEED): FloorMove {
  const f: FloorMove = {
    kind: 'floor', sector: sec, type, crush: false, direction: 1, newspecial: 0, texture: null, dest: sec.floorH, speed,
    tick(c) { return tickFloor(c, this); },
  };
  sec.specialData = f;
  addThinker(f);
  switch (type) {
    case 'lowerFloor': f.direction = -1; f.dest = highestFloorSurrounding(sec); break;
    case 'lowerFloorToLowest': f.direction = -1; f.dest = lowestFloorSurrounding(sec); break;
    case 'turboLower':
      f.direction = -1; f.speed = FLOORSPEED * 4; f.dest = highestFloorSurrounding(sec);
      if (f.dest !== sec.floorH) f.dest += 8; break;
    case 'raiseFloorCrush': case 'raiseFloor':
      if (type === 'raiseFloorCrush') f.crush = true;
      f.direction = 1; f.dest = Math.min(lowestCeilingSurrounding(sec), sec.ceilH);
      if (type === 'raiseFloorCrush') f.dest -= 8; break;
    case 'raiseFloorTurbo': f.direction = 1; f.speed = FLOORSPEED * 4; f.dest = nextHighestFloor(sec, sec.floorH); break;
    case 'raiseFloorToNearest': f.direction = 1; f.dest = nextHighestFloor(sec, sec.floorH); break;
    case 'raiseFloor24': f.direction = 1; f.dest = sec.floorH + 24; break;
    case 'raiseFloor512': f.direction = 1; f.dest = sec.floorH + 512; break;
    case 'raiseFloor24AndChange':
      f.direction = 1; f.dest = sec.floorH + 24;
      if (line) { sec.floorFlat = line.frontSector.floorFlat; sec.special = line.frontSector.special; }
      break;
    case 'raiseToTexture': {
      f.direction = 1;
      let minsize = 32000;
      for (const l of sec.lines) {
        if (!(l.flags & ML.TWOSIDED) || !l.back) continue;
        for (const side of [l.front, l.back]) {
          if (side.bottom && side.bottom !== '-') {
            const t = ctx.assets.texture(side.bottom);
            if (t && t.height < minsize) minsize = t.height;
          }
        }
      }
      f.dest = sec.floorH + (minsize === 32000 ? 0 : minsize);
      break;
    }
    case 'lowerAndChange': {
      f.direction = -1; f.dest = lowestFloorSurrounding(sec); f.texture = sec.floorFlat;
      for (const n of neighbors(sec)) if (n.floorH === f.dest) { f.texture = n.floorFlat; f.newspecial = n.special; break; }
      break;
    }
    case 'donutRaise': f.direction = -1; f.dest = lowestFloorSurrounding(sec); break;
    case 'buildStair': break;
  }
  return f;
}

function doFloor(ctx: GameCtx, line: Line, type: FloorType): boolean {
  let rtn = false;
  for (const sec of sectorsWithTag(ctx, line.tag)) {
    if (sec.specialData) continue;
    rtn = true;
    startFloor(ctx, sec, type, line);
  }
  return rtn;
}

function buildStairs(ctx: GameCtx, line: Line, stairsize: number, speed: number): boolean {
  let rtn = false;
  for (const first of sectorsWithTag(ctx, line.tag)) {
    if (first.specialData) continue;
    rtn = true;
    let sec = first;
    const texture = sec.floorFlat;
    let height = sec.floorH + stairsize;
    const f = startFloor(ctx, sec, 'buildStair', line, speed);
    f.direction = 1; f.dest = height;
    let ok: boolean;
    do {
      ok = false;
      for (const l of sec.lines) {
        if (!(l.flags & ML.TWOSIDED)) continue;
        if (l.frontSector !== sec) continue;
        const tsec = l.backSector;
        if (!tsec || tsec.floorFlat !== texture) continue;
        height += stairsize;
        if (tsec.specialData) continue;
        sec = tsec;
        const nf = startFloor(ctx, sec, 'buildStair', line, speed);
        nf.direction = 1; nf.dest = height;
        ok = true;
        break;
      }
    } while (ok);
  }
  return rtn;
}

// ------------------------------------------------------------------ ceilings
type CeilingType = 'lowerToFloor' | 'raiseToHighest' | 'lowerAndCrush' | 'crushAndRaise' | 'fastCrushAndRaise' | 'silentCrushAndRaise';
interface CeilingMove extends Thinker { kind: 'ceiling'; sector: Sector; type: CeilingType; bottomheight: number; topheight: number; speed: number; crush: boolean; direction: -1 | 0 | 1; tag: number; olddirection: -1 | 0 | 1 }
const CEILSPEED = 1;

function tickCeiling(ctx: GameCtx, c: CeilingMove): boolean {
  const sec = c.sector;
  switch (c.direction) {
    case 0: return true;
    case 1: {
      const res = movePlane(ctx, sec, c.speed, c.topheight, false, 'ceiling', 1);
      if (!(ctx.tic & 7) && c.type !== 'silentCrushAndRaise') sound(ctx, 'DSSTNMOV', sec);
      if (res === PASTDEST) {
        if (c.type === 'raiseToHighest') { sec.specialData = null; return false; }
        if (c.type === 'silentCrushAndRaise') sound(ctx, 'DSPSTOP', sec);
        c.direction = -1;
      }
      return true;
    }
    case -1: {
      const res = movePlane(ctx, sec, c.speed, c.bottomheight, c.crush, 'ceiling', -1);
      if (!(ctx.tic & 7) && c.type !== 'silentCrushAndRaise') sound(ctx, 'DSSTNMOV', sec);
      if (res === PASTDEST) {
        if (c.type === 'silentCrushAndRaise') sound(ctx, 'DSPSTOP', sec);
        if (c.type === 'crushAndRaise' || c.type === 'fastCrushAndRaise' || c.type === 'silentCrushAndRaise') {
          c.speed = CEILSPEED; c.direction = 1; return true;
        }
        sec.specialData = null; return false;
      }
      if (res === CRUSHED && (c.type === 'silentCrushAndRaise' || c.type === 'crushAndRaise' || c.type === 'lowerAndCrush')) c.speed = CEILSPEED / 8;
      return true;
    }
  }
  return true;
}

function doCeiling(ctx: GameCtx, line: Line, type: CeilingType): boolean {
  let rtn = false;
  for (const sec of sectorsWithTag(ctx, line.tag)) {
    if (sec.specialData) continue;
    rtn = true;
    const c: CeilingMove = {
      kind: 'ceiling', sector: sec, type, bottomheight: sec.floorH, topheight: sec.ceilH, speed: CEILSPEED, crush: false,
      direction: -1, tag: line.tag, olddirection: -1,
      tick(x) { return tickCeiling(x, this); },
    };
    sec.specialData = c;
    addThinker(c);
    switch (type) {
      case 'fastCrushAndRaise': c.crush = true; c.topheight = sec.ceilH; c.bottomheight = sec.floorH + 8; c.direction = -1; c.speed = CEILSPEED * 2; break;
      case 'silentCrushAndRaise': case 'crushAndRaise': case 'lowerAndCrush': case 'lowerToFloor':
        if (type === 'silentCrushAndRaise' || type === 'crushAndRaise') { c.crush = true; c.topheight = sec.ceilH; }
        c.bottomheight = sec.floorH; if (type !== 'lowerToFloor') c.bottomheight += 8; c.direction = -1; break;
      case 'raiseToHighest': c.topheight = highestCeilingSurrounding(sec); c.direction = 1; break;
    }
  }
  return rtn;
}

// ------------------------------------------------------------------ lights
function spawnLightFlash(sec: Sector): void {
  const maxlight = sec.light, minlight = minLightSurrounding(sec, sec.light);
  let count = (rnd255() & 64) + 1;
  const t: Thinker = {
    tick() {
      if (--count > 0) return true;
      if (sec.light === maxlight) { sec.light = minlight; count = (rnd255() & 7) + 1; }
      else { sec.light = maxlight; count = (rnd255() & 64) + 1; }
      return true;
    },
  };
  sec.lightData = t; sec.special = 0; addThinker(t);
}
function spawnStrobeFlash(sec: Sector, fastOrSlow: number, inSync: boolean): void {
  const darktime = fastOrSlow, brighttime = 5;
  const maxlight = sec.light;
  let minlight = minLightSurrounding(sec, sec.light);
  if (minlight === maxlight) minlight = 0;
  let count = inSync ? 1 : (rnd255() & 7) + 1;
  const t: Thinker = {
    tick() {
      if (--count > 0) return true;
      if (sec.light === minlight) { sec.light = maxlight; count = brighttime; }
      else { sec.light = minlight; count = darktime; }
      return true;
    },
  };
  sec.lightData = t; addThinker(t);
}
function spawnGlowingLight(sec: Sector): void {
  const minlight = minLightSurrounding(sec, sec.light), maxlight = sec.light;
  let direction = -1;
  const t: Thinker = {
    tick() {
      if (direction === -1) { sec.light -= 8; if (sec.light <= minlight) { sec.light += 8; direction = 1; } }
      else { sec.light += 8; if (sec.light >= maxlight) { sec.light -= 8; direction = -1; } }
      return true;
    },
  };
  sec.lightData = t; sec.special = 0; addThinker(t);
}
function spawnFireFlicker(sec: Sector): void {
  const maxlight = sec.light, minlight = minLightSurrounding(sec, sec.light) + 16;
  let count = 4;
  const t: Thinker = {
    tick() {
      if (--count > 0) return true;
      const amount = (rnd255() & 3) * 16;
      sec.light = maxlight - amount < minlight ? minlight : maxlight - amount;
      count = 4;
      return true;
    },
  };
  sec.lightData = t; sec.special = 0; addThinker(t);
}
function lightTurnOn(ctx: GameCtx, line: Line, bright: number): void {
  for (const sec of sectorsWithTag(ctx, line.tag)) {
    let b = bright;
    if (b === 0) { b = 0; for (const n of neighbors(sec)) if (n.light > b) b = n.light; }
    sec.light = b;
  }
}
function turnTagLightsOff(ctx: GameCtx, line: Line): void {
  for (const sec of sectorsWithTag(ctx, line.tag)) {
    let min = sec.light;
    for (const n of neighbors(sec)) if (n.light < min) min = n.light;
    sec.light = min;
  }
}
function startLightStrobing(ctx: GameCtx, line: Line): void {
  for (const sec of sectorsWithTag(ctx, line.tag)) {
    if (sec.lightData) continue;
    spawnStrobeFlash(sec, 35, false);
  }
}

// ------------------------------------------------------------------ teleport
function teleport(ctx: GameCtx, line: Line, side: 0 | 1, thing: Mobj): boolean {
  if (thing.flags & MF.MISSILE) return false;
  if (side === 1) return false;
  const dest = S.teleDests.find(d => d.sector.tag === line.tag);
  if (!dest) return false;
  const oldx = thing.x, oldy = thing.y, oldz = thing.z;
  if (thing.player) {
    // telefrag whatever stands on the destination
    ctx.geo.thingsInRadius(dest.x, dest.y, thing.radius + 64, m => {
      if (m === thing || !(m.flags & MF.SHOOTABLE)) return;
      const dx = Math.abs(m.x - dest.x), dy = Math.abs(m.y - dest.y);
      if (Math.max(dx, dy) < m.radius + thing.radius) damageMobj(ctx, m, thing, thing, 10000);
    });
  }
  if (!ctx.geo.teleportMove(thing, dest.x, dest.y)) return false;
  thing.z = thing.floorz;
  if (thing.player) thing.player.viewz = thing.z + thing.player.viewheight;
  const fog1 = spawnMobj(ctx, 'TFOG', oldx, oldy, oldz, 0);
  if (fog1) ctx.playSound('DSTELEPT', fog1);
  const an = deg2rad(dest.angle);
  const fog2 = spawnMobj(ctx, 'TFOG', dest.x + 20 * Math.cos(an), dest.y + 20 * Math.sin(an), thing.z, 0);
  if (fog2) ctx.playSound('DSTELEPT', fog2);
  if (thing.player) thing.reactiontime = 18;
  thing.angle = an;
  thing.momx = thing.momy = thing.momz = 0;
  return true;
}

// ------------------------------------------------------------------ switches
function changeSwitchTexture(ctx: GameCtx, line: Line, useAgain: boolean): void {
  if (!useAgain) line.special = 0;
  const side = line.front;
  const org = lineCenter(line);
  for (const key of ['top', 'mid', 'bottom'] as const) {
    const pair = ctx.assets.switchPair(side[key]);
    if (pair) {
      ctx.playSound('DSSWTCHN', org);
      const old = side[key];
      side[key] = pair;
      if (useAgain) S.buttons.push({ side, key, texture: old, timer: 35, org });
      return;
    }
  }
  if (!useAgain) ctx.playSound('DSSWTCHN', org);
}

function exitLevel(ctx: GameCtx, line: Line, secret: boolean): void {
  ctx.playSound('DSSWTCHX', null);
  line.special = 0;
  ctx.exitLevel(secret);
}

// ------------------------------------------------------------------ boss death (E1M8 / MAP07)
export function bossDeath(ctx: GameCtx, m: Mobj): void {
  const name = ctx.level.name;
  let tag = 0;
  let type: FloorType = 'lowerFloorToLowest';
  if (name === 'E1M8' && m.info.name === 'BARON') tag = 666;
  else if (name === 'MAP07' && m.info.name === 'MANCUBUS') tag = 666;
  else if (name === 'MAP07' && m.info.name === 'ARACHNOTRON') { tag = 667; type = 'raiseToTexture'; }
  else if (/^E[234]M8$/.test(name) && (m.info.name === 'CYBERDEMON' || m.info.name === 'SPIDERMASTERMIND')) { ctx.exitLevel(false); return; }
  if (!tag) return;
  for (const o of ctx.mobjs) if (o !== m && o.info === m.info && o.health > 0 && !o.removed) return;
  for (const sec of sectorsWithTag(ctx, tag)) if (!sec.specialData) startFloor(ctx, sec, type, null);
}

// ------------------------------------------------------------------ dispatch
export function useSpecialLine(ctx: GameCtx, line: Line, side: 0 | 1, user: Mobj): boolean {
  if (side === 1) return false;
  if (!user.player) {
    if (line.flags & ML.SECRET) return false;
    if (![1, 32, 33, 34].includes(line.special)) return false;
  }
  const sw = (fn: () => boolean) => { if (fn()) changeSwitchTexture(ctx, line, false); return true; };
  const btn = (fn: () => boolean) => { if (fn()) changeSwitchTexture(ctx, line, true); return true; };
  switch (line.special) {
    // manual doors
    case 1: case 26: case 27: case 28: case 31: case 32: case 33: case 34: case 117: case 118:
      return verticalDoor(ctx, line, user);
    // switches (S1)
    case 7: return sw(() => buildStairs(ctx, line, 8, FLOORSPEED / 4));
    case 9: return sw(() => doFloor(ctx, line, 'donutRaise'));
    case 11: changeSwitchTexture(ctx, line, false); exitLevel(ctx, line, false); return true;
    case 14: return sw(() => doPlat(ctx, line, 'raiseAndChange', 32));
    case 15: return sw(() => doPlat(ctx, line, 'raiseAndChange', 24));
    case 18: return sw(() => doFloor(ctx, line, 'raiseFloorToNearest'));
    case 20: return sw(() => doPlat(ctx, line, 'raiseToNearestAndChange', 0));
    case 21: return sw(() => doPlat(ctx, line, 'downWaitUpStay', 0));
    case 23: return sw(() => doFloor(ctx, line, 'lowerFloorToLowest'));
    case 29: return sw(() => doDoor(ctx, line, 'normal'));
    case 41: return sw(() => doCeiling(ctx, line, 'lowerToFloor'));
    case 71: return sw(() => doFloor(ctx, line, 'turboLower'));
    case 49: return sw(() => doCeiling(ctx, line, 'crushAndRaise'));
    case 50: return sw(() => doDoor(ctx, line, 'close'));
    case 51: changeSwitchTexture(ctx, line, false); exitLevel(ctx, line, true); return true;
    case 55: return sw(() => doFloor(ctx, line, 'raiseFloorCrush'));
    case 101: return sw(() => doFloor(ctx, line, 'raiseFloor'));
    case 102: return sw(() => doFloor(ctx, line, 'lowerFloor'));
    case 103: return sw(() => doDoor(ctx, line, 'open'));
    case 111: return sw(() => doDoor(ctx, line, 'blazeRaise'));
    case 112: return sw(() => doDoor(ctx, line, 'blazeOpen'));
    case 113: return sw(() => doDoor(ctx, line, 'blazeClose'));
    case 122: return sw(() => doPlat(ctx, line, 'blazeDWUS', 0));
    case 127: return sw(() => buildStairs(ctx, line, 16, FLOORSPEED * 4));
    case 131: return sw(() => doFloor(ctx, line, 'raiseFloorTurbo'));
    case 133: case 135: case 137: return sw(() => doLockedDoor(ctx, line, 'blazeOpen', user));
    case 140: return sw(() => doFloor(ctx, line, 'raiseFloor512'));
    // buttons (SR)
    case 42: return btn(() => doDoor(ctx, line, 'close'));
    case 43: return btn(() => doCeiling(ctx, line, 'lowerToFloor'));
    case 45: return btn(() => doFloor(ctx, line, 'lowerFloor'));
    case 60: return btn(() => doFloor(ctx, line, 'lowerFloorToLowest'));
    case 61: return btn(() => doDoor(ctx, line, 'open'));
    case 62: return btn(() => doPlat(ctx, line, 'downWaitUpStay', 1));
    case 63: return btn(() => doDoor(ctx, line, 'normal'));
    case 64: return btn(() => doFloor(ctx, line, 'raiseFloor'));
    case 66: return btn(() => doPlat(ctx, line, 'raiseAndChange', 24));
    case 67: return btn(() => doPlat(ctx, line, 'raiseAndChange', 32));
    case 65: return btn(() => doFloor(ctx, line, 'raiseFloorCrush'));
    case 68: return btn(() => doPlat(ctx, line, 'raiseToNearestAndChange', 0));
    case 69: return btn(() => doFloor(ctx, line, 'raiseFloorToNearest'));
    case 70: return btn(() => doFloor(ctx, line, 'turboLower'));
    case 114: return btn(() => doDoor(ctx, line, 'blazeRaise'));
    case 115: return btn(() => doDoor(ctx, line, 'blazeOpen'));
    case 116: return btn(() => doDoor(ctx, line, 'blazeClose'));
    case 123: return btn(() => doPlat(ctx, line, 'blazeDWUS', 0));
    case 132: return btn(() => doFloor(ctx, line, 'raiseFloorTurbo'));
    case 99: case 134: case 136: return btn(() => doLockedDoor(ctx, line, 'blazeOpen', user));
    case 138: lightTurnOn(ctx, line, 255); changeSwitchTexture(ctx, line, true); return true;
    case 139: lightTurnOn(ctx, line, 35); changeSwitchTexture(ctx, line, true); return true;
  }
  return false;
}

export function crossSpecialLine(ctx: GameCtx, line: Line, side: 0 | 1, thing: Mobj): void {
  if (!thing.player) {
    if (thing.flags & MF.MISSILE) return;
    if (![39, 97, 125, 126, 4, 10, 88].includes(line.special)) return;
  }
  const once = (fn: () => unknown) => { fn(); line.special = 0; };
  switch (line.special) {
    // W1
    case 2: once(() => doDoor(ctx, line, 'open')); break;
    case 3: once(() => doDoor(ctx, line, 'close')); break;
    case 4: once(() => doDoor(ctx, line, 'normal')); break;
    case 5: once(() => doFloor(ctx, line, 'raiseFloor')); break;
    case 6: once(() => doCeiling(ctx, line, 'fastCrushAndRaise')); break;
    case 8: once(() => buildStairs(ctx, line, 8, FLOORSPEED / 4)); break;
    case 10: once(() => doPlat(ctx, line, 'downWaitUpStay', 0)); break;
    case 12: once(() => lightTurnOn(ctx, line, 0)); break;
    case 13: once(() => lightTurnOn(ctx, line, 255)); break;
    case 16: once(() => doDoor(ctx, line, 'close30ThenOpen')); break;
    case 17: once(() => startLightStrobing(ctx, line)); break;
    case 19: once(() => doFloor(ctx, line, 'lowerFloor')); break;
    case 22: once(() => doPlat(ctx, line, 'raiseToNearestAndChange', 0)); break;
    case 25: once(() => doCeiling(ctx, line, 'crushAndRaise')); break;
    case 30: once(() => doFloor(ctx, line, 'raiseToTexture')); break;
    case 35: once(() => lightTurnOn(ctx, line, 35)); break;
    case 36: once(() => doFloor(ctx, line, 'turboLower')); break;
    case 37: once(() => doFloor(ctx, line, 'lowerAndChange')); break;
    case 38: once(() => doFloor(ctx, line, 'lowerFloorToLowest')); break;
    case 39: once(() => teleport(ctx, line, side, thing)); break;
    case 40: once(() => { doCeiling(ctx, line, 'raiseToHighest'); doFloor(ctx, line, 'lowerFloorToLowest'); }); break;
    case 44: once(() => doCeiling(ctx, line, 'lowerAndCrush')); break;
    case 52: exitLevel(ctx, line, false); break;
    case 53: once(() => doPlat(ctx, line, 'perpetualRaise', 0)); break;
    case 54: once(() => stopPlats(ctx, line.tag)); break;
    case 56: once(() => doFloor(ctx, line, 'raiseFloorCrush')); break;
    case 57: line.special = 0; break; // ceiling stop (not modelled)
    case 58: once(() => doFloor(ctx, line, 'raiseFloor24')); break;
    case 59: once(() => doFloor(ctx, line, 'raiseFloor24AndChange')); break;
    case 104: once(() => turnTagLightsOff(ctx, line)); break;
    case 108: once(() => doDoor(ctx, line, 'blazeRaise')); break;
    case 109: once(() => doDoor(ctx, line, 'blazeOpen')); break;
    case 100: once(() => buildStairs(ctx, line, 16, FLOORSPEED * 4)); break;
    case 110: once(() => doDoor(ctx, line, 'blazeClose')); break;
    case 119: once(() => doFloor(ctx, line, 'raiseFloorToNearest')); break;
    case 121: once(() => doPlat(ctx, line, 'blazeDWUS', 0)); break;
    case 124: exitLevel(ctx, line, true); break;
    case 125: if (!thing.player) once(() => teleport(ctx, line, side, thing)); break;
    case 130: once(() => doFloor(ctx, line, 'raiseFloorTurbo')); break;
    case 141: once(() => doCeiling(ctx, line, 'silentCrushAndRaise')); break;
    // WR
    case 72: doCeiling(ctx, line, 'lowerAndCrush'); break;
    case 73: doCeiling(ctx, line, 'crushAndRaise'); break;
    case 74: break; // ceiling stop
    case 75: doDoor(ctx, line, 'close'); break;
    case 76: doDoor(ctx, line, 'close30ThenOpen'); break;
    case 77: doCeiling(ctx, line, 'fastCrushAndRaise'); break;
    case 79: lightTurnOn(ctx, line, 35); break;
    case 80: lightTurnOn(ctx, line, 0); break;
    case 81: lightTurnOn(ctx, line, 255); break;
    case 82: doFloor(ctx, line, 'lowerFloorToLowest'); break;
    case 83: doFloor(ctx, line, 'lowerFloor'); break;
    case 84: doFloor(ctx, line, 'lowerAndChange'); break;
    case 86: doDoor(ctx, line, 'open'); break;
    case 87: doPlat(ctx, line, 'perpetualRaise', 0); break;
    case 88: activateInStasis(line.tag); doPlat(ctx, line, 'downWaitUpStay', 0); break;
    case 89: stopPlats(ctx, line.tag); break;
    case 90: doDoor(ctx, line, 'normal'); break;
    case 91: doFloor(ctx, line, 'raiseFloor'); break;
    case 92: doFloor(ctx, line, 'raiseFloor24'); break;
    case 93: doFloor(ctx, line, 'raiseFloor24AndChange'); break;
    case 94: doFloor(ctx, line, 'raiseFloorCrush'); break;
    case 95: doPlat(ctx, line, 'raiseToNearestAndChange', 0); break;
    case 96: doFloor(ctx, line, 'raiseToTexture'); break;
    case 97: teleport(ctx, line, side, thing); break;
    case 98: doFloor(ctx, line, 'turboLower'); break;
    case 105: doDoor(ctx, line, 'blazeRaise'); break;
    case 106: doDoor(ctx, line, 'blazeOpen'); break;
    case 107: doDoor(ctx, line, 'blazeClose'); break;
    case 120: doPlat(ctx, line, 'blazeDWUS', 0); break;
    case 126: if (!thing.player) teleport(ctx, line, side, thing); break;
    case 128: doFloor(ctx, line, 'raiseFloorToNearest'); break;
    case 129: doFloor(ctx, line, 'raiseFloorTurbo'); break;
  }
}

export function shootSpecialLine(ctx: GameCtx, line: Line, side: 0 | 1, shooter: Mobj): void {
  void side;
  if (!shooter.player && line.special !== 46) return;
  switch (line.special) {
    case 24: if (doFloor(ctx, line, 'raiseFloor')) changeSwitchTexture(ctx, line, false); break;
    case 46: doDoor(ctx, line, 'open'); changeSwitchTexture(ctx, line, true); break;
    case 47: if (doPlat(ctx, line, 'raiseToNearestAndChange', 0)) changeSwitchTexture(ctx, line, false); break;
  }
}

// ------------------------------------------------------------------ player sector effects
export function playerInSpecialSector(ctx: GameCtx): void {
  const p = ctx.player;
  const mo = p.mo;
  if (!mo || p.dead) return;
  const sec = mo.sector ?? ctx.level.pointInSector(mo.x, mo.y);
  if (mo.z > mo.floorz + 0.001) return; // not on the floor
  const every32 = (ctx.tic & 0x1f) === 0;
  switch (sec.special) {
    case 5: if (every32) damageMobj(ctx, mo, null, null, 10); break;
    case 7: if (every32) damageMobj(ctx, mo, null, null, 5); break;
    case 16: case 4: if (every32) damageMobj(ctx, mo, null, null, 20); break;
    case 9:
      p.secretcount++; sec.special = 0; ctx.message('A secret is revealed!'); break;
    case 11:
      p.cheats.god = false;
      if (every32) damageMobj(ctx, mo, null, null, 20);
      if (p.health <= 10) ctx.exitLevel(false);
      break;
  }
}

// ------------------------------------------------------------------ init / tick
export function initSpecials(ctx: GameCtx): void {
  S = new SpecialsState();
  for (const t of ctx.level.things) {
    if (t.type === 14) S.teleDests.push({ ...t, sector: ctx.level.pointInSector(t.x, t.y) });
  }
  for (const sec of ctx.level.sectors) {
    sec.specialData = null;
    sec.lightData = null;
    switch (sec.special) {
      case 1: spawnLightFlash(sec); break;
      case 2: spawnStrobeFlash(sec, 15, false); break;
      case 3: spawnStrobeFlash(sec, 35, false); break;
      case 4: spawnStrobeFlash(sec, 15, false); break; // keeps special 4 for damage
      case 8: spawnGlowingLight(sec); break;
      case 9: ctx.stats.totalSecrets++; break;
      case 10: { // door close in 30 seconds
        const d = makeDoor(ctx, sec, 'normal'); d.direction = 0; d.topcountdown = 30 * 35; sec.special = 0; break;
      }
      case 12: spawnStrobeFlash(sec, 35, true); break;
      case 13: spawnStrobeFlash(sec, 15, true); break;
      case 14: { // door raise in 5 minutes
        const d = makeDoor(ctx, sec, 'raiseIn5Mins'); d.direction = 2; d.topcountdown = 5 * 60 * 35;
        d.topheight = lowestCeilingSurrounding(sec) - 4; sec.special = 0; break;
      }
      case 17: spawnFireFlicker(sec); break;
    }
  }
  for (const line of ctx.level.lines) {
    if (line.special === 48) {
      const side = line.front;
      addThinker({ tick() { side.xoff += 1; return true; } });
    }
  }
  applyAnims(ctx);
}

function applyAnims(ctx: GameCtx): void {
  const k = S.animIndex;
  for (const g of ctx.assets.textureAnimGroups) {
    const n = g.length;
    for (let i = 0; i < n; i++) ctx.anim.textureAlias.set(g[i], g[(i + k) % n]);
  }
  for (const g of ctx.assets.flatAnimGroups) {
    const n = g.length;
    for (let i = 0; i < n; i++) ctx.anim.flatAlias.set(g[i], g[(i + k) % n]);
  }
}

export function tickSpecials(ctx: GameCtx): void {
  for (const t of Array.from(S.thinkers)) {
    if (!t.tick(ctx)) S.thinkers.delete(t);
  }
  for (let i = S.buttons.length - 1; i >= 0; i--) {
    const b = S.buttons[i];
    if (--b.timer <= 0) {
      b.side[b.key] = b.texture;
      ctx.playSound('DSSWTCHN', b.org);
      S.buttons.splice(i, 1);
    }
  }
  if (ctx.tic % 8 === 0) { S.animIndex++; applyAnims(ctx); }
}

export { ONFLOORZ };
