/**
 * Generates the art-directed placeholder imagery used across the site.
 *
 * These are ORIGINAL abstract "cinematic plates" (light, haze, grain) — not
 * stock photos — so the site looks finished before real production stills
 * are available. Replace any file in /public/images with a real photo of the
 * same name (WebP or JPG, update the path in /data if the extension changes).
 *
 * Run:  npm run images
 */
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve("public/images");

// ---------- helpers ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TONES = {
  warm: "#e8d2b4",
  cool: "#b9c6d6",
  neutral: "#e6e6e6",
  amber: "#f0c48a",
};

const defs = (w, h, tone) => `
  <defs>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" seed="7" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="table" tableValues="0 0.11"/></feComponentTransfer>
    </filter>
    <filter id="b8" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${Math.round(w / 220)}"/></filter>
    <filter id="b24" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${Math.round(w / 70)}"/></filter>
    <filter id="b60" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${Math.round(w / 28)}"/></filter>
    <radialGradient id="vig" cx="50%" cy="50%" r="75%">
      <stop offset="55%" stop-color="#000" stop-opacity="0"/>
      <stop offset="100%" stop-color="#000" stop-opacity="0.85"/>
    </radialGradient>
    <linearGradient id="floor" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${tone}" stop-opacity="0.18"/>
      <stop offset="1" stop-color="${tone}" stop-opacity="0"/>
    </linearGradient>
  </defs>`;

const finish = (w, h) => `
  <rect width="${w}" height="${h}" fill="url(#vig)"/>
  <rect width="${w}" height="${h}" filter="url(#grain)"/>`;

