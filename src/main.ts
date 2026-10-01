// Browser entry point: load WADs, build assets, create the canvas surface, run the game, expose a debug API.
import { WadFile, Wads } from './wad/wad';
import { buildAssets } from './wad/assets';
import { mapList } from './level/index';
import { GlyphCanvas } from './render/index';
import { createWorld } from './game/world';
import { Game, makeSurface } from './game/game';
import { Input } from './input';
import { GameAudio } from './audio';
import type { Assets } from './types';

const params = new URLSearchParams(location.search);
const bootEl = document.getElementById('boot') as HTMLDivElement | null;
const dropEl = document.getElementById('drop') as HTMLDivElement | null;
const fileEl = document.getElementById('wadfile') as HTMLInputElement | null;
const canvas = document.getElementById('screen') as HTMLCanvasElement;

function status(text: string): void {
  if (bootEl) { bootEl.textContent = text; bootEl.classList.remove('hidden'); }
  console.log('[ascii-doom]', text);
}

async function fetchWad(url: string, name: string): Promise<WadFile> {
  status(`LOADING ${name} ...`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  return new WadFile(await res.arrayBuffer(), name);
}

function parsePos(): { x: number; y: number; deg: number } | null {
  const v = params.get('pos');
  if (!v) return null;
  const [x, y, deg] = v.split(',').map(Number);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y, deg: Number.isFinite(deg) ? deg : 90 };
}

let game: Game | null = null;
let wads = new Wads();
let assets: Assets | null = null;
const input = new Input();
let audio: GameAudio | null = null;
const fontPx = Number(params.get('font')) || 12;

function buildSurface(gc: GlyphCanvas, a: Assets) {
  gc.resize();
  return makeSurface(a, gc, gc.cols, gc.rows, gc.cellAspect);
}

function wadLabel(w: Wads): string {
  return w.wads.map(x => x.name).join(' + ');
}

async function loadFromFiles(files: FileList | File[]): Promise<void> {
  const list = Array.from(files).filter(f => /\.wad$/i.test(f.name));
  if (list.length === 0 || !game || !audio) return;
  let stack = wads;
  let preferred: string | null = null;
  let replaced = false;
  for (const f of list) {
    const wad = new WadFile(await f.arrayBuffer(), f.name);
    if (wad.type === 'IWAD') {
      stack = new Wads();
      stack.add(wad);
      replaced = true;
      preferred = null;
    } else {
      if (!replaced && stack.wads.length === 0) { status('Load an IWAD first'); return; }
      stack.add(wad);
      const maps = new Wads();
      maps.add(wad);
      const pm = maps.mapNames();
      if (pm.length) preferred = pm[0];
    }
  }
  status('BUILDING ASSETS ...');
  const a = buildAssets(stack);
  wads = stack;
  assets = a;
  audio.setAssets(a);
  const gc = game.surface.gc!;
  game.setSurface(buildSurface(gc, a));
  game.setWads(stack, a, createWorld(), wadLabel(stack), preferred);
  if (bootEl) bootEl.classList.add('hidden');
}

async function boot(): Promise<void> {
  const wadParam = params.get('wad');
  if (wadParam) {
    const w = await fetchWad(wadParam, wadParam.split('/').pop() || 'custom.wad');
    if (w.type === 'IWAD') wads.add(w);
    else {
      wads.add(await fetchWad('/wads/doom1.wad', 'doom1.wad'));
      wads.add(w);
    }
  } else {
    wads.add(await fetchWad('/wads/doom1.wad', 'doom1.wad'));
  }
  status('BUILDING ASSETS ...');
  assets = buildAssets(wads);
  audio = new GameAudio(assets, params.get('nosound') !== '1');
  input.onGesture = () => audio?.unlock();
  input.attach(canvas);

  const gc = new GlyphCanvas(canvas, fontPx);
  const surface = buildSurface(gc, assets);
  const world = createWorld();
  const maps = mapList(wads);
  const mapParam = params.get('map')?.toUpperCase() ?? null;
  game = new Game(
    { wads, assets, world, input, audio, surface, wadName: wadLabel(wads) },
    {
      god: params.get('god') === '1',
      noclip: params.get('noclip') === '1',
      startPos: parsePos(),
      startMap: mapParam && maps.includes(mapParam) ? mapParam : null,
    },
  );
  if (params.get('autostart') === '1') game.start();
  if (bootEl) bootEl.classList.add('hidden');

  let resizeTimer = 0;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (game && assets) game.setSurface(buildSurface(gc, assets));
    }, 100);
  });

  // WAD drag & drop / file picker
  window.addEventListener('dragover', (e) => { e.preventDefault(); dropEl?.classList.remove('hidden'); });
  window.addEventListener('dragleave', () => dropEl?.classList.add('hidden'));
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    dropEl?.classList.add('hidden');
    if (e.dataTransfer?.files?.length) void loadFromFiles(e.dataTransfer.files).catch(err => status(`WAD load failed: ${err.message}`));
  });
  fileEl?.addEventListener('change', () => { if (fileEl.files) void loadFromFiles(fileEl.files); });
  window.addEventListener('keydown', (e) => { if (e.code === 'KeyO' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); fileEl?.click(); } });

  const loop = (now: number) => {
    try { game!.frame(now); } catch (err) { console.error(err); status(`ERROR: ${(err as Error).message}`); }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}

// Debug / test API
const api = {
  get ready() { return !!game; },
  get state() { return game?.state ?? 'BOOT'; },
  get level() { return game?.level ?? null; },
  get levelName() { return game?.currentMap ?? null; },
  get player() { return game?.player ?? null; },
  get ctx() { return game?.ctx ?? null; },
  get game() { return game; },
  get tic() { return game?.ctx?.tic ?? 0; },
  ascii(): string { return game ? game.ascii() : ''; },
  teleport(x: number, y: number, deg?: number) { game?.teleport(x, y, deg); },
  setKey(code: string, down: boolean) { input.setKey(code, down); },
  mouse(dx: number) { input.addMouse(dx); },
  tick(n = 1) { game?.runTics(n); game?.render(); },
  exitLevel(secret = false) { game?.exitLevel(secret); },
  startMap(name: string, pistolStart = true) { game?.startLevel(name.toUpperCase(), pistolStart); },
  start() { if (game && game.state === 'TITLE') game.start(); },
  loadWadFiles(files: FileList | File[]) { return loadFromFiles(files); },
};
(window as unknown as { __game: typeof api }).__game = api;

boot().catch((err) => {
  console.error(err);
  status(`BOOT FAILED: ${(err as Error).message}`);
});
