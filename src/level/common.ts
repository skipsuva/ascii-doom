// Shared geometry helpers (DOOM p_maputl.c equivalents).
import type { BspNode, Line, Opening } from '../types';

export const BLOCK_SIZE = 128;
export const MAXRADIUS = 32;
export const MAXMOVE = 30;
export const MAXSTEP = 24;
export const USERANGE = 64;

let validcount = 1;
export function nextValidcount(): number {
  validcount++;
  if (validcount > 0x3ffffff0) validcount = 1;
  return validcount;
}

/** 0 = front/right of the directed line (ox,oy)+(dx,dy), 1 = back/left (points exactly on the line count as back). */
export function sideOf(x: number, y: number, ox: number, oy: number, dx: number, dy: number): 0 | 1 {
  if (dx === 0) {
    if (x <= ox) return dy > 0 ? 1 : 0;
    return dy < 0 ? 1 : 0;
  }
  if (dy === 0) {
    if (y <= oy) return dx < 0 ? 1 : 0;
    return dx > 0 ? 1 : 0;
  }
  const left = dy * (x - ox);
  const right = (y - oy) * dx;
  return right < left ? 0 : 1;
}

export function pointOnLineSide(x: number, y: number, line: Line): 0 | 1 {
  return sideOf(x, y, line.v1.x, line.v1.y, line.dx, line.dy);
}

export function pointOnNodeSide(x: number, y: number, node: BspNode): 0 | 1 {
  return sideOf(x, y, node.x, node.y, node.dx, node.dy);
}

/** DOOM P_BoxOnLineSide: 0/1 if the box is entirely on that side, -1 if it straddles the line. */
export function boxOnLineSide(minx: number, miny: number, maxx: number, maxy: number, line: Line): -1 | 0 | 1 {
  let p1: number;
  let p2: number;
  switch (line.slopeType) {
    case 0: // horizontal
      p1 = maxy > line.v1.y ? 1 : 0;
      p2 = miny > line.v1.y ? 1 : 0;
      if (line.dx < 0) { p1 ^= 1; p2 ^= 1; }
      break;
    case 1: // vertical
      p1 = maxx < line.v1.x ? 1 : 0;
      p2 = minx < line.v1.x ? 1 : 0;
      if (line.dy < 0) { p1 ^= 1; p2 ^= 1; }
      break;
    case 2: // positive slope
      p1 = pointOnLineSide(minx, maxy, line);
      p2 = pointOnLineSide(maxx, miny, line);
      break;
    default: // negative slope
      p1 = pointOnLineSide(maxx, maxy, line);
      p2 = pointOnLineSide(minx, miny, line);
      break;
  }
  return p1 === p2 ? (p1 as 0 | 1) : -1;
}

/** DOOM P_LineOpening written into `out` (no allocation). One-sided lines have range 0. */
export function openingInto(line: Line, out: Opening): void {
  const front = line.frontSector;
  const back = line.backSector;
  if (!back) {
    out.top = front.ceilH;
    out.bottom = front.floorH;
    out.range = 0;
    out.lowFloor = front.floorH;
    return;
  }
  out.top = front.ceilH < back.ceilH ? front.ceilH : back.ceilH;
  if (front.floorH > back.floorH) {
    out.bottom = front.floorH;
    out.lowFloor = back.floorH;
  } else {
    out.bottom = back.floorH;
    out.lowFloor = front.floorH;
  }
  out.range = out.top - out.bottom;
}

export function newOpening(): Opening {
  return { top: 0, bottom: 0, range: 0, lowFloor: 0 };
}
