// DOOM picture (patch) format decoder → column-major pixels + mask.
import type { Patch } from '../types';

export const EMPTY_PATCH: Patch = {
  width: 1, height: 1, leftOffset: 0, topOffset: 0, pixels: new Uint8Array(1), mask: new Uint8Array(1),
};

/**
 * Decode a picture lump. Never throws; returns null when the header is implausible (not a picture).
 * Column data is bounds-checked, so truncated/corrupt lumps yield partial images instead of errors.
 */
export function decodePatch(bytes: Uint8Array): Patch | null {
  const n = bytes.length;
  if (n < 8) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = dv.getInt16(0, true);
  const height = dv.getInt16(2, true);
  const leftOffset = dv.getInt16(4, true);
  const topOffset = dv.getInt16(6, true);
  if (width <= 0 || height <= 0 || width > 4096 || height > 4096) return null;
  if (n < 8 + width * 4) return null;
  const pixels = new Uint8Array(width * height);
  const mask = new Uint8Array(width * height);
  for (let x = 0; x < width; x++) {
    let p = dv.getUint32(8 + x * 4, true);
    const col = x * height;
    let prevTop = -1;
    while (p < n) {
      const topdelta = bytes[p];
      if (topdelta === 0xff) break;
      if (p + 3 > n) break;
      const len = bytes[p + 1];
      // tall-patch extension: if topdelta <= previous top, it is relative to the previous top
      const top = prevTop >= 0 && topdelta <= prevTop ? prevTop + topdelta : topdelta;
      prevTop = top;
      const src = p + 3;
      for (let i = 0; i < len; i++) {
        const s = src + i;
        if (s >= n) break;
        const y = top + i;
        if (y >= 0 && y < height) {
          pixels[col + y] = bytes[s];
          mask[col + y] = 1;
        }
      }
      p = src + len + 1;
    }
  }
  return { width, height, leftOffset, topOffset, pixels, mask };
}
