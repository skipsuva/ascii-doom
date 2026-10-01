// Shared contracts between modules. Implementations live in src/wad (assets), src/level (geometry/collision),
// src/render (renderer), src/game (game logic). Only ADD to these interfaces; never rename existing members.
import type { Wads } from './wad/wad';

// ---------------------------------------------------------------- flags (DOOM values)
export const MF = {
  SPECIAL: 1, SOLID: 2, SHOOTABLE: 4, NOSECTOR: 8, NOBLOCKMAP: 16, AMBUSH: 32, JUSTHIT: 64, JUSTATTACKED: 128,
  SPAWNCEILING: 256, NOGRAVITY: 512, DROPOFF: 1024, PICKUP: 2048, NOCLIP: 4096, FLOAT: 16384, TELEPORT: 32768,
  MISSILE: 65536, DROPPED: 131072, SHADOW: 262144, NOBLOOD: 524288, CORPSE: 1048576, COUNTKILL: 4194304,
  COUNTITEM: 8388608, SKULLFLY: 16777216, NOTDMATCH: 33554432,
} as const;

export const ML = {
  BLOCKING: 1, BLOCKMONSTERS: 2, TWOSIDED: 4, DONTPEGTOP: 8, DONTPEGBOTTOM: 16, SECRET: 32, SOUNDBLOCK: 64,
  DONTDRAW: 128, MAPPED: 256,
} as const;

/** THINGS flags */
export const MTF = { EASY: 1, NORMAL: 2, HARD: 4, AMBUSH: 8, NOTSINGLE: 16 } as const;

export const NF_SUBSECTOR = 0x8000;
export const SKY_FLAT = 'F_SKY1';

// ---------------------------------------------------------------- level geometry (src/level)
export interface Vertex { x: number; y: number }

export interface Sector {
  id: number;
  floorH: number;
  ceilH: number;
  floorFlat: string;
  ceilFlat: string;
  light: number;
  special: number;
  tag: number;
  lines: Line[];
  /** Sectors reachable through two-sided lines. */
  neighbors: Sector[];
  /** Mobjs whose position is in this sector (maintained by Geo.setThingPosition). */
  things: Set<Mobj>;
  /** Active mover/light thinker owned by src/game (null when idle). */
  specialData: unknown;
  /** Secondary thinker slot (e.g. lighting) so a light effect can coexist with a mover. */
  lightData: unknown;
  soundTarget: Mobj | null;
  validcount: number;
}

export interface Side {
  id: number;
  xoff: number;
  yoff: number;
  /** Texture names (mutable: switches / texture changes). '-' means none. */
  top: string;
  bottom: string;
  mid: string;
  sector: Sector;
}

export interface Line {
  id: number;
  v1: Vertex;
  v2: Vertex;
  dx: number;
  dy: number;
  flags: number;
  special: number;
  tag: number;
  front: Side;
  back: Side | null;
  frontSector: Sector;
  backSector: Sector | null;
  /** [minx, miny, maxx, maxy] */
  bbox: [number, number, number, number];
  /** 0 horizontal, 1 vertical, 2 positive slope, 3 negative slope */
  slopeType: number;
  /** Set by renderer when drawn; used by automap. */
  mapped: boolean;
  validcount: number;
}

export interface Seg {
  id: number;
  v1: Vertex;
  v2: Vertex;
  /** radians */
  angle: number;
  line: Line;
  side: 0 | 1;
  /** distance along the linedef from the sidedef's start vertex to v1 */
  offset: number;
  frontSector: Sector;
  backSector: Sector | null;
  length: number;
}

export interface Subsector {
  id: number;
  sector: Sector;
  segs: Seg[];
}

export interface BspNode {
  x: number; y: number; dx: number; dy: number;
  /** bbox[child] = [top(maxy), bottom(miny), left(minx), right(maxx)] like DOOM */
  bbox: [number[], number[]];
  /** child index; bit 15 (NF_SUBSECTOR) set -> subsector */
  children: [number, number];
}

export interface Blockmap {
  originX: number;
  originY: number;
  columns: number;
  rows: number;
  /** line indices per block */
  lines: Int32Array[];
  /** mobjs per block */
  things: Set<Mobj>[];
}

export interface ThingSpawn {
  x: number; y: number;
  /** degrees as stored in the WAD */
  angle: number;
  type: number;
  flags: number;
}

