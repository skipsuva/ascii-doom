// ASCII automap: linedefs rasterized into the cell grid, centered on the player.
import type { CellGrid, Level, Player } from '../types';
import { ML } from '../types';
import { putText } from './text';

const COL_WALL = 0xff6060;
const COL_FLOOR = 0xc09050;
const COL_CEIL = 0xe0e060;
const COL_SPECIAL = 0x60c0ff;
const COL_OTHER = 0x707070;
const COL_PLAYER = 0xffffff;

/**
 * @param zoom cells per 128 map units (horizontal)
 * @param showAll draw every line (debug) instead of only lines the player has seen
 */
export function drawAutomap(grid: CellGrid, level: Level, player: Player, zoom: number, showAll: boolean, cellAspect = 0.5): void {
  grid.ch.fill(32);
  grid.fg.fill(0xc8c8c8);
  const px = player.mo.x, py = player.mo.y;
  const sx = zoom / 128, sy = sx * cellAspect;
  const ccx = grid.cols / 2, ccy = grid.rows / 2;
  const cols = grid.cols, rows = grid.rows;
  const plot = (x: number, y: number, ch: number, fg: number) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return;
    const i = y * cols + x;
    grid.ch[i] = ch;
    grid.fg[i] = fg;
  };
  for (const l of level.lines) {
    if (!showAll) {
      if (!l.mapped) continue;
      if (l.flags & ML.DONTDRAW) continue;
    }
    let ch: number, fg: number;
    const back = l.backSector;
    if (!back || (l.flags & ML.SECRET && !showAll)) { ch = 35; fg = COL_WALL; }            // '#'
    else if (l.special) { ch = 61; fg = COL_SPECIAL; }                                        // '='
    else if (l.frontSector.floorH !== back.floorH) { ch = 43; fg = COL_FLOOR; }              // '+'
    else if (l.frontSector.ceilH !== back.ceilH) { ch = 45; fg = COL_CEIL; }                 // '-'
    else { ch = 46; fg = COL_OTHER; }                                                         // '.'
    let x0 = ccx + (l.v1.x - px) * sx, y0 = ccy - (l.v1.y - py) * sy;
    let x1 = ccx + (l.v2.x - px) * sx, y1 = ccy - (l.v2.y - py) * sy;
    // Liang-Barsky clip to the grid rectangle
    const dx = x1 - x0, dy = y1 - y0;
    let t0 = 0, t1 = 1;
    const clip = (p: number, q: number): boolean => {
      if (p === 0) return q >= 0;
      const t = q / p;
      if (p < 0) { if (t > t1) return false; if (t > t0) t0 = t; }
      else { if (t < t0) return false; if (t < t1) t1 = t; }
      return true;
    };
    if (!clip(-dx, x0) || !clip(dx, cols - 1 - x0) || !clip(-dy, y0) || !clip(dy, rows - 1 - y0)) continue;
    const cx0 = x0 + dx * t0, cy0 = y0 + dy * t0, cx1 = x0 + dx * t1, cy1 = y0 + dy * t1;
    x0 = Math.round(cx0); y0 = Math.round(cy0); x1 = Math.round(cx1); y1 = Math.round(cy1);
    // Bresenham
    let ax = Math.abs(x1 - x0), ay = Math.abs(y1 - y0);
    const stepX = x0 < x1 ? 1 : -1, stepY = y0 < y1 ? 1 : -1;
    let err = ax - ay;
    let cx = x0, cy = y0;
    for (let guard = 0; guard < 10000; guard++) {
      plot(cx, cy, ch, fg);
      if (cx === x1 && cy === y1) break;
      const e2 = 2 * err;
      if (e2 > -ay) { err -= ay; cx += stepX; }
      if (e2 < ax) { err += ax; cy += stepY; }
    }
  }
  // player marker + heading
  const pcx = Math.round(ccx), pcy = Math.round(ccy);
  const a = player.mo.angle;
  const dirs = '>/^\\</v\\';
  const oct = Math.round(a / (Math.PI / 4)) & 7;
  const dxs = [1, 1, 0, -1, -1, -1, 0, 1], dys = [0, -1, -1, -1, 0, 1, 1, 1];
  plot(pcx, pcy, 64, COL_PLAYER); // '@'
  plot(pcx + dxs[oct], pcy + dys[oct], dirs.charCodeAt(oct), COL_PLAYER);
  putText(grid, 1, 0, `AUTOMAP ${level.name}`, COL_PLAYER);
}
