import { describe, expect, it } from 'vitest';
import { STATES, S_NULL, allInfos, infoFor } from '../src/game/info';
import { createWorld } from '../src/game/world';
import { MF } from '../src/types';
import type { GameCtx, Geo, Level, Mobj, Player, Sector } from '../src/types';

describe('info tables', () => {
  it('has the shareware roster with DOOM stats', () => {
    expect(infoFor(3004)?.health).toBe(20);
    expect(infoFor(9)?.health).toBe(30);
    expect(infoFor(3001)?.health).toBe(60);
    expect(infoFor(3002)?.health).toBe(150);
    expect(infoFor(58)?.flags! & MF.SHADOW).toBeTruthy();
    expect(infoFor(3003)?.health).toBe(1000);
    expect(infoFor(2035)?.health).toBe(20);
    expect(infoFor('PLAYER')?.radius).toBe(16);
    expect(infoFor(2007)?.pickup).toBe('clip');
    expect(infoFor(2001)?.pickup).toBe('shotgun');
    expect(infoFor(5)?.pickup).toBe('bluecard');
  });
  it('has unique doomednums', () => {
    const seen = new Set<number>();
    for (const i of allInfos()) {
      if (i.doomednum <= 0) continue;
      expect(seen.has(i.doomednum)).toBe(false);
      seen.add(i.doomednum);
    }
  });
  it('state table is closed: every next/state exists and frames are sane', () => {
    for (const [name, st] of Object.entries(STATES)) {
      expect(STATES[st.next], `${name} -> ${st.next}`).toBeDefined();
      expect(st.sprite.length).toBe(4);
      expect(st.frame).toBeGreaterThanOrEqual(0);
      expect(st.frame).toBeLessThan(29);
      expect(st.tics === -1 || st.tics >= 0).toBe(true);
    }
    for (const i of allInfos()) {
      for (const [k, s] of Object.entries(i.states)) {
        expect(STATES[s!], `${i.name}.${k}=${s}`).toBeDefined();
      }
      expect(i.states.spawn).toBeDefined();
    }
    expect(STATES[S_NULL]).toBeDefined();
  });
});

// ------------------------------------------------------------------ fake geo smoke test
function fakeSector(): Sector {
  return { id: 0, floorH: 0, ceilH: 128, floorFlat: 'FLOOR0_1', ceilFlat: 'CEIL1_1', light: 160, special: 0, tag: 0,
    lines: [], neighbors: [], things: new Set(), specialData: null, lightData: null, soundTarget: null, validcount: 0 };
}
function fakeCtx(): GameCtx {
  const sector = fakeSector();
  const level = { name: 'E1M1', sectors: [sector], lines: [], things: [], pointInSector: () => sector,
    pointInSubsector: () => ({ id: 0, sector, segs: [] }) } as unknown as Level;
  const geo: Geo = {
    level,
    checkPosition: () => ({ ok: true, floorz: 0, ceilingz: 128, dropoffz: 0, blockingLine: null, blockingThing: null, specLines: [] }),
    tryMove(m, x, y) { m.x = x; m.y = y; m.floorz = 0; m.ceilingz = 128; return true; },
    slideMove: () => false,
    setThingPosition(m) { m.sector = sector; sector.things.add(m); },
    unsetThingPosition(m) { sector.things.delete(m); },
    updateFloorCeiling(m) { m.floorz = 0; m.ceilingz = 128; m.dropoffz = 0; },
    checkSight: () => true,
    hitscan: () => ({ kind: 'none' }),
    useTrace: () => null,
    thingsInRadius: (_x, _y, _r, cb) => { for (const m of ctx.mobjs) if (cb(m) === false) break; },
    linesInBox: () => {},
    lineOpening: () => ({ top: 128, bottom: 0, range: 128, lowFloor: 0 }),
    teleportMove(m, x, y) { m.x = x; m.y = y; return true; },
    pointOnLineSide: () => 0,
  };
  const sounds: string[] = [];
  const ctx = {
    level, geo, audio: { play: () => {}, setListener: () => {}, muted: true },
    assets: { sprite: () => ({ name: 'X', frames: [] }), texture: () => null, textureAnimGroups: [], flatAnimGroups: [], switchPair: () => null },
    player: null as unknown as Player, mobjs: new Set<Mobj>(), anim: { textureAlias: new Map(), flatAlias: new Map() },
    tic: 0, skill: 3, stats: { totalKills: 0, totalItems: 0, totalSecrets: 0 },
    rnd: () => (Math.random() * 256) | 0,
    spawn: (t: number | string, x: number, y: number, z: number, a = 0) => world.spawn(ctx, t, x, y, z, a),
    remove: (m: Mobj) => world.remove(ctx, m),
    damage: (t: Mobj, i: Mobj | null, s: Mobj | null, d: number) => world.damage(ctx, t, i, s, d),
    message: () => {}, exitLevel: () => {}, noiseAlert: (e: Mobj) => world.noiseAlert(ctx, e), flash: () => {},
    playSound: (n: string) => { sounds.push(n); }, sounds,
  } as unknown as GameCtx & { sounds: string[] };
  const world = createWorld();
  const mo = world.spawn(ctx, 'PLAYER', 0, 0, 0, 0)!;
  const player: Player = {
    mo, health: 100, armor: 0, armorType: 0, ammo: [50, 0, 0, 0], maxAmmo: [200, 50, 50, 300], weapons: [true, true],
    readyWeapon: 1, pendingWeapon: 1, keys: { blue: false, yellow: false, red: false }, backpack: false, berserk: 0, bob: 0,
    viewz: 41, viewheight: 41, deltaviewheight: 0, psprites: [], attackdown: false, usedown: false, refire: 0,
    damagecount: 0, bonuscount: 0, extralight: 0, killcount: 0, itemcount: 0, secretcount: 0, message: null, messageTics: 0,
    cheats: { god: false, noclip: false }, dead: false, attacker: null,
  };
  mo.player = player;
  ctx.player = player;
  (ctx as unknown as { world: typeof world }).world = world;
  return ctx;
}

