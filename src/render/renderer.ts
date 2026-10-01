// DOOM-style software renderer: front-to-back BSP walk, per-column walls with ceiling/floor clip arrays,
// per-column floor/ceiling spans, 2D depth buffer for masked walls and sprites. DOM-free.
import type {
  AnimState, Assets, CellGrid, Level, Mobj, Patch, PSprite, RenderOptions, Seg, Subsector, Texture, View,
} from '../types';
import { MF, ML, NF_SUBSECTOR, SKY_FLAT } from '../types';
import { TAU } from '../math';
import { composeCells, RAMP, RAMP_MED } from './ascii';

const NEAR = 1;
const NO_TEX = '-';
const MINZ = 4;

interface MaskedSeg {
  seg: Seg;
  c1: number;
  c2: number;
  tex: Texture;
  texTopZ: number;
  light: number;
  openTop: number;
  openBottom: number;
}

interface VisSprite {
  m: Mobj;
  depth: number;
  side: number;
  patch: Patch;
  flip: boolean;
  light: number;
}

export class Renderer {
  readonly W: number;
  readonly H: number;
  readonly cx: number;
  readonly cy: number;
  readonly projX: number;
  readonly projY: number;
  readonly fb: Uint8Array;
  readonly depth: Float32Array;
  readonly fuzz: Uint8Array;
  /** glyph ramp used by the compositor (dark -> bright) */
  ramp: string = RAMP_MED;
  /** gamma lift applied to cell luminance before ramp lookup */
  gamma = 0.9;
  frameCount = 0;

  private solid: Uint8Array;
  private solidCount = 0;
  private ceilingClip: Int32Array;
  private floorClip: Int32Array;
  private dirX: Float64Array;
  private dirY: Float64Array;
  /** 1 / (cy - (y+0.5)) per framebuffer row */
  private invDen: Float64Array;
  /** floor(1280 / (d + 16)) indexed by (d * 0.5) | 0 */
  private distLight: Uint8Array;
  private level: Level | null = null;
  private vx = 0; private vy = 0; private vz = 0;
  private fwdX = 1; private fwdY = 0; private rgtX = 0; private rgtY = -1;
  private viewAngle = 0;
  private extralight = 0;
  private fixedColormap = 0;
  private anim: AnimState | null = null;
  private texCache = new Map<string, Texture | null>();
  private flatCache = new Map<string, Uint8Array | null>();
  private masked: MaskedSeg[] = [];
  private sky: Texture | null = null;
  private skyFor = '';
  private missingTex: Texture;
  private missingFlat: Uint8Array;

  constructor(public assets: Assets, public cols: number, public rows: number, public cellAspect: number, public ss = 2) {
    this.W = cols * ss;
    this.H = rows * ss;
    this.cx = this.W / 2;
    this.cy = this.H / 2;
    this.projX = this.W / 2;
    this.projY = this.projX * cellAspect;
    const n = this.W * this.H;
    this.fb = new Uint8Array(n);
    this.depth = new Float32Array(n);
    this.fuzz = new Uint8Array(n);
    this.solid = new Uint8Array(this.W);
    this.ceilingClip = new Int32Array(this.W);
    this.floorClip = new Int32Array(this.W);
    this.dirX = new Float64Array(this.W);
    this.dirY = new Float64Array(this.W);
    this.invDen = new Float64Array(this.H);
    for (let y = 0; y < this.H; y++) {
      const den = this.cy - (y + 0.5);
      this.invDen[y] = den === 0 ? 0 : 1 / den;
    }
    this.distLight = new Uint8Array(4096);
    for (let k = 0; k < 4096; k++) this.distLight[k] = Math.floor(1280 / (k * 2 + 16));
    const mt = new Uint8Array(64 * 64);
    const mf = new Uint8Array(64 * 64);
    for (let x = 0; x < 64; x++) for (let y = 0; y < 64; y++) {
      const v = ((x >> 3) + (y >> 3)) & 1 ? 4 : 0;
      mt[x * 64 + y] = v;
      mf[y * 64 + x] = v;
    }
    this.missingTex = { name: '-MISSING-', width: 64, height: 64, pixels: mt, mask: null };
    this.missingFlat = mf;
  }

