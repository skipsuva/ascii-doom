// Movement & collision (DOOM p_map.c equivalents) and the Geo implementation.
import { MF, ML, type CheckResult, type Geo, type Level, type Line, type Mobj, type MoveHooks, type Opening } from '../types';
import { BLOCK_SIZE, MAXMOVE, MAXRADIUS, MAXSTEP, boxOnLineSide, newOpening, nextValidcount, openingInto, pointOnLineSide } from './common';
import { checkSight, hitscan, linesInBox, thingsInRadius, useTrace } from './trace';

const EMPTY_LINES: Line[] = [];

export class GeoImpl implements Geo {
  private readonly op: Opening = newOpening();
  // scratch written by scanLines()
  private tmFloorz = 0;
  private tmCeilingz = 0;
  private tmDropoffz = 0;
  private tmBlockingLine: Line | null = null;
  private tmSpecLines: Line[] = EMPTY_LINES;

  constructor(readonly level: Level) {}

  private blockX(x: number): number { return Math.floor((x - this.level.blockmap.originX) / BLOCK_SIZE); }
  private blockY(y: number): number { return Math.floor((y - this.level.blockmap.originY) / BLOCK_SIZE); }

  /** Line pass of P_CheckPosition. Returns true if blocked by a line. Fills tm* scratch. */
  private scanLines(m: Mobj, bminx: number, bminy: number, bmaxx: number, bmaxy: number, collectSpec: boolean): boolean {
    const level = this.level;
    const bm = level.blockmap;
    const allLines = level.lines;
    const isMissile = (m.flags & MF.MISSILE) !== 0;
    const op = this.op;
    this.tmBlockingLine = null;
    this.tmSpecLines = EMPTY_LINES;
    let bx1 = this.blockX(bminx);
    let bx2 = this.blockX(bmaxx);
    let by1 = this.blockY(bminy);
    let by2 = this.blockY(bmaxy);
    if (bx1 < 0) bx1 = 0;
    if (by1 < 0) by1 = 0;
    if (bx2 >= bm.columns) bx2 = bm.columns - 1;
    if (by2 >= bm.rows) by2 = bm.rows - 1;
    const vc = nextValidcount();
    for (let by = by1; by <= by2; by++) {
      for (let bx = bx1; bx <= bx2; bx++) {
        const list = bm.lines[by * bm.columns + bx];
        for (let i = 0; i < list.length; i++) {
          const line = allLines[list[i]];
          if (line.validcount === vc) continue;
          line.validcount = vc;
          const bb = line.bbox;
          if (bmaxx <= bb[0] || bminx >= bb[2] || bmaxy <= bb[1] || bminy >= bb[3]) continue;
          if (boxOnLineSide(bminx, bminy, bmaxx, bmaxy, line) !== -1) continue;
          if (!line.back) { this.tmBlockingLine = line; return true; }
          if (!isMissile) {
            if (line.flags & ML.BLOCKING) { this.tmBlockingLine = line; return true; }
            if (!m.player && (line.flags & ML.BLOCKMONSTERS)) { this.tmBlockingLine = line; return true; }
          }
          openingInto(line, op);
          if (op.top < this.tmCeilingz) this.tmCeilingz = op.top;
          if (op.bottom > this.tmFloorz) this.tmFloorz = op.bottom;
          if (op.lowFloor < this.tmDropoffz) this.tmDropoffz = op.lowFloor;
          if (collectSpec && line.special) {
            if (this.tmSpecLines === EMPTY_LINES) this.tmSpecLines = [];
            this.tmSpecLines.push(line);
          }
        }
      }
    }
    return false;
  }

  /** Thing pass of P_CheckPosition. Returns the blocking thing or null. */
  private scanThings(m: Mobj, x: number, y: number, bminx: number, bminy: number, bmaxx: number, bmaxy: number, hooks?: MoveHooks): Mobj | null {
    const bm = this.level.blockmap;
    const r = m.radius;
    const isMissile = (m.flags & MF.MISSILE) !== 0;
    let bx1 = this.blockX(bminx - MAXRADIUS);
    let bx2 = this.blockX(bmaxx + MAXRADIUS);
    let by1 = this.blockY(bminy - MAXRADIUS);
    let by2 = this.blockY(bmaxy + MAXRADIUS);
    if (bx1 < 0) bx1 = 0;
    if (by1 < 0) by1 = 0;
    if (bx2 >= bm.columns) bx2 = bm.columns - 1;
    if (by2 >= bm.rows) by2 = bm.rows - 1;
    for (let by = by1; by <= by2; by++) {
      for (let bx = bx1; bx <= bx2; bx++) {
        const set = bm.things[by * bm.columns + bx];
        if (set.size === 0) continue;
        for (const other of set) {
          if (other === m || other.removed) continue;
          if (!(other.flags & (MF.SOLID | MF.SPECIAL | MF.SHOOTABLE))) continue;
          const blockdist = other.radius + r;
          if (Math.abs(other.x - x) >= blockdist || Math.abs(other.y - y) >= blockdist) continue;
          if (isMissile) {
            if (other === m.target) continue; // don't hit the shooter
            if (m.z > other.z + other.height) continue; // overhead
            if (m.z + m.height < other.z) continue; // underneath
            if (other.flags & (MF.SHOOTABLE | MF.SOLID)) {
              const stop = hooks && hooks.onMissileHit ? hooks.onMissileHit(m, other) : true;
              if (stop) return other;
            }
            continue;
          }
          if ((other.flags & MF.SPECIAL) && (m.flags & MF.PICKUP)) {
            if (hooks && hooks.onTouchSpecial) hooks.onTouchSpecial(other, m);
            continue;
          }
          if (other.flags & MF.SOLID) return other;
        }
      }
    }
    return null;
  }