export interface Level {
  name: string;
  vertices: Vertex[];
  sectors: Sector[];
  sides: Side[];
  lines: Line[];
  segs: Seg[];
  subsectors: Subsector[];
  nodes: BspNode[];
  blockmap: Blockmap;
  things: ThingSpawn[];
  bounds: { minx: number; miny: number; maxx: number; maxy: number };
  pointInSubsector(x: number, y: number): Subsector;
  pointInSector(x: number, y: number): Sector;
  /** 0 = front/right side, 1 = back/left side */
  pointOnLineSide(x: number, y: number, line: Line): 0 | 1;
  /** Which side of a BSP partition; 0 front(right), 1 back(left) */
  pointOnNodeSide(x: number, y: number, node: BspNode): 0 | 1;
}

export interface Opening {
  top: number;      // min ceiling
  bottom: number;   // max floor
  range: number;    // top - bottom
  lowFloor: number; // min floor
}

export interface CheckResult {
  ok: boolean;
  floorz: number;
  ceilingz: number;
  dropoffz: number;
  blockingLine: Line | null;
  blockingThing: Mobj | null;
  /** special lines whose bbox the move crossed (for W1/WR triggers) */
  specLines: Line[];
}

export interface MoveHooks {
  /** Called after a successful move for each special line crossed. oldSide = side of the line before the move. */
  onCross?(line: Line, oldSide: 0 | 1, mover: Mobj): void;
  /** Mover (with MF_PICKUP) touched an MF_SPECIAL thing. */
  onTouchSpecial?(item: Mobj, toucher: Mobj): void;
  /** Mover is a MF_MISSILE and hit a shootable/solid thing. Return true to stop (missile explodes). */
  onMissileHit?(missile: Mobj, target: Mobj): boolean;
}

export type HitResult =
  | { kind: 'none' }
  | { kind: 'wall'; x: number; y: number; z: number; line: Line; frac: number }
  | { kind: 'thing'; x: number; y: number; z: number; thing: Mobj; frac: number };

export interface Geo {
  level: Level;
  /** DOOM P_CheckPosition: is (x,y) valid for mobj m; fills floor/ceiling info. No side effects on m. */
  checkPosition(m: Mobj, x: number, y: number, hooks?: MoveHooks): CheckResult;
  /** P_TryMove: move if valid (step<=24, headroom, dropoff rules), update links/floorz/ceilingz, fire hooks. */
  tryMove(m: Mobj, x: number, y: number, hooks?: MoveHooks): boolean;
  /** Move by momentum with wall sliding (P_SlideMove-lite). Returns true if any movement happened. */
  slideMove(m: Mobj, hooks?: MoveHooks): boolean;
  /** Link m into blockmap + sector (sets m.subsector/m.sector). */
  setThingPosition(m: Mobj): void;
  unsetThingPosition(m: Mobj): void;
  /** Update floorz/ceilingz/dropoffz for m at its current position (after teleports / sector moves). */
  updateFloorCeiling(m: Mobj): void;
  /** P_CheckSight: line of sight between two mobjs (eye heights: z + height*0.75 / z + height/2). */
  checkSight(a: Mobj, b: Mobj): boolean;
  /**
   * Hitscan trace from shooter (at height z) along angle for `range`. First shootable thing whose 2D circle the ray
   * crosses and whose vertical extent is within generous autoaim of z, or the first blocking wall / closed opening.
   * Does not apply damage.
   */
  hitscan(shooter: Mobj, angle: number, range: number, z: number): HitResult;
  /** P_UseLines: first line within 64 units in front of user. 'noway' if a non-special solid line blocks. */
  useTrace(user: Mobj): { line: Line; side: 0 | 1 } | 'noway' | null;
  /** Iterate mobjs (via blockmap) within radius r of (x,y). Callback returns false to stop. */
  thingsInRadius(x: number, y: number, r: number, cb: (m: Mobj) => boolean | void): void;
  /** Iterate lines (via blockmap) intersecting the bbox. Callback returns false to stop. */
  linesInBox(minx: number, miny: number, maxx: number, maxy: number, cb: (l: Line) => boolean | void): void;
  lineOpening(line: Line): Opening;
  /** Teleport-style move: unlink, set position, relink, update floor/ceiling. Stomps nothing. */
  teleportMove(m: Mobj, x: number, y: number): boolean;
  /** Line distance helper: 0 front/right, 1 back/left */
  pointOnLineSide(x: number, y: number, line: Line): 0 | 1;
}

// ---------------------------------------------------------------- assets (src/wad)
/** Column-major pixel storage: pixels[x * height + y] = palette index; mask[x*height+y] = 1 if opaque. */
export interface Patch {
  width: number;
  height: number;
  leftOffset: number;
  topOffset: number;
  pixels: Uint8Array;
  mask: Uint8Array;
}

export interface Texture {
  name: string;
  width: number;
  height: number;
  /** column-major */
  pixels: Uint8Array;
  /** null when fully opaque */
  mask: Uint8Array | null;
}

