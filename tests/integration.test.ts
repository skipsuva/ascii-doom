import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { WadFile, Wads } from '../src/wad/wad';
import { buildAssets } from '../src/wad/assets';
import { loadLevel, mapList } from '../src/level/index';

function loadWads(): Wads {
  const buf = readFileSync('public/wads/doom1.wad');
  const wads = new Wads();
  wads.add(new WadFile(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'doom1.wad'));
  return wads;
}

describe('assets <-> level cross checks', () => {
  const wads = loadWads();
  const assets = buildAssets(wads);
  it('every texture/flat referenced by every shareware map resolves', () => {
    const missingTex = new Set<string>();
    const missingFlat = new Set<string>();
    for (const name of mapList(wads)) {
      const level = loadLevel(wads, name);
      for (const s of level.sides) {
        for (const t of [s.top, s.bottom, s.mid]) {
          if (t !== '-' && !assets.texture(t)) missingTex.add(t);
        }
      }
      for (const sec of level.sectors) {
        for (const f of [sec.floorFlat, sec.ceilFlat]) {
          if (f !== 'F_SKY1' && !assets.flat(f)) missingFlat.add(f);
        }
      }
      expect(assets.skyTexture(name)).not.toBeNull();
    }
    expect([...missingTex]).toEqual([]);
    expect([...missingFlat]).toEqual([]);
  });
  it('monster/item sprites referenced by E1M1 things exist', () => {
    const level = loadLevel(wads, 'E1M1');
    const spriteFor: Record<number, string> = { 3004: 'POSS', 9: 'SPOS', 3001: 'TROO', 3002: 'SARG', 2035: 'BAR1', 2018: 'ARM1', 2012: 'MEDI', 2007: 'CLIP', 2001: 'SHOT', 2008: 'SHEL', 2014: 'BON1', 2015: 'BON2', 2011: 'STIM', 2048: 'AMMO' };
    const seen = new Set<string>();
    for (const t of level.things) {
      const sp = spriteFor[t.type];
      if (sp) seen.add(sp);
    }
    expect(seen.size).toBeGreaterThan(3);
    for (const sp of seen) {
      const def = assets.sprite(sp);
      expect(def, sp).not.toBeNull();
      expect(def!.frames[0], sp + ' frame A').toBeDefined();
    }
  });
});
