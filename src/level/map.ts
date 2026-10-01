// Raw map lump parsing (little-endian DOOM formats). No runtime linking here; see level.ts.
import type { Lump } from '../wad/wad';
import { readName8 } from '../wad/wad';

export interface RawThing { x: number; y: number; angle: number; type: number; flags: number }
export interface RawLinedef { v1: number; v2: number; flags: number; special: number; tag: number; right: number; left: number }
export interface RawSidedef { xoff: number; yoff: number; top: string; bottom: string; mid: string; sector: number }
export interface RawVertex { x: number; y: number }
export interface RawSeg { v1: number; v2: number; angle: number; linedef: number; side: number; offset: number }
export interface RawSubsector { numSegs: number; firstSeg: number }
export interface RawNode {
  x: number; y: number; dx: number; dy: number;
  bboxRight: number[]; bboxLeft: number[];
  childRight: number; childLeft: number;
}
export interface RawSector { floorH: number; ceilH: number; floorFlat: string; ceilFlat: string; light: number; special: number; tag: number }

export function parseThings(l: Lump): RawThing[] {
  const dv = l.view();
  const n = Math.floor(l.size / 10);
  const out: RawThing[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 10;
    out[i] = {
      x: dv.getInt16(o, true), y: dv.getInt16(o + 2, true), angle: dv.getInt16(o + 4, true),
      type: dv.getInt16(o + 6, true), flags: dv.getInt16(o + 8, true),
    };
  }
  return out;
}

export function parseLinedefs(l: Lump): RawLinedef[] {
  const dv = l.view();
  const n = Math.floor(l.size / 14);
  const out: RawLinedef[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 14;
    const right = dv.getUint16(o + 10, true);
    const left = dv.getUint16(o + 12, true);
    out[i] = {
      v1: dv.getUint16(o, true), v2: dv.getUint16(o + 2, true), flags: dv.getUint16(o + 4, true),
      special: dv.getUint16(o + 6, true), tag: dv.getUint16(o + 8, true),
      right: right === 0xffff ? -1 : right, left: left === 0xffff ? -1 : left,
    };
  }
  return out;
}

export function parseSidedefs(l: Lump): RawSidedef[] {
  const dv = l.view();
  const bytes = l.wad.bytes;
  const base = l.offset;
  const n = Math.floor(l.size / 30);
  const out: RawSidedef[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 30;
    out[i] = {
      xoff: dv.getInt16(o, true), yoff: dv.getInt16(o + 2, true),
      top: readName8(bytes, base + o + 4), bottom: readName8(bytes, base + o + 12), mid: readName8(bytes, base + o + 20),
      sector: dv.getUint16(o + 28, true),
    };
  }
  return out;
}

export function parseVertexes(l: Lump): RawVertex[] {
  const dv = l.view();
  const n = Math.floor(l.size / 4);
  const out: RawVertex[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = { x: dv.getInt16(i * 4, true), y: dv.getInt16(i * 4 + 2, true) };
  return out;
}

export function parseSegs(l: Lump): RawSeg[] {
  const dv = l.view();
  const n = Math.floor(l.size / 12);
  const out: RawSeg[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 12;
    out[i] = {
      v1: dv.getUint16(o, true), v2: dv.getUint16(o + 2, true), angle: dv.getUint16(o + 4, true),
      linedef: dv.getUint16(o + 6, true), side: dv.getUint16(o + 8, true), offset: dv.getInt16(o + 10, true),
    };
  }
  return out;
}

export function parseSubsectors(l: Lump): RawSubsector[] {
  const dv = l.view();
  const n = Math.floor(l.size / 4);
  const out: RawSubsector[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = { numSegs: dv.getUint16(i * 4, true), firstSeg: dv.getUint16(i * 4 + 2, true) };
  return out;
}

export function parseNodes(l: Lump): RawNode[] {
  const dv = l.view();
  const n = Math.floor(l.size / 28);
  const out: RawNode[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 28;
    out[i] = {
      x: dv.getInt16(o, true), y: dv.getInt16(o + 2, true), dx: dv.getInt16(o + 4, true), dy: dv.getInt16(o + 6, true),
      bboxRight: [dv.getInt16(o + 8, true), dv.getInt16(o + 10, true), dv.getInt16(o + 12, true), dv.getInt16(o + 14, true)],
      bboxLeft: [dv.getInt16(o + 16, true), dv.getInt16(o + 18, true), dv.getInt16(o + 20, true), dv.getInt16(o + 22, true)],
      childRight: dv.getUint16(o + 24, true), childLeft: dv.getUint16(o + 26, true),
    };
  }
  return out;
}

export function parseSectors(l: Lump): RawSector[] {
  const dv = l.view();
  const bytes = l.wad.bytes;
  const base = l.offset;
  const n = Math.floor(l.size / 26);
  const out: RawSector[] = new Array(n);
  for (let i = 0; i < n; i++) {
    const o = i * 26;
    out[i] = {
      floorH: dv.getInt16(o, true), ceilH: dv.getInt16(o + 2, true),
      floorFlat: readName8(bytes, base + o + 4), ceilFlat: readName8(bytes, base + o + 12),
      light: dv.getInt16(o + 20, true), special: dv.getUint16(o + 22, true), tag: dv.getUint16(o + 24, true),
    };
  }
  return out;
}
