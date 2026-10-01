// Title, intermission, death overlay, victory screens.
import type { Assets, CellGrid } from '../types';
import { drawPatchAscii, fillGrid, putText, putTextCentered } from '../render/index';

const WHITE = 0xffffff;
const GRAY = 0x9a9a9a;
const DIM = 0x606060;

const LOGO = [
  ' █████╗  ███████╗ ██████╗██╗██╗    ██████╗  ██████╗  ██████╗ ███╗   ███╗',
  '██╔══██╗ ██╔════╝██╔════╝██║██║    ██╔══██╗██╔═══██╗██╔═══██╗████╗ ████║',
  '███████║ ███████╗██║     ██║██║    ██║  ██║██║   ██║██║   ██║██╔████╔██║',
  '██╔══██║ ╚════██║██║     ██║██║    ██║  ██║██║   ██║██║   ██║██║╚██╔╝██║',
  '██║  ██║ ███████║╚██████╗██║██║    ██████╔╝╚██████╔╝╚██████╔╝██║ ╚═╝ ██║',
  '╚═╝  ╚═╝ ╚══════╝ ╚═════╝╚═╝╚═╝    ╚═════╝  ╚═════╝  ╚═════╝ ╚═╝     ╚═╝',
];

function clearRows(g: CellGrid, y0: number, y1: number): void {
  for (let y = Math.max(0, y0); y <= Math.min(g.rows - 1, y1); y++) {
    const o = y * g.cols;
    for (let x = 0; x < g.cols; x++) { g.ch[o + x] = 32; g.fg[o + x] = GRAY; }
  }
}

function drawLogo(g: CellGrid, y: number): void {
  for (let i = 0; i < LOGO.length; i++) putTextCentered(g, y + i, LOGO[i], WHITE);
}

export const HELP_LINE = 'DROP A .WAD FILE TO LOAD IT  |  WASD MOVE  MOUSE/ARROWS TURN  CTRL/CLICK FIRE  SPACE/E USE  TAB MAP  1-7 WEAPONS';

export function drawTitle(g: CellGrid, assets: Assets, tic: number, wadName: string, colorMode: boolean): void {
  fillGrid(g, 32, GRAY);
  const pic = assets.picture('TITLEPIC');
  if (pic) drawPatchAscii(g, assets, pic, 0, 0, g.cols, g.rows, colorMode);
  const ly = Math.max(1, Math.floor(g.rows * 0.12));
  if (g.cols >= 80 && g.rows >= 30) {
    clearRows(g, ly - 1, ly + LOGO.length);
    drawLogo(g, ly);
  } else {
    clearRows(g, ly, ly);
    putTextCentered(g, ly, 'A S C I I   D O O M', WHITE);
  }
  const by = g.rows - 5;
  clearRows(g, by - 1, g.rows - 1);
  if ((tic >> 4) & 1) putTextCentered(g, by, 'PRESS ENTER TO START', WHITE);
  putTextCentered(g, by + 2, `WAD: ${wadName}`, GRAY);
  putTextCentered(g, by + 3, HELP_LINE.length > g.cols ? 'WASD MOVE  ARROWS TURN  CTRL FIRE  SPACE USE  TAB MAP' : HELP_LINE, DIM);
}

export interface IntermissionInfo {
  finished: string;
  next: string | null;
  killsPct: number;
  itemsPct: number;
  secretsPct: number;
  timeSec: number;
}

function fmtTime(s: number): string {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec < 10 ? '0' : ''}${sec}`;
}

export function drawIntermission(g: CellGrid, assets: Assets, info: IntermissionInfo, tic: number, colorMode: boolean): void {
  fillGrid(g, 32, GRAY);
  const pic = assets.picture('WIMAP0') ?? assets.picture('INTERPIC');
  if (pic) drawPatchAscii(g, assets, pic, 0, 0, g.cols, g.rows, colorMode);
  const cy = Math.floor(g.rows / 2);
  clearRows(g, cy - 5, cy + 5);
  putTextCentered(g, cy - 4, `${info.finished}  FINISHED`, WHITE);
  putTextCentered(g, cy - 2, `KILLS ${pad3(info.killsPct)}%    ITEMS ${pad3(info.itemsPct)}%    SECRETS ${pad3(info.secretsPct)}%`, WHITE);
  putTextCentered(g, cy, `TIME ${fmtTime(info.timeSec)}`, GRAY);
  if (info.next) putTextCentered(g, cy + 2, `ENTERING ${info.next}`, WHITE);
  else putTextCentered(g, cy + 2, 'THE END IS NEAR', WHITE);
  if ((tic >> 4) & 1) putTextCentered(g, cy + 4, 'PRESS ENTER', GRAY);
}

function pad3(n: number): string {
  const s = String(Math.round(n));
  return s.length >= 3 ? s : ' '.repeat(3 - s.length) + s;
}

export function drawDeathOverlay(g: CellGrid, viewRows: number, tic: number): void {
  const cy = Math.floor(viewRows / 2);
  putTextCentered(g, cy - 1, '  Y O U   D I E D  ', 0xff5050);
  if ((tic >> 4) & 1) putTextCentered(g, cy + 1, '  PRESS USE TO RESTART  ', WHITE);
}

export function drawPaused(g: CellGrid, viewRows: number): void {
  putTextCentered(g, Math.floor(viewRows / 2), '  P A U S E D  ', WHITE);
}

export interface VictoryTotals { kills: number; totalKills: number; items: number; totalItems: number; secrets: number; totalSecrets: number; timeSec: number; levels: number }

export function drawVictory(g: CellGrid, assets: Assets, t: VictoryTotals, tic: number, colorMode: boolean): void {
  fillGrid(g, 32, GRAY);
  const pic = assets.picture('CREDIT') ?? assets.picture('HELP2') ?? assets.picture('TITLEPIC');
  if (pic) drawPatchAscii(g, assets, pic, 0, 0, g.cols, g.rows, colorMode);
  const cy = Math.floor(g.rows / 2);
  clearRows(g, cy - 6, cy + 5);
  putTextCentered(g, cy - 5, 'YOU HAVE ESCAPED THE ASCII HELL', WHITE);
  putTextCentered(g, cy - 3, `LEVELS CLEARED ${t.levels}`, GRAY);
  putTextCentered(g, cy - 1, `KILLS ${t.kills}/${t.totalKills}   ITEMS ${t.items}/${t.totalItems}   SECRETS ${t.secrets}/${t.totalSecrets}`, WHITE);
  putTextCentered(g, cy + 1, `TOTAL TIME ${fmtTime(t.timeSec)}`, GRAY);
  if ((tic >> 4) & 1) putTextCentered(g, cy + 4, 'PRESS ENTER FOR TITLE', GRAY);
  putText(g, 1, g.rows - 1, 'ASCII DOOM', DIM);
}
