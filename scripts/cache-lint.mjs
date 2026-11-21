// The cache lint (#1431; technical design: Numbers version 0 has to hold, "The app's footprint"): every long-lived
// cache declares a bound in entries and in bytes, since a cache of many small or failed entries stays under a byte
// bound alone. A cache declares them in a `//` or `///` comment `cache: entries <bound>, bytes <bound>`, on the line
// that holds it or in the unbroken run of comment and attribute lines just above it; the cache is named
// `<Type>::<field>` for a struct's field and by its own name for a static. A declaration missing either bound fails,
// naming the cache. So does a holder with no declaration: each bounded cache (a field or static whose type is
// `Kept<...>`) and each holder the issue names, in its file. It reads the Rust files under crates/ and vendor/ (GPUI's
// holders are vendored). One `FAIL cache: <path>:<line>: ...` line per finding, or one `PASS cache: ...` line; exit 1
// on a finding. `--root <dir>` checks another checkout.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stripRust } from './rust-source.mjs';

const at = process.argv.indexOf('--root');
if (at !== -1 && (!process.argv[at + 1] || process.argv[at + 1].startsWith('--'))) {
  console.log('BLOCKED cache: --root takes a folder\n  Fix: node scripts/cache-lint.mjs [--root <checkout>]');
  process.exit(2);
}
const root = at === -1 ? fileURLToPath(new URL('../', import.meta.url)) : process.argv[at + 1];
if (!existsSync(root)) {
  console.log(`BLOCKED cache: no checkout at ${root}\n  Fix: node scripts/cache-lint.mjs [--root <checkout>]`);
  process.exit(2);
}

// The holders the issue names, each a cache that must declare its bounds where its file is: a struct's fields, or
// statics (struct null).
const NAMED = [
  ['crates/deep-marks-render/src/macos.rs', 'Session', ['images', 'placed', 'resampled']],
  ['crates/deep-app/src/show.rs', 'CanvasPanel', ['pictures']],
  ['crates/deep-gpu-layer/src/textures.rs', 'Made', ['ready']],
  ['crates/deep-scene3d-render/src/renderer.rs', 'Renderer', ['meshes']],
  ['crates/deep-scene3d-render/src/maps.rs', 'Store', ['textures', 'groups']],
  ['crates/deep-scene3d-render/src/proxy.rs', null, ['PROXIES']],
  ['vendor/gpui-pre-apple/src/metal_atlas.rs', 'MetalAtlasTextures', ['monochrome_textures', 'polychrome_textures']],
];

const files = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const path = join(dir, entry.name);
  if (entry.isDirectory()) return entry.name === 'target' ? [] : files(path);
  return entry.name.endsWith('.rs') ? [path] : [];
});