  setLevel(level: Level): void {
    this.level = level;
    this.sky = null;
    this.skyFor = '';
  }

  /** Render the 3D view and write ASCII cells into grid rows [rowOffset, rowOffset+rows). */
  render(view: View, opts: RenderOptions, grid: CellGrid, rowOffset: number, colorMode: boolean): void {
    this.frameCount++;
    this.setupView(view, opts);
    this.fb.fill(0);
    this.depth.fill(Infinity);
    this.fuzz.fill(0);
    this.solid.fill(0);
    this.solidCount = 0;
    this.ceilingClip.fill(-1);
    this.floorClip.fill(this.H);
    this.masked.length = 0;
    this.texCache.clear();
    this.flatCache.clear();
    const level = this.level;
    if (level) {
      if (this.skyFor !== level.name) {
        this.sky = this.assets.skyTexture(level.name);
        this.skyFor = level.name;
      }
      if (level.nodes.length === 0) {
        if (level.subsectors[0]) this.renderSubsector(level.subsectors[0]);
      } else {
        this.renderNode(level.nodes.length - 1);
      }
      this.drawMasked();
      this.drawSprites(opts);
    }
    this.drawPsprites(opts.psprites, view);
    composeCells(this, grid, rowOffset, colorMode);
  }

  // ------------------------------------------------------------------ setup / helpers

  private setupView(view: View, opts: RenderOptions): void {
    this.vx = view.x; this.vy = view.y; this.vz = view.z;
    this.viewAngle = view.angle;
    const c = Math.cos(view.angle), s = Math.sin(view.angle);
    this.fwdX = c; this.fwdY = s;
    this.rgtX = s; this.rgtY = -c;
    this.extralight = view.extralight | 0;
    this.fixedColormap = view.fixedColormap | 0;
    this.anim = opts.anim;
    for (let x = 0; x < this.W; x++) {
      const t = (x + 0.5 - this.cx) / this.projX;
      this.dirX[x] = c + t * s;
      this.dirY[x] = s - t * c;
    }
  }

  private lightIdx(light: number, d: number): number {
    if (this.fixedColormap) return this.fixedColormap;
    let ln = (light >> 4) + this.extralight;
    if (ln < 0) ln = 0; else if (ln > 15) ln = 15;
    let k = (d * 0.5) | 0;
    if (k > 4095) k = 4095;
    const idx = (15 - ln) * 4 - this.distLight[k];
    return idx < 0 ? 0 : idx > 31 ? 31 : idx;
  }

  private getTexture(name: string): Texture | null {
    if (name === NO_TEX || name === '') return null;
    const aliased = this.anim?.textureAlias.get(name) ?? name;
    let t = this.texCache.get(aliased);
    if (t === undefined) {
      t = this.assets.texture(aliased);
      this.texCache.set(aliased, t);
    }
    return t;
  }

  private getFlat(name: string): Uint8Array | null {
    const aliased = this.anim?.flatAlias.get(name) ?? name;
    let f = this.flatCache.get(aliased);
    if (f === undefined) {
      f = this.assets.flat(aliased);
      this.flatCache.set(aliased, f);
    }
    return f;
  }

  // ------------------------------------------------------------------ BSP

  private renderNode(idx: number): void {
    const level = this.level!;
    if (idx & NF_SUBSECTOR) {
      const ss = level.subsectors[idx & 0x7fff];
      if (ss) this.renderSubsector(ss);
      return;
    }
    const node = level.nodes[idx];
    if (!node) return;
    const side = level.pointOnNodeSide(this.vx, this.vy, node);
    this.renderNode(node.children[side]);
    if (this.solidCount >= this.W) return;
    if (this.checkBBox(node.bbox[side ^ 1])) this.renderNode(node.children[side ^ 1]);
  }

