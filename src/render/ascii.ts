// Framebuffer (palette indices) -> ASCII cells.
import type { CellGrid } from '../types';
import type { Renderer } from './renderer';

/** Classic 70-level luminance ramp (dark -> bright). */
export const RAMP = " .'`^\",:;Il!i~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@$";
/** Shorter, more readable ramps. */
export const RAMP_SHORT = ' .:-=+*#%@';
export const RAMP_MED = " .,:;-~=+*x#%@$";

export const MONO_FG = 0xd0d0d0;

// Auto-levels state (temporally smoothed so the stretch doesn't flicker between frames).
let smoothLo = 0.05;
let smoothHi = 0.6;
let cellLum = new Float32Array(0);
let cellFuzz = new Uint8Array(0);
let cellR = new Float32Array(0);
let cellG = new Float32Array(0);
let cellB = new Float32Array(0);
const hist = new Uint32Array(256);
/** Percentiles mapped to the darkest / brightest glyph. */
export const LEVELS = { loPct: 0.03, hiPct: 0.985, minRange: 0.22, smoothing: 0.2 };

/** Reset the auto-level smoothing (e.g. on level change). */
export function resetLevels(): void { smoothLo = 0.05; smoothHi = 0.6; }

/**
 * Average the ss×ss framebuffer block under each cell into a luminance, stretch the frame's luminance range
 * (percentile auto-levels) so the whole ramp is used, apply gamma, pick a ramp glyph.
 * Cells touched by the fuzz mask (spectres) jitter their glyph.
 */
export function composeCells(r: Renderer, grid: CellGrid, rowOffset: number, colorMode: boolean): void {
  const { W, ss, cols, rows, fb, fuzz } = r;
  const lum = r.assets.lum;
  const pal = r.assets.palette;
  const ramp = r.ramp;
  const n = ramp.length - 1;
  const inv = 1 / (ss * ss);
  const gamma = r.gamma;
  const maxRows = Math.min(rows, grid.rows - rowOffset);
  const total = cols * maxRows;
  if (cellLum.length < total) {
    cellLum = new Float32Array(total); cellFuzz = new Uint8Array(total);
    cellR = new Float32Array(total); cellG = new Float32Array(total); cellB = new Float32Array(total);
  }
  hist.fill(0);
  // pass 1: per-cell luminance
  for (let cy = 0; cy < maxRows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      let sum = 0, fz = 0, rs = 0, gs = 0, bs = 0;
      for (let j = 0; j < ss; j++) {
        let i = (cy * ss + j) * W + cx * ss;
        for (let k = 0; k < ss; k++, i++) {
          const p = fb[i];
          sum += lum[p];
          fz |= fuzz[i];
          if (colorMode) { const p3 = p * 3; rs += pal[p3]; gs += pal[p3 + 1]; bs += pal[p3 + 2]; }
        }
      }
      const c = cy * cols + cx;
      const l = sum * inv;
      cellLum[c] = l; cellFuzz[c] = fz;
      if (colorMode) { cellR[c] = rs * inv; cellG[c] = gs * inv; cellB[c] = bs * inv; }
      hist[Math.min(255, (l * 255) | 0)]++;
    }
  }
  // percentiles
  let acc = 0, lo = 0, hi = 1;
  const loCount = total * LEVELS.loPct, hiCount = total * LEVELS.hiPct;
  let foundLo = false;
  for (let b = 0; b < 256; b++) {
    acc += hist[b];
    if (!foundLo && acc >= loCount) { lo = b / 255; foundLo = true; }
    if (acc >= hiCount) { hi = (b + 1) / 255; break; }
  }
  if (hi - lo < LEVELS.minRange) { const mid = (hi + lo) / 2; lo = Math.max(0, mid - LEVELS.minRange / 2); hi = lo + LEVELS.minRange; }
  smoothLo += (lo - smoothLo) * LEVELS.smoothing;
  smoothHi += (hi - smoothHi) * LEVELS.smoothing;
  const scale = 1 / Math.max(0.02, smoothHi - smoothLo);
  // pass 2: glyphs
  for (let cy = 0; cy < maxRows; cy++) {
    const gRow = (rowOffset + cy) * grid.cols;
    for (let cx = 0; cx < cols; cx++) {
      const c = cy * cols + cx;
      let l = (cellLum[c] - smoothLo) * scale;
      if (l < 0) l = 0; else if (l > 1) l = 1;
      l = Math.pow(l, gamma);
      let idx = Math.round(l * n);
      if (cellFuzz[c]) { idx += ((Math.random() * 7) | 0) - 3; if (idx < 1) idx = 1; }
      if (idx > n) idx = n; else if (idx < 0) idx = 0;
      grid.ch[gRow + cx] = ramp.charCodeAt(idx);
      if (colorMode) {
        // keep the hue, normalize brightness so glyph choice carries the luminance
        let R = cellR[c], G = cellG[c], B = cellB[c];
        const m = Math.max(R, G, B, 1);
        const k = 220 / m;
        R = Math.min(255, R * k + 20); G = Math.min(255, G * k + 20); B = Math.min(255, B * k + 20);
        grid.fg[gRow + cx] = ((R | 0) << 16) | ((G | 0) << 8) | (B | 0);
      } else {
        grid.fg[gRow + cx] = MONO_FG;
      }
    }
  }
}
