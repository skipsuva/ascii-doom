// Asset aggregator: implements the Assets contract from src/types.ts on top of a Wads stack.
import type { Assets, DecodedSound, Patch, SpriteDef, Texture } from '../types';
import { buildAnims, switchPair } from './anim';
import { loadFlats } from './flat';
import { loadPalette } from './palette';
import { decodePatch } from './patch';
import { decodeDmx, normalizeSoundName } from './sound';
import { SpriteStore } from './sprite';
import { TextureStore } from './texture';
import type { Wads } from './wad';

export interface AssetsEx extends Assets {
  /** all wall texture names in definition order */
  textureNames: string[];
  /** all sprite names (4 chars) */
  spriteNames: string[];
  /** all 14 palettes (14*768) for tint effects */
  playpal: Uint8Array;
}

export function buildAssets(wads: Wads): AssetsEx {
  const pal = loadPalette(wads);
  const textures = new TextureStore(wads);
  const flats = loadFlats(wads);
  const sprites = new SpriteStore(wads);
  const sounds = new Map<string, DecodedSound | null>();
  const pictures = new Map<string, Patch | null>();
  const anims = buildAnims(n => textures.has(n), n => flats.has(n));

  function texture(name: string): Texture | null {
    return textures.get(name);
  }
  function flat(name: string): Uint8Array | null {
    return flats.get(name.toUpperCase()) ?? null;
  }
  function sprite(name4: string): SpriteDef | null {
    return sprites.get(name4);
  }
  function picture(name: string): Patch | null {
    const key = name.toUpperCase();
    const hit = pictures.get(key);
    if (hit !== undefined) return hit;
    const lump = wads.lump(key);
    const p = lump && lump.size > 8 ? decodePatch(lump.data()) : null;
    pictures.set(key, p);
    return p;
  }
  function sound(name: string): DecodedSound | null {
    const candidates = normalizeSoundName(name);
    const key = candidates[0];
    const hit = sounds.get(key);
    if (hit !== undefined) return hit;
    let decoded: DecodedSound | null = null;
    for (const c of candidates) {
      const lump = wads.lump(c);
      if (lump && lump.size > 8) {
        decoded = decodeDmx(lump.data());
        if (decoded) break;
      }
    }
    sounds.set(key, decoded);
    return decoded;
  }
  function skyTexture(mapName: string): Texture | null {
    const m = /^E(\d)M\d$/i.exec(mapName);
    if (m) {
      for (const c of [`SKY${m[1]}`, 'SKY3', 'SKY2', 'SKY1']) {
        const t = textures.get(c);
        if (t) return t;
      }
      return null;
    }
    const m2 = /^MAP(\d\d)$/i.exec(mapName);
    if (m2) {
      const n = Number(m2[1]);
      const c = n <= 11 ? 'SKY1' : n <= 20 ? 'SKY2' : 'SKY3';
      return textures.get(c) ?? textures.get('SKY1');
    }
    return textures.get('SKY1') ?? textures.get('SKY2') ?? textures.get('SKY3');
  }

  return {
    wads,
    palette: pal.palette,
    playpal: pal.playpal,
    colormap: pal.colormap,
    lum: pal.lum,
    texture,
    flat,
    sprite,
    picture,
    sound,
    skyTexture,
    flatAnimGroups: anims.flats,
    textureAnimGroups: anims.textures,
    switchPair: (name: string) => switchPair(name, n => textures.has(n)),
    hasLump: (name: string) => wads.has(name),
    textureNames: textures.names,
    spriteNames: sprites.names(),
  };
}