// ---------- recipes ----------
const recipes = {
  blinds(w, h, r, tone) {
    const bands = [];
    const n = 7 + Math.floor(r() * 4);
    const skew = w * (0.25 + r() * 0.2);
    const x0 = w * (0.15 + r() * 0.2);
    const bw = w * 0.05;
    for (let i = 0; i < n; i++) {
      const y = h * 0.05 + i * (h / n) * 0.95;
      const th = (h / n) * (0.35 + r() * 0.15);
      bands.push(
        `<polygon points="${x0},${y} ${x0 + bw * 9},${y} ${x0 + bw * 9 + skew},${y + th * 1.6} ${x0 + skew},${y + th * 1.6}" fill="${tone}" opacity="${0.32 + r() * 0.2}"/>`,
      );
    }
    return `<rect width="${w}" height="${h}" fill="#0b0b0b"/>
      <g filter="url(#b8)">${bands.join("")}</g>
      <ellipse cx="${w * 0.5}" cy="${h * 0.5}" rx="${w * 0.45}" ry="${h * 0.4}" fill="${tone}" opacity="0.05" filter="url(#b60)"/>`;
  },
  doorway(w, h, r, tone) {
    const cx = w * (0.55 + r() * 0.15);
    const dw = w * 0.11;
    const dh = h * 0.62;
    const top = h * 0.12;
    return `<rect width="${w}" height="${h}" fill="#070707"/>
      <rect x="${cx - dw * 2.5}" y="${top - dh * 0.2}" width="${dw * 5}" height="${dh * 1.5}" fill="${tone}" opacity="0.10" filter="url(#b60)"/>
      <rect x="${cx - dw / 2}" y="${top}" width="${dw}" height="${dh}" fill="${tone}" opacity="0.95" filter="url(#b8)"/>
      <rect x="${cx - dw / 2}" y="${top}" width="${dw}" height="${dh}" fill="#fff" opacity="0.6"/>
      <polygon points="${cx - dw / 2},${top + dh} ${cx + dw / 2},${top + dh} ${cx + dw * 2.4},${h} ${cx - dw * 2.4},${h}" fill="url(#floor)" filter="url(#b8)"/>
      <rect x="0" y="${top + dh}" width="${w}" height="1.5" fill="${tone}" opacity="0.15"/>`;
  },
  softbox(w, h, r, tone) {
    const bw = w * (0.3 + r() * 0.1);
    const bh = h * 0.42;
    const x = w * (0.2 + r() * 0.3);
    const y = h * 0.14;
    return `<rect width="${w}" height="${h}" fill="#0a0a0a"/>
      <rect x="${x - bw * 0.3}" y="${y - bh * 0.3}" width="${bw * 1.6}" height="${bh * 1.6}" fill="${tone}" opacity="0.14" filter="url(#b60)"/>
      <rect x="${x}" y="${y}" width="${bw}" height="${bh}" fill="${tone}" opacity="0.55" filter="url(#b24)"/>
      <rect x="${x + bw * 0.06}" y="${y + bh * 0.06}" width="${bw * 0.88}" height="${bh * 0.88}" fill="#fff" opacity="0.28" filter="url(#b24)"/>
      <rect x="0" y="${h * 0.7}" width="${w}" height="${h * 0.3}" fill="#050505"/>
      <rect x="${x}" y="${h * 0.72}" width="${bw}" height="${h * 0.2}" fill="${tone}" opacity="0.12" filter="url(#b24)"/>
      <line x1="${x + bw / 2}" y1="${y + bh}" x2="${x + bw / 2}" y2="${h * 0.7}" stroke="#2a2a2a" stroke-width="${w / 400}"/>`;
  },
  bokeh(w, h, r, tone) {
    const c = [];
    for (let i = 0; i < 38; i++) {
      const rad = w * (0.01 + r() * 0.05);
      c.push(
        `<circle cx="${r() * w}" cy="${h * (0.2 + r() * 0.6)}" r="${rad}" fill="${tone}" opacity="${0.08 + r() * 0.35}"/>`,
      );
    }
    return `<rect width="${w}" height="${h}" fill="#080808"/>
      <g filter="url(#b8)">${c.join("")}</g>
      <rect x="0" y="${h * 0.75}" width="${w}" height="${h * 0.25}" fill="#000" opacity="0.6" filter="url(#b24)"/>`;
  },
  horizon(w, h, r, tone) {
    const hy = h * (0.55 + r() * 0.1);
    const sx = w * (0.3 + r() * 0.4);
    return `<rect width="${w}" height="${h}" fill="#060606"/>
      <ellipse cx="${sx}" cy="${hy}" rx="${w * 0.6}" ry="${h * 0.25}" fill="${tone}" opacity="0.22" filter="url(#b60)"/>
      <ellipse cx="${sx}" cy="${hy}" rx="${w * 0.08}" ry="${h * 0.05}" fill="#fff" opacity="0.8" filter="url(#b24)"/>
      <rect x="0" y="${hy - 1}" width="${w}" height="${h * 0.006}" fill="${tone}" opacity="0.7" filter="url(#b8)"/>
      <rect x="0" y="${hy}" width="${w}" height="${h - hy}" fill="#030303" opacity="0.92"/>
      <rect x="0" y="${hy}" width="${w}" height="${h * 0.08}" fill="${tone}" opacity="0.06" filter="url(#b24)"/>`;
  },
  aperture(w, h, r, tone) {
    const cx = w * (0.5 + (r() - 0.5) * 0.3);
    const cy = h * 0.5;
    const R = Math.min(w, h) * 0.36;
    const rings = [];
    for (let i = 0; i < 9; i++) {
      const rr = R * (1 - i * 0.1);
      rings.push(
        `<circle cx="${cx}" cy="${cy}" r="${rr}" fill="none" stroke="${tone}" stroke-width="${w / (300 + i * 40)}" opacity="${0.06 + (i % 3) * 0.06}"/>`,
      );
    }
    return `<rect width="${w}" height="${h}" fill="#070707"/>
      <circle cx="${cx}" cy="${cy}" r="${R * 1.05}" fill="#0d0d0d"/>
      ${rings.join("")}
      <path d="M ${cx - R * 0.8} ${cy - R * 0.35} A ${R * 0.88} ${R * 0.88} 0 0 1 ${cx + R * 0.1} ${cy - R * 0.87}" fill="none" stroke="${tone}" stroke-width="${w / 90}" opacity="0.55" filter="url(#b8)"/>
      <circle cx="${cx}" cy="${cy}" r="${R * 0.22}" fill="#000"/>
      <circle cx="${cx - R * 0.07}" cy="${cy - R * 0.07}" r="${R * 0.04}" fill="#fff" opacity="0.4" filter="url(#b8)"/>`;
  },
  spot(w, h, r, tone) {
    const cx = w * (0.4 + r() * 0.2);
    const fy = h * 0.8;
    const dust = [];
    for (let i = 0; i < 70; i++) {
      const t = r();
      const y = h * 0.05 + t * (fy - h * 0.05);
      const spread = w * 0.03 + t * w * 0.2;
      dust.push(
        `<circle cx="${cx + (r() - 0.5) * spread * 2}" cy="${y}" r="${w / (900 + r() * 1200)}" fill="#fff" opacity="${0.2 + r() * 0.5}"/>`,
      );
    }
    return `<rect width="${w}" height="${h}" fill="#050505"/>
      <polygon points="${cx - w * 0.02},0 ${cx + w * 0.02},0 ${cx + w * 0.24},${fy} ${cx - w * 0.24},${fy}" fill="${tone}" opacity="0.2" filter="url(#b24)"/>
      <ellipse cx="${cx}" cy="${fy}" rx="${w * 0.26}" ry="${h * 0.05}" fill="${tone}" opacity="0.4" filter="url(#b24)"/>
      ${dust.join("")}`;
  },
  streak(w, h, r, tone) {
    const s = [];
    for (let i = 0; i < 14; i++) {
      const y = h * (0.25 + r() * 0.5);
      const x = r() * w;
      const len = w * (0.2 + r() * 0.6);
      s.push(
        `<rect x="${x - len / 2}" y="${y}" width="${len}" height="${h * 0.012}" fill="${i % 3 === 0 ? TONES.cool : tone}" opacity="${0.25 + r() * 0.5}" filter="url(#b8)"/>`,
        `<circle cx="${x}" cy="${y}" r="${w * 0.012}" fill="#fff" opacity="0.9" filter="url(#b8)"/>`,
      );
    }
    return `<rect width="${w}" height="${h}" fill="#050506"/>
      <rect x="0" y="${h * 0.3}" width="${w}" height="${h * 0.4}" fill="${tone}" opacity="0.05" filter="url(#b60)"/>
      ${s.join("")}`;
  },
  silk(w, h, r, tone) {
    const p = [];
    for (let i = 0; i < 14; i++) {
      const o = i * (h / 18);
      const a = h * (0.1 + r() * 0.2);
      p.push(
        `<path d="M -50 ${h * 0.2 + o} C ${w * 0.3} ${h * 0.2 + o - a}, ${w * 0.6} ${h * 0.2 + o + a}, ${w + 50} ${h * 0.1 + o}" fill="none" stroke="${tone}" stroke-width="${w / (80 + i * 12)}" opacity="${0.05 + (i % 4) * 0.05}"/>`,
      );
    }
    return `<rect width="${w}" height="${h}" fill="#080808"/>
      <g filter="url(#b8)">${p.join("")}</g>
      <ellipse cx="${w * 0.6}" cy="${h * 0.45}" rx="${w * 0.3}" ry="${h * 0.15}" fill="${tone}" opacity="0.1" filter="url(#b60)"/>`;
  },
  mic(w, h, r, tone) {
    // Abstract podcast set: two pools of warm light + boom-arm line
    const y = h * 0.62;
    return `<rect width="${w}" height="${h}" fill="#070707"/>
      <ellipse cx="${w * 0.28}" cy="${h * 0.4}" rx="${w * 0.2}" ry="${h * 0.3}" fill="${tone}" opacity="0.14" filter="url(#b60)"/>
      <ellipse cx="${w * 0.74}" cy="${h * 0.4}" rx="${w * 0.2}" ry="${h * 0.3}" fill="${TONES.cool}" opacity="0.08" filter="url(#b60)"/>
      <path d="M ${w * 0.5} ${h * 0.05} L ${w * 0.5} ${h * 0.22} L ${w * 0.42} ${h * 0.38}" fill="none" stroke="#222" stroke-width="${w / 160}" stroke-linecap="round"/>
      <rect x="${w * 0.395}" y="${h * 0.37}" width="${w * 0.05}" height="${h * 0.14}" rx="${w * 0.025}" fill="#151515" stroke="${tone}" stroke-opacity="0.35" stroke-width="${w / 700}"/>
      <rect x="0" y="${y}" width="${w}" height="${h - y}" fill="#040404"/>
      <rect x="${w * 0.1}" y="${y}" width="${w * 0.8}" height="${h * 0.004}" fill="${tone}" opacity="0.35" filter="url(#b8)"/>`;
  },
};