  /** Conservative visibility test for a node bbox [top, bottom, left, right]. */
  private checkBBox(bb: number[]): boolean {
    const top = bb[0], bottom = bb[1], left = bb[2], right = bb[3];
    const vx = this.vx, vy = this.vy;
    if (vx >= left && vx <= right && vy >= bottom && vy <= top) return true;
    let xmin = Infinity, xmax = -Infinity;
    let anyBehind = false, anyFront = false;
    for (let k = 0; k < 4; k++) {
      const x = (k === 0 || k === 3) ? left : right;
      const y = k < 2 ? bottom : top;
      const ax = x - vx, ay = y - vy;
      const d = ax * this.fwdX + ay * this.fwdY;
      if (d < NEAR) { anyBehind = true; continue; }
      anyFront = true;
      const s = ax * this.rgtX + ay * this.rgtY;
      const sx = this.cx + s * this.projX / d;
      if (sx < xmin) xmin = sx;
      if (sx > xmax) xmax = sx;
    }
    if (!anyFront) return false;
    let c1: number, c2: number;
    if (anyBehind) { c1 = 0; c2 = this.W - 1; }
    else {
      c1 = Math.max(0, Math.floor(xmin));
      c2 = Math.min(this.W - 1, Math.ceil(xmax));
      if (c2 < c1) return false;
    }
    for (let x = c1; x <= c2; x++) if (!this.solid[x]) return true;
    return false;
  }

  private renderSubsector(ss: Subsector): void {
    const segs = ss.segs;
    for (let i = 0; i < segs.length; i++) this.addSeg(segs[i]);
  }

  // ------------------------------------------------------------------ walls

