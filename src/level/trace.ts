// Blockmap ray traversal (P_PathTraverse) and the traces built on it: hitscan, checkSight, useTrace.
import { MF, type HitResult, type Level, type Line, type Mobj } from '../types';
import { BLOCK_SIZE, MAXRADIUS, USERANGE, newOpening, nextValidcount, openingInto, pointOnLineSide } from './common';

class Intercept {
  frac = 0;
  line: Line | null = null;
  thing: Mobj | null = null;
}

const pool: Intercept[] = [];
const order: Intercept[] = [];
let count = 0;
let tx = 0;
let ty = 0;
let tdx = 0;
let tdy = 0;
const op = newOpening();
const byFrac = (a: Intercept, b: Intercept) => a.frac - b.frac;

function addIntercept(frac: number, line: Line | null, thing: Mobj | null): void {
  let it = pool[count];
  if (!it) {
    it = new Intercept();
    pool[count] = it;
  }
  it.frac = frac;
  it.line = line;
  it.thing = thing;
  count++;
}

function addLine(line: Line): void {
  const s1 = pointOnLineSide(tx, ty, line);
  const s2 = pointOnLineSide(tx + tdx, ty + tdy, line);
  if (s1 === s2) return; // trace does not cross the (infinite) line
  // The line's own endpoints must straddle the trace, otherwise the crossing point lies outside the segment
  // (DOOM's P_PointOnDivlineSide test on both vertices). Without this, collinear neighbours shadow each other.
  const d1 = (line.v1.x - tx) * tdy - (line.v1.y - ty) * tdx;
  const d2 = (line.v2.x - tx) * tdy - (line.v2.y - ty) * tdx;
  if ((d1 > 0 && d2 > 0) || (d1 < 0 && d2 < 0)) return;
  const den = line.dy * tdx - line.dx * tdy;
  if (den === 0) return;
  const num = (line.v1.x - tx) * line.dy + (ty - line.v1.y) * line.dx;
  const frac = num / den;
  if (frac < 0 || frac > 1) return; // behind source or beyond range
  addIntercept(frac, line, null);
}

function addThing(th: Mobj): void {
  if (th.removed) return;
  const len2 = tdx * tdx + tdy * tdy;
  if (len2 === 0) return;
  const rx = th.x - tx;
  const ry = th.y - ty;
  const t = (rx * tdx + ry * tdy) / len2;
  const px = tx + t * tdx - th.x;
  const py = ty + t * tdy - th.y;
  const perp2 = px * px + py * py;
  const r = th.radius;
  if (perp2 > r * r) return;
  const back = Math.sqrt(r * r - perp2) / Math.sqrt(len2);
  if (t + back < 0) return; // entirely behind
  let frac = t - back; // entry point
  if (frac < 0) frac = 0;
  if (frac > 1) return;
  addIntercept(frac, null, th);
}

/**
 * Collect all line/thing intercepts along the segment (x1,y1)->(x2,y2), sorted by fraction into `order`.
 * Returns the count. Uses pooled objects; results are valid until the next call.
 */
