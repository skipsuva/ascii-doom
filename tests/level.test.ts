import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { WadFile, Wads } from '../src/wad/wad';
import { createGeo, loadLevel, mapList, nextMap } from '../src/level/index';
import { MF, NF_SUBSECTOR, type Level, type Mobj, type MobjInfo } from '../src/types';

function loadWads(): Wads {
  const buf = readFileSync('public/wads/doom1.wad');
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  const wads = new Wads();
  wads.add(new WadFile(ab, 'doom1.wad'));
  return wads;
}

function fakeMobj(x: number, y: number, over: Partial<Mobj> = {}): Mobj {
  const info: MobjInfo = {
    name: 'TEST', doomednum: -1, sprite: 'PLAY', health: 100, speed: 0, radius: 16, height: 56, mass: 100,
    painChance: 0, damage: 0, flags: 0, reactionTime: 0, seeSound: null, attackSound: null, painSound: null,
    deathSound: null, activeSound: null, states: {},
  };
  return {
    id: 1, type: 1, info, x, y, z: 0, angle: Math.PI / 2, momx: 0, momy: 0, momz: 0, radius: 16, height: 56,
    floorz: 0, ceilingz: 0, dropoffz: 0, health: 100, flags: MF.SOLID | MF.SHOOTABLE | MF.PICKUP | MF.DROPOFF,
    sprite: 'PLAY', frame: 0, fullbright: false, state: null, tics: -1, target: null, tracer: null,
    reactiontime: 0, movedir: 0, movecount: 0, threshold: 0, lastlook: 0, subsector: null, sector: null,
    blockIndex: -1, player: {} as never, spawnPoint: null, removed: false, ...over,
  };
}

const wads = loadWads();
const maps = mapList(wads);
const level: Level = loadLevel(wads, 'E1M1');

describe('E1M1 structure', () => {
  it('has geometry', () => {
    expect(level.sectors.length).toBeGreaterThan(0);
    expect(level.lines.length).toBeGreaterThan(0);
    expect(level.sides.length).toBeGreaterThan(0);
    expect(level.vertices.length).toBeGreaterThan(0);
    expect(level.segs.length).toBeGreaterThan(0);
    expect(level.subsectors.length).toBeGreaterThan(0);
    expect(level.nodes.length).toBeGreaterThan(0);
    expect(level.things.length).toBeGreaterThan(0);
    console.log(`E1M1: sectors=${level.sectors.length} lines=${level.lines.length} sides=${level.sides.length} verts=${level.vertices.length} segs=${level.segs.length} ssecs=${level.subsectors.length} nodes=${level.nodes.length} things=${level.things.length} blockmap=${level.blockmap.columns}x${level.blockmap.rows}`);
  });

  it('links lines, sides and sectors', () => {
    for (const line of level.lines) {
      expect(line.front).toBeDefined();
      expect(line.frontSector).toBeDefined();
      expect(level.sectors[line.frontSector.id]).toBe(line.frontSector);
      if (line.back) expect(line.backSector).toBe(line.back.sector);
      else expect(line.backSector).toBeNull();
    }
    for (const seg of level.segs) {
      expect(level.lines[seg.line.id]).toBe(seg.line);
      expect(level.vertices.includes(seg.v1)).toBe(true);
      expect(level.vertices.includes(seg.v2)).toBe(true);
      expect(seg.frontSector).toBeDefined();
    }
    for (const sub of level.subsectors) expect(sub.segs.length).toBeGreaterThan(0);
  });

  it('BSP reaches every subsector exactly once', () => {
    const seen = new Map<number, number>();
    const walk = (num: number) => {
      if (num & NF_SUBSECTOR) {
        const idx = num & 0x7fff;
        seen.set(idx, (seen.get(idx) ?? 0) + 1);
        return;
      }
      const node = level.nodes[num];
      expect(node).toBeDefined();
      walk(node.children[0]);
      walk(node.children[1]);
    };
    walk(level.nodes.length - 1);
    expect(seen.size).toBe(level.subsectors.length);
    for (const [, n] of seen) expect(n).toBe(1);
  });

  it('resolves the player start sector', () => {
    const start = level.things.find(t => t.type === 1);
    expect(start).toBeDefined();
    expect(start!.x).toBe(1056);
    expect(start!.y).toBe(-3616);
    const sec = level.pointInSector(1056, -3616);
    if (sec.floorH !== 0) console.log(`start sector floorH=${sec.floorH} ceilH=${sec.ceilH}`);
    expect(sec.floorH).toBe(0);
    console.log(`start sector #${sec.id}: floor=${sec.floorH} ceil=${sec.ceilH} light=${sec.light}`);
  });
});