  private addSeg(seg: Seg): void {
    const v1 = seg.v1, v2 = seg.v2;
    const ex = v2.x - v1.x, ey = v2.y - v1.y;
    const vx = this.vx, vy = this.vy, vz = this.vz;
    // back-face cull: viewer must be on the front (right) side of v1->v2
    if ((vy - v1.y) * ex - (vx - v1.x) * ey >= 0) return;

    const ax = v1.x - vx, ay = v1.y - vy, bx = v2.x - vx, by = v2.y - vy;
    let d1 = ax * this.fwdX + ay * this.fwdY, s1 = ax * this.rgtX + ay * this.rgtY;
    let d2 = bx * this.fwdX + by * this.fwdY, s2 = bx * this.rgtX + by * this.rgtY;
    if (d1 < NEAR && d2 < NEAR) return;
    if (d1 < NEAR) { const t = (NEAR - d1) / (d2 - d1); s1 += (s2 - s1) * t; d1 = NEAR; }
    else if (d2 < NEAR) { const t = (NEAR - d2) / (d1 - d2); s2 += (s1 - s2) * t; d2 = NEAR; }
    // FOV clip (90 deg): left plane s + d >= 0, right plane d - s >= 0
    const f1 = s1 + d1, f2 = s2 + d2;
    if (f1 < 0) {
      if (f2 < 0) return;
      const t = f1 / (f1 - f2);
      s1 += (s2 - s1) * t; d1 += (d2 - d1) * t;
    }
    const g1 = d1 - s1, g2 = d2 - s2;
    if (g2 < 0) {
      if (g1 < 0) return;
      const t = g2 / (g2 - g1);
      s2 += (s1 - s2) * t; d2 += (d1 - d2) * t;
    }
    const x1 = this.cx + s1 * this.projX / d1;
    const x2 = this.cx + s2 * this.projX / d2;
    let c1 = Math.ceil(x1 - 0.5), c2 = Math.ceil(x2 - 0.5) - 1;
    if (c1 < 0) c1 = 0;
    if (c2 >= this.W) c2 = this.W - 1;
    if (c2 < c1) return;

    // ---- classification (R_AddLine / R_StoreWallRange)
    const line = seg.line;
    const side = seg.side === 0 ? line.front : (line.back ?? line.front);
    const front = seg.frontSector, back = seg.backSector;
    const flags = line.flags;
    let isSolid = false, hasUpper = false, hasLower = false, markCeil = false, markFloor = false;
    let ceilZ = front.ceilH;
    const floorZ = front.floorH;
    const frontSky = front.ceilFlat === SKY_FLAT;
    if (!back) {
      isSolid = true; markCeil = true; markFloor = true;
    } else {
      const closed = back.ceilH <= front.floorH || back.floorH >= front.ceilH;
      if (closed) {
        isSolid = true; markCeil = true; markFloor = true;
      } else if (back.ceilH === front.ceilH && back.floorH === front.floorH && back.ceilFlat === front.ceilFlat
        && back.floorFlat === front.floorFlat && back.light === front.light && side.mid === NO_TEX) {
        return;
      }
      markCeil = markCeil || back.ceilH !== front.ceilH || back.ceilFlat !== front.ceilFlat || back.light !== front.light;
      markFloor = markFloor || back.floorH !== front.floorH || back.floorFlat !== front.floorFlat || back.light !== front.light;
      const skyHack = frontSky && back.ceilFlat === SKY_FLAT;
      if (skyHack) ceilZ = back.ceilH;
      hasUpper = back.ceilH < front.ceilH && !skyHack;
      hasLower = back.floorH > front.floorH;
    }
    if (front.ceilH <= vz && !frontSky) markCeil = false;
    if (front.floorH >= vz) markFloor = false;

    const midTex = !back ? (this.getTexture(side.mid) ?? this.missingTex) : null;
    const upperTex = hasUpper ? this.getTexture(side.top) : null;
    const lowerTex = hasLower ? this.getTexture(side.bottom) : null;
    const maskedTex = back && side.mid !== NO_TEX ? this.getTexture(side.mid) : null;
    const yoff = side.yoff;
    const midTop = midTex ? ((flags & ML.DONTPEGBOTTOM) ? front.floorH + midTex.height : front.ceilH) + yoff : 0;
    const upperTop = upperTex ? ((flags & ML.DONTPEGTOP) ? front.ceilH : back!.ceilH + upperTex.height) + yoff : 0;
    const lowerTop = lowerTex ? ((flags & ML.DONTPEGBOTTOM) ? front.ceilH : back!.floorH) + yoff : 0;
    const uBase = seg.offset + side.xoff;
    const segLen = seg.length || Math.hypot(ex, ey);
    let wallLight = front.light;
    if (ey === 0) wallLight -= 16; else if (ex === 0) wallLight += 16;
    const ceilFlat = frontSky ? null : (this.getFlat(front.ceilFlat) ?? this.missingFlat);
    const floorFlat = this.getFlat(front.floorFlat) ?? this.missingFlat;
    const backCeilZ = back ? back.ceilH : 0, backFloorZ = back ? back.floorH : 0;
    const wx0 = v1.x - vx, wy0 = v1.y - vy;
    const H = this.H, cy = this.cy, projY = this.projY;
    let drewAny = false;

    for (let x = c1; x <= c2; x++) {
      if (this.solid[x]) continue;
      const dx = this.dirX[x], dy = this.dirY[x];
      const denom = dx * ey - dy * ex;
      if (denom > -1e-12 && denom < 1e-12) continue;
      let d = (wx0 * ey - wy0 * ex) / denom;
      if (d < 0.25) d = 0.25;
      let sp = (wx0 * dy - wy0 * dx) / denom;
      if (sp < 0) sp = 0; else if (sp > 1) sp = 1;
      const u = uBase + sp * segLen;
      const scale = projY / d;
      const yCeil = cy - (ceilZ - vz) * scale;
      const yFloor = cy - (floorZ - vz) * scale;
      let yl = Math.ceil(yCeil - 0.5), yh = Math.ceil(yFloor - 0.5) - 1;
      const cc = this.ceilingClip[x], fc = this.floorClip[x];
      if (yl <= cc) yl = cc + 1;
      if (yh >= fc) yh = fc - 1;
      const li = this.lightIdx(wallLight, d);

      if (markCeil) {
        const top = cc + 1, bot = Math.min(yl - 1, fc - 1);
        if (top <= bot) {
          if (frontSky) this.drawSky(x, top, bot);
          else this.drawPlane(x, top, bot, front.ceilH, ceilFlat!, front.light);
        }
      }
      if (markFloor) {
        const top = Math.max(yh + 1, cc + 1), bot = fc - 1;
        if (top <= bot) this.drawPlane(x, top, bot, front.floorH, floorFlat, front.light);
      }

      if (!back) {
        if (yl <= yh) this.drawWallColumn(x, yl, yh, midTex!, u, midTop, scale, d, li);
        this.ceilingClip[x] = H; this.floorClip[x] = -1; this.solid[x] = 1; this.solidCount++;
      } else {
        if (hasUpper) {
          const yBackCeil = cy - (backCeilZ - vz) * scale;
          let mid = Math.ceil(yBackCeil - 0.5) - 1;
          if (mid >= fc) mid = fc - 1;
          if (mid > yh) mid = yh;
          if (mid >= yl) {
            if (upperTex) this.drawWallColumn(x, yl, mid, upperTex, u, upperTop, scale, d, li);
            this.ceilingClip[x] = mid;
          } else this.ceilingClip[x] = yl - 1;
        } else if (markCeil) this.ceilingClip[x] = yl - 1;

        if (hasLower) {
          const yBackFloor = cy - (backFloorZ - vz) * scale;
          let mid = Math.ceil(yBackFloor - 0.5);
          const cc2 = this.ceilingClip[x];
          if (mid <= cc2) mid = cc2 + 1;
          if (mid < yl) mid = yl;
          if (mid <= yh) {
            if (lowerTex) this.drawWallColumn(x, mid, yh, lowerTex, u, lowerTop, scale, d, li);
            this.floorClip[x] = mid;
          } else this.floorClip[x] = yh + 1;
        } else if (markFloor) this.floorClip[x] = yh + 1;

        if (isSolid) { this.ceilingClip[x] = H; this.floorClip[x] = -1; this.solid[x] = 1; this.solidCount++; }
      }
      drewAny = true;
    }

    if (drewAny) {
      line.mapped = true;
      if (maskedTex && back) {
        const texTopZ = ((flags & ML.DONTPEGBOTTOM)
          ? Math.max(front.floorH, back.floorH) + maskedTex.height
          : Math.min(front.ceilH, back.ceilH)) + yoff;
        this.masked.push({
          seg, c1, c2, tex: maskedTex, texTopZ, light: wallLight,
          openTop: Math.min(front.ceilH, back.ceilH), openBottom: Math.max(front.floorH, back.floorH),
        });
      }
    }
  }