describe('world simulation (fake geo)', () => {
  it('spawns a zombieman, it wakes up, chases, and dies when damaged', () => {
    const ctx = fakeCtx() as GameCtx & { world: ReturnType<typeof createWorld>; sounds: string[] };
    const world = ctx.world;
    const z = world.spawn(ctx, 3004, 200, 0, Number.NaN, Math.PI)!; // facing west, toward the player
    expect(z.health).toBe(20);
    expect(z.sprite).toBe('POSS');
    expect(ctx.mobjs.size).toBe(2);
    // run some tics: A_Look should see the player and switch to the run state
    for (let i = 0; i < 40; i++) { ctx.tic++; world.tick(ctx); }
    expect(String(z.state).startsWith('POSS_RUN') || String(z.state).startsWith('POSS_ATK')).toBe(true);
    expect(z.target).toBe(ctx.player.mo);
    // shoot it
    world.damage(ctx, z, ctx.player.mo, ctx.player.mo, 15);
    expect(z.health).toBe(5);
    world.damage(ctx, z, ctx.player.mo, ctx.player.mo, 15);
    expect(z.health).toBeLessThanOrEqual(0);
    expect(z.flags & MF.SHOOTABLE).toBe(0);
    expect(z.flags & MF.CORPSE).toBeTruthy();
    expect(ctx.player.killcount).toBe(1);
    // corpse animates to the final frame and stays
    for (let i = 0; i < 60; i++) { ctx.tic++; world.tick(ctx); }
    expect(z.removed).toBe(false);
    expect(z.tics).toBe(-1);
    expect(z.frame).toBe('L'.charCodeAt(0) - 65);
    // it dropped a clip
    const clip = [...ctx.mobjs].find(m => m.type === 2007);
    expect(clip).toBeDefined();
    expect(clip!.flags & MF.DROPPED).toBeTruthy();
  });
  it('damages the player through armor and kills at zero', () => {
    const ctx = fakeCtx() as GameCtx & { world: ReturnType<typeof createWorld>; sounds: string[] };
    const p = ctx.player;
    p.armor = 100; p.armorType = 1;
    ctx.world.damage(ctx, p.mo, null, null, 30);
    expect(p.armor).toBe(90);
    expect(p.health).toBe(80);
    expect(ctx.sounds).toContain('DSPLPAIN');
    ctx.world.damage(ctx, p.mo, null, null, 1000);
    expect(p.dead).toBe(true);
    expect(p.health).toBe(0);
  });
  it('missiles fly and explode into their death state', () => {
    const ctx = fakeCtx() as GameCtx & { world: ReturnType<typeof createWorld> };
    const ball = ctx.world.spawn(ctx, 'BAL1', 0, 0, 32, 0)!;
    ball.momx = 10;
    for (let i = 0; i < 5; i++) { ctx.tic++; ctx.world.tick(ctx); }
    expect(ball.x).toBeGreaterThan(40);
    // fake geo: block the next move
    ctx.geo.tryMove = () => false;
    ctx.tic++; ctx.world.tick(ctx);
    expect(ball.flags & MF.MISSILE).toBe(0);
    expect(String(ball.state).startsWith('BAL1_DIE')).toBe(true);
    for (let i = 0; i < 30; i++) { ctx.tic++; ctx.world.tick(ctx); }
    expect(ball.removed).toBe(true);
  });
});