const DECLARATION = /^\s*\/\/\/?\s*cache:(.*)$/;
const BOUND = /^(entries|bytes)\s+\S/;
const COMMENT_OR_ATTRIBUTE = /^\s*(\/\/|#\[|#!\[)/;
const VISIBILITY = String.raw`(?:pub(?:\([^)]*\))?\s+)?`;
const STATIC = new RegExp(String.raw`^\s*${VISIBILITY}(?:static|const)\s+(?:mut\s+)?([A-Za-z_]\w*)`);
const FIELD = new RegExp(String.raw`^\s*${VISIBILITY}([A-Za-z_]\w*)\s*:(?!:)`);
const KEPT = /\bKept</;

/** A comment's `cache:` declaration: which bounds it gives, or null when it is prose that only starts with "cache:". */
function declaration(comment) {
  const m = DECLARATION.exec(comment);
  if (!m) return null;
  const parts = m[1].split(',').map((p) => p.trim()).filter(Boolean);
  const bounds = parts.filter((p) => BOUND.test(p));
  if (parts.length && !bounds.length) return null;
  return { entries: bounds.some((p) => p.startsWith('entries')), bytes: bounds.some((p) => p.startsWith('bytes')) };
}

/** What a code line holds, as a cache is named: `<Type>::<field>` for a struct's field, a static's own name. */
function holder(code, owner) {
  const item = STATIC.exec(code);
  if (item) return { name: item[1], ident: item[1], kind: 'static' };
  const field = FIELD.exec(code);
  if (field && owner && !/^\s*(let|fn|pub fn|use|type|impl|return)\b/.test(code)) {
    return { name: `${owner}::${field[1]}`, ident: field[1], kind: 'field' };
  }
  const word = /[A-Za-z_]\w*/.exec(code);
  return { name: word ? word[0] : '?', ident: word ? word[0] : '?', kind: 'other' };
}

const findings = [];
let declared = 0;
const scanned = ['crates', 'vendor'].map((d) => join(root, d)).filter((d) => existsSync(d)).flatMap(files);
for (const file of scanned) {
  const path = relative(root, file).split(sep).join('/');
  const text = readFileSync(file, 'utf8');
  // Comments kept, strings blanked: a `// cache:` inside a string declares nothing.
  const lines = stripRust(text, { keepComments: true }).split('\n');
  const code = stripRust(text).split('\n');
  // The struct each line is in, by its braces' depth.
  const owners = [];
  let owner = null;
  let depth = 0;
  let ownerDepth = -1;
  for (const line of code) {
    const struct = /^\s*(?:pub(?:\([^)]*\))?\s+)?struct\s+(\w+)[^;]*\{/.exec(line);
    if (struct && owner === null) {
      owner = struct[1];
      ownerDepth = depth;
    }
    owners.push(owner);
    depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
    if (owner !== null && depth <= ownerDepth) owner = null;
  }
  const declares = new Set();
  for (const [i, line] of lines.entries()) {
    const comment = line.indexOf('//');
    if (comment < 0) continue;
    const found = declaration(line.slice(comment));
    if (!found) continue;
    // On the holder's own line, or above it: the first line after the run of comments and attributes.
    let at = i;
    if (!code[i].trim()) {
      at = i + 1;
      while (at < lines.length && (COMMENT_OR_ATTRIBUTE.test(lines[at]) || !code[at].trim())) at++;
    }
    const { name } = holder(code[at] ?? '', owners[at]);
    declares.add(at);
    declared++;
    if (!found.entries || !found.bytes) {
      const has = found.bytes ? 'a byte bound and no entry bound' : found.entries ? 'an entry bound and no byte bound' : 'no bound';
      findings.push(`${path}:${i + 1}: ${name} declares ${has}; a long-lived cache declares both, in entries and in bytes`);
    }
  }
  // Every bounded cache, and every holder the issue names, carries a declaration.
  const named = NAMED.filter(([file]) => file === path);
  const seen = new Set();
  for (const [i, line] of code.entries()) {
    const h = holder(line, owners[i]);
    if (h.kind === 'other') continue;
    const issue = named.some(([, struct, holders]) => holders.includes(h.ident) && (struct === null ? h.kind === 'static' : h.name === `${struct}::${h.ident}`));
    if (issue) seen.add(h.name);
    if ((issue || KEPT.test(line)) && !declares.has(i)) {
      findings.push(`${path}:${i + 1}: ${h.name} declares no bounds; a long-lived cache declares a bound in entries and in bytes (// cache: entries <n>, bytes <n>)`);
    }
  }
  for (const [, struct, holders] of named) {
    for (const name of holders.map((h) => (struct ? `${struct}::${h}` : h)).filter((n) => !seen.has(n))) {
      findings.push(`${path}:1: ${name}, a holder the issue names, isn't in this file; move its name in scripts/cache-lint.mjs with it`);
    }
  }
}

for (const f of findings) console.log(`FAIL cache: ${f}`);
if (findings.length) {
  console.log('  Fix: declare both bounds on the cache, `// cache: entries <n>, bytes <n>`, and hold it to them.');
  process.exit(1);
}
console.log(`PASS cache: ${declared} long-lived caches declare a bound in entries and in bytes`);
