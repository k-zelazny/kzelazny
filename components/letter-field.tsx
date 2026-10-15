"use client";

import { useEffect, useRef } from "react";

type Rgb = [number, number, number];
type Ring = { x: number; y: number; start: number; seed: number };

const GLYPHS = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const CELL_W = 7;
const CELL_H = 14;
const FONT_SIZE = 11;
const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
const LEVELS = 10;
const BG: Rgb = [20, 20, 20];
// Peak colour of a glyph at full strength: idle field, click ring.
const TONES: Rgb[] = [
  [56, 56, 56],
  [62, 122, 168],
];
const RING_LIFE = 2.8;
const RING_REACH = 460;
const MAX_RINGS = 8;

const smooth = (t: number) => t * t * (3 - 2 * t);
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const range = (v: number, a: number, b: number) => smooth(clamp01((v - a) / (b - a)));

function hash(x: number, y: number, z: number) {
  let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(z, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

// Smooth value noise in 3D (x, y, time), 0..1.
function noise(x: number, y: number, z: number) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const u = smooth(x - xi);
  const v = smooth(y - yi);
  const w = smooth(z - zi);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  return l(
    l(
      l(hash(xi, yi, zi), hash(xi + 1, yi, zi), u),
      l(hash(xi, yi + 1, zi), hash(xi + 1, yi + 1, zi), u),
      v,
    ),
    l(
      l(hash(xi, yi, zi + 1), hash(xi + 1, yi, zi + 1), u),
      l(hash(xi, yi + 1, zi + 1), hash(xi + 1, yi + 1, zi + 1), u),
      v,
    ),
    w,
  );
}

// Pre-renders every glyph in every tone and brightness level, so a frame is only drawImage calls.
function buildAtlas(cw: number, ch: number, dpr: number) {
  const atlas = document.createElement("canvas");
  atlas.width = cw * GLYPHS.length;
  atlas.height = ch * TONES.length * LEVELS;
  const ctx = atlas.getContext("2d")!;
  ctx.font = `${Math.round(FONT_SIZE * dpr)}px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";

  TONES.forEach((tone, ti) => {
    for (let l = 0; l < LEVELS; l++) {
      const f = (l + 1) / LEVELS;
      const c = tone.map((v, i) => Math.round(BG[i] + (v - BG[i]) * f));
      ctx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      for (let g = 0; g < GLYPHS.length; g++) {
        ctx.fillText(GLYPHS[g], g * cw + cw / 2, (ti * LEVELS + l) * ch + ch / 2);
      }
    }
  });
  return atlas;
}

export default function LetterField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const rings: Ring[] = [];
    let atlas: HTMLCanvasElement;
    let glyphs = new Uint8Array(0);
    let dpr = 1;
    let cw = CELL_W;
    let ch = CELL_H;
    let cols = 0;
    let rows = 0;
    let raf = 0;
    const origin = performance.now();

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      cw = Math.round(CELL_W * dpr);
      ch = Math.round(CELL_H * dpr);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      cols = Math.ceil(canvas.width / cw);
      rows = Math.ceil(canvas.height / ch);
      glyphs = new Uint8Array(cols * rows).map(() => Math.floor(Math.random() * GLYPHS.length));
      atlas = buildAtlas(cw, ch, dpr);
      if (reduceMotion.matches) draw(origin);
    };

    const draw = (now: number) => {
      const t = (now - origin) / 1000;
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const live = rings.filter((r) => t - r.start < RING_LIFE);
      const active = live.map((r) => {
        const age = t - r.start;
        return {
          ...r,
          age,
          radius: RING_REACH * dpr * (1 - Math.exp(-age / 0.85)),
          half: (36 + age * 12) * dpr,
          strength: Math.pow(1 - age / RING_LIFE, 1.2),
        };
      });

      const scale = 1 / (380 * dpr);
      for (let cy = 0; cy < rows; cy++) {
        const y = (cy + 0.5) * ch;
        for (let cx = 0; cx < cols; cx++) {
          const x = (cx + 0.5) * cw;
          const i = cy * cols + cx;

          // Two octaves drifting in different directions so the patches slowly flow and merge.
          const n =
            noise(x * scale + t * 0.05, y * scale, t * 0.07) * 0.65 +
            noise(x * scale * 2.3 - t * 0.08, y * scale * 2.3 + t * 0.04, t * 0.11 + 40) * 0.35;
          const idle = range(n, 0.52, 0.8) * 0.7;

          let ring = 0;
          for (const r of active) {
            const dx = x - r.x;
            const dy = y - r.y;
            const d = Math.hypot(dx, dy);
            if (Math.abs(d - r.radius) > r.half * 1.6) continue;
            const angle = Math.atan2(dy, dx);
            const wobble = noise(Math.cos(angle) * 1.4 + r.seed, Math.sin(angle) * 1.4 + r.seed, r.age * 0.6);
            const edge = 1 - Math.abs(d - r.radius * (0.92 + wobble * 0.16)) / r.half;
            if (edge <= 0) continue;
            // The ring breaks into fragments as it ages.
            const gaps = 1 - (1 - range(wobble, 0.25, 0.5)) * 0.75 * clamp01(r.age / 1.8);
            ring = Math.max(ring, smooth(clamp01(edge * 1.8)) * gaps * r.strength);
          }

          const click = ring > 0.06 && ring >= idle;
          const a = click ? ring : idle;
          if (a < 0.06) continue;

          if (Math.random() < (click ? 0.3 : 0.025)) {
            glyphs[i] = Math.floor(Math.random() * GLYPHS.length);
          }
          const level = Math.min(LEVELS - 1, Math.floor(a * LEVELS));
          ctx.drawImage(
            atlas,
            glyphs[i] * cw,
            ((click ? 1 : 0) * LEVELS + level) * ch,
            cw,
            ch,
            cx * cw,
            cy * ch,
            cw,
            ch,
          );
        }
      }
    };

    const frame = (now: number) => {
      draw(now);
      raf = requestAnimationFrame(frame);
    };

    const onPointerDown = (e: PointerEvent) => {
      if (reduceMotion.matches) return;
      const start = (performance.now() - origin) / 1000;
      rings.push({ x: e.clientX * dpr, y: e.clientY * dpr, start, seed: Math.random() * 100 });
      if (rings.length > MAX_RINGS) rings.shift();
    };

    resize();
    if (!reduceMotion.matches) raf = requestAnimationFrame(frame);
    window.addEventListener("resize", resize);
    window.addEventListener("pointerdown", onPointerDown, { passive: true });

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("pointerdown", onPointerDown);
    };
  }, []);

  return <canvas ref={canvasRef} className="letter-field" aria-hidden="true" />;
}