const jobs = [
  // hero
  { file: "hero/hero.webp", w: 2400, h: 1350, recipe: "blinds", tone: "warm", seed: 11 },
  // about
  { file: "about/about-1.webp", w: 1200, h: 1500, recipe: "doorway", tone: "warm", seed: 3 },
  { file: "about/about-2.webp", w: 1200, h: 900, recipe: "softbox", tone: "neutral", seed: 5 },
  // services
  { file: "services/video-production.webp", w: 1200, h: 1500, recipe: "aperture", tone: "neutral", seed: 21 },
  { file: "services/commercial-ad-films.webp", w: 1200, h: 1500, recipe: "streak", tone: "amber", seed: 22 },
  { file: "services/social-media-reels.webp", w: 1200, h: 1500, recipe: "bokeh", tone: "cool", seed: 23 },
  { file: "services/brand-films.webp", w: 1200, h: 1500, recipe: "horizon", tone: "warm", seed: 24 },
  { file: "services/photography.webp", w: 1200, h: 1500, recipe: "softbox", tone: "neutral", seed: 25 },
  { file: "services/event-coverage.webp", w: 1200, h: 1500, recipe: "spot", tone: "amber", seed: 26 },
  { file: "services/podcast.webp", w: 1200, h: 1500, recipe: "mic", tone: "warm", seed: 27 },
  { file: "services/post-production.webp", w: 1200, h: 1500, recipe: "silk", tone: "cool", seed: 28 },
  // work
  { file: "work/sample-01.webp", w: 1920, h: 1080, recipe: "streak", tone: "warm", seed: 31 },
  { file: "work/sample-02.webp", w: 1200, h: 1500, recipe: "bokeh", tone: "amber", seed: 32 },
  { file: "work/sample-03.webp", w: 1920, h: 1080, recipe: "horizon", tone: "cool", seed: 33 },
  { file: "work/sample-04.webp", w: 1200, h: 1500, recipe: "silk", tone: "warm", seed: 34 },
  { file: "work/sample-05.webp", w: 1920, h: 1080, recipe: "spot", tone: "neutral", seed: 35 },
  { file: "work/sample-06.webp", w: 1920, h: 1080, recipe: "blinds", tone: "cool", seed: 36 },
  { file: "work/sample-07.webp", w: 1200, h: 1500, recipe: "doorway", tone: "amber", seed: 37 },
  { file: "work/sample-08.webp", w: 1920, h: 1080, recipe: "aperture", tone: "warm", seed: 38 },
  // contact backdrop
  { file: "contact/contact.webp", w: 2000, h: 1200, recipe: "horizon", tone: "warm", seed: 41 },
];

for (const j of jobs) {
  const r = rng(j.seed);
  const tone = TONES[j.tone];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${j.w}" height="${j.h}" viewBox="0 0 ${j.w} ${j.h}">
    ${defs(j.w, j.h, tone)}
    ${recipes[j.recipe](j.w, j.h, r, tone)}
    ${finish(j.w, j.h)}
  </svg>`;
  const out = path.join(OUT, j.file);
  await mkdir(path.dirname(out), { recursive: true });
  await sharp(Buffer.from(svg)).webp({ quality: 74, effort: 5 }).toFile(out);
  console.log("✓", j.file);
}
