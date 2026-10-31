// The preflight's color-literal guard (#882): the app's chrome draws every color from its look's roles, through
// crates/deep-app/src/chrome.rs, so no other line of the app's Rust source, nor of the panels it ships
// (crates/deep-app/panels, whose scripts read the same roles as `color.*`), names a color of its own. A literal is a
// hex color (`0x2563eb`, `"#2563eb"`), a color call over numbers (`rgb(0x...)`, `rgba(...)`, `hsla(0.6, ...)`), or one
// of gpui's named colors (`white()`). One `FAIL color literal: <path>:<line>: ...` line per literal, naming the look's
// role nearest its color to use instead, or one `PASS color literal` line; exit 1 on a finding. A line keeps its
// literal only with a trailing `// color-literal-exception: <reason>; review <YYYY-MM-DD>`, until that date.
// `--root <dir>` checks the app's source under another checkout, against that checkout's look. scripts/app-inventory.mjs
// imports LITERAL to list the literals each panel has left.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = 'crates/deep-app/src';
const PANELS = 'crates/deep-app/panels';
const LOOK = 'crates/deep-canvas-marks/looks/clean.json';
export const LITERAL = /\b(?:rgba?|hsla?)\(\s*(?:0x|[\d.])|\b0x[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?\b|"#[0-9a-fA-F]{6}(?:[0-9a-fA-F]{2})?"|\b(?:black|white|red|green|blue|yellow)\(\)/;
const EXCEPTION = /\/\/ color-literal-exception: (\S[^;]*?)(?:; review (\d{4}-\d{2}-\d{2}))?\s*$/;
const HOW = 'read it from crate::chrome (a panel script: the theme\'s color.*), or end the line with // color-literal-exception: <reason>; review <YYYY-MM-DD>';


/** sRGB bytes in OKLab. */
function oklab([r, g, b]) {
  const lin = (v) => ((v /= 255) <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [R, G, B] = [lin(r), lin(g), lin(b)];
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}
const bytes = (hex) => [0, 2, 4, 6].map((i) => parseInt(hex.slice(i, i + 2) || 'ff', 16));

/** The light theme's roles of the look under `root`, each as the bytes it shows over the ground. */
function roles(root) {
  const path = join(root, LOOK);
  if (!existsSync(path)) return [];
  const look = JSON.parse(readFileSync(path, 'utf8'));
  const named = { ...look.roles, ...look.themes?.light?.roles };
  const color = (role) => bytes(String(look.palette?.[named[role]] ?? '').slice(1));
  const ground = color('ground');
  return Object.keys(named).map((role) => {
    const [r, g, b, a] = color(role);
    return [role, [r, g, b].map((v, i) => Math.round(v * (a / 255) + ground[i] * (1 - a / 255)))];
  }).filter(([, c]) => c.every(Number.isFinite));
}

/** The color a literal names, as bytes, when it says one. */
function colorOf(text) {
  const hex = /0x([0-9a-fA-F]{6})|"#([0-9a-fA-F]{6})/.exec(text);
  if (hex) return bytes(hex[1] ?? hex[2]).slice(0, 3);
  const hsla = /hsla?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)/.exec(text);
  if (hsla) {
    const [h, s, l] = hsla.slice(1).map(Number);
    const k = (n) => (n + h * 12) % 12;
    const f = (n) => l - s * Math.min(l, 1 - l) * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
    return [f(0), f(8), f(4)].map((v) => Math.round(v * 255));
  }
  const named = /\b(black|white|red|green|blue|yellow)\(\)/.exec(text);
  return named && { black: [0, 0, 0], white: [255, 255, 255], red: [255, 0, 0], green: [0, 255, 0], blue: [0, 0, 255], yellow: [255, 255, 0] }[named[1]];
}

/** The role of `ROLES` to use instead: the one nearest the literal's color, or the ink when it names none. */
function role(ROLES, text) {
  const c = colorOf(text);
  if (!c || !ROLES.length) return 'ink_primary';
  const at = oklab(c);
  const d = ([, rgb]) => Math.hypot(...oklab(rgb).map((x, i) => x - at[i]));
  return ROLES.reduce((best, r) => (d(r) < d(best) ? r : best))[0];
}

/** The files under `dir` whose names end with `ext`; none when there's no `dir`. */
const files = (dir, ext) => (existsSync(dir) ? readdirSync(dir) : []).flatMap((name) => {
  const path = join(dir, name);
  return statSync(path).isDirectory() ? files(path, ext) : name.endsWith(ext) ? [path] : [];
});

function main() {
  const at = process.argv.indexOf('--root');
  if (at !== -1 && (!process.argv[at + 1] || process.argv[at + 1].startsWith('--'))) {
    console.log('BLOCKED color literal: --root takes a folder\n  Fix: node scripts/color-literal-guard.mjs [--root <checkout>]');
    process.exit(2);
  }
  const root = at === -1 ? fileURLToPath(new URL('../', import.meta.url)) : process.argv[at + 1];
  const ROLES = roles(root);
  const today = new Date().toISOString().slice(0, 10);
  const findings = [];
  for (const file of [...files(join(root, SOURCE), '.rs'), ...files(join(root, PANELS), '.js')]) {
    const path = relative(root, file).replaceAll('\\', '/');
    readFileSync(file, 'utf8').split('\n').forEach((text, i) => {
      if (/^\s*\/\//.test(text)) return;
      const exception = EXCEPTION.exec(text);
      const code = exception ? text.slice(0, exception.index) : text;
      const literal = LITERAL.exec(code);
      if (!literal) return;
      const place = `${path}:${i + 1}`;
      if (exception?.[2] >= today) return;
      const why = !exception ? '' : exception[2] ? `; its exception's review date ${exception[2]} has passed` : '; its exception names no review date';
      const shown = code.trim().length > 72 ? `${code.trim().slice(0, 71)}…` : code.trim();
      findings.push(`FAIL color literal: ${place}: \`${shown}\` names a color${why}; use the look's role ${role(ROLES, code)} (${LOOK}): ${HOW}`);
    });
  }
  for (const line of findings) console.log(line);
  if (!findings.length) console.log(`PASS color literal: ${SOURCE} and ${PANELS} read every color from the look's roles`);
  process.exitCode = findings.length ? 1 : 0;
}

if (process.argv[1] && realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url))) main();
