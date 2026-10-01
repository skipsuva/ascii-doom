// Flats: 64x64 raw palette-index lumps between F_START/F_END (FF_START/FF_END). Later WADs override.
import type { Wads } from './wad';

export function loadFlats(wads: Wads): Map<string, Uint8Array> {
  const flats = new Map<string, Uint8Array>();
  for (const l of wads.lumpsBetween('F_START', 'F_END', 'FF_START', 'FF_END')) {
    let d = l.data();
    if (d.length !== 4096) {
      const padded = new Uint8Array(4096);
      padded.set(d.subarray(0, Math.min(d.length, 4096)));
      d = padded;
    }
    flats.set(l.name, d);
  }
  return flats;
}