  private drawWallColumn(x: number, yl: number, yh: number, tex: Texture, u: number, texTopZ: number, scale: number, d: number, li: number): void {
    if (yl < 0) yl = 0;
    if (yh >= this.H) yh = this.H - 1;
    if (yl > yh) return;
    const w = tex.width, h = tex.height;
    let col = Math.floor(u) % w;
    if (col < 0) col += w;
    const base = col * h;
    const px = tex.pixels;
    const cm = this.assets.colormap;
    const cmBase = li * 256;
    const fb = this.fb, depth = this.depth, W = this.W;
    const vStep = 1 / scale;
    let v = texTopZ - (this.vz + (this.cy - (yl + 0.5)) / scale);
    const pow2 = (h & (h - 1)) === 0;
    let i = yl * W + x;
    for (let y = yl; y <= yh; y++, v += vStep, i += W) {
      let tv: number;
      if (pow2) tv = Math.floor(v) & (h - 1);
      else { tv = Math.floor(v) % h; if (tv < 0) tv += h; }
      fb[i] = cm[cmBase + px[base + tv]];
      depth[i] = d;
    }
  }

  private drawPlane(x: number, top: number, bottom: number, planeZ: number, flat: Uint8Array, light: number): void {
    if (top < 0) top = 0;
    if (bottom >= this.H) bottom = this.H - 1;
    if (top > bottom) return;
    const dz = planeZ - this.vz;
    const projY = this.projY, W = this.W;
    const dx = this.dirX[x], dy = this.dirY[x];
    const vx = this.vx, vy = this.vy;
    const cm = this.assets.colormap;
    const fb = this.fb, depth = this.depth;
    const invDen = this.invDen, distLight = this.distLight;
    let ln = (light >> 4) + this.extralight;
    if (ln < 0) ln = 0; else if (ln > 15) ln = 15;
    const startmap = (15 - ln) * 4;
    const fixed = this.fixedColormap;
    const k0 = dz * projY;
    let i = top * W + x;
    for (let y = top; y <= bottom; y++, i += W) {
      const d = k0 * invDen[y];
      if (d <= 0) continue;
      const wx = vx + d * dx, wy = vy + d * dy;
      const tex = flat[(((-wy) & 63) << 6) + (wx & 63)];
      let li: number;
      if (fixed) li = fixed;
      else {
        let k = (d * 0.5) | 0;
        if (k > 4095) k = 4095;
        li = startmap - distLight[k];
        if (li < 0) li = 0; else if (li > 31) li = 31;
      }
      fb[i] = cm[li * 256 + tex];
      depth[i] = d;
    }
  }

