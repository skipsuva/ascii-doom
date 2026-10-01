// Map list and progression rules.
import type { Wads } from '../wad/wad';

export function mapList(wads: Wads): string[] {
  return wads.mapNames();
}

/** Next map after `current` (null = episode/game finished). */
export function nextMap(current: string, secret: boolean, maps: string[]): string | null {
  const cur = current.toUpperCase();
  const has = (n: string) => maps.includes(n);
  const em = /^E(\d)M(\d)$/.exec(cur);
  if (em) {
    const ep = em[1];
    const mission = Number(em[2]);
    if (secret && mission !== 9 && has(`E${ep}M9`)) return `E${ep}M9`;
    if (mission === 9) return has(`E${ep}M4`) ? `E${ep}M4` : null;
    if (mission === 8) return null;
    const n = `E${ep}M${mission + 1}`;
    return has(n) ? n : null;
  }
  const mm = /^MAP(\d\d)$/.exec(cur);
  if (mm) {
    const n = Number(mm[1]);
    const name = (k: number) => `MAP${String(k).padStart(2, '0')}`;
    if (secret && n === 15 && has('MAP31')) return 'MAP31';
    if (n === 31) {
      if (secret && has('MAP32')) return 'MAP32';
      return has('MAP16') ? 'MAP16' : null;
    }
    if (n === 32) return has('MAP16') ? 'MAP16' : null;
    if (n === 30) return null;
    return has(name(n + 1)) ? name(n + 1) : null;
  }
  const i = maps.indexOf(cur);
  return i >= 0 && i + 1 < maps.length ? maps[i + 1] : null;
}
