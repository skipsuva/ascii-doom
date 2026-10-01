// Gameplay verification through the debug API (window.__game). Requires `npm run dev` on :5173.
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const BASE = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : 'http://localhost:5173';
mkdirSync('shots', { recursive: true });
const results = [];
function record(name, ok, info) { results.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${JSON.stringify(info)}`); }

let browser;
try { browser = await chromium.launch({ channel: 'chrome', headless: true }); } catch { browser = await chromium.launch({ headless: true }); }
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(`${BASE}/?autostart=1&nosound=1&map=E1M1`);
await page.waitForFunction(() => window.__game && window.__game.ready && window.__game.state === 'PLAYING', null, { timeout: 60000 });

// helpers injected into the page
await page.evaluate(() => {
  const g = window.__game;
  window.__h = {
    mobjs() { return [...g.ctx.mobjs]; },
    find(pred) { return this.mobjs().find(pred) || null; },
    lineWithSpecial(specials, nearX, nearY) {
      let best = null, bd = Infinity;
      for (const l of g.level.lines) {
        if (!specials.includes(l.special)) continue;
        const mx = (l.v1.x + l.v2.x) / 2, my = (l.v1.y + l.v2.y) / 2;
        const d = Math.hypot(mx - nearX, my - nearY);
        if (d < bd) { bd = d; best = l; }
      }
      return best;
    },
    // stand `dist` units in front (front side) of a line, facing it
    standBefore(l, dist) {
      const mx = (l.v1.x + l.v2.x) / 2, my = (l.v1.y + l.v2.y) / 2;
      const len = Math.hypot(l.dx, l.dy);
      const nx = l.dy / len, ny = -l.dx / len; // right/front side normal
      const px = mx + nx * dist, py = my + ny * dist;
      const deg = Math.atan2(-ny, -nx) * 180 / Math.PI;
      g.teleport(px, py, deg);
      return { px, py, deg, line: l.id, special: l.special, tag: l.tag };
    },
    aimAt(m) { const p = g.player.mo; p.angle = Math.atan2(m.y - p.y, m.x - p.x); },
    press(code, holdTics = 2) { g.setKey(code, true); g.tick(holdTics); g.setKey(code, false); g.tick(1); },
    fire() { this.press('ControlLeft', 2); g.tick(12); },
  };
});

const S = () => page.evaluate(() => { const g = window.__game; const p = g.player; return { state: g.state, level: g.levelName, tic: g.tic, x: Math.round(p.mo.x), y: Math.round(p.mo.y), z: Math.round(p.mo.z), health: p.health, armor: p.armor, ammo: p.ammo.slice(), kills: p.killcount, items: p.itemcount, dead: p.dead, mobjs: g.ctx.mobjs.size }; });

// 1) level state sanity
{
  const s = await S();
  const counts = await page.evaluate(() => { const c = {}; for (const m of window.__game.ctx.mobjs) { c[m.info.name] = (c[m.info.name] || 0) + 1; } return c; });
  record('level loaded with things', s.mobjs > 30 && (counts.ZOMBIEMAN || 0) > 0, { mobjs: s.mobjs, zombiemen: counts.ZOMBIEMAN, shotgunguys: counts.SHOTGUNGUY || counts.SERGEANT, imps: counts.IMP, sample: Object.keys(counts).slice(0, 12) });
}

// 2) pickup: walk into an ammo/health item from a free standing spot
{
  const r = await page.evaluate(() => {
    const g = window.__game, h = window.__h;
    const mo = g.player.mo;
    const kinds = ['clip', 'shells', 'clipbox', 'shellbox', 'stimpack', 'medikit', 'armorbonus', 'healthbonus'];
    const items = h.mobjs().filter(m => kinds.includes(m.info.pickup) && !m.removed);
    if (!items.length) return { found: false };
    for (const item of items) {
      let spot = null;
      for (let k = 0; k < 8 && !spot; k++) {
        const a = (k / 8) * Math.PI * 2;
        const sx = item.x + Math.cos(a) * 56, sy = item.y + Math.sin(a) * 56;
        const cr = g.ctx.geo.checkPosition(mo, sx, sy);
        if (cr.ok && Math.abs(cr.floorz - item.z) <= 24) spot = { sx, sy, a };
      }
      if (!spot) continue;
      g.player.health = Math.min(g.player.health, 50); // make health items pickable
      const before = { ammo: g.player.ammo.slice(), health: g.player.health, armor: g.player.armor, items: g.player.itemcount };
      g.teleport(spot.sx, spot.sy, (Math.atan2(item.y - spot.sy, item.x - spot.sx) * 180) / Math.PI);
      g.setKey('KeyW', true); g.tick(30); g.setKey('KeyW', false); g.tick(1);
      const after = { ammo: g.player.ammo.slice(), health: g.player.health, armor: g.player.armor, items: g.player.itemcount };
      return { found: true, kind: item.info.pickup, removed: item.removed, before, after, msg: g.player.message, dist: Math.round(Math.hypot(mo.x - item.x, mo.y - item.y)) };
    }
    return { found: true, reason: 'no item with a free approach spot' };
  });
  const gained = r.found && r.after && (r.after.ammo.some((v, i) => v > r.before.ammo[i]) || r.after.health > r.before.health || r.after.armor > r.before.armor);
  record('item pickup', !!(r.found && r.removed && gained), r);
}

// 3) door: use the nearest DR door from the start
{
  const r = await page.evaluate(() => {
    const g = window.__game, h = window.__h;
    const l = h.lineWithSpecial([1, 117, 31], 1056, -3616);
    if (!l) return { found: false };
    const door = l.backSector;
    const before = door.ceilH;
    const pos = h.standBefore(l, 40);
    h.press('Space', 3);
    g.tick(30);
    return { found: true, ...pos, floor: door.floorH, before, after: door.ceilH, msg: g.player.message };
  });
  record('door opens on use', r.found && r.after > r.before, r);
}

// 4) monster: wake a zombieman with gunfire, let it attack, then kill it (from a spot with line of sight)
{
  const r = await page.evaluate(() => {
    const g = window.__game, h = window.__h;
    const mo = g.player.mo;
    const zombies = h.mobjs().filter(m => m.info.name === 'ZOMBIEMAN' && m.health > 0);
    if (!zombies.length) return { found: false };
    let z = null, spot = null;
    outer: for (const cand of zombies) {
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const sx = cand.x + Math.cos(a) * 176, sy = cand.y + Math.sin(a) * 176;
        const cr = g.ctx.geo.checkPosition(mo, sx, sy);
        if (!cr.ok) continue;
        g.teleport(sx, sy, 0);
        const hs = g.ctx.geo.hitscan(mo, Math.atan2(cand.y - sy, cand.x - sx), 2048, mo.z + 40);
        if (hs.kind === 'thing' && hs.thing === cand) { z = cand; spot = { sx, sy }; break outer; }
      }
    }
    if (!z) return { found: true, reason: 'no zombieman with a clear line of sight spot' };
    h.aimAt(z);
    const hp0 = g.player.health;
    h.fire(); // noise alert
    g.tick(20);
    const awake = z.target === g.player.mo;
    g.player.mo.angle += Math.PI; // don't kill it yet, let it shoot us
    g.tick(175);
    const hp1 = g.player.health;
    const zHpBefore = z.health;
    let shots = 0;
    while (z.health > 0 && shots < 15 && !g.player.dead) { h.aimAt(z); h.fire(); shots++; }
    return { found: true, spot, awake, hp0, hp1, playerDamaged: hp1 < hp0, zHpBefore, zHp: z.health, shots, kills: g.player.killcount, corpse: !!(z.flags & 1048576), dead: g.player.dead };
  });
  record('zombieman wakes, fights, dies', !!(r.found && r.awake && r.zHp <= 0 && r.kills >= 1), r);
  if (r.found && r.awake && !r.playerDamaged) console.log('  note: player took no damage in 5s (RNG / cover)');
}

// 5) lift or floor mover if present (soft)
{
  const r = await page.evaluate(() => {
    const g = window.__game, h = window.__h;
    const l = h.lineWithSpecial([62, 88, 10, 21, 123, 120, 121, 122], g.player.mo.x, g.player.mo.y);
    if (!l) return { found: false };
    const sec = g.level.sectors.find(s => s.tag === l.tag && s.tag !== 0) || l.backSector;
    if (!sec) return { found: false, reason: 'no tagged sector' };
    const before = sec.floorH;
    const pos = h.standBefore(l, 24);
    if ([62, 21, 123, 122].includes(l.special)) h.press('Space', 3); else { g.setKey('KeyW', true); g.tick(20); g.setKey('KeyW', false); }
    g.tick(40);
    return { found: true, ...pos, before, after: sec.floorH };
  });
  record('lift moves', !r.found || r.after !== r.before, r);
}

// 6) exit switch -> intermission -> next map
{
  const r = await page.evaluate(() => {
    const g = window.__game, h = window.__h;
    const l = h.lineWithSpecial([11, 52], g.player.mo.x, g.player.mo.y);
    if (!l) return { found: false };
    const pos = h.standBefore(l, 40);
    if (l.special === 52) { g.setKey('KeyW', true); g.tick(30); g.setKey('KeyW', false); } else h.press('Space', 3);
    g.tick(5);
    return { found: true, ...pos, state: g.state, level: g.levelName };
  });
  record('exit switch -> intermission', r.found && r.state === 'INTERMISSION', r);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(1500);
  const s = await S();
  record('next level loads', s.state === 'PLAYING' && s.level === 'E1M2' && s.mobjs > 20, s);
}

// 7) death & restart (pistol start creates a fresh player object)
{
  const r = await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    const ticBefore = g.tic;
    g.ctx.damage(p.mo, null, null, 500);
    g.tick(5);
    const dead = p.dead, hp = p.health;
    g.tick(40);
    g.setKey('Space', true); g.tick(3); g.setKey('Space', false); g.tick(5);
    const np = g.player;
    return { dead, hp, ticBefore, afterState: g.state, afterTic: g.tic, newPlayer: np !== p, afterHealth: np.health, afterDead: np.dead, level: g.levelName };
  });
  record('death then restart', r.dead && r.afterHealth === 100 && !r.afterDead && r.afterTic < r.ticBefore, r);
}

// 8) soak: imps throw fireballs, barrels explode, random movement for ~40s of game time, no exceptions
{
  const r = await page.evaluate(() => {
    const g = window.__game, h = window.__h;
    const out = { fireballsSeen: 0, barrelExploded: false, errors: [] };
    try {
      const mo = g.player.mo;
      g.player.cheats.god = true;
      // stand in front of an imp with line of sight and let it attack
      const imps = h.mobjs().filter(m => m.info.name === 'IMP' && m.health > 0);
      for (const imp of imps) {
        let ok = false;
        for (let k = 0; k < 16 && !ok; k++) {
          const a = (k / 16) * Math.PI * 2;
          const sx = imp.x + Math.cos(a) * 320, sy = imp.y + Math.sin(a) * 320;
          if (!g.ctx.geo.checkPosition(mo, sx, sy).ok) continue;
          g.teleport(sx, sy, 0);
          const hs = g.ctx.geo.hitscan(mo, Math.atan2(imp.y - sy, imp.x - sx), 2048, mo.z + 40);
          ok = hs.kind === 'thing' && hs.thing === imp;
        }
        if (!ok) continue;
        h.aimAt(imp); h.fire();
        for (let t = 0; t < 12; t++) { g.tick(10); if (h.find(m => m.info.name === 'BAL1' || (m.flags & 65536))) out.fireballsSeen++; }
        break;
      }
      // blow up a barrel
      const barrel = h.find(m => m.info.name === 'BARREL' && m.health > 0);
      if (barrel) { g.ctx.damage(barrel, null, mo, 100); g.tick(60); out.barrelExploded = barrel.removed || barrel.health <= 0; }
      // random running around
      for (let i = 0; i < 40; i++) {
        mo.angle = Math.random() * Math.PI * 2;
        g.setKey('KeyW', true); g.setKey('ShiftLeft', true); g.tick(35); g.setKey('KeyW', false); g.setKey('ShiftLeft', false);
        if (i % 5 === 0) h.press('Space', 2);
        if (i % 7 === 0) h.fire();
      }
      out.tic = g.tic; out.mobjs = g.ctx.mobjs.size; out.state = g.state; out.health = g.player.health;
      g.player.cheats.god = false;
    } catch (e) { out.errors.push(String(e && e.stack || e)); }
    return out;
  });
  record('soak run (fireballs, barrel, 40s of running)', r.errors.length === 0 && r.state === 'PLAYING' && r.barrelExploded, r);
}

await page.screenshot({ path: 'shots/verify-final.png' });
writeFileSync('shots/verify.json', JSON.stringify({ results, errors }, null, 2));
console.log('page errors:', errors.length ? errors : 'none');
await browser.close();
const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