export interface SpriteFrame {
  /** 1 entry when the frame has no rotations, else 8 (index 0 = rotation 1 = facing viewer) */
  rot: Patch[];
  flip: boolean[];
  rotates: boolean;
}

export interface SpriteDef {
  name: string;
  /** index = frame letter (A=0). Undefined where missing. */
  frames: (SpriteFrame | undefined)[];
}

export interface DecodedSound {
  sampleRate: number;
  /** -1..1 */
  samples: Float32Array;
}

export interface Assets {
  wads: Wads;
  /** 768 bytes, palette 0 */
  palette: Uint8Array;
  /** 34 * 256 */
  colormap: Uint8Array;
  /** luminance 0..1 per palette index (palette 0) */
  lum: Float32Array;
  texture(name: string): Texture | null;
  flat(name: string): Uint8Array | null;
  sprite(name4: string): SpriteDef | null;
  /** Standalone picture lumps: TITLEPIC, WIMAP0, INTERPIC, HELP1, CREDIT, STBAR... */
  picture(name: string): Patch | null;
  sound(name: string): DecodedSound | null;
  /** SKY1/SKY2/SKY3 by map name (E1Mx -> SKY1 ...; MAP01-11 SKY1, 12-20 SKY2, 21+ SKY3). */
  skyTexture(mapName: string): Texture | null;
  /** Vanilla animation groups (ordered names). */
  flatAnimGroups: string[][];
  textureAnimGroups: string[][];
  /** SW1xxx <-> SW2xxx (null if not a switch texture) */
  switchPair(name: string): string | null;
  /** True if any wad has the lump. */
  hasLump(name: string): boolean;
}

/** Animated texture/flat aliasing: renderer resolves names through these maps every frame. */
export interface AnimState {
  textureAlias: Map<string, string>;
  flatAlias: Map<string, string>;
}

// ---------------------------------------------------------------- mobjs (src/game)
export interface MobjInfo {
  name: string;
  doomednum: number;
  /** 4-char sprite name */
  sprite: string;
  health: number;
  speed: number;
  radius: number;
  height: number;
  mass: number;
  painChance: number;
  /** missile damage multiplier */
  damage: number;
  flags: number;
  reactionTime: number;
  seeSound: string[] | null;
  attackSound: string | null;
  painSound: string | null;
  deathSound: string[] | null;
  activeSound: string | null;
  /** state entry-point names understood by the game's state machine (spawn/see/melee/missile/pain/death/xdeath) */
  states: Record<string, string | undefined>;
  /** free-form extras (pickup kind, missile type, drop item, decoration, etc.) */
  [extra: string]: unknown;
}

export interface Mobj {
  id: number;
  /** doomednum, or a negative internal id for things without editor numbers */
  type: number;
  info: MobjInfo;
  x: number; y: number; z: number;
  /** radians */
  angle: number;
  momx: number; momy: number; momz: number;
  radius: number;
  height: number;
  floorz: number;
  ceilingz: number;
  dropoffz: number;
  health: number;
  flags: number;
  /** current sprite (4 chars) and frame index (A=0) for rendering */
  sprite: string;
  frame: number;
  fullbright: boolean;
  /** game-owned state object */
  state: unknown;
  tics: number;
  target: Mobj | null;
  tracer: Mobj | null;
  reactiontime: number;
  movedir: number;
  movecount: number;
  threshold: number;
  lastlook: number;
  subsector: Subsector | null;
  sector: Sector | null;
  /** blockmap cell index or -1 */
  blockIndex: number;
  player: Player | null;
  spawnPoint: ThingSpawn | null;
  removed: boolean;
}

// ---------------------------------------------------------------- player
export const AMMO = { BULLETS: 0, SHELLS: 1, ROCKETS: 2, CELLS: 3, NONE: 4 } as const;
export const WEAPON = { FIST: 0, PISTOL: 1, SHOTGUN: 2, CHAINGUN: 3, ROCKET: 4, PLASMA: 5, BFG: 6, CHAINSAW: 7 } as const;

export interface PSprite {
  /** 4-char sprite name or null when hidden */
  sprite: string | null;
  frame: number;
  /** DOOM 320x200 space; default sx=1, sy=32 (WEAPONTOP), 128 = WEAPONBOTTOM */
  sx: number;
  sy: number;
  fullbright: boolean;
}

