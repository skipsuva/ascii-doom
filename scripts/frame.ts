// Render one ASCII frame of a map from the terminal:
//   npx vite-node scripts/frame.ts [E1M1] [--pos x,y,deg] [--cols 160] [--rows 50] [--things] [--weapon] [--wad path]
import { existsSync, readFileSync } from 'node:fs';
import { WadFile, Wads } from '../src/wad/wad';
import type { Assets, Level, Mobj, MobjInfo, RenderOptions, View } from '../src/types';
import { makeGrid } from '../src/types';
import { Renderer, gridToText, drawAutomap } from '../src/render/index';

const argv = process.argv.slice(2);
function opt(name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : undefined;
}
const flag = (name: string) => argv.includes(`--${name}`);
const VALUELESS = ['things', 'weapon', 'map', 'bench'];
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !VALUELESS.includes(argv[i - 1].slice(2))));
const mapName = (positional[0] ?? 'E1M1').toUpperCase();
const cols = Number(opt('cols') ?? 160);
const rows = Number(opt('rows') ?? 50);
const wadPath = opt('wad') ?? 'public/wads/doom1.wad';

if (!existsSync(wadPath)) {
  console.error(`WAD not found: ${wadPath} (run: npm run fetch-wad)`);
  process.exit(1);
}
const buf = readFileSync(wadPath);
const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
const wads = new Wads();
wads.add(new WadFile(ab, wadPath));

let assets: Assets;
let level: Level;
try {
  const mod = await import('../src/wad/assets');
  assets = mod.buildAssets(wads);
} catch (e) {
  console.error('assets module not ready:', (e as Error).message);
  process.exit(1);
}
try {
  const mod = await import('../src/level/index');
  level = mod.loadLevel(wads, mapName);
} catch (e) {
  console.error('level module not ready:', (e as Error).message);
  process.exit(1);
}

let x: number, y: number, angDeg: number;
const pos = opt('pos');
if (pos) {
  [x, y, angDeg] = pos.split(',').map(Number);
} else {
  const start = level.things.find(t => t.type === 1);
  if (!start) { console.error('no player start'); process.exit(1); }
  x = start.x; y = start.y; angDeg = start.angle;
}
const sector = level.pointInSector(x, y);
const view: View = { x, y, z: sector.floorH + 41, angle: (angDeg * Math.PI) / 180, sector, extralight: 0, fixedColormap: 0 };

const SPRITES: Record<number, string> = {
  3004: 'POSS', 9: 'SPOS', 3001: 'TROO', 3002: 'SARG', 58: 'SARG', 3003: 'BOSS', 3005: 'HEAD', 3006: 'SKUL',
  2035: 'BAR1', 2018: 'ARM1', 2019: 'ARM2', 2012: 'MEDI', 2011: 'STIM', 2007: 'CLIP', 2001: 'SHOT', 2002: 'MGUN',
  2048: 'AMMO', 2008: 'SHEL', 2049: 'SBOX', 2014: 'BON1', 2015: 'BON2', 5: 'BKEY', 6: 'YKEY', 13: 'RKEY',
  2028: 'COLU', 48: 'ELEC', 2013: 'SOUL', 2010: 'ROCK', 2046: 'BROK', 2003: 'LAUN', 2005: 'CSAW', 8: 'BPAK',
  10: 'PLAY', 12: 'PLAY', 15: 'PLAY', 24: 'POL5', 34: 'CAND', 35: 'CBRA', 2023: 'PSTR', 2024: 'PINS', 2022: 'PINV',
};
let id = 1;
function fakeMobj(sprite: string, mx: number, my: number, ang: number, shadow = false): Mobj {
  const info: MobjInfo = {
    name: sprite, doomednum: 0, sprite, health: 1, speed: 0, radius: 20, height: 56, mass: 100, painChance: 0, damage: 0,
    flags: 0, reactionTime: 8, seeSound: null, attackSound: null, painSound: null, deathSound: null, activeSound: null, states: {},
  };
  const sec = level.pointInSector(mx, my);
  return {
    id: id++, type: 0, info, x: mx, y: my, z: sec.floorH, angle: ang, momx: 0, momy: 0, momz: 0, radius: 20, height: 56,
    floorz: sec.floorH, ceilingz: sec.ceilH, dropoffz: sec.floorH, health: 1, flags: shadow ? 262144 : 0, sprite, frame: 0,
    fullbright: false, state: null, tics: -1, target: null, tracer: null, reactiontime: 0, movedir: 0, movecount: 0,
    threshold: 0, lastlook: 0, subsector: null, sector: sec, blockIndex: -1, player: null, spawnPoint: null, removed: false,
  };
}
const things: Mobj[] = [];
if (flag('things')) {
  for (const t of level.things) {
    const spr = SPRITES[t.type];
    if (!spr) continue;
    if (t.type === 1 || (t.type >= 2 && t.type <= 4) || t.type === 11 || t.type === 14) continue;
    if (!assets.sprite(spr)) continue;
    things.push(fakeMobj(spr, t.x, t.y, (t.angle * Math.PI) / 180, t.type === 58));
  }
}
const spawn = opt('spawn'); // e.g. --spawn POSS,128,0  (sprite, distance ahead, facing offset deg)
if (spawn) {
  const [spr, distS, faceS] = spawn.split(',');
  const dist = Number(distS ?? 128), face = Number(faceS ?? 180);
  const sx = x + Math.cos(view.angle) * dist, sy = y + Math.sin(view.angle) * dist;
  const isSpectre = spr.toLowerCase() === 'spectre';
  things.push(fakeMobj(isSpectre ? 'SARG' : spr.toUpperCase(), sx, sy, view.angle + (face * Math.PI) / 180, isSpectre));
}
const opts: RenderOptions = {
  anim: { textureAlias: new Map(), flatAlias: new Map() },
  things,
  psprites: flag('weapon') ? [{ sprite: 'PISG', frame: 0, sx: 1, sy: 32, fullbright: false }] : [],
  tic: 0,
};
const renderer = new Renderer(assets, cols, rows, 0.5, 2);
renderer.setLevel(level);
const grid = makeGrid(cols, rows);
const t0 = performance.now();
renderer.render(view, opts, grid, 0, false);
const t1 = performance.now();
if (flag('bench')) {
  const n = 30;
  const b0 = performance.now();
  for (let i = 0; i < n; i++) renderer.render(view, opts, grid, 0, false);
  console.error(`bench: ${((performance.now() - b0) / n).toFixed(2)} ms/frame avg over ${n} (fb ${renderer.W}x${renderer.H})`);
}
if (flag('map')) {
  const mg = makeGrid(cols, rows);
  const fakePlayer = { mo: fakeMobj('PLAY', x, y, view.angle) } as unknown as import('../src/types').Player;
  drawAutomap(mg, level, fakePlayer, Number(opt('zoom') ?? 8), true, 0.5);
  console.log(gridToText(mg));
  console.log('-'.repeat(cols));
}
console.log(gridToText(grid));
console.error(`${mapName} @ (${x},${y}) ${angDeg}deg z=${view.z} sector#${sector.id} light=${sector.light} | ${cols}x${rows} | ${things.length} things | ${(t1 - t0).toFixed(1)} ms`);
