// Downloads the freely redistributable shareware doom1.wad (v1.9) into public/wads/.
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dest = join(root, 'public', 'wads', 'doom1.wad');
const EXPECTED_SIZE = 4196020;
const EXPECTED_MD5 = 'f0cefca49926d00903cf57551d901abe';
const URLS = [
  'https://raw.githubusercontent.com/Akbar30Bill/DOOM_wads/master/doom1.wad',
  'https://github.com/Akbar30Bill/DOOM_wads/raw/master/doom1.wad',
  'https://distro.ibiblio.org/slitaz/sources/packages/d/doom1.wad',
];

if (existsSync(dest) && statSync(dest).size > 1_000_000) {
  process.exit(0);
}
mkdirSync(dirname(dest), { recursive: true });
let ok = false;
for (const url of URLS) {
  try {
    process.stdout.write(`fetching ${url} ... `);
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) { console.log(`HTTP ${res.status}`); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length < 1_000_000 || buf.toString('latin1', 0, 4) !== 'IWAD') { console.log('not an IWAD'); continue; }
    const md5 = createHash('md5').update(buf).digest('hex');
    writeFileSync(dest, buf);
    console.log(`ok (${buf.length} bytes)`);
    if (buf.length !== EXPECTED_SIZE || md5 !== EXPECTED_MD5) {
      console.warn(`warning: size/md5 differ from doom1.wad v1.9 (size ${buf.length}, md5 ${md5}); continuing anyway`);
    }
    ok = true;
    break;
  } catch (e) {
    console.log(`failed: ${e.message}`);
  }
}
if (!ok) {
  console.error('Could not download doom1.wad. Place a WAD at public/wads/doom1.wad manually.');
  process.exit(1);
}
