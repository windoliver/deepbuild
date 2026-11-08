// #1003's acceptance tests: what every file shares. The criterion IDs, the role and surface names the README pins,
// color math (OKLab distance, WCAG contrast, alpha over a surface, as the look's guard computes them at the base),
// temporary roots under /tmp/da1003-*, builds of the binaries the tests drive (copied out of target/debug so a
// sibling build can't swap them mid-run), and one call to the look's guard. Nothing here writes to the repo.
import { spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));
/** The merge base this suite was written against (origin/main when #1003 was drafted). */
export const BASE = 'e2e6e1cc';

/** `#1003.` and the first 8 hex of SHA-256 of each criterion's text (scripts/proof-change.mjs, criterionId). */
export const AC = { 1: '#1003.29de0e96', 2: '#1003.29e7223e', 3: '#1003.5c4fd8c1', 4: '#1003.4b14acdc', 5: '#1003.2565997a' };

/** Each ink tier's contrast floor (none for disabled), as at the base. */
export const FLOORS = { ink_primary: 4.5, ink_secondary: 4.5, ink_tertiary: 3 };
export const STATUS_FLOOR = 3;
export const TERMINAL_FLOOR = 3;
export const FOCUS_FLOOR = 3;
export const MIN_DISTANCE = 0.1;

/** The 16 terminal roles by ANSI index (README: The look's terminal colors); index 8 is bright black. */
const NAMES = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];
export const TERMINAL_ROLES = [...NAMES.map((n) => `term_${n}`), ...NAMES.map((n) => `term_bright_${n}`)];
export const TERMINAL_BACKGROUND = 'term_background';
export const FOCUS = 'focus';

/** The surfaces a row can be drawn on, in the order the README pins, from a theme's resolved roles. */
export const SURFACE_NAMES = ['ground', 'raised', 'hover over ground', 'hover over raised', 'selected over ground', 'selected over raised'];

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

/** WCAG 2.x relative luminance and contrast ratio. */
export const luminance = (rgb) => {
  const [r, g, b] = rgb.map((v) => decode(v / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
export function contrast(p, q) {
  const [x, y] = [luminance(p), luminance(q)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** `color` (parsed) over an opaque `base` (rgb), blended in sRGB-encoded values and rounded, as the base's guard does. */
export function over(color, base) {
  const { rgb, a } = color;
  return rgb.map((v, i) => Math.round(v * a + base[i] * (1 - a)));
}

/** A theme's six surfaces `[[name, rgb]]` from its resolved roles (`role → #rrggbb[aa]`); raised falls back to ground. */
export function surfaces(roles) {
  const ground = parseColor(roles?.ground)?.rgb;
  if (!ground) return [];
  const raised = parseColor(roles.raised)?.rgb ?? ground;
  const out = [['ground', ground], ['raised', raised]];
  for (const fill of ['hover', 'selected']) {
    const c = parseColor(roles[fill]);
    if (c) out.push([`${fill} over ground`, over(c, ground)], [`${fill} over raised`, over(c, raised)]);
  }
  return out;
}

/** A role's color drawn on `surface` (an alpha role blended over it). */
export const on = (color, surface) => (color.a === 1 ? color.rgb : over(color, surface));

// ---------------------------------------------------------------------------------------------------------
// Temporary roots and the binaries.

/** A fresh folder /tmp/da1003-<what>-XXXXXX (the OS temp dir where there is no /tmp). */
export const tempRoot = (what) => mkdtempSync(join(existsSync('/tmp') ? '/tmp' : tmpdir(), `da1003-${what}-`));
export const remove = (dir) => rmSync(dir, { recursive: true, force: true });
export const ensureDir = (dir) => mkdirSync(dir, { recursive: true });

const built = new Map();
/**
 * `cargo build --locked -p <pkg> --bin <bin>`, once per process, copied to /tmp/da1003-bin-*. Answers `{ path }`, or
 * `{ error }` with cargo's error lines.
 */
export function buildBin(pkg, bin) {
  const key = `${pkg}/${bin}`;
  if (!built.has(key)) {
    const run = spawnSync('cargo', ['build', '--locked', '-p', pkg, '--bin', bin], {
      cwd: repoRoot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 3_600_000,
    });
    if (run.error || run.status !== 0) {
      const lines = `${run.stderr ?? ''}`.split('\n').filter((l) => /^error|^\s+-->|cannot find|unresolved/.test(l));
      built.set(key, { error: `cargo build --locked -p ${pkg} --bin ${bin} failed: ${run.error?.message ?? lines.slice(0, 12).join('\n')}` });
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

/**
 * The look's guard as the base already asks it: `deep-canvas-render look`, one JSON line in per input, one line out.
 * Answers the parsed lines, or throws naming why there are none. `inputs` are objects such as `{look: "clean"}`.
 */
export function realGuard(inputs) {
  const bin = buildBin('deep-marks-render', 'deep-canvas-render');
  if (bin.error) throw new Error(bin.error);
  const run = spawnSync(bin.path, ['look'], {
    cwd: repoRoot, input: `${inputs.map((i) => JSON.stringify(i)).join('\n')}\n`, encoding: 'utf8', timeout: 300_000, maxBuffer: 64 * 1024 * 1024,
  });
  const lines = `${run.stdout ?? ''}`.split('\n').filter(Boolean);
  if (lines.length !== inputs.length) throw new Error(`deep-canvas-render look answered ${lines.length} lines for ${inputs.length} (exit ${run.status}): ${`${run.stderr}`.slice(0, 400)}`);
  return lines.map((l) => JSON.parse(l));
}

/** The look definition `fixtures/<name>.json`, freshly parsed. */
export const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), 'utf8'));