  private drawSky(x: number, top: number, bottom: number): void {
    if (top < 0) top = 0;
    if (bottom >= this.H) bottom = this.H - 1;
    if (top > bottom) return;
    const sky = this.sky;
    const fb = this.fb, W = this.W;
    if (!sky) {
      // no sky texture: leave black
      return;
    }
    const t = (x + 0.5 - this.cx) / this.projX;
    let ang = this.viewAngle - Math.atan(t);
    ang -= Math.floor(ang / TAU) * TAU;
    let col = Math.floor((ang / TAU) * 1024) % sky.width;
    if (col < 0) col += sky.width;
    const base = col * sky.height;
    const h = sky.height;
    const px = sky.pixels;
    const cm = this.assets.colormap;
    const rowScale = 168 / this.H;
    let i = top * W + x;
    for (let y = top; y <= bottom; y++, i += W) {
      let row = Math.floor(100 + (y + 0.5 - this.cy) * rowScale) % h;
      if (row < 0) row += h;
      fb[i] = cm[px[base + row]];
    }
  }

  private drawMasked(): void {
    const list = this.masked;
    const vx = this.vx, vy = this.vy, vz = this.vz;
    const W = this.W, H = this.H, cy = this.cy, projY = this.projY;
    const cm = this.assets.colormap;
    const fb = this.fb, depth = this.depth;
    for (let k = 0; k < list.length; k++) {
      const m = list[k];
      const seg = m.seg;
      const v1 = seg.v1;
      const ex = seg.v2.x - v1.x, ey = seg.v2.y - v1.y;
      const segLen = seg.length || Math.hypot(ex, ey);
      const side = seg.side === 0 ? seg.line.front : (seg.line.back ?? seg.line.front);
      const uBase = seg.offset + side.xoff;
      const tex = m.tex;
      const w = tex.width, h = tex.height;
      const px = tex.pixels, mask = tex.mask;
      const topZ = Math.min(m.texTopZ, m.openTop);
      const botZ = Math.max(m.texTopZ - h, m.openBottom);
      if (botZ >= topZ) continue;
      const wx0 = v1.x - vx, wy0 = v1.y - vy;
      for (let x = m.c1; x <= m.c2; x++) {
        const dx = this.dirX[x], dy = this.dirY[x];
        const denom = dx * ey - dy * ex;
        if (denom > -1e-12 && denom < 1e-12) continue;
        let d = (wx0 * ey - wy0 * ex) / denom;
        if (d < 0.25) d = 0.25;
        let sp = (wx0 * dy - wy0 * dx) / denom;
        if (sp < 0) sp = 0; else if (sp > 1) sp = 1;
        const u = uBase + sp * segLen;
        const scale = projY / d;
        const yT = cy - (topZ - vz) * scale, yB = cy - (botZ - vz) * scale;
        let yl = Math.ceil(yT - 0.5), yh = Math.ceil(yB - 0.5) - 1;
        if (yl < 0) yl = 0;
        if (yh >= H) yh = H - 1;
        if (yl > yh) continue;
        let col = Math.floor(u) % w;
        if (col < 0) col += w;
        const base = col * h;
        const cmBase = this.lightIdx(m.light, d) * 256;
        const vStep = 1 / scale;
        let v = m.texTopZ - (vz + (cy - (yl + 0.5)) / scale);
        let i = yl * W + x;
        for (let y = yl; y <= yh; y++, v += vStep, i += W) {
          const tv = Math.floor(v);
          if (tv < 0 || tv >= h) continue;
          if (d >= depth[i]) continue;
          const ti = base + tv;
          if (mask && !mask[ti]) continue;
          fb[i] = cm[cmBase + px[ti]];
          depth[i] = d;
        }
      }
    }
  }

