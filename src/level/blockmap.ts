// BLOCKMAP parsing with validation; falls back to building one from the linedefs.
import type { Blockmap, Line, Mobj } from '../types';
import type { Lump } from '../wad/wad';
import { BLOCK_SIZE, boxOnLineSide } from './common';

export interface Bounds { minx: number; miny: number; maxx: number; maxy: number }

function makeThingSets(n: number): Set<Mobj>[] {
  const out: Set<Mobj>[] = new Array(n);
  for (let i = 0; i < n; i++) out[i] = new Set<Mobj>();
  return out;
}

export function parseOrBuildBlockmap(lump: Lump | undefined, lines: Line[], bounds: Bounds): Blockmap {
  const parsed = lump ? tryParse(lump, lines) : null;
  return parsed ?? buildBlockmap(lines, bounds);
}

function tryParse(lump: Lump, lines: Line[]): Blockmap | null {
  if (lump.size < 8) return null;
  try {
    const dv = lump.view();
    const originX = dv.getInt16(0, true);
    const originY = dv.getInt16(2, true);
    const columns = dv.getUint16(4, true);
    const rows = dv.getUint16(6, true);
    const n = columns * rows;
    if (n <= 0 || lump.size < 8 + n * 2) return null;
    const out: Int32Array[] = new Array(n);
    const tmp: number[] = [];
    for (let i = 0; i < n; i++) {
      let off = dv.getUint16(8 + i * 2, true) * 2;
      if (off + 2 > lump.size) return null;
      tmp.length = 0;
      let first = true;
      for (;;) {
        if (off + 2 > lump.size) return null;
        const v = dv.getUint16(off, true);
        off += 2;
        if (v === 0xffff) break;
        if (first && v === 0) { first = false; continue; } // leading delimiter
        first = false;
        if (v >= lines.length) return null;
        tmp.push(v);
        if (tmp.length > lines.length) return null;
      }
      out[i] = Int32Array.from(tmp);
    }
    return { originX, originY, columns, rows, lines: out, things: makeThingSets(n) };
  } catch {
    return null;
  }
}

export function buildBlockmap(lines: Line[], bounds: Bounds): Blockmap {
  const originX = Math.floor(bounds.minx) - 8;
  const originY = Math.floor(bounds.miny) - 8;
  const columns = Math.max(1, Math.floor((bounds.maxx - originX) / BLOCK_SIZE) + 1);
  const rows = Math.max(1, Math.floor((bounds.maxy - originY) / BLOCK_SIZE) + 1);
  const n = columns * rows;
  const lists: number[][] = new Array(n);
  for (let i = 0; i < n; i++) lists[i] = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const bx1 = Math.max(0, Math.floor((line.bbox[0] - originX) / BLOCK_SIZE));
    const bx2 = Math.min(columns - 1, Math.floor((line.bbox[2] - originX) / BLOCK_SIZE));
    const by1 = Math.max(0, Math.floor((line.bbox[1] - originY) / BLOCK_SIZE));
    const by2 = Math.min(rows - 1, Math.floor((line.bbox[3] - originY) / BLOCK_SIZE));
    for (let by = by1; by <= by2; by++) {
      for (let bx = bx1; bx <= bx2; bx++) {
        const cx = originX + bx * BLOCK_SIZE;
        const cy = originY + by * BLOCK_SIZE;
        if (boxOnLineSide(cx, cy, cx + BLOCK_SIZE, cy + BLOCK_SIZE, line) === -1) lists[by * columns + bx].push(li);
      }
    }
  }
  return { originX, originY, columns, rows, lines: lists.map(l => Int32Array.from(l)), things: makeThingSets(n) };
}
