// WAD container parsing: WadFile (one file) and Wads (a stack of IWAD + PWADs, last loaded wins).

export interface Lump {
  name: string;
  offset: number;
  size: number;
  wad: WadFile;
  /** Index of this lump within its own WAD's directory. */
  index: number;
  data(): Uint8Array;
  view(): DataView;
}

export function readName8(bytes: Uint8Array, off: number): string {
  let s = '';
  for (let i = 0; i < 8; i++) {
    const c = bytes[off + i];
    if (c === 0) break;
    s += String.fromCharCode(c);
  }
  return s.toUpperCase();
}

export class WadFile {
  readonly type: 'IWAD' | 'PWAD';
  readonly lumps: Lump[] = [];
  readonly bytes: Uint8Array;
  readonly buffer: ArrayBuffer;
  private byName = new Map<string, number>(); // name -> last index

  constructor(buffer: ArrayBuffer, readonly name = 'wad') {
    this.buffer = buffer;
    this.bytes = new Uint8Array(buffer);
    const dv = new DataView(buffer);
    const id = String.fromCharCode(...this.bytes.subarray(0, 4));
    if (id !== 'IWAD' && id !== 'PWAD') throw new Error(`Not a WAD file (id=${JSON.stringify(id)})`);
    this.type = id;
    const numLumps = dv.getInt32(4, true);
    const dirOfs = dv.getInt32(8, true);
    for (let i = 0; i < numLumps; i++) {
      const e = dirOfs + i * 16;
      const offset = dv.getInt32(e, true);
      const size = dv.getInt32(e + 4, true);
      const lname = readName8(this.bytes, e + 8);
      const wad = this;
      const lump: Lump = {
        name: lname, offset, size, wad, index: i,
        data: () => wad.bytes.subarray(offset, offset + size),
        view: () => new DataView(wad.buffer, offset, size),
      };
      this.lumps.push(lump);
      this.byName.set(lname, i);
    }
  }

  lumpIndex(name: string): number {
    const i = this.byName.get(name.toUpperCase());
    return i === undefined ? -1 : i;
  }

  lump(name: string): Lump | undefined {
    const i = this.lumpIndex(name);
    return i < 0 ? undefined : this.lumps[i];
  }
}

const MAP_RE = /^(E\dM\d|MAP\d\d)$/;

export class Wads {
  readonly wads: WadFile[] = [];

  add(wad: WadFile): void {
    this.wads.push(wad);
  }

  get iwad(): WadFile | undefined {
    return this.wads.find(w => w.type === 'IWAD') ?? this.wads[0];
  }

  /** Last-loaded WAD wins. */
  lump(name: string): Lump | undefined {
    for (let i = this.wads.length - 1; i >= 0; i--) {
      const l = this.wads[i].lump(name);
      if (l) return l;
    }
    return undefined;
  }

  has(name: string): boolean {
    return this.lump(name) !== undefined;
  }

  /** All lumps of all wads in load order (useful for marker scans). */
  allLumps(): Lump[] {
    const out: Lump[] = [];
    for (const w of this.wads) out.push(...w.lumps);
    return out;
  }

  /**
   * Lumps strictly between start/end markers, scanning each WAD separately (later WADs later in the result so
   * "last wins" semantics hold when the caller builds a Map). Nested markers like F1_START/F1_END are skipped
   * (they are zero-size and match `skipMarkers`).
   */
  lumpsBetween(startMarker: string, endMarker: string, altStart?: string, altEnd?: string): Lump[] {
    const out: Lump[] = [];
    for (const w of this.wads) {
      let inside = false;
      for (const l of w.lumps) {
        if (l.name === startMarker || (altStart && l.name === altStart)) { inside = true; continue; }
        if (l.name === endMarker || (altEnd && l.name === altEnd)) { inside = false; continue; }
        if (inside) {
          if (l.size === 0) continue; // nested markers (F1_START, S_START duplicates, etc.)
          out.push(l);
        }
      }
    }
    return out;
  }

  /** Map marker names across all WADs, later WADs override; sorted ExMy then MAPxx. */
  mapNames(): string[] {
    const set = new Set<string>();
    for (const w of this.wads) {
      for (let i = 0; i < w.lumps.length - 1; i++) {
        const l = w.lumps[i];
        if (MAP_RE.test(l.name) && w.lumps[i + 1].name === 'THINGS') set.add(l.name);
      }
    }
    return [...set].sort();
  }

  /** Lumps following a map marker (THINGS..BLOCKMAP), from the last WAD that defines the map. */
  mapLumps(mapName: string): Map<string, Lump> | null {
    for (let wi = this.wads.length - 1; wi >= 0; wi--) {
      const w = this.wads[wi];
      const idx = w.lumps.findIndex((l, i) => l.name === mapName.toUpperCase() && w.lumps[i + 1]?.name === 'THINGS');
      if (idx < 0) continue;
      const out = new Map<string, Lump>();
      for (let i = idx + 1; i < w.lumps.length; i++) {
        const l = w.lumps[i];
        if (MAP_RE.test(l.name)) break;
        if (!['THINGS', 'LINEDEFS', 'SIDEDEFS', 'VERTEXES', 'SEGS', 'SSECTORS', 'NODES', 'SECTORS', 'REJECT', 'BLOCKMAP'].includes(l.name)) break;
        out.set(l.name, l);
      }
      return out;
    }
    return null;
  }
}
