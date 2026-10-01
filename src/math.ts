// Angles are radians; 0 = east (+x), counter-clockwise positive (90deg = north, +y) like DOOM.
export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const ANG45 = Math.PI / 4;
export const ANG90 = Math.PI / 2;
export const ANG180 = Math.PI;
export const ANG270 = Math.PI * 1.5;

export function deg2rad(d: number): number { return d * DEG; }
export function rad2deg(r: number): number { return r / DEG; }
/** 16-bit binary angle (SEGS angle field) to radians. */
export function bam16ToRad(a: number): number { return ((a & 0xffff) / 65536) * TAU; }
/** Normalize to [0, TAU). */
export function normAngle(a: number): number {
  a %= TAU;
  return a < 0 ? a + TAU : a;
}
/** Signed smallest difference a-b in (-PI, PI]. */
export function angleDiff(a: number, b: number): number {
  let d = normAngle(a - b);
  if (d > Math.PI) d -= TAU;
  return d;
}
export function pointToAngle(dx: number, dy: number): number { return normAngle(Math.atan2(dy, dx)); }
export function dist2d(dx: number, dy: number): number { return Math.hypot(dx, dy); }
/** DOOM's P_AproxDistance. */
export function approxDist(dx: number, dy: number): number {
  dx = Math.abs(dx); dy = Math.abs(dy);
  return dx < dy ? dx + dy - dx / 2 : dx + dy - dy / 2;
}
export function clamp(v: number, lo: number, hi: number): number { return v < lo ? lo : v > hi ? hi : v; }
export function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
/** Sign as -1/0/1. */
export function sgn(v: number): number { return v > 0 ? 1 : v < 0 ? -1 : 0; }
/** 0..255 random, DOOM style. */
export function rnd255(): number { return (Math.random() * 256) | 0; }
/** DOOM's P_Random()-P_Random(): -255..255. */
export function rndSigned(): number { return rnd255() - rnd255(); }
