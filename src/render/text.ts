import type { Assets, CellGrid, Patch } from '../types';
import { MONO_FG, RAMP } from './ascii';

export function putText(grid: CellGrid, x: number, y: number, text: string, fg = MONO_FG): void {
  if (y < 0 || y >= grid.rows) return;
  const row = y * grid.cols;
  for (let i = 0; i < text.length; i++) {
    const cx = x + i;
    if (cx < 0 || cx >= grid.cols) continue;
    grid.ch[row + cx] = text.charCodeAt(i);
    grid.fg[row + cx] = fg;
  }
}

export function putTextCentered(grid: CellGrid, y: number, text: string, fg = MONO_FG): void {
  putText(grid, Math.floor((grid.cols - text.length) / 2), y, text, fg);
}

export function fillGrid(grid: CellGrid, ch = 32, fg = MONO_FG): void {
  grid.ch.fill(ch);
  grid.fg.fill(fg);
}

/** Fill a rectangle (clipped) with a character. */
export function fillRect(grid: CellGrid, x: number, y: number, w: number, h: number, ch = 32, fg = MONO_FG): void {
  for (let j = 0; j < h; j++) {
    const yy = y + j;
    if (yy < 0 || yy >= grid.rows) continue;
    for (let i = 0; i < w; i++) {
      const xx = x + i;
      if (xx < 0 || xx >= grid.cols) continue;
      grid.ch[yy * grid.cols + xx] = ch;
      grid.fg[yy * grid.cols + xx] = fg;
    }
  }
}

/** Grid contents as newline-separated text (debugging / terminal). */
export function gridToText(grid: CellGrid): string {
  const lines: string[] = [];
  for (let r = 0; r < grid.rows; r++) {
    let s = '';
    for (let c = 0; c < grid.cols; c++) s += String.fromCharCode(grid.ch[r * grid.cols + c] || 32);
    lines.push(s);
  }
  return lines.join('\n');
}

/**
 * Draw a picture lump (TITLEPIC, WIMAP0, ...) as ASCII into a w×h cell rectangle at (x,y), box-averaging the
 * source pixels under each cell. Fully transparent cells are left untouched.
 */
export function drawPatchAscii(grid: CellGrid, assets: Assets, patch: Patch, x: number, y: number, w: number, h: number, colorMode = false): void {
  const lum = assets.lum, pal = assets.palette;
  const n = RAMP.length - 1;
  const pw = patch.width, ph = patch.height;
  for (let j = 0; j < h; j++) {
    const gy = y + j;
    if (gy < 0 || gy >= grid.rows) continue;
    const sy0 = Math.floor(j * ph / h), sy1 = Math.max(sy0 + 1, Math.floor((j + 1) * ph / h));
    for (let i = 0; i < w; i++) {
      const gx = x + i;
      if (gx < 0 || gx >= grid.cols) continue;
      const sx0 = Math.floor(i * pw / w), sx1 = Math.max(sx0 + 1, Math.floor((i + 1) * pw / w));
      let sum = 0, cnt = 0, total = 0, rs = 0, gs = 0, bs = 0;
      for (let px = sx0; px < sx1 && px < pw; px++) {
        const base = px * ph;
        for (let py = sy0; py < sy1 && py < ph; py++) {
          total++;
          if (!patch.mask[base + py]) continue;
          const p = patch.pixels[base + py];
          cnt++;
          sum += lum[p];
          if (colorMode) { rs += pal[p * 3]; gs += pal[p * 3 + 1]; bs += pal[p * 3 + 2]; }
        }
      }
      if (cnt === 0) continue;
      const l = Math.pow(sum / cnt, 0.7) * (cnt / total);
      const idx = Math.max(0, Math.min(n, Math.round(l * n)));
      grid.ch[gy * grid.cols + gx] = RAMP.charCodeAt(idx);
      if (colorMode) {
        let R = rs / cnt, G = gs / cnt, B = bs / cnt;
        const k = 220 / Math.max(R, G, B, 1);
        R = Math.min(255, R * k + 20); G = Math.min(255, G * k + 20); B = Math.min(255, B * k + 20);
        grid.fg[gy * grid.cols + gx] = ((R | 0) << 16) | ((G | 0) << 8) | (B | 0);
      } else {
        grid.fg[gy * grid.cols + gx] = MONO_FG;
      }
    }
  }
}