export interface Player {
  mo: Mobj;
  health: number;
  armor: number;
  /** 0 none, 1 green (1/3), 2 blue (1/2) */
  armorType: number;
  ammo: number[];
  maxAmmo: number[];
  weapons: boolean[];
  readyWeapon: number;
  pendingWeapon: number;
  keys: { blue: boolean; yellow: boolean; red: boolean };
  backpack: boolean;
  berserk: number;
  bob: number;
  viewz: number;
  viewheight: number;
  deltaviewheight: number;
  psprites: PSprite[];
  attackdown: boolean;
  usedown: boolean;
  refire: number;
  /** red flash intensity (ticks down) */
  damagecount: number;
  /** yellow pickup flash */
  bonuscount: number;
  extralight: number;
  killcount: number;
  itemcount: number;
  secretcount: number;
  message: string | null;
  messageTics: number;
  cheats: { god: boolean; noclip: boolean };
  dead: boolean;
  /** who killed us (for facing) */
  attacker: Mobj | null;
}

// ---------------------------------------------------------------- audio
export interface AudioBus {
  /** name like 'DSPISTOL' (case-insensitive, 'DS' prefix optional). origin null/undefined = player-relative full volume. */
  play(name: string, origin?: { x: number; y: number } | null, volume?: number): void;
  setListener(x: number, y: number, angle: number): void;
  muted: boolean;
}

// ---------------------------------------------------------------- game context shared by game modules
export interface LevelStats { totalKills: number; totalItems: number; totalSecrets: number }

export interface GameCtx {
  level: Level;
  geo: Geo;
  assets: Assets;
  audio: AudioBus;
  player: Player;
  mobjs: Set<Mobj>;
  anim: AnimState;
  /** game tics since level start (35/s) */
  tic: number;
  skill: number;
  stats: LevelStats;
  rnd(): number;
  spawn(type: number | string, x: number, y: number, z: number, angle?: number): Mobj | null;
  remove(m: Mobj): void;
  damage(target: Mobj, inflictor: Mobj | null, source: Mobj | null, amount: number): void;
  message(text: string): void;
  exitLevel(secret: boolean): void;
  noiseAlert(emitter: Mobj): void;
  flash(kind: 'damage' | 'bonus', amount: number): void;
  /** Spawn a hitscan bullet puff / blood at a hit point (convenience over spawn). */
  playSound(name: string, origin?: Mobj | { x: number; y: number } | null): void;
}

/** World simulation (monsters, missiles, sector specials) implemented in src/game/world.ts. */
export interface WorldSim {
  /** Called after the level is loaded and ctx.player.mo exists: spawn map things (skill filter), init specials/anims. */
  init(ctx: GameCtx): void;
  /** Advance all non-player thinkers one tic. */
  tick(ctx: GameCtx): void;
  spawn(ctx: GameCtx, type: number | string, x: number, y: number, z: number, angle: number): Mobj | null;
  remove(ctx: GameCtx, m: Mobj): void;
  damage(ctx: GameCtx, target: Mobj, inflictor: Mobj | null, source: Mobj | null, amount: number): void;
  /** Returns true if the line did something. */
  useSpecialLine(ctx: GameCtx, line: Line, side: 0 | 1, user: Mobj): boolean;
  crossSpecialLine(ctx: GameCtx, line: Line, side: 0 | 1, thing: Mobj): void;
  shootSpecialLine(ctx: GameCtx, line: Line, side: 0 | 1, shooter: Mobj): void;
  noiseAlert(ctx: GameCtx, emitter: Mobj): void;
  /** Sector specials affecting the player (damage floors, secrets, exit floors). Call once per tic. */
  playerInSpecialSector(ctx: GameCtx): void;
  /** Radius (explosion) damage. */
  radiusAttack(ctx: GameCtx, spot: Mobj, source: Mobj | null, damage: number): void;
  /** Look up info by doomednum or internal name. */
  infoFor(type: number | string): MobjInfo | null;
}

// ---------------------------------------------------------------- rendering (src/render)
export interface View {
  x: number; y: number; z: number;
  angle: number;
  sector: Sector;
  extralight: number;
  /** >0 = force this colormap (e.g. 32 invulnerability). 0 = normal lighting. */
  fixedColormap: number;
}

export interface RenderOptions {
  anim: AnimState;
  things: Iterable<Mobj>;
  psprites: PSprite[];
  tic: number;
  /** don't draw this mobj (the player's own body) */
  skip?: Mobj | null;
}

/** A grid of character cells. ch = UTF-16 code, fg = 0xRRGGBB. */
export interface CellGrid {
  cols: number;
  rows: number;
  ch: Uint16Array;
  fg: Uint32Array;
}

export function makeGrid(cols: number, rows: number): CellGrid {
  const g: CellGrid = { cols, rows, ch: new Uint16Array(cols * rows), fg: new Uint32Array(cols * rows) };
  g.ch.fill(32);
  g.fg.fill(0xc8c8c8);
  return g;
}
