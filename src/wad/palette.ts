// PLAYPAL / COLORMAP loading and per-index luminance.
import type { Wads } from './wad';

export interface PaletteData {
  /** palette 0, 768 bytes */
  palette: Uint8Array;
  /** all 14 palettes (14*768) — generated grayscale if PLAYPAL is missing */
  playpal: Uint8Array;
  /** 34*256 */
  colormap: Uint8Array;
  /** 0..1 luminance per palette-0 index */
  lum: Float32Array;
}

export function loadPalette(wads: Wads): PaletteData {
  const pp = wads.lump('PLAYPAL');
  let playpal: Uint8Array;
  if (pp && pp.size >= 768) {
    playpal = new Uint8Array(14 * 768);
    const d = pp.data();
    playpal.set(d.subarray(0, Math.min(d.length, 14 * 768)));
    // if fewer than 14 palettes, repeat palette 0 into the empty slots
    for (let p = Math.floor(Math.min(d.length, 14 * 768) / 768); p < 14; p++) playpal.set(playpal.subarray(0, 768), p * 768);
  } else {
    playpal = new Uint8Array(14 * 768);
    for (let p = 0; p < 14; p++) for (let i = 0; i < 256; i++) {
      playpal[p * 768 + i * 3] = playpal[p * 768 + i * 3 + 1] = playpal[p * 768 + i * 3 + 2] = i;
    }
  }
  const palette = playpal.slice(0, 768);

  const colormap = new Uint8Array(34 * 256);
  for (let m = 0; m < 34; m++) for (let i = 0; i < 256; i++) colormap[m * 256 + i] = i;
  const cm = wads.lump('COLORMAP');
  if (cm && cm.size >= 256) {
    const d = cm.data();
    colormap.set(d.subarray(0, Math.min(d.length, 34 * 256)));
  }

  const lum = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    lum[i] = (0.299 * palette[i * 3] + 0.587 * palette[i * 3 + 1] + 0.114 * palette[i * 3 + 2]) / 255;
  }
  return { palette, playpal, colormap, lum };
}
