// DMX sound lump decoder → Float32 PCM.
import type { DecodedSound } from '../types';

/**
 * DMX: u16 format(3), u16 sampleRate, u32 sampleCount, 16 pad bytes, samples (u8, center 128), 16 pad bytes.
 * v1.9 lumps count the 32 padding bytes in sampleCount; older ones don't — both handled.
 */
export function decodeDmx(bytes: Uint8Array): DecodedSound | null {
  if (bytes.length < 24) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const format = dv.getUint16(0, true);
  if (format !== 3) return null;
  let sampleRate = dv.getUint16(2, true);
  if (sampleRate <= 0) sampleRate = 11025;
  const count = dv.getUint32(4, true);
  const avail = bytes.length - 8;
  const start = 24;
  let n: number;
  if (count + 32 <= avail) n = count;               // count excludes padding
  else n = Math.min(count, avail) - 32;             // count includes padding
  if (n <= 0) n = avail - 32;
  n = Math.min(n, bytes.length - start);
  if (n <= 0) return null;
  const samples = new Float32Array(n);
  for (let i = 0; i < n; i++) samples[i] = (bytes[start + i] - 128) / 128;
  return { sampleRate, samples };
}

export function normalizeSoundName(name: string): string[] {
  const n = name.toUpperCase();
  return n.startsWith('DS') ? [n, 'DS' + n] : ['DS' + n, n];
}
