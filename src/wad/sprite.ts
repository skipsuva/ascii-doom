// Sprite lump index (S_START..S_END) and lazy SpriteDef construction.
import type { Patch, SpriteDef, SpriteFrame } from '../types';
import { decodePatch, EMPTY_PATCH } from './patch';
import type { Lump, Wads } from './wad';

/** slots[0] = rotation 0 (no rotations), slots[1..8] = rotations 1..8 */
interface FrameSlots { lumps: (Lump | null)[]; flips: boolean[] }

function frameIndex(c: string): number {
  const i = c.charCodeAt(0) - 65; // A=0 .. Z=25, [=26, \=27, ]=28
  return i >= 0 && i <= 28 ? i : -1;
}
function rotIndex(c: string): number {
  const i = c.charCodeAt(0) - 48;
  return i >= 0 && i <= 8 ? i : -1;
}

export class SpriteStore {
  private index = new Map<string, FrameSlots[]>();
  private cache = new Map<string, SpriteDef | null>();
  private patchCache = new Map<Lump, Patch | null>();

  constructor(wads: Wads) {
    for (const l of wads.lumpsBetween('S_START', 'S_END', 'SS_START', 'SS_END')) this.addLump(l);
  }

  private addLump(l: Lump): void {
    const n = l.name;
    if (n.length !== 6 && n.length !== 8) return;
    const f1 = frameIndex(n[4]), r1 = rotIndex(n[5]);
    if (f1 < 0 || r1 < 0) return;
    let f2 = -1, r2 = -1;
    if (n.length === 8) {
      f2 = frameIndex(n[6]); r2 = rotIndex(n[7]);
      if (f2 < 0 || r2 < 0) return;
    }
    const name4 = n.slice(0, 4);
    this.set(name4, f1, r1, l, false);
    if (f2 >= 0) this.set(name4, f2, r2, l, true);
  }

  private set(name4: string, frame: number, rot: number, lump: Lump, flip: boolean): void {
    let frames = this.index.get(name4);
    if (!frames) { frames = []; this.index.set(name4, frames); }
    let fs = frames[frame];
    if (!fs) { fs = { lumps: new Array(9).fill(null), flips: new Array(9).fill(false) }; frames[frame] = fs; }
    fs.lumps[rot] = lump;
    fs.flips[rot] = flip;
  }

  has(name4: string): boolean { return this.index.has(name4.toUpperCase()); }

  names(): string[] { return [...this.index.keys()]; }

  private patch(l: Lump | null): Patch | null {
    if (!l) return null;
    const hit = this.patchCache.get(l);
    if (hit !== undefined) return hit;
    const p = decodePatch(l.data());
    this.patchCache.set(l, p);
    return p;
  }

  get(name4: string): SpriteDef | null {
    const key = name4.toUpperCase();
    const hit = this.cache.get(key);
    if (hit !== undefined) return hit;
    const slots = this.index.get(key);
    let def: SpriteDef | null = null;
    if (slots) {
      const frames: (SpriteFrame | undefined)[] = [];
      let any = false;
      for (let f = 0; f < slots.length; f++) {
        const fs = slots[f];
        if (!fs) continue;
        let rotates = false;
        for (let r = 1; r <= 8; r++) if (fs.lumps[r]) { rotates = true; break; }
        if (rotates) {
          // first available rotation (or rotation 0) fills missing slots
          let fillIdx = -1;
          for (let r = 1; r <= 8; r++) if (fs.lumps[r]) { fillIdx = r; break; }
          if (fs.lumps[0]) fillIdx = 0;
          const rot: Patch[] = [], flip: boolean[] = [];
          for (let r = 1; r <= 8; r++) {
            const idx = fs.lumps[r] ? r : fillIdx;
            rot.push(this.patch(fs.lumps[idx]) ?? EMPTY_PATCH);
            flip.push(fs.flips[idx]);
          }
          frames[f] = { rot, flip, rotates: true };
          any = true;
        } else if (fs.lumps[0]) {
          frames[f] = { rot: [this.patch(fs.lumps[0]) ?? EMPTY_PATCH], flip: [fs.flips[0]], rotates: false };
          any = true;
        }
      }
      if (any) def = { name: key, frames };
    }
    this.cache.set(key, def);
    return def;
  }
}
