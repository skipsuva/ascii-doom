import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildAssets } from '../src/wad/assets';
import { WadFile, Wads } from '../src/wad/wad';

function loadWads(): Wads {
  const buf = readFileSync('public/wads/doom1.wad');
  const wad = new WadFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'doom1.wad');
  const wads = new Wads();
  wads.add(wad);
  return wads;
}

const wads = loadWads();
const assets = buildAssets(wads);

describe('WAD container', () => {
  it('parses the shareware IWAD directory', () => {
    expect(wads.iwad?.type).toBe('IWAD');
    expect(wads.iwad!.lumps.length).toBeGreaterThan(1000);
    expect(wads.mapNames()).toEqual(['E1M1', 'E1M2', 'E1M3', 'E1M4', 'E1M5', 'E1M6', 'E1M7', 'E1M8', 'E1M9']);
  });
});

describe('palette', () => {
  it('has PLAYPAL and COLORMAP', () => {
    expect(wads.lump('PLAYPAL')!.size).toBe(14 * 768);
    expect(assets.palette.length).toBe(768);
    expect(wads.lump('COLORMAP')!.size).toBeGreaterThanOrEqual(34 * 256);
    expect(assets.colormap.length).toBe(34 * 256);
    expect(assets.lum.length).toBe(256);
    // colormap 0 is identity-ish for bright colors; index 4 (white) is brighter than index 0 (black)
    expect(assets.lum[4]).toBeGreaterThan(assets.lum[0]);
  });
});

describe('textures', () => {
  it('composites TEXTURE1 entries', () => {
    expect(assets.textureNames.length).toBeGreaterThan(100);
    const t = assets.texture('STARTAN3')!;
    expect(t).not.toBeNull();
    expect(t.width).toBe(128);
    expect(t.height).toBe(128);
    expect(t.pixels.some(p => p !== 0)).toBe(true);
    expect(t.mask).toBeNull();
    expect(assets.texture('-')).toBeNull();
    expect(assets.texture('NOPE_NOPE')).toBeNull();
    expect(assets.texture('startan3')).toBe(t); // cached, case-insensitive
  });
  it('resolves the sky', () => {
    const sky = assets.skyTexture('E1M1')!;
    expect(sky).not.toBeNull();
    expect(sky.width).toBe(256);
  });
  it('pairs switch textures', () => {
    expect(assets.switchPair('SW1BRCOM')).toBe('SW2BRCOM');
    expect(assets.switchPair('SW2BRCOM')).toBe('SW1BRCOM');
    expect(assets.switchPair('STARTAN3')).toBeNull();
  });
});

describe('flats', () => {
  it('loads flats and animation groups', () => {
    expect(assets.flat('NUKAGE1')!.length).toBe(4096);
    expect(assets.flat('FLOOR4_8')!.length).toBe(4096);
    expect(assets.flat('NOPE')).toBeNull();
    expect(assets.flatAnimGroups).toContainEqual(['NUKAGE1', 'NUKAGE2', 'NUKAGE3']);
    expect(assets.textureAnimGroups.length).toBeGreaterThan(0);
  });
});

describe('sprites', () => {
  it('builds rotation tables', () => {
    const troo = assets.sprite('TROO')!;
    expect(troo).not.toBeNull();
    const a = troo.frames[0]!;
    expect(a.rotates).toBe(true);
    expect(a.rot.length).toBe(8);
    expect(a.flip[0]).toBe(false);
    expect(a.flip[7]).toBe(true);
    expect(a.rot[0].width).toBeGreaterThan(10);
    expect(a.rot[0].mask.some(m => m === 1)).toBe(true);
    // pistol weapon sprite has no rotations
    const pisg = assets.sprite('PISG')!;
    expect(pisg.frames[0]!.rotates).toBe(false);
    expect(pisg.frames[0]!.rot.length).toBe(1);
    expect(assets.sprite('ZZZZ')).toBeNull();
  });
});

describe('sounds and pictures', () => {
  it('decodes DMX sounds', () => {
    const s = assets.sound('DSPISTOL')!;
    expect(s).not.toBeNull();
    expect(s.sampleRate).toBe(11025);
    expect(s.samples.length).toBeGreaterThan(1000);
    expect(assets.sound('pistol')).toBe(s);
    expect(assets.sound('DSNOPE')).toBeNull();
  });
  it('decodes TITLEPIC', () => {
    const p = assets.picture('TITLEPIC')!;
    expect(p.width).toBe(320);
    expect(p.height).toBe(200);
    expect(assets.picture('E1M1')).toBeNull();
  });
});
