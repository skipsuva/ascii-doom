// Blits a CellGrid to a canvas using a per-color glyph atlas.
import type { CellGrid } from '../types';

export interface CanvasEffects {
  scanlines: boolean;
  /** 0xRRGGBB tint color mixed into every glyph by tintAmount (0..1) */
  tint: number;
  tintAmount: number;
}

interface Atlas {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  color: string;
}

const ATLAS_COLS = 32;
const MAX_GLYPHS = 512;

export class GlyphCanvas {
  cols = 80;
  rows = 25;
  cellAspect = 0.5;
  cellW = 8;
  cellH = 16;
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private font = '';
  private offX = 0;
  private offY = 0;
  private atlases = new Map<number, Atlas>();
  private glyphIndex = new Map<number, number>();
  private glyphCount = 0;
  private scanPattern: CanvasPattern | null = null;

  constructor(public canvas: HTMLCanvasElement, public fontPx: number) {
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) throw new Error('2D canvas not available');
    this.ctx = ctx;
    this.resize();
  }

  /** Fit the canvas to the window and recompute the cell grid. */
  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.floor(window.innerWidth * this.dpr));
    const h = Math.max(1, Math.floor(window.innerHeight * this.dpr));
    this.canvas.width = w;
    this.canvas.height = h;
    this.canvas.style.width = window.innerWidth + 'px';
    this.canvas.style.height = window.innerHeight + 'px';
    const fpx = Math.max(4, Math.round(this.fontPx * this.dpr));
    this.font = `${fpx}px Menlo, Consolas, "DejaVu Sans Mono", "Courier New", monospace`;
    this.ctx.font = this.font;
    const adv = this.ctx.measureText('M').width || fpx * 0.6;
    this.cellW = Math.max(1, Math.round(adv));
    this.cellH = Math.max(1, Math.round(fpx * 1.15));
    this.cellAspect = this.cellW / this.cellH;
    this.cols = Math.max(1, Math.floor(w / this.cellW));
    this.rows = Math.max(1, Math.floor(h / this.cellH));
    this.offX = Math.floor((w - this.cols * this.cellW) / 2);
    this.offY = Math.floor((h - this.rows * this.cellH) / 2);
    this.atlases.clear();
    this.glyphIndex.clear();
    this.glyphCount = 0;
    this.scanPattern = null;
    this.ctx.imageSmoothingEnabled = false;
  }

  draw(grid: CellGrid, fx: CanvasEffects): void {
    const ctx = this.ctx;
    const cw = this.cellW, ch = this.cellH;
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const cols = Math.min(grid.cols, this.cols), rows = Math.min(grid.rows, this.rows);
    const tintAmt = fx.tintAmount > 0 ? Math.min(1, fx.tintAmount) : 0;
    const tr = (fx.tint >> 16) & 255, tg = (fx.tint >> 8) & 255, tb = fx.tint & 255;
    let lastKey = -1;
    let atlas: Atlas | null = null;
    for (let r = 0; r < rows; r++) {
      const gi = r * grid.cols;
      const y = this.offY + r * ch;
      for (let c = 0; c < cols; c++) {
        const code = grid.ch[gi + c];
        if (code <= 32) continue;
        let fg = grid.fg[gi + c];
        if (tintAmt > 0) {
          let R = (fg >> 16) & 255, G = (fg >> 8) & 255, B = fg & 255;
          R = (R + (tr - R) * tintAmt) | 0;
          G = (G + (tg - G) * tintAmt) | 0;
          B = (B + (tb - B) * tintAmt) | 0;
          fg = (R << 16) | (G << 8) | B;
        }
        const key = ((fg >> 12) & 0xf00) | ((fg >> 8) & 0xf0) | ((fg >> 4) & 0xf);
        if (key !== lastKey || !atlas) {
          atlas = this.atlasFor(key);
          lastKey = key;
        }
        let idx = this.glyphIndex.get(code);
        if (idx === undefined) idx = this.registerGlyph(code);
        if (idx < 0) continue;
        ctx.drawImage(atlas.canvas, (idx % ATLAS_COLS) * cw, Math.floor(idx / ATLAS_COLS) * ch, cw, ch, this.offX + c * cw, y, cw, ch);
      }
    }
    if (fx.scanlines) {
      if (!this.scanPattern) {
        const pc = document.createElement('canvas');
        pc.width = 1; pc.height = 2;
        const pctx = pc.getContext('2d')!;
        pctx.fillStyle = 'rgba(0,0,0,0.28)';
        pctx.fillRect(0, 1, 1, 1);
        this.scanPattern = ctx.createPattern(pc, 'repeat');
      }
      if (this.scanPattern) {
        ctx.fillStyle = this.scanPattern;
        ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      }
    }
  }

  private atlasFor(key: number): Atlas {
    let a = this.atlases.get(key);
    if (a) return a;
    const r = ((key >> 8) & 15) * 17, g = ((key >> 4) & 15) * 17, b = (key & 15) * 17;
    const color = `rgb(${r},${g},${b})`;
    const canvas = document.createElement('canvas');
    canvas.width = ATLAS_COLS * this.cellW;
    canvas.height = Math.ceil(MAX_GLYPHS / ATLAS_COLS) * this.cellH;
    const ctx = canvas.getContext('2d')!;
    a = { canvas, ctx, color };
    this.atlases.set(key, a);
    for (const [code, idx] of this.glyphIndex) this.renderGlyph(a, code, idx);
    return a;
  }

  private registerGlyph(code: number): number {
    if (this.glyphCount >= MAX_GLYPHS) {
      const q = this.glyphIndex.get(63);
      return q === undefined ? -1 : q;
    }
    const idx = this.glyphCount++;
    this.glyphIndex.set(code, idx);
    for (const a of this.atlases.values()) this.renderGlyph(a, code, idx);
    return idx;
  }

  private renderGlyph(a: Atlas, code: number, idx: number): void {
    const ctx = a.ctx;
    const x = (idx % ATLAS_COLS) * this.cellW, y = Math.floor(idx / ATLAS_COLS) * this.cellH;
    ctx.clearRect(x, y, this.cellW, this.cellH);
    ctx.font = this.font;
    ctx.fillStyle = a.color;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';
    ctx.fillText(String.fromCharCode(code), x + this.cellW / 2, y + this.cellH / 2 + 1);
  }
}