  // ------------------------------------------------------------------ sprites

  private drawSprites(opts: RenderOptions): void {
    const vis: VisSprite[] = [];
    const vx = this.vx, vy = this.vy;
    for (const m of opts.things) {
      if (m === opts.skip || m.removed || (m.flags & MF.NOSECTOR)) continue;
      const def = this.assets.sprite(m.sprite);
      if (!def) continue;
      const fr = def.frames[m.frame];
      if (!fr) continue;
      const tx = m.x - vx, ty = m.y - vy;
      const depth = tx * this.fwdX + ty * this.fwdY;
      if (depth < MINZ) continue;
      const side = tx * this.rgtX + ty * this.rgtY;
      if (Math.abs(side) > depth * 1.05 + 320) continue;
      let rot = 0;
      if (fr.rotates) {
        const ang = Math.atan2(m.y - vy, m.x - vx);
        let rel = ang - m.angle + Math.PI + Math.PI / 8;
        rel -= Math.floor(rel / TAU) * TAU;
        rot = Math.floor(rel / (Math.PI / 4)) & 7;
      }
      const patch = fr.rot[rot] ?? fr.rot[0];
      if (!patch) continue;
      const sec = m.sector ?? m.subsector?.sector ?? null;
      const light = sec ? sec.light : 255;
      vis.push({ m, depth, side, patch, flip: fr.flip[rot] ?? false, light });
    }
    vis.sort((a, b) => b.depth - a.depth);
    for (let i = 0; i < vis.length; i++) this.drawSprite(vis[i]);
  }

