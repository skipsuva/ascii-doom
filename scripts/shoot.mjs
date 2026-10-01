// Playwright smoke run: drives the game in headless Chrome and saves PNG + ASCII frames to shots/.
// Usage: npm run dev (in another terminal) then: node scripts/shoot.mjs [--url http://localhost:5173]
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const urlIdx = argv.indexOf('--url');
const base = urlIdx >= 0 ? argv[urlIdx + 1] : 'http://localhost:5173';
mkdirSync('shots', { recursive: true });

async function launch() {
  try {
    return await chromium.launch({ channel: 'chrome', headless: true });
  } catch (e) {
    console.log('chrome channel unavailable, falling back to bundled chromium:', e.message);
    return await chromium.launch({ headless: true });
  }
}

const browser = await launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const logs = [];
page.on('console', (m) => { logs.push(`[${m.type()}] ${m.text()}`); if (m.type() === 'error') console.log('console.error:', m.text()); });
page.on('pageerror', (e) => console.log('pageerror:', e.message));

async function snap(name) {
  await page.screenshot({ path: `shots/${name}.png` });
  const txt = await page.evaluate(() => window.__game.ascii());
  writeFileSync(`shots/${name}.txt`, txt);
  const info = await page.evaluate(() => {
    const g = window.__game;
    const p = g.player;
    return { state: g.state, level: g.levelName, tic: g.tic, pos: p ? [Math.round(p.mo.x), Math.round(p.mo.y), Math.round(p.mo.z), Math.round(p.mo.angle * 180 / Math.PI)] : null, health: p?.health, dead: p?.dead };
  });
  console.log(`${name}: ${JSON.stringify(info)}`);
  return info;
}

async function step(name, fn) {
  try { await fn(); } catch (e) { console.log(`step ${name} failed: ${e.message}`); }
}

await step('load', async () => {
  await page.goto(`${base}/?autostart=1&nosound=1&map=E1M1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.ready && window.__game.state === 'PLAYING', null, { timeout: 60000 });
  await page.waitForTimeout(500);
  await snap('01-start');
});
await step('walk', async () => {
  await page.evaluate(() => window.__game.setKey('KeyW', true));
  await page.waitForTimeout(1000);
  await page.evaluate(() => window.__game.setKey('KeyW', false));
  await page.waitForTimeout(200);
  await snap('02-walk');
});
await step('turn', async () => {
  await page.evaluate(() => window.__game.setKey('ArrowLeft', true));
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__game.setKey('ArrowLeft', false));
  await page.waitForTimeout(200);
  await snap('03-turn');
});
await step('fire', async () => {
  await page.evaluate(() => window.__game.setKey('ControlLeft', true));
  await page.waitForTimeout(120);
  await snap('03b-fire');
  await page.evaluate(() => window.__game.setKey('ControlLeft', false));
});
await step('automap', async () => {
  await page.evaluate(() => { window.__game.setKey('Tab', true); window.__game.tick(1); window.__game.setKey('Tab', false); });
  await page.waitForTimeout(200);
  await snap('03c-automap');
  await page.evaluate(() => { window.__game.setKey('Tab', true); window.__game.tick(1); window.__game.setKey('Tab', false); });
});
await step('intermission', async () => {
  await page.evaluate(() => window.__game.exitLevel(false));
  await page.waitForTimeout(300);
  await snap('04-intermission');
});
await step('next-level', async () => {
  await page.evaluate(() => { window.__game.setKey('Enter', true); window.__game.tick(1); window.__game.setKey('Enter', false); });
  await page.waitForTimeout(800);
  const info = await snap('05-e1m2');
  console.log(info.level === 'E1M2' ? 'OK: entered E1M2' : `FAIL: expected E1M2, got ${info.level}`);
});
await step('title', async () => {
  await page.goto(`${base}/?nosound=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__game && window.__game.ready, null, { timeout: 60000 });
  await page.waitForTimeout(600);
  await snap('06-title');
});
writeFileSync('shots/console.log', logs.join('\n'));
await browser.close();
console.log('done; see shots/');