  checkPosition(m: Mobj, x: number, y: number, hooks?: MoveHooks): CheckResult {
    const r = m.radius;
    const bminx = x - r;
    const bminy = y - r;
    const bmaxx = x + r;
    const bmaxy = y + r;
    const sec = this.level.pointInSubsector(x, y).sector;
    this.tmFloorz = sec.floorH;
    this.tmDropoffz = sec.floorH;
    this.tmCeilingz = sec.ceilH;
    this.tmBlockingLine = null;
    this.tmSpecLines = EMPTY_LINES;
    let blockingThing: Mobj | null = null;
    let blocked = false;
    const noclip = (m.flags & MF.NOCLIP) !== 0;
    if (!noclip) {
      blockingThing = this.scanThings(m, x, y, bminx, bminy, bmaxx, bmaxy, hooks);
      if (blockingThing) blocked = true;
      else blocked = this.scanLines(m, bminx, bminy, bmaxx, bmaxy, true);
    } else {
      // still gather floor/ceiling from openings so noclip players get sane heights
      this.scanLinesNoBlock(m, bminx, bminy, bmaxx, bmaxy);
    }
    const floorz = this.tmFloorz;
    const ceilingz = this.tmCeilingz;
    const dropoffz = this.tmDropoffz;
    let ok = !blocked;
    if (ok && !noclip) {
      const isMissile = (m.flags & MF.MISSILE) !== 0;
      if (ceilingz - floorz < m.height) ok = false; // doesn't fit
      else if (!(m.flags & MF.TELEPORT)) {
        if (ceilingz - m.z < m.height) ok = false; // must lower itself to fit
        else if (floorz - m.z > MAXSTEP) ok = false; // too big a step up
        else if (!isMissile && !m.player && !(m.flags & (MF.DROPOFF | MF.FLOAT)) && floorz - dropoffz > MAXSTEP) ok = false; // don't stand over a dropoff
      }
    }
    return { ok, floorz, ceilingz, dropoffz, blockingLine: this.tmBlockingLine, blockingThing, specLines: this.tmSpecLines };
  }

  /** Floor/ceiling from openings only, never blocking (used for noclip and updateFloorCeiling). */
  private scanLinesNoBlock(m: Mobj, bminx: number, bminy: number, bmaxx: number, bmaxy: number): void {
    const level = this.level;
    const bm = level.blockmap;
    const allLines = level.lines;
    const op = this.op;
    let bx1 = this.blockX(bminx);
    let bx2 = this.blockX(bmaxx);
    let by1 = this.blockY(bminy);
    let by2 = this.blockY(bmaxy);
    if (bx1 < 0) bx1 = 0;
    if (by1 < 0) by1 = 0;
    if (bx2 >= bm.columns) bx2 = bm.columns - 1;
    if (by2 >= bm.rows) by2 = bm.rows - 1;
    const vc = nextValidcount();
    for (let by = by1; by <= by2; by++) {
      for (let bx = bx1; bx <= bx2; bx++) {
        const list = bm.lines[by * bm.columns + bx];
        for (let i = 0; i < list.length; i++) {
          const line = allLines[list[i]];
          if (line.validcount === vc) continue;
          line.validcount = vc;
          if (!line.back) continue;
          const bb = line.bbox;
          if (bmaxx <= bb[0] || bminx >= bb[2] || bmaxy <= bb[1] || bminy >= bb[3]) continue;
          if (boxOnLineSide(bminx, bminy, bmaxx, bmaxy, line) !== -1) continue;
          openingInto(line, op);
          if (op.top < this.tmCeilingz) this.tmCeilingz = op.top;
          if (op.bottom > this.tmFloorz) this.tmFloorz = op.bottom;
          if (op.lowFloor < this.tmDropoffz) this.tmDropoffz = op.lowFloor;
        }
      }
    }
    void m;
  }