export function collectIntercepts(level: Level, x1: number, y1: number, x2: number, y2: number, lines: boolean, things: boolean): number {
  const bm = level.blockmap;
  count = 0;
  tx = x1; ty = y1; tdx = x2 - x1; tdy = y2 - y1;
  const vc = nextValidcount();
  const bx = (x1 - bm.originX) / BLOCK_SIZE;
  const by = (y1 - bm.originY) / BLOCK_SIZE;
  const ex = (x2 - bm.originX) / BLOCK_SIZE;
  const ey = (y2 - bm.originY) / BLOCK_SIZE;
  let mapx = Math.floor(bx);
  let mapy = Math.floor(by);
  const endx = Math.floor(ex);
  const endy = Math.floor(ey);
  const ddx = ex - bx;
  const ddy = ey - by;
  const stepX = ddx > 0 ? 1 : ddx < 0 ? -1 : 0;
  const stepY = ddy > 0 ? 1 : ddy < 0 ? -1 : 0;
  const tDeltaX = ddx !== 0 ? 1 / Math.abs(ddx) : Infinity;
  const tDeltaY = ddy !== 0 ? 1 / Math.abs(ddy) : Infinity;
  let tMaxX = ddx > 0 ? (mapx + 1 - bx) * tDeltaX : ddx < 0 ? (bx - mapx) * tDeltaX : Infinity;
  let tMaxY = ddy > 0 ? (mapy + 1 - by) * tDeltaY : ddy < 0 ? (by - mapy) * tDeltaY : Infinity;
  const allLines = level.lines;
  for (let n = 0; n < 4096; n++) {
    if (mapx >= 0 && mapx < bm.columns && mapy >= 0 && mapy < bm.rows) {
      const idx = mapy * bm.columns + mapx;
      if (lines) {
        const list = bm.lines[idx];
        for (let i = 0; i < list.length; i++) {
          const line = allLines[list[i]];
          if (line.validcount === vc) continue;
          line.validcount = vc;
          addLine(line);
        }
      }
      if (things) {
        const set = bm.things[idx];
        if (set.size) for (const th of set) addThing(th);
      }
    }
    if (mapx === endx && mapy === endy) break;
    if (tMaxX < tMaxY) { tMaxX += tDeltaX; mapx += stepX; }
    else { tMaxY += tDeltaY; mapy += stepY; }
    if (stepX !== 0 && (stepX > 0 ? mapx > endx : mapx < endx)) break;
    if (stepY !== 0 && (stepY > 0 ? mapy > endy : mapy < endy)) break;
  }
  order.length = count;
  for (let i = 0; i < count; i++) order[i] = pool[i];
  if (count > 1) order.sort(byFrac);
  return count;
}

export function hitscan(level: Level, shooter: Mobj, angle: number, range: number, z: number): HitResult {
  const x1 = shooter.x;
  const y1 = shooter.y;
  const x2 = x1 + Math.cos(angle) * range;
  const y2 = y1 + Math.sin(angle) * range;
  const n = collectIntercepts(level, x1, y1, x2, y2, true, true);
  for (let i = 0; i < n; i++) {
    const it = order[i];
    if (it.line) {
      const line = it.line;
      let hit = false;
      if (!line.back) hit = true;
      else {
        openingInto(line, op);
        if (op.range <= 0 || z <= op.bottom || z >= op.top) hit = true;
      }
      if (hit) return { kind: 'wall', x: x1 + tdx * it.frac, y: y1 + tdy * it.frac, z, line, frac: it.frac };
    } else if (it.thing) {
      const th = it.thing;
      if (th === shooter || !(th.flags & MF.SHOOTABLE)) continue;
      const dist = it.frac * range;
      const half = th.height / 2;
      if (Math.abs(th.z + half - z) <= half + 0.6 * dist) {
        let hz = z;
        if (hz < th.z) hz = th.z;
        else if (hz > th.z + th.height) hz = th.z + th.height;
        return { kind: 'thing', x: x1 + tdx * it.frac, y: y1 + tdy * it.frac, z: hz, thing: th, frac: it.frac };
      }
    }
  }
  return { kind: 'none' };
}

export function checkSight(level: Level, a: Mobj, b: Mobj): boolean {
  const x1 = a.x;
  const y1 = a.y;
  const x2 = b.x;
  const y2 = b.y;
  if (x1 === x2 && y1 === y2) return true;
  const n = collectIntercepts(level, x1, y1, x2, y2, true, false);
  const za = a.z + a.height * 0.75;
  const zb = b.z + b.height / 2;
  for (let i = 0; i < n; i++) {
    const it = order[i];
    const line = it.line!;
    if (!line.back) return false;
    openingInto(line, op);
    if (op.range <= 0) return false;
    const fs = line.frontSector;
    const bs = line.backSector!;
    if (fs.floorH === bs.floorH && fs.ceilH === bs.ceilH) continue;
    const sz = za + (zb - za) * it.frac;
    if (sz <= op.bottom || sz >= op.top) return false;
  }
  return true;
}

