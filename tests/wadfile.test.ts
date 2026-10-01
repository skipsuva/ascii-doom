import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { WadFile, Wads } from '../src/wad/wad';

function loadDoom1(): WadFile {
  const buf = readFileSync('public/wads/doom1.wad');
  return new WadFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'doom1.wad');
}

describe('WadFile', () => {
  const wad = loadDoom1();
  it('parses the directory', () => {
    expect(wad.type).toBe('IWAD');
    expect(wad.lumps.length).toBeGreaterThan(1000);
    expect(wad.lump('PLAYPAL')?.size).toBe(14 * 768);
    expect(wad.lump('COLORMAP')?.size).toBeGreaterThanOrEqual(34 * 256);
    expect(wad.lump('E1M1')).toBeDefined();
    expect(wad.lump('NOPE_X')).toBeUndefined();
  });
  it('lists maps and map lumps', () => {
    const wads = new Wads();
    wads.add(wad);
    expect(wads.mapNames()).toEqual(['E1M1', 'E1M2', 'E1M3', 'E1M4', 'E1M5', 'E1M6', 'E1M7', 'E1M8', 'E1M9']);
    const ml = wads.mapLumps('E1M1')!;
    expect([...ml.keys()]).toEqual(['THINGS', 'LINEDEFS', 'SIDEDEFS', 'VERTEXES', 'SEGS', 'SSECTORS', 'NODES', 'SECTORS', 'REJECT', 'BLOCKMAP']);
    expect(ml.get('THINGS')!.size % 10).toBe(0);
    expect(wads.mapLumps('MAP01')).toBeNull();
  });
  it('scans marker ranges', () => {
    const wads = new Wads();
    wads.add(wad);
    const flats = wads.lumpsBetween('F_START', 'F_END', 'FF_START', 'FF_END');
    expect(flats.length).toBeGreaterThan(50);
    expect(flats.every(l => l.size === 4096)).toBe(true);
    const sprites = wads.lumpsBetween('S_START', 'S_END', 'SS_START', 'SS_END');
    expect(sprites.some(l => l.name === 'TROOA1')).toBe(true);
  });
});