  tryMove(m: Mobj, x: number, y: number, hooks?: MoveHooks): boolean {
    const res = this.checkPosition(m, x, y, hooks);
    if (!res.ok) return false;
    const oldx = m.x;
    const oldy = m.y;
    this.unsetThingPosition(m);
    m.floorz = res.floorz;
    m.ceilingz = res.ceilingz;
    m.dropoffz = res.dropoffz;
    m.x = x;
    m.y = y;
    this.setThingPosition(m);
    const spec = res.specLines;
    if (spec.length && hooks && hooks.onCross && !(m.flags & (MF.TELEPORT | MF.NOCLIP))) {
      for (let i = spec.length - 1; i >= 0; i--) {
        const line = spec[i];
        const side = pointOnLineSide(x, y, line);
        const oldSide = pointOnLineSide(oldx, oldy, line);
        if (side !== oldSide) hooks.onCross(line, oldSide, m);
      }
    }
    return true;
  }

  slideMove(m: Mobj, hooks?: MoveHooks): boolean {
    if (m.momx > MAXMOVE) m.momx = MAXMOVE; else if (m.momx < -MAXMOVE) m.momx = -MAXMOVE;
    if (m.momy > MAXMOVE) m.momy = MAXMOVE; else if (m.momy < -MAXMOVE) m.momy = -MAXMOVE;
    const mx = m.momx;
    const my = m.momy;
    if (mx === 0 && my === 0) return false;
    if (this.tryMove(m, m.x + mx, m.y + my, hooks)) return true;
    // Blocked: slide along the blocking line if there is one.
    const bl = this.tmBlockingLine;
    if (bl) {
      const len = Math.hypot(bl.dx, bl.dy);
      if (len > 0) {
        const ux = bl.dx / len;
        const uy = bl.dy / len;
        const dot = mx * ux + my * uy;
        const sx = dot * ux;
        const sy = dot * uy;
        if ((Math.abs(sx) > 1e-6 || Math.abs(sy) > 1e-6) && this.tryMove(m, m.x + sx, m.y + sy, hooks)) {
          m.momx = sx;
          m.momy = sy;
          return true;
        }
      }
    }
    // Stair-step fallback: one axis at a time.
    if (mx !== 0 && this.tryMove(m, m.x + mx, m.y, hooks)) { m.momy = 0; return true; }
    if (my !== 0 && this.tryMove(m, m.x, m.y + my, hooks)) { m.momx = 0; return true; }
    m.momx = 0;
    m.momy = 0;
    return false;
  }

  setThingPosition(m: Mobj): void {
    const ss = this.level.pointInSubsector(m.x, m.y);
    m.subsector = ss;
    m.sector = ss.sector;
    if (!(m.flags & MF.NOSECTOR)) ss.sector.things.add(m);
    if (!(m.flags & MF.NOBLOCKMAP)) {
      const bm = this.level.blockmap;
      const bx = this.blockX(m.x);
      const by = this.blockY(m.y);
      if (bx >= 0 && bx < bm.columns && by >= 0 && by < bm.rows) {
        const idx = by * bm.columns + bx;
        bm.things[idx].add(m);
        m.blockIndex = idx;
      } else m.blockIndex = -1;
    } else m.blockIndex = -1;
  }

  unsetThingPosition(m: Mobj): void {
    if (m.sector) m.sector.things.delete(m);
    if (m.blockIndex >= 0) {
      const set = this.level.blockmap.things[m.blockIndex];
      if (set) set.delete(m);
      m.blockIndex = -1;
    }
  }

  updateFloorCeiling(m: Mobj): void {
    const r = m.radius;
    const sec = this.level.pointInSubsector(m.x, m.y).sector;
    this.tmFloorz = sec.floorH;
    this.tmDropoffz = sec.floorH;
    this.tmCeilingz = sec.ceilH;
    this.scanLinesNoBlock(m, m.x - r, m.y - r, m.x + r, m.y + r);
    m.floorz = this.tmFloorz;
    m.ceilingz = this.tmCeilingz;
    m.dropoffz = this.tmDropoffz;
  }

  checkSight(a: Mobj, b: Mobj): boolean { return checkSight(this.level, a, b); }
  hitscan(shooter: Mobj, angle: number, range: number, z: number) { return hitscan(this.level, shooter, angle, range, z); }
  useTrace(user: Mobj) { return useTrace(this.level, user); }
  thingsInRadius(x: number, y: number, r: number, cb: (m: Mobj) => boolean | void): void { thingsInRadius(this.level, x, y, r, cb); }
  linesInBox(minx: number, miny: number, maxx: number, maxy: number, cb: (l: Line) => boolean | void): void { linesInBox(this.level, minx, miny, maxx, maxy, cb); }

  lineOpening(line: Line): Opening {
    const o = newOpening();
    openingInto(line, o);
    return o;
  }

  teleportMove(m: Mobj, x: number, y: number): boolean {
    this.unsetThingPosition(m);
    m.x = x;
    m.y = y;
    this.setThingPosition(m);
    this.updateFloorCeiling(m);
    return true;
  }

  pointOnLineSide(x: number, y: number, line: Line): 0 | 1 { return pointOnLineSide(x, y, line); }
}