export function useTrace(level: Level, user: Mobj): { line: Line; side: 0 | 1 } | 'noway' | null {
  const x1 = user.x;
  const y1 = user.y;
  const x2 = x1 + Math.cos(user.angle) * USERANGE;
  const y2 = y1 + Math.sin(user.angle) * USERANGE;
  const n = collectIntercepts(level, x1, y1, x2, y2, true, false);
  for (let i = 0; i < n; i++) {
    const line = order[i].line!;
    if (line.special) return { line, side: pointOnLineSide(x1, y1, line) };
    if (!line.back) return 'noway';
    openingInto(line, op);
    if (op.range <= 0) return 'noway';
  }
  return null;
}

const scratchThings: Mobj[] = [];

export function thingsInRadius(level: Level, x: number, y: number, r: number, cb: (m: Mobj) => boolean | void): void {
  const bm = level.blockmap;
  let bx1 = Math.floor((x - r - MAXRADIUS - bm.originX) / BLOCK_SIZE);
  let bx2 = Math.floor((x + r + MAXRADIUS - bm.originX) / BLOCK_SIZE);
  let by1 = Math.floor((y - r - MAXRADIUS - bm.originY) / BLOCK_SIZE);
  let by2 = Math.floor((y + r + MAXRADIUS - bm.originY) / BLOCK_SIZE);
  if (bx1 < 0) bx1 = 0;
  if (by1 < 0) by1 = 0;
  if (bx2 >= bm.columns) bx2 = bm.columns - 1;
  if (by2 >= bm.rows) by2 = bm.rows - 1;
  scratchThings.length = 0;
  for (let by = by1; by <= by2; by++) {
    for (let bx = bx1; bx <= bx2; bx++) {
      const set = bm.things[by * bm.columns + bx];
      if (set.size) for (const th of set) scratchThings.push(th);
    }
  }
  for (let i = 0; i < scratchThings.length; i++) {
    const th = scratchThings[i];
    if (th.removed) continue;
    const dx = th.x - x;
    const dy = th.y - y;
    const rr = r + th.radius;
    if (dx * dx + dy * dy <= rr * rr) {
      if (cb(th) === false) break;
    }
  }
  scratchThings.length = 0;
}

export function linesInBox(level: Level, minx: number, miny: number, maxx: number, maxy: number, cb: (l: Line) => boolean | void): void {
  const bm = level.blockmap;
  let bx1 = Math.floor((minx - bm.originX) / BLOCK_SIZE);
  let bx2 = Math.floor((maxx - bm.originX) / BLOCK_SIZE);
  let by1 = Math.floor((miny - bm.originY) / BLOCK_SIZE);
  let by2 = Math.floor((maxy - bm.originY) / BLOCK_SIZE);
  if (bx1 < 0) bx1 = 0;
  if (by1 < 0) by1 = 0;
  if (bx2 >= bm.columns) bx2 = bm.columns - 1;
  if (by2 >= bm.rows) by2 = bm.rows - 1;
  const vc = nextValidcount();
  const allLines = level.lines;
  for (let by = by1; by <= by2; by++) {
    for (let bx = bx1; bx <= bx2; bx++) {
      const list = bm.lines[by * bm.columns + bx];
      for (let i = 0; i < list.length; i++) {
        const line = allLines[list[i]];
        if (line.validcount === vc) continue;
        line.validcount = vc;
        if (maxx <= line.bbox[0] || minx >= line.bbox[2] || maxy <= line.bbox[1] || miny >= line.bbox[3]) continue;
        if (cb(line) === false) return;
      }
    }
  }
}
