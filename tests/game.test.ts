import { describe, expect, it } from 'vitest';
import { AMMO, MF, WEAPON, type GameCtx, type Mobj, type MobjInfo } from '../src/types';
import { createPlayer, carryOverPlayer } from '../src/game/player';
import { bestWeapon, selectWeaponSlot, hasAmmoFor } from '../src/game/weapons';
import { touchSpecial } from '../src/game/pickups';

function fakeMobj(extra: Partial<Mobj> = {}, info: Partial<MobjInfo> = {}): Mobj {
  const inf: MobjInfo = {
    name: 'X', doomednum: 0, sprite: 'XXXX', health: 0, speed: 0, radius: 20, height: 16, mass: 100, painChance: 0,
    damage: 0, flags: 0, reactionTime: 0, seeSound: null, attackSound: null, painSound: null, deathSound: null,
    activeSound: null, states: {}, ...info,
  };
  return {
    id: 1, type: 0, info: inf, x: 0, y: 0, z: 0, angle: 0, momx: 0, momy: 0, momz: 0, radius: 20, height: 16,
    floorz: 0, ceilingz: 128, dropoffz: 0, health: 0, flags: 0, sprite: 'XXXX', frame: 0, fullbright: false,
    state: null, tics: 0, target: null, tracer: null, reactiontime: 0, movedir: 0, movecount: 0, threshold: 0,
    lastlook: 0, subsector: null, sector: null, blockIndex: -1, player: null, spawnPoint: null, removed: false, ...extra,
  };
}

function fakeCtx(player: ReturnType<typeof createPlayer>) {
  const removed: Mobj[] = [];
  const sounds: string[] = [];
  const messages: string[] = [];
  const ctx = {
    player,
    remove: (m: Mobj) => { removed.push(m); m.removed = true; },
    playSound: (n: string) => { sounds.push(n); },
    message: (t: string) => { messages.push(t); },
    flash: () => {},
  } as unknown as GameCtx;
  return { ctx, removed, sounds, messages };
}

describe('weapons', () => {
  it('fresh player has pistol + fist and 50 bullets', () => {
    const p = createPlayer();
    expect(p.weapons[WEAPON.PISTOL]).toBe(true);
    expect(p.ammo[AMMO.BULLETS]).toBe(50);
    expect(hasAmmoFor(p, WEAPON.PISTOL)).toBe(true);
    expect(bestWeapon(p)).toBe(WEAPON.PISTOL);
  });
  it('falls back to fist without ammo and prefers chaingun over shotgun', () => {
    const p = createPlayer();
    p.ammo[AMMO.BULLETS] = 0;
    expect(bestWeapon(p)).toBe(WEAPON.FIST);
    p.weapons[WEAPON.SHOTGUN] = true; p.ammo[AMMO.SHELLS] = 4;
    p.weapons[WEAPON.CHAINGUN] = true; p.ammo[AMMO.BULLETS] = 3;
    expect(bestWeapon(p)).toBe(WEAPON.CHAINGUN);
  });
  it('slot selection only picks owned weapons', () => {
    const p = createPlayer();
    selectWeaponSlot(p, 2);
    expect(p.pendingWeapon).toBe(-1);
    p.weapons[WEAPON.SHOTGUN] = true;
    selectWeaponSlot(p, 2);
    expect(p.pendingWeapon).toBe(WEAPON.SHOTGUN);
  });
});

describe('pickups', () => {
  it('clip gives 10 bullets, dropped clip gives 5, capped at max', () => {
    const p = createPlayer();
    p.mo = fakeMobj({ height: 56 });
    p.mo.player = p;
    const { ctx, removed } = fakeCtx(p);
    const clip = fakeMobj({}, { pickup: 'clip' });
    expect(touchSpecial(ctx, clip, p.mo)).toBe(true);
    expect(p.ammo[AMMO.BULLETS]).toBe(60);
    expect(removed).toContain(clip);
    const dropped = fakeMobj({ flags: MF.DROPPED }, { pickup: 'clip' });
    touchSpecial(ctx, dropped, p.mo);
    expect(p.ammo[AMMO.BULLETS]).toBe(65);
    p.ammo[AMMO.BULLETS] = 200;
    expect(touchSpecial(ctx, fakeMobj({}, { pickup: 'clip' }), p.mo)).toBe(false);
  });
  it('shotgun pickup gives weapon + 8 shells and switches to it', () => {
    const p = createPlayer();
    p.mo = fakeMobj({ height: 56 });
    p.mo.player = p;
    const { ctx, sounds, messages } = fakeCtx(p);
    const sg = fakeMobj({}, { pickup: 'shotgun' });
    expect(touchSpecial(ctx, sg, p.mo)).toBe(true);
    expect(p.weapons[WEAPON.SHOTGUN]).toBe(true);
    expect(p.ammo[AMMO.SHELLS]).toBe(8);
    expect(p.pendingWeapon).toBe(WEAPON.SHOTGUN);
    expect(sounds).toContain('DSWPNUP');
    expect(messages[0]).toMatch(/shotgun/);
  });
  it('medikit does nothing at full health; backpack doubles max ammo; keys and items count', () => {
    const p = createPlayer();
    p.mo = fakeMobj({ height: 56 });
    p.mo.player = p;
    const { ctx } = fakeCtx(p);
    expect(touchSpecial(ctx, fakeMobj({}, { pickup: 'medikit' }), p.mo)).toBe(false);
    p.health = 30;
    expect(touchSpecial(ctx, fakeMobj({}, { pickup: 'medikit' }), p.mo)).toBe(true);
    expect(p.health).toBe(55);
    touchSpecial(ctx, fakeMobj({}, { pickup: 'backpack' }), p.mo);
    expect(p.maxAmmo[AMMO.BULLETS]).toBe(400);
    touchSpecial(ctx, fakeMobj({ flags: MF.COUNTITEM }, { pickup: 'bluecard' }), p.mo);
    expect(p.keys.blue).toBe(true);
    expect(p.itemcount).toBe(1);
    // items out of vertical reach are ignored
    expect(touchSpecial(ctx, fakeMobj({ z: 100 }, { pickup: 'clip' }), p.mo)).toBe(false);
  });
  it('carry over keeps ammo/weapons, drops keys', () => {
    const p = createPlayer();
    p.keys.red = true; p.weapons[WEAPON.CHAINGUN] = true; p.ammo[AMMO.BULLETS] = 123; p.health = 42;
    const n = carryOverPlayer(p);
    expect(n.keys.red).toBe(false);
    expect(n.weapons[WEAPON.CHAINGUN]).toBe(true);
    expect(n.ammo[AMMO.BULLETS]).toBe(123);
    expect(n.health).toBe(42);
  });
});