describe('map list / progression', () => {
  it('lists the 9 shareware maps in order', () => {
    expect(maps).toEqual(['E1M1', 'E1M2', 'E1M3', 'E1M4', 'E1M5', 'E1M6', 'E1M7', 'E1M8', 'E1M9']);
  });
  it('follows DOOM progression rules', () => {
    expect(nextMap('E1M1', false, maps)).toBe('E1M2');
    expect(nextMap('E1M3', true, maps)).toBe('E1M9');
    expect(nextMap('E1M9', false, maps)).toBe('E1M4');
    expect(nextMap('E1M8', false, maps)).toBeNull();
    const d2 = Array.from({ length: 32 }, (_, i) => `MAP${String(i + 1).padStart(2, '0')}`);
    expect(nextMap('MAP15', true, d2)).toBe('MAP31');
    expect(nextMap('MAP31', true, d2)).toBe('MAP32');
    expect(nextMap('MAP31', false, d2)).toBe('MAP16');
    expect(nextMap('MAP32', false, d2)).toBe('MAP16');
    expect(nextMap('MAP30', false, d2)).toBeNull();
    expect(nextMap('MAP07', false, d2)).toBe('MAP08');
  });
});

describe('collision & traces', () => {
  it('moves the player north from the start and traces walls', () => {
    const geo = createGeo(level);
    const m = fakeMobj(1056, -3616);
    geo.setThingPosition(m);
    geo.updateFloorCeiling(m);
    m.z = m.floorz;
    expect(m.sector).toBe(level.pointInSector(1056, -3616));
    expect(m.sector!.things.has(m)).toBe(true);
    expect(geo.tryMove(m, 1056, -3608)).toBe(true);
    expect(m.y).toBe(-3608);
    expect(m.floorz).toBe(0);
    expect(m.blockIndex).toBeGreaterThanOrEqual(0);

    const hit = geo.hitscan(m, Math.PI / 2, 2048, m.z + 32);
    expect(hit.kind).toBe('wall');
    if (hit.kind === 'wall') {
      expect(hit.y).toBeGreaterThan(m.y);
      console.log(`hitscan north hits line #${hit.line.id} at (${hit.x.toFixed(1)}, ${hit.y.toFixed(1)}) frac=${hit.frac.toFixed(3)}`);
    }

    const use = geo.useTrace(m);
    expect(use === null || use === 'noway').toBe(true);

    // sliding into a wall should not throw and should keep the mobj inside the map
    m.momx = 0; m.momy = 30;
    for (let i = 0; i < 200; i++) geo.slideMove(m);
    expect(Number.isFinite(m.x) && Number.isFinite(m.y)).toBe(true);
    expect(level.pointInSector(m.x, m.y)).toBeDefined();

    // a second solid thing blocks movement; a special one is touched instead
    const other = fakeMobj(m.x, m.y + 40, { id: 2, player: null });
    geo.setThingPosition(other);
    const before = { x: m.x, y: m.y };
    expect(geo.tryMove(m, m.x, m.y + 20)).toBe(false);
    expect(m.x).toBe(before.x);
    expect(m.y).toBe(before.y);
    other.flags = MF.SPECIAL;
    let touched: Mobj | null = null;
    geo.tryMove(m, m.x, m.y + 20, { onTouchSpecial: (item) => { touched = item; } });
    expect(touched).toBe(other);

    // sight between two mobjs in the same room
    const b = fakeMobj(1056, -3500, { id: 3 });
    geo.setThingPosition(b);
    geo.updateFloorCeiling(b);
    b.z = b.floorz;
    expect(geo.checkSight(m, b)).toBe(true);

    let count = 0;
    geo.thingsInRadius(m.x, m.y, 200, () => { count++; });
    expect(count).toBeGreaterThanOrEqual(2);

    geo.unsetThingPosition(m);
    expect(m.blockIndex).toBe(-1);
    expect(m.sector!.things.has(m)).toBe(false);
  });
});
