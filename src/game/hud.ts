// Two-row ASCII status bar + message line.
import { AMMO, type CellGrid, type LevelStats, type Player } from '../types';
import { putText } from '../render/index';
import { WEAPONS } from './weapons';

const LABEL = 0x8c8c8c;
const BRIGHT = 0xf4f4f4;
const DIM = 0x505050;

function pad(n: number, w: number): string {
  const s = String(Math.max(0, Math.floor(n)));
  return s.length >= w ? s : ' '.repeat(w - s.length) + s;
}

function clearRow(g: CellGrid, y: number): void {
  if (y < 0 || y >= g.rows) return;
  const o = y * g.cols;
  for (let x = 0; x < g.cols; x++) { g.ch[o + x] = 32; g.fg[o + x] = DIM; }
}

function field(g: CellGrid, x: number, y: number, label: string, value: string, color = BRIGHT): number {
  putText(g, x, y, label, LABEL);
  putText(g, x + label.length + 1, y, value, color);
  return x + label.length + 1 + value.length + 2;
}

export function face(health: number, dead: boolean): string {
  if (dead || health <= 0) return '(x_x)';
  if (health > 80) return '(^_^)';
  if (health > 50) return '(o_o)';
  if (health > 20) return '(>_<)';
  return '(;_;)';
}

export function drawHud(g: CellGrid, p: Player, levelName: string, stats: LevelStats): void {
  const yA = g.rows - 2;
  const yB = g.rows - 1;
  clearRow(g, yA);
  clearRow(g, yB);
  const w = WEAPONS[p.readyWeapon];
  const ammoType = w ? w.ammo : AMMO.NONE;
  const ammoStr = ammoType === AMMO.NONE ? '  -  ' : `${pad(p.ammo[ammoType], 3)}/${pad(p.maxAmmo[ammoType], 3)}`;
  const hc = p.health > 50 ? BRIGHT : p.health > 20 ? 0xffd060 : 0xff5050;
  let x = 1;
  x = field(g, x, yA, 'HEALTH', pad(p.health, 3) + '%', hc);
  x = field(g, x, yA, 'ARMOR', pad(p.armor, 3) + '%');
  x = field(g, x, yA, 'AMMO', ammoStr);
  x = field(g, x, yA, '', `[${w ? w.name : '?'}]`, 0xffffff);
  putText(g, x, yA, 'KEYS', LABEL);
  putText(g, x + 5, yA, '[B]', p.keys.blue ? 0x5080ff : DIM);
  putText(g, x + 8, yA, '[Y]', p.keys.yellow ? 0xffd030 : DIM);
  putText(g, x + 11, yA, '[R]', p.keys.red ? 0xff4040 : DIM);
  const f = face(p.health, p.dead);
  putText(g, g.cols - f.length - 1, yA, f, BRIGHT);

  // row B: weapons + stats + level
  x = 1;
  putText(g, x, yB, 'ARMS', LABEL);
  x += 5;
  const slotWeapon = [-1, 1, 2, 3, 4, 5, 6];
  for (let slot = 0; slot < 7; slot++) {
    let owned = false;
    let current = false;
    if (slot === 0) {
      owned = true;
      current = p.readyWeapon === 0 || p.readyWeapon === 7;
    } else {
      owned = !!p.weapons[slotWeapon[slot]];
      current = p.readyWeapon === slotWeapon[slot];
    }
    const s = current ? `[${slot + 1}]` : owned ? ` ${slot + 1} ` : ` . `;
    putText(g, x, yB, s, current ? 0xffffff : owned ? BRIGHT : DIM);
    x += 3;
  }
  x += 2;
  x = field(g, x, yB, 'KILLS', `${p.killcount}/${stats.totalKills}`);
  x = field(g, x, yB, 'ITEMS', `${p.itemcount}/${stats.totalItems}`);
  x = field(g, x, yB, 'SECRETS', `${p.secretcount}/${stats.totalSecrets}`);
  putText(g, g.cols - levelName.length - 1, yB, levelName, BRIGHT);
}

export function drawMessage(g: CellGrid, p: Player): void {
  if (p.message && p.messageTics > 0) putText(g, 1, 0, p.message, 0xffffff);
}
