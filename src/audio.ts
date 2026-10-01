// WebAudio sound bus: decodes DMX lumps from Assets into AudioBuffers, positional gain + stereo pan.
import type { Assets, AudioBus } from './types';
import { angleDiff, clamp, pointToAngle } from './math';

const MAX_VOICES = 16;
const FALLOFF_DIST = 1200;

export class GameAudio implements AudioBus {
  muted = false;
  private actx: AudioContext | null = null;
  private master: GainNode | null = null;
  private buffers = new Map<string, AudioBuffer | null>();
  private active = 0;
  private lx = 0;
  private ly = 0;
  private la = 0;

  constructor(private assets: Assets, private enabled: boolean) {}

  /** Call from a user gesture handler to create/resume the context. */
  unlock(): void {
    if (!this.enabled) return;
    if (!this.actx) {
      try {
        this.actx = new AudioContext();
        this.master = this.actx.createGain();
        this.master.gain.value = 0.5;
        this.master.connect(this.actx.destination);
      } catch {
        this.enabled = false;
        return;
      }
    }
    if (this.actx.state === 'suspended') void this.actx.resume().catch(() => {});
  }

  setAssets(assets: Assets): void {
    this.assets = assets;
    this.buffers.clear();
  }

  setListener(x: number, y: number, angle: number): void {
    this.lx = x; this.ly = y; this.la = angle;
  }

  private buffer(name: string): AudioBuffer | null {
    const cached = this.buffers.get(name);
    if (cached !== undefined) return cached;
    let buf: AudioBuffer | null = null;
    const snd = this.assets.sound(name);
    if (snd && this.actx && snd.samples.length > 0) {
      const rate = clamp(snd.sampleRate || 11025, 8000, 96000);
      buf = this.actx.createBuffer(1, snd.samples.length, rate);
      const copy = new Float32Array(snd.samples.length);
      copy.set(snd.samples);
      buf.copyToChannel(copy, 0);
    }
    this.buffers.set(name, buf);
    return buf;
  }

  play(name: string, origin?: { x: number; y: number } | null, volume = 1): void {
    if (!this.enabled || this.muted) return;
    const actx = this.actx;
    if (!actx || actx.state !== 'running' || !this.master) return;
    name = name.toUpperCase();
    if (!name.startsWith('DS')) name = 'DS' + name;
    let gain = volume;
    let pan = 0;
    if (origin) {
      const dx = origin.x - this.lx, dy = origin.y - this.ly;
      const dist = Math.hypot(dx, dy);
      gain *= clamp(1 - dist / FALLOFF_DIST, 0, 1);
      if (dist > 1) {
        const rel = angleDiff(pointToAngle(dx, dy), this.la);
        pan = -Math.sin(rel) * clamp(dist / 160, 0, 1);
      }
    }
    if (gain <= 0.01 || this.active >= MAX_VOICES) return;
    const buf = this.buffer(name);
    if (!buf) return;
    const src = actx.createBufferSource();
    src.buffer = buf;
    const g = actx.createGain();
    g.gain.value = gain;
    src.connect(g);
    if (typeof actx.createStereoPanner === 'function') {
      const p = actx.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      g.connect(p);
      p.connect(this.master);
    } else {
      g.connect(this.master);
    }
    this.active++;
    src.onended = () => { this.active--; };
    src.start();
  }
}
