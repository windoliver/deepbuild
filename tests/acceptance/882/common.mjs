// #882's acceptance tests: what every judge shares. The criterion IDs, the role names the README pins,
// the look's status colors, color math (OKLab distance, WCAG contrast, alpha over a ground), a PNG reader,
// temporary roots under /tmp/da882-*, and builds of the two binaries the tests drive, copied out of
// target/debug so a sibling build can't swap them mid-run. Nothing here writes to the repo's own files.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
/** The merge base this suite was written against (origin/main when #882 was drafted). */
export const BASE = '0f7fb686';

/** `#882.` and the first 8 hex of SHA-256 of each criterion's text (scripts/proof-change.mjs, criterionId). */
export const AC = { 1: '#882.98cbaa26', 2: '#882.f3bc7068', 3: '#882.218503b6', 4: '#882.c60566b1' };

/** The chrome roles the README pins, each in the look's `roles` for light and dark. */
export const INK_TIERS = ['ink_primary', 'ink_secondary', 'ink_tertiary', 'ink_disabled'];
export const CHROME_ROLES = ['ground', 'raised', 'divider', ...INK_TIERS, 'hover', 'selected', 'accent', 'session_readout', 'session_line'];
/** Each ink tier's contrast floor (none for disabled). */
export const FLOORS = { ink_primary: 4.5, ink_secondary: 4.5, ink_tertiary: 3 };
/** The status distance, OKLab ΔE. */
export const MIN_DISTANCE = 0.1;
/** Hover and selected are the one ink at a low alpha: at most this. */
export const LOW_ALPHA = 0.25;

/** The clean look's status map at the base (crates/deep-canvas-marks/looks/clean.json); #882 doesn't change it. */
export const STATUS = {
  pass: '#007429', fail: '#bf232b', invalid: '#8645b0', blocked: '#a44700', inconclusive: '#666600',
  running: '#0063b8', needs_you: '#8a5900', stale: '#326c6f', idle: '#636464',
};

// ---------------------------------------------------------------------------------------------------------
// Color math.

/** `#rrggbb` or `#rrggbbaa` as `{ rgb: [r, g, b], a }` (a in 0..1), or null. */
export function parseColor(text) {
  const m = typeof text === 'string' && /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(text);
  if (!m) return null;
  const rgb = [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
  return { rgb, a: m[2] === undefined ? 1 : parseInt(m[2], 16) / 255 };
}
export const hex = (rgb) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`;

const decode = (v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const encode = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

/** sRGB bytes in OKLab (Björn Ottosson's matrices, as deep_canvas::color uses). */
export function oklab(rgb) {
  const [r, g, b] = rgb.map((v) => decode(v / 255));
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
export const distance = (p, q) => Math.hypot(...oklab(p).map((x, i) => x - oklab(q)[i]));

/** The nearest status color to `rgb`: `[state, distance]`. */
export function nearestStatus(rgb, status = STATUS) {
  return Object.entries(status)
    .map(([state, h]) => [state, distance(rgb, parseColor(h).rgb)])
    .sort((x, y) => x[1] - y[1])[0];
}

/** WCAG 2.x relative luminance and contrast ratio. */
const luminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => decode(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export function contrast(p, q) {
  const [x, y] = [luminance(p), luminance(q)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * `color` (parsed) over an opaque `ground` (rgb): blended in sRGB-encoded values, as GPUI's renderer blends into
 * its BGRA8Unorm target, or (`linear: true`) in linear light. Rounded to bytes.
 */
export function over(color, ground, { linear = false } = {}) {
  const { rgb, a } = color;
  return rgb.map((v, i) => (linear
    ? Math.round(255 * encode(decode(v / 255) * a + decode(ground[i] / 255) * (1 - a)))
    : Math.round(v * a + ground[i] * (1 - a))));
}

// ---------------------------------------------------------------------------------------------------------
// PNG: 8-bit RGB or RGBA, non-interlaced, as the replica's `image` crate writes it.

export function readPng(path) {
  const bytes = readFileSync(path);
  if (bytes.readUInt32BE(0) !== 0x89504e47) throw new Error(`${path} is not a PNG`);
  let at = 8, width = 0, height = 0, type = 0;
  const idat = [];
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at);
    const kind = bytes.toString('latin1', at + 4, at + 8);
    const body = bytes.subarray(at + 8, at + 8 + length);
    if (kind === 'IHDR') {
      [width, height] = [body.readUInt32BE(0), body.readUInt32BE(4)];
      type = body[9];
      if (body[8] !== 8 || ![2, 6].includes(type) || body[12] !== 0) throw new Error(`${path}: only 8-bit RGB(A), non-interlaced`);
    } else if (kind === 'IDAT') idat.push(body);
    else if (kind === 'IEND') break;
    at += 12 + length;
  }
  const channels = type === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const row = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const left = x >= channels ? row[x - channels] : 0;
      const up = previous[x];
      const corner = x >= channels ? previous[x - channels] : 0;
      let value = line[x];
      if (filter === 1) value += left;
      else if (filter === 2) value += up;
      else if (filter === 3) value += (left + up) >> 1;
      else if (filter === 4) {
        const p = left + up - corner;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
        value += pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      }
      row[x] = value & 0xff;
    }
    for (let x = 0; x < width; x++) {
      for (let c = 0; c < 3; c++) out[(y * width + x) * 4 + c] = row[x * channels + c];
      out[(y * width + x) * 4 + 3] = channels === 4 ? row[x * channels + 3] : 255;
    }
    previous = row;
  }
  return { width, height, data: out };
}

// ---------------------------------------------------------------------------------------------------------
// Temporary roots and the binaries.

/** A fresh folder /tmp/da882-<what>-XXXXXX (the OS temp dir where there is no /tmp). */
export const tempRoot = (what) => mkdtempSync(join(existsSync('/tmp') ? '/tmp' : tmpdir(), `da882-${what}-`));
export const remove = (dir) => rmSync(dir, { recursive: true, force: true });

const built = new Map();
/**
 * `cargo build --locked -p <pkg> --bin <bin>`, once per process, copied to /tmp/da882-bin-*. Answers `{ path }`, or
 * `{ error }` with cargo's error lines.
 */
export function buildBin(pkg, bin) {
  const key = `${pkg}/${bin}`;
  if (!built.has(key)) {
    const run = spawnSync('cargo', ['build', '--locked', '-p', pkg, '--bin', bin], {
      cwd: repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 3_600_000,
    });
    if (run.error || run.status !== 0) {
      const lines = `${run.stderr ?? ''}`.split('\n').filter((l) => /error|warning: unused/.test(l) && !/Compiling|Blocking/.test(l));
      built.set(key, { error: `cargo build --locked -p ${pkg} --bin ${bin} failed: ${run.error?.message ?? lines.slice(0, 30).join('\n')}` });
    } else {
      const dir = tempRoot('bin');
      const path = join(dir, bin);
      copyFileSync(join(process.env.CARGO_TARGET_DIR ?? join(repoRoot, 'target'), 'debug', bin), path);
      chmodSync(path, 0o755);
      process.on('exit', () => remove(dir));
      built.set(key, { path });
    }
  }
  return built.get(key);
}

export const ensureDir = (dir) => mkdirSync(dir, { recursive: true });