  private drawSprite(v: VisSprite): void {
    const { m, depth: d, side, patch, flip } = v;
    const W = this.W, H = this.H, cx = this.cx, cy = this.cy;
    const scaleX = this.projX / d, scaleY = this.projY / d;
    const x1 = cx + (side - patch.leftOffset) * scaleX;
    const x2 = x1 + patch.width * scaleX;
    let c1 = Math.ceil(x1 - 0.5), c2 = Math.ceil(x2 - 0.5) - 1;
    if (c1 < 0) c1 = 0;
    if (c2 >= W) c2 = W - 1;
    if (c1 > c2) return;
    const topZ = m.z + patch.topOffset;
    const yT = cy - (topZ - this.vz) * scaleY;
    const yB = yT + patch.height * scaleY;
    let r1 = Math.ceil(yT - 0.5), r2 = Math.ceil(yB - 0.5) - 1;
    if (r1 < 0) r1 = 0;
    if (r2 >= H) r2 = H - 1;
    if (r1 > r2) return;
    const cmBase = (m.fullbright ? (this.fixedColormap || 0) : this.lightIdx(v.light, d)) * 256;
    const cm = this.assets.colormap;
    const shadow = (m.flags & MF.SHADOW) !== 0;
    const h = patch.height, w = patch.width;
    const invSX = 1 / scaleX, invSY = 1 / scaleY;
    const fb = this.fb, depth = this.depth, fuzz = this.fuzz;
    const px = patch.pixels, mask = patch.mask;
    for (let x = c1; x <= c2; x++) {
      let tc = Math.floor((x + 0.5 - x1) * invSX);
      if (tc < 0) tc = 0; else if (tc >= w) tc = w - 1;
      if (flip) tc = w - 1 - tc;
      const base = tc * h;
      let i = r1 * W + x;
      for (let y = r1; y <= r2; y++, i += W) {
        let tr = Math.floor((y + 0.5 - yT) * invSY);
        if (tr < 0) tr = 0; else if (tr >= h) tr = h - 1;
        const ti = base + tr;
        if (!mask[ti]) continue;
        if (d >= depth[i]) continue;
        if (shadow) fuzz[i] = 1;
        else fb[i] = cm[cmBase + px[ti]];
      }
    }
  }

  private drawPsprites(psprites: PSprite[], view: View): void {
    if (!psprites || psprites.length === 0) return;
    const W = this.W, H = this.H;
    const sxScale = W / 320;
    const syScale = 1.2 * sxScale * this.cellAspect;
    const light = view.sector ? view.sector.light : 255;
    let ln = (light >> 4) + this.extralight;
    if (ln < 0) ln = 0; else if (ln > 15) ln = 15;
    let baseLi = (15 - ln) * 4 - 24;
    if (baseLi < 0) baseLi = 0;
    if (this.fixedColormap) baseLi = this.fixedColormap;
    const cm = this.assets.colormap;
    const fb = this.fb;
    for (const psp of psprites) {
      if (!psp.sprite) continue;
      const def = this.assets.sprite(psp.sprite);
      const fr = def?.frames[psp.frame];
      const patch = fr?.rot[0];
      if (!patch) continue;
      const cmBase = (psp.fullbright ? (this.fixedColormap || 0) : baseLi) * 256;
      const xL = psp.sx - patch.leftOffset;
      const yT168 = psp.sy - 16.5 - patch.topOffset;
      const x0 = xL * sxScale, x1 = (xL + patch.width) * sxScale;
      const y0 = H - (168 - yT168) * syScale, y1 = y0 + patch.height * syScale;
      let c1 = Math.ceil(x0 - 0.5), c2 = Math.ceil(x1 - 0.5) - 1;
      let r1 = Math.ceil(y0 - 0.5), r2 = Math.ceil(y1 - 0.5) - 1;
      if (c1 < 0) c1 = 0;
      if (c2 >= W) c2 = W - 1;
      if (r1 < 0) r1 = 0;
      if (r2 >= H) r2 = H - 1;
      if (c1 > c2 || r1 > r2) continue;
      const h = patch.height, w = patch.width;
      const px = patch.pixels, mask = patch.mask;
      for (let x = c1; x <= c2; x++) {
        let tc = Math.floor((x + 0.5 - x0) / sxScale);
        if (tc < 0) tc = 0; else if (tc >= w) tc = w - 1;
        const base = tc * h;
        let i = r1 * W + x;
        for (let y = r1; y <= r2; y++, i += W) {
          let tr = Math.floor((y + 0.5 - y0) / syScale);
          if (tr < 0) tr = 0; else if (tr >= h) tr = h - 1;
          const ti = base + tr;
          if (!mask[ti]) continue;
          fb[i] = cm[cmBase + px[ti]];
        }
      }
    }
  }
}
