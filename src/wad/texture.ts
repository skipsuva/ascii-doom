// PNAMES + TEXTURE1/TEXTURE2 → lazily composited wall textures (column-major).
import type { Patch, Texture } from '../types';
import { decodePatch } from './patch';
import { readName8, type Wads } from './wad';

interface TexPatchDef { originX: number; originY: number; patch: number }
interface TexDef { name: string; width: number; height: number; patches: TexPatchDef[] }

export class TextureStore {
  private defs = new Map<string, TexDef>();
  private cache = new Map<string, Texture | null>();
  private patchCache = new Map<string, Patch | null>();
  readonly pnames: string[] = [];
  /** texture names in definition order (TEXTURE1 then TEXTURE2) */
  readonly names: string[] = [];

  constructor(private wads: Wads) {
    const pn = wads.lump('PNAMES');
    if (pn && pn.size >= 4) {
      const bytes = pn.data();
      const count = pn.view().getInt32(0, true);
      for (let i = 0; i < count && 4 + i * 8 + 8 <= bytes.length; i++) this.pnames.push(readName8(bytes, 4 + i * 8));
    }
    for (const lumpName of ['TEXTURE1', 'TEXTURE2']) {
      const l = wads.lump(lumpName);
      if (l && l.size >= 4) this.parseTextureLump(l.data());
    }
  }

  private parseTextureLump(bytes: Uint8Array): void {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const n = dv.getInt32(0, true);
    if (n <= 0 || n > 65536) return;
    for (let i = 0; i < n; i++) {
      if (4 + i * 4 + 4 > bytes.length) break;
      const ofs = dv.getInt32(4 + i * 4, true);
      if (ofs < 0 || ofs + 22 > bytes.length) continue;
      const name = readName8(bytes, ofs);
      const width = dv.getInt16(ofs + 12, true);
      const height = dv.getInt16(ofs + 14, true);
      const patchCount = dv.getInt16(ofs + 20, true);
      const patches: TexPatchDef[] = [];
      for (let j = 0; j < patchCount; j++) {
        const p = ofs + 22 + j * 10;
        if (p + 10 > bytes.length) break;
        patches.push({ originX: dv.getInt16(p, true), originY: dv.getInt16(p + 2, true), patch: dv.getInt16(p + 4, true) });
      }
      if (width <= 0 || height <= 0 || !name) continue;
      if (!this.defs.has(name)) this.names.push(name);
      this.defs.set(name, { name, width, height, patches });
    }
  }

  has(name: string): boolean {
    const key = name.toUpperCase();
    return key !== '-' && this.defs.has(key);
  }

  get(name: string): Texture | null {
    const key = name.toUpperCase();
    if (key === '-' || key === '') return null;
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const def = this.defs.get(key);
    const tex = def ? this.composite(def) : null;
    this.cache.set(key, tex);
    return tex;
  }

  private getPatch(name: string): Patch | null {
    const hit = this.patchCache.get(name);
    if (hit !== undefined) return hit;
    const lump = this.wads.lump(name);
    const patch = lump ? decodePatch(lump.data()) : null;
    this.patchCache.set(name, patch);
    return patch;
  }

  private composite(def: TexDef): Texture {
    const w = def.width, h = def.height;
    const pixels = new Uint8Array(w * h);
    const mask = new Uint8Array(w * h);
    for (const tp of def.patches) {
      const pname = this.pnames[tp.patch];
      if (!pname) continue;
      const patch = this.getPatch(pname);
      if (!patch) continue;
      const ph = patch.height;
      for (let x = 0; x < patch.width; x++) {
        const px = tp.originX + x;
        if (px < 0 || px >= w) continue;
        const scol = x * ph, dcol = px * h;
        for (let y = 0; y < ph; y++) {
          if (!patch.mask[scol + y]) continue;
          const py = tp.originY + y;
          if (py < 0 || py >= h) continue;
          pixels[dcol + py] = patch.pixels[scol + y];
          mask[dcol + py] = 1;
        }
      }
    }
    let full = true;
    for (let i = 0; i < mask.length; i++) if (!mask[i]) { full = false; break; }
    return { name: def.name, width: w, height: h, pixels, mask: full ? null : mask };
  }
}
