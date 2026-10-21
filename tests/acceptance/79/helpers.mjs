// Shared by the #79 acceptance tests: the surfaces manifest (brand/surfaces.json), the kit files it
// names, the bytes each surface really uses, and the checks on them. Nothing here reads the app's or
// the CLI's source: the app is reached through its built binary, the CLI through `deep --help` in a
// pty, the README and the docs head through their markup, and the rest through file bytes.
// Each check returns a list of problems; an empty list means it holds.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, isAbsolute, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));

// Criterion IDs, by the rule in tests/acceptance/48/README.md.
export const HASH = '#79.457c8d34';
export const SMALL = '#79.fd1154c6';
export const TRADEMARK = '#79.816c9037';
export const BUDGET = '#79.c744da3f';

// The surface (this job's choice, see README.md).
export const MANIFEST = 'brand/surfaces.json';
export const SEARCH = 'brand/trademark-search.json';
export const BRAND_README = 'brand/README.md';
export const README = 'README.md';
export const HEAD_HTML = 'docs/web/head.html';
export const WEBMANIFEST = 'docs/web/site.webmanifest';
export const SHOTS = 'docs/evidence/79/';
export const CLI = 'packages/cli/src/main.ts';
export const BINARY = 'target/debug/deep-app';

export const SURFACES = ['app-icon', 'menu-bar', 'title-bar', 'welcome', 'cli-banner', 'readme-light', 'readme-dark', 'docs-favicon', 'docs-web-icon', 'social-preview'];
// What the app embeds: the binary must hold these bytes, and their sizes add up to the budget.
export const APP_SURFACES = ['app-icon', 'menu-bar', 'title-bar', 'welcome'];
// Surfaces that are 24 px or smaller by nature: a menu-bar item, one terminal line, a tab icon.
export const SMALL_SURFACES = ['menu-bar', 'cli-banner', 'docs-favicon'];
// Surfaces whose ground the surface itself makes dark, so colour artwork (Signal on transparent)
// is allowed there: GitHub's dark theme, and the app's own dark appearance, which the shots show.
export const DARK_GROUND_SURFACES = ['readme-dark', 'title-bar', 'welcome'];
export const SMALL_PX = 24;
export const KB = 1000; // as benchmarks/budgets.json counts a megabyte, 10^6 bytes
export const ASSET_LIMIT = 200 * KB;
export const SHOT_LIMIT = 1_000_000;
export const REFERENCE_MODELS = ['Mac15,7', 'Mac15,12']; // docs/technical-design.md, "The reference Macs"

// brand/palette.json
export const INK = [21, 22, 25];
export const PAPER = [246, 246, 244];
export const WHITE = [255, 255, 255];
export const SIGNAL = [242, 196, 64];
const SIGNAL_HEX = /#f2c440\b|rgb\(\s*242\s*,\s*196\s*,\s*64\s*\)/i;
const DARK_HEX = /^#(151619|000000|000)$/i;
// The kit's small cut (brand/README.md, Construction): on a 16-unit grid of the 256 box, stem and
// bowl 3, counter radius 3, keyframe radius 2. build.py writes it as these path commands.
const SMALL_D = /M32,32 H128 A96,96 0 0 1 128,224 H32 Z M80,80 V176 H128 A48,48 0 0 0 128,80 Z/;
const REGULAR_D = /M44(\.75)?,36(\.75)? H120 A9[12](\.25)?,9[12](\.25)? 0 0 1 120,2(20|19\.25) H44/;

export const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
export const blocked = (message) => Error(`BLOCKED: ${message}`);

export function git(repo, ...args) {
  return spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}

const trackedCache = new Map();
// Committed or staged both count: the index is what the change will commit.
export function trackedFiles(repo) {
  if (!trackedCache.has(repo)) trackedCache.set(repo, new Set(git(repo, 'ls-files', '-z').stdout.split('\0').filter(Boolean)));
  return trackedCache.get(repo);
}
export const isRepoPath = (path) => typeof path === 'string' && path.length > 0 && !isAbsolute(path) && !path.split('/').includes('..') && normalize(path) === path;
export const tracked = (repo, path) => isRepoPath(path) && trackedFiles(repo).has(path) && existsSync(join(repo, path));
export const isKitFile = (repo, path) => tracked(repo, path) && /^brand\/.+\.(svg|png|icns|ico)$/.test(path);
export const bytes = (repo, path) => readFileSync(join(repo, path));

export function loadJson(repo, path, what) {
  if (!existsSync(join(repo, path))) throw blocked(`no ${what} at ${path}`);
  try {
    return JSON.parse(readFileSync(join(repo, path), 'utf8'));
  } catch (error) {
    throw blocked(`${path} is not JSON: ${error.message}`);
  }
}
export const loadManifest = (repo = root) => loadJson(repo, MANIFEST, 'surfaces manifest');

const list = (value) => (Array.isArray(value) ? value : []);
const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
const today = () => new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------------------------------------
// Images

// 8-bit, non-interlaced PNG (every colour type) to RGBA, with its text chunks.
export function decodePng(buffer) {
  if (buffer.length < 8 || buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw Error('not a PNG');
  let offset = 8, width, height, depth, colorType, interlace, palette, trns;
  const idat = [], text = [];
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset), type = buffer.subarray(offset + 4, offset + 8).toString('latin1'), data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === 'IHDR') { width = data.readUInt32BE(0); height = data.readUInt32BE(4); depth = data[8]; colorType = data[9]; interlace = data[12]; }
    else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'tEXt' || type === 'iTXt') text.push(data.toString('latin1'));
    else if (type === 'zTXt') { const end = data.indexOf(0); try { text.push(data.subarray(0, end).toString('latin1') + inflateSync(data.subarray(end + 2)).toString('latin1')); } catch { text.push(data.toString('latin1')); } }
    else if (type === 'IEND') break;
    offset += 12 + length;
  }
  if (!width || depth !== 8 || interlace !== 0) throw Error(`PNG the tests don't read: depth ${depth}, interlace ${interlace}`);
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[colorType];
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const pixels = new Uint8Array(width * height * 4);
  let previous = new Uint8Array(stride), position = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[position++];
    const line = new Uint8Array(raw.subarray(position, position + stride));
    position += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? line[i - channels] : 0, b = previous[i], c = i >= channels ? previous[i - channels] : 0;
      let value = line[i];
      if (filter === 1) value += a;
      else if (filter === 2) value += b;
      else if (filter === 3) value += (a + b) >> 1;
      else if (filter === 4) { const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c); value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
      line[i] = value & 255;
    }
    for (let x = 0; x < width; x++) {
      const out = (y * width + x) * 4, inp = x * channels;
      if (colorType === 6) pixels.set(line.subarray(inp, inp + 4), out);
      else if (colorType === 2) { pixels.set(line.subarray(inp, inp + 3), out); pixels[out + 3] = 255; }
      else if (colorType === 0) { pixels[out] = pixels[out + 1] = pixels[out + 2] = line[inp]; pixels[out + 3] = 255; }
      else if (colorType === 4) { pixels[out] = pixels[out + 1] = pixels[out + 2] = line[inp]; pixels[out + 3] = line[inp + 1]; }
      else { const index = line[inp]; pixels.set(palette.subarray(index * 3, index * 3 + 3), out); pixels[out + 3] = trns && index < trns.length ? trns[index] : 255; }
    }
    previous = line;
  }
  return { width, height, pixels, text };
}

// Apple's packed ARGB icon data (icns ic04, ic05, icsb, sb24): 'ARGB', then each channel run-length
// packed as iconutil writes it.
export function decodeArgb(data, size) {
  const count = size * size, out = new Uint8Array(count * 4);
  let offset = 4;
  for (let channel = 0; channel < 4; channel++) {
    const values = [];
    while (values.length < count) {
      if (offset >= data.length) throw Error('ARGB icon data ends early');
      const byte = data[offset++];
      if (byte < 128) for (let i = 0; i <= byte; i++) values.push(data[offset++]);
      else { const value = data[offset++]; for (let i = 0; i < byte - 125; i++) values.push(value); }
    }
    const target = [3, 0, 1, 2][channel];
    for (let i = 0; i < count; i++) out[i * 4 + target] = values[i];
  }
  return { width: size, height: size, pixels: out, text: [] };
}

// icns entry types, their pixel size and the point size they're shown at.
const ICNS_TYPES = {
  icp4: [16, 16], ic04: [16, 16], ic11: [32, 16], icsb: [18, 18], icsB: [36, 18], sb24: [24, 24], SB24: [48, 24],
  icp5: [32, 32], ic05: [32, 32], ic12: [64, 32], icp6: [64, 64], ic07: [128, 128], ic13: [256, 128], ic08: [256, 256], ic14: [512, 256], ic09: [512, 512], ic10: [1024, 512],
};
export function icnsEntries(buffer) {
  if (buffer.length < 8 || buffer.subarray(0, 4).toString('latin1') !== 'icns') throw Error('not an icns file');
  const entries = [];
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const type = buffer.subarray(offset, offset + 4).toString('latin1'), length = buffer.readUInt32BE(offset + 4);
    const data = buffer.subarray(offset + 8, offset + length);
    offset += Math.max(length, 8);
    if (!ICNS_TYPES[type]) continue;
    const [px, pt] = ICNS_TYPES[type];
    const entry = { type, px, pt };
    try {
      if (data.subarray(0, 4).toString('latin1') === 'ARGB') entry.image = decodeArgb(data, px);
      else if (data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') entry.image = decodePng(data);
      else entry.error = 'neither PNG nor ARGB data (JPEG 2000?)';
      if (entry.image && (entry.image.width !== px || entry.image.height !== px)) entry.error = `${entry.image.width}x${entry.image.height} data in a ${px} px entry`;
    } catch (error) {
      entry.error = error.message;
    }
    entries.push(entry);
  }
  return entries;
}

export function icoEntries(buffer) {
  if (buffer.length < 6 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) throw Error('not an ico file');
  const count = buffer.readUInt16LE(4), entries = [];
  for (let i = 0; i < count; i++) {
    const at = 6 + i * 16, px = buffer[at] || 256, size = buffer.readUInt32LE(at + 8), start = buffer.readUInt32LE(at + 12);
    const data = buffer.subarray(start, start + size), entry = { px, pt: px, bytes: data };
    try {
      if (data.subarray(0, 8).toString('hex') === '89504e470d0a1a0a') entry.image = decodePng(data);
      else entry.error = 'a BMP entry, which the tests don\'t read; the kit\'s .ico holds PNG entries';
      if (entry.image && (entry.image.width !== px || entry.image.height !== px)) entry.error = `${entry.image.width}x${entry.image.height} data in a ${px} px entry`;
    } catch (error) {
      entry.error = error.message;
    }
    entries.push(entry);
  }
  return entries;
}

const distance = (pixels, i, [r, g, b]) => Math.hypot(pixels[i] - r, pixels[i + 1] - g, pixels[i + 2] - b);
const opaque = (pixels, i) => pixels[i + 3] >= 250;
export const isSignal = (pixels, i) => opaque(pixels, i) && distance(pixels, i, SIGNAL) < 48;
export const isLight = (pixels, i) => opaque(pixels, i) && Math.min(pixels[i], pixels[i + 1], pixels[i + 2]) >= 230;

// Which cut a raster of the mark takes, from the D's shape: the small cut's D is square (on the
// 16-unit grid it spans 32..224 both ways), the regular D is 168 wide by 184 tall (0.913). Widths
// are coverage sums, so anti-aliased edges count by their fraction. The drawn mark is what isn't
// ground: the light parts inside an Ink tile when the image has light pixels, else whatever has
// alpha (an Ink or black mark on transparent).
export function cut(image) {
  const { width, height, pixels } = image;
  const coverage = new Float32Array(width * height);
  let hasLight = false;
  for (let i = 0; i < width * height; i++) if (isLight(pixels, i * 4)) { hasLight = true; break; }
  for (let i = 0; i < width * height; i++) {
    const alpha = pixels[i * 4 + 3] / 255;
    if (!hasLight) { coverage[i] = alpha; continue; }
    const lum = (pixels[i * 4] + pixels[i * 4 + 1] + pixels[i * 4 + 2]) / 3, inkLum = (INK[0] + INK[1] + INK[2]) / 3;
    coverage[i] = alpha * Math.min(1, Math.max(0, (lum - inkLum) / (255 - inkLum)));
  }
  let w = 0, h = 0;
  for (let x = 0; x < width; x++) { let m = 0; for (let y = 0; y < height; y++) m = Math.max(m, coverage[y * width + x]); w += m; }
  for (let y = 0; y < height; y++) { let m = 0; for (let x = 0; x < width; x++) m = Math.max(m, coverage[y * width + x]); h += m; }
  if (h < 4) return { cut: 'unclear', aspect: null, reason: 'no mark found' };
  const aspect = w / h;
  // A lockup or a wordmark is wider than tall; only the symbol or its tile is judged here.
  return { cut: aspect > 1.1 ? 'not a symbol' : aspect >= 0.96 ? 'small' : aspect <= 0.935 ? 'regular' : 'unclear', aspect };
}

export function svgCut(text) {
  if (SMALL_D.test(text) && !REGULAR_D.test(text)) return 'small';
  if (REGULAR_D.test(text)) return 'regular';
  return 'none';
}

// Signal pixels next to a light pixel (White, Paper or any near-white), and, when the ground
// outside the file isn't known to be dark, next to a pixel that isn't opaque (the ground shows
// through there). Returns the first few offending pixels.
export function signalPixels(image, { groundKnownDark = false } = {}) {
  const { width, height, pixels } = image;
  const onLight = [], onUnknown = [];
  let count = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (!isSignal(pixels, i)) continue;
      count++;
      let light = false, open = false;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) { open = true; continue; }
          const j = (ny * width + nx) * 4;
          if (isLight(pixels, j)) light = true;
          else if (!opaque(pixels, j)) open = true;
        }
      }
      if (light && onLight.length < 5) onLight.push(`${x},${y}`);
      if (open && !groundKnownDark && onUnknown.length < 5) onUnknown.push(`${x},${y}`);
    }
  }
  return { count, onLight, onUnknown };
}

// For an SVG, a structural reading: does it paint Signal, and is its first painted element a
// dark fill (an Ink tile the rest sits on)?
export function svgSignal(text) {
  const hasSignal = SIGNAL_HEX.test(text);
  const first = text.match(/<(path|rect|circle|polygon|ellipse)\b[^>]*>/i);
  const fill = first?.[0].match(/\bfill\s*=\s*"([^"]+)"/i)?.[1] ?? first?.[0].match(/fill\s*:\s*([^;"]+)/i)?.[1];
  return { hasSignal, firstPaintDark: Boolean(fill && DARK_HEX.test(fill.trim())) };
}

// Decodes the bytes a surface uses into the images to judge, each with its pixel and point size.
// An SVG gives no image (judged structurally); a container gives one per entry.
export function imagesOf(path, buffer, entry = {}) {
  const scale = entry.scale ?? 1;
  if (/\.png$/i.test(path)) { const image = decodePng(buffer); return [{ label: path, image, px: image.height, pt: image.height / scale }]; }
  if (/\.icns$/i.test(path)) return icnsEntries(buffer).map((each) => ({ label: `${path} ${each.type} (${each.px} px, ${each.pt} pt)`, ...each }));
  if (/\.ico$/i.test(path)) return icoEntries(buffer).map((each) => ({ label: `${path} ${each.px} px`, ...each }));
  return [];
}

// ---------------------------------------------------------------------------------------------
// Criterion 1: every surface uses the kit's files, never a redrawn copy, by hash

export function manifestProblems(manifest, repo = root) {
  const problems = [];
  if (manifest?.issue !== 79) problems.push(`${MANIFEST}: issue must be 79`);
  const entries = list(manifest?.surfaces);
  if (!entries.length) problems.push(`${MANIFEST}: surfaces is empty`);
  for (const id of SURFACES) if (!entries.some((entry) => entry?.surface === id)) problems.push(`${MANIFEST}: no entry for the ${id} surface`);
  entries.forEach((entry, index) => {
    const where = `${MANIFEST} surfaces[${index}] (${entry?.surface ?? 'no surface'})`;
    if (!SURFACES.includes(entry?.surface)) problems.push(`${where}: surface must be one of ${SURFACES.join(', ')}`);
    if (!isKitFile(repo, entry?.kit)) { problems.push(`${where}: kit must be a tracked .svg, .png, .icns or .ico under brand/, not ${JSON.stringify(entry?.kit)}`); return; }
    if (!tracked(repo, entry?.use)) { problems.push(`${where}: use must be a tracked file, not ${JSON.stringify(entry?.use)}`); return; }
    const kitHash = sha256(bytes(repo, entry.kit)), useHash = sha256(bytes(repo, entry.use));
    if (kitHash !== useHash) problems.push(`${where}: ${entry.use} (sha256 ${useHash.slice(0, 12)}) is not byte for byte the kit's ${entry.kit} (${kitHash.slice(0, 12)}): a redrawn or re-encoded copy`);
    const container = /\.(icns|ico)$/i.test(entry.kit);
    if (entry.surface !== 'social-preview' && !container) {
      if (!Number.isInteger(entry.px) || entry.px <= 0) problems.push(`${where}: px, the height the mark is shown at in points, must be a positive integer`);
      if (entry.scale !== undefined && ![1, 2, 3].includes(entry.scale)) problems.push(`${where}: scale must be 1, 2 or 3`);
      if (/\.png$/i.test(entry.kit) && Number.isInteger(entry.px)) {
        try {
          const image = decodePng(bytes(repo, entry.kit));
          if (image.height !== entry.px * (entry.scale ?? 1)) problems.push(`${where}: a ${image.width}x${image.height} PNG shown at ${entry.px} pt (scale ${entry.scale ?? 1}) is resampled; px times scale must be its height`);
        } catch (error) { problems.push(`${where}: ${entry.kit}: ${error.message}`); }
      }
    }
    const shots = list(entry?.shots);
    if (!shots.length) problems.push(`${where}: shots must name at least one screenshot under ${SHOTS}`);
  });
  return problems;
}

// The README's <picture>: its dark source and light image are the readme surfaces' files.
export function readmePicture(repo = root) {
  const text = readFileSync(join(repo, README), 'utf8');
  const picture = text.match(/<picture>([\s\S]*?)<\/picture>/)?.[1] ?? '';
  const dark = picture.match(/<source[^>]*media="\(prefers-color-scheme:\s*dark\)"[^>]*srcset="([^"]+)"/)?.[1] ?? picture.match(/<source[^>]*srcset="([^"]+)"[^>]*media="\(prefers-color-scheme:\s*dark\)"/)?.[1];
  const light = picture.match(/<img[^>]*\ssrc="([^"]+)"/)?.[1];
  return { dark, light };
}

export function readmeProblems(manifest, repo = root) {
  const problems = [], { dark, light } = readmePicture(repo);
  const uses = (id) => list(manifest?.surfaces).filter((entry) => entry?.surface === id).map((entry) => entry?.use);
  if (!light) problems.push(`${README}: no <picture> with an <img src> for the light header`);
  else if (!uses('readme-light').includes(light)) problems.push(`${README}: the light header ${light} is not a readme-light entry's use in ${MANIFEST} (${uses('readme-light').join(', ') || 'none'})`);
  if (!dark) problems.push(`${README}: no <picture> <source media="(prefers-color-scheme: dark)"> for the dark header`);
  else if (!uses('readme-dark').includes(dark)) problems.push(`${README}: the dark header ${dark} is not a readme-dark entry's use in ${MANIFEST} (${uses('readme-dark').join(', ') || 'none'})`);
  return problems;
}

// The docs head fragment and web manifest: every icon they reference, resolved from docs/web/.
export function docsIcons(repo = root) {
  const problems = [], icons = [];
  const base = join(repo, dirname(HEAD_HTML));
  const resolveRef = (reference, where) => {
    if (!reference || /^(https?:)?\/\//i.test(reference) || reference.startsWith('data:')) { problems.push(`${where}: ${reference ?? 'an empty reference'} must be a relative path to a file in the repo`); return null; }
    const path = relative(repo, resolve(base, reference.split(/[?#]/)[0]));
    if (!isRepoPath(path) || !tracked(repo, path)) { problems.push(`${where}: ${reference} does not resolve to a tracked file`); return null; }
    return path;
  };
  if (!existsSync(join(repo, HEAD_HTML))) { problems.push(`no docs head fragment at ${HEAD_HTML}`); return { problems, icons }; }
  const head = readFileSync(join(repo, HEAD_HTML), 'utf8');
  const links = [...head.matchAll(/<link\b[^>]*>/gi)].map((match) => match[0]);
  const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`, 'i'))?.[1];
  const byRel = (rel) => links.filter((tag) => (attribute(tag, 'rel') ?? '').toLowerCase().split(/\s+/).includes(rel));
  if (!byRel('icon').length) problems.push(`${HEAD_HTML}: no <link rel="icon">`);
  if (!byRel('apple-touch-icon').length) problems.push(`${HEAD_HTML}: no <link rel="apple-touch-icon">`);
  for (const tag of [...byRel('icon'), ...byRel('apple-touch-icon')]) {
    const path = resolveRef(attribute(tag, 'href'), `${HEAD_HTML} ${tag}`);
    if (path) icons.push({ path, sizes: attribute(tag, 'sizes'), type: attribute(tag, 'type'), where: `${HEAD_HTML} ${tag}` });
  }
  const manifestLink = byRel('manifest')[0];
  if (!manifestLink) problems.push(`${HEAD_HTML}: no <link rel="manifest">`);
  else {
    const path = resolveRef(attribute(manifestLink, 'href'), `${HEAD_HTML} ${manifestLink}`);
    if (path && path !== WEBMANIFEST) problems.push(`${HEAD_HTML}: the manifest link must point at ${WEBMANIFEST}, not ${path}`);
  }
  if (!existsSync(join(repo, WEBMANIFEST))) problems.push(`no web manifest at ${WEBMANIFEST}`);
  else {
    let manifest;
    try { manifest = JSON.parse(readFileSync(join(repo, WEBMANIFEST), 'utf8')); } catch (error) { problems.push(`${WEBMANIFEST} is not JSON: ${error.message}`); }
    const entries = list(manifest?.icons);
    if (!entries.length) problems.push(`${WEBMANIFEST}: icons is empty`);
    entries.forEach((icon, index) => {
      const where = `${WEBMANIFEST} icons[${index}]`;
      const path = resolveRef(icon?.src, where);
      if (path) icons.push({ path, sizes: icon?.sizes, type: icon?.type, where });
    });
  }
  return { problems, icons };
}

export function docsProblems(manifest, repo = root) {
  const { problems, icons } = docsIcons(repo);
  const declared = list(manifest?.surfaces).filter((entry) => ['docs-favicon', 'docs-web-icon'].includes(entry?.surface));
  const kits = new Set(trackedFiles(repo));
  for (const icon of icons) {
    if (!declared.some((entry) => entry.use === icon.path)) problems.push(`${icon.where}: ${icon.path} is not the use of any docs-favicon or docs-web-icon entry in ${MANIFEST}`);
    const data = bytes(repo, icon.path);
    const hash = sha256(data);
    if (![...kits].some((path) => /^brand\//.test(path) && sha256(bytes(repo, path)) === hash)) problems.push(`${icon.where}: ${icon.path} matches no kit file's bytes`);
    // The declared sizes are the file's: a wrong `sizes` makes a browser scale another entry.
    try {
      const sizes = imagesOf(icon.path, data).map((each) => each.error ? `?` : `${each.image.width}x${each.image.height}`);
      if (icon.sizes && icon.sizes !== 'any' && sizes.length) {
        const declaredSizes = icon.sizes.toLowerCase().split(/\s+/).sort().join(' '), actual = [...new Set(sizes)].sort().join(' ');
        if (declaredSizes !== actual) problems.push(`${icon.where}: sizes="${icon.sizes}" but the file holds ${actual}`);
      }
    } catch (error) { problems.push(`${icon.where}: ${error.message}`); }
  }
  for (const entry of declared) if (!icons.some((icon) => icon.path === entry.use)) problems.push(`${MANIFEST}: ${entry.surface} ${entry.use} is referenced by neither ${HEAD_HTML} nor ${WEBMANIFEST}`);
  return problems;
}

// `deep --help` in a pty, as a terminal runs it. Returns the raw output and every inline image it
// carries: iTerm2's OSC 1337 File (base64 after the colon) and kitty's APC G (base64 payloads,
// chunked with m=1 until m=0).
export function cliHelp(env, repo = root) {
  const result = spawnSync('script', ['-q', '-t', '0', '/dev/null', process.execPath, CLI, '--help'], {
    cwd: repo, encoding: 'latin1', timeout: 30_000, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
    env: { PATH: process.env.PATH, HOME: process.env.HOME, LANG: 'en_US.UTF-8', COLUMNS: '120', LINES: '40', ...env },
  });
  if (result.error) throw blocked(`could not run ${CLI} --help in a pty through script(1): ${result.error.message}`);
  const output = (result.stdout ?? '').replace(/^\^D\x08\x08/, '');
  const images = [];
  for (const match of output.matchAll(/\x1b\]1337;File=([^:\x07\x1b]*):([A-Za-z0-9+/=]+)(?:\x07|\x1b\\)/g)) images.push({ protocol: 'iterm2', args: match[1], bytes: Buffer.from(match[2], 'base64') });
  let kitty = [];
  for (const match of output.matchAll(/\x1b_G([^;\x1b]*)(?:;([A-Za-z0-9+/=]*))?\x1b\\/g)) {
    const control = Object.fromEntries(match[1].split(',').filter(Boolean).map((pair) => pair.split('=')));
    kitty.push(match[2] ?? '');
    if (control.m !== '1') { images.push({ protocol: 'kitty', args: match[1], bytes: Buffer.from(kitty.join(''), 'base64') }); kitty = []; }
  }
  const lines = output.split(/\r?\n/);
  return { status: result.status, output, images, lines, text: output.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b_[^\x1b]*\x1b\\|\x1b\[[0-9;?]*[ -/]*[@-~]/g, '') };
}

export const TERMINALS = {
  iterm2: { TERM: 'xterm-256color', TERM_PROGRAM: 'iTerm.app', TERM_PROGRAM_VERSION: '3.5.0', LC_TERMINAL: 'iTerm2', LC_TERMINAL_VERSION: '3.5.0' },
  kitty: { TERM: 'xterm-kitty', TERM_PROGRAM: '', KITTY_WINDOW_ID: '1' },
  plain: { TERM: 'xterm-256color', TERM_PROGRAM: '' },
};
const IMAGE_ESCAPES = /\x1b\]1337;File=|\x1b_G/;

export function bannerProblems(manifest, { iterm2, kitty, plain, piped }) {
  const problems = [];
  const kits = list(manifest?.surfaces).filter((entry) => entry?.surface === 'cli-banner' && isKitFile(root, entry.kit));
  const hashes = new Map(kits.map((entry) => [sha256(bytes(root, entry.kit)), entry.kit]));
  const capable = [['iTerm2', iterm2], ['kitty', kitty]].filter(([, run]) => run.images.length);
  if (!capable.length) problems.push(`deep --help prints no inline image under iTerm2 (${TERMINALS.iterm2.TERM_PROGRAM}) nor kitty (${TERMINALS.kitty.TERM}): the terminal can show the mark and the banner doesn't`);
  for (const [name, run] of [['iTerm2', iterm2], ['kitty', kitty], ['plain', plain]]) {
    if (run.status !== 0) problems.push(`${name}: deep --help exited ${run.status}`);
    if (!/Usage: deep/.test(run.text)) problems.push(`${name}: the help no longer says "Usage: deep"`);
    const banner = run.lines[0] ?? '';
    const bannerText = banner.replace(/\x1b\][^\x07\x1b]*(\x07|\x1b\\)|\x1b_[^\x1b]*\x1b\\|\x1b\[[0-9;?]*[ -/]*[@-~]/g, '');
    if (!/DeepBuild/.test(bannerText)) problems.push(`${name}: the first line of deep --help is not a banner naming DeepBuild: ${JSON.stringify(banner.slice(0, 120))}`);
    const imageLines = run.lines.map((line, index) => (IMAGE_ESCAPES.test(line) ? index : -1)).filter((index) => index >= 0);
    if (imageLines.some((index) => index !== 0)) problems.push(`${name}: the mark appears on line ${imageLines.find((index) => index !== 0) + 1}, not only in the one-line banner`);
    if (run.images.length > 1) problems.push(`${name}: ${run.images.length} inline images; the banner carries the mark once`);
    for (const image of run.images) {
      const hash = sha256(image.bytes);
      if (!hashes.has(hash)) problems.push(`${name}: the inline image (${image.protocol}, ${image.bytes.length} bytes, sha256 ${hash.slice(0, 12)}) is not byte for byte a cli-banner entry's kit file (${[...hashes.values()].join(', ') || 'none declared'})`);
    }
  }
  if (IMAGE_ESCAPES.test(plain.output)) problems.push('plain: a terminal that identifies as neither iTerm2 nor kitty gets an image escape it may print as garbage');
  if (IMAGE_ESCAPES.test(piped.stdout) || /\x1b/.test(piped.stdout)) problems.push('piped: deep --help with stdout not a terminal prints escape sequences');
  if (piped.status !== 0 || !/Usage: deep/.test(piped.stdout)) problems.push(`piped: deep --help exited ${piped.status} or lost its usage`);
  return problems;
}

export function pipedHelp(repo = root) {
  return spawnSync(process.execPath, [CLI, '--help'], { cwd: repo, encoding: 'utf8', timeout: 30_000, env: { ...process.env, TERM: 'xterm-256color', TERM_PROGRAM: '' } });
}

// ---------------------------------------------------------------------------------------------
// Criterion 2: the small cut at 24 px and below, and no Signal on White or Paper

export function cutProblems(manifest, repo = root) {
  const problems = [];
  for (const entry of list(manifest?.surfaces)) {
    if (!isKitFile(repo, entry?.kit)) continue;
    const where = `${entry.surface} ${entry.kit}`;
    const data = bytes(repo, entry.kit);
    if (SMALL_SURFACES.includes(entry.surface) && !/\.(icns|ico)$/i.test(entry.kit) && !(Number.isInteger(entry.px) && entry.px <= SMALL_PX)) problems.push(`${where}: a ${entry.surface} use is ${SMALL_PX} px or smaller by nature; px is ${entry.px}`);
    if (/\.svg$/i.test(entry.kit)) {
      if (Number.isInteger(entry.px) && entry.px <= SMALL_PX && svgCut(data.toString('utf8')) !== 'small') problems.push(`${where}: shown at ${entry.px} px but its D is not the small cut (brand/README.md, Construction: Small cut)`);
      continue;
    }
    let images;
    try { images = imagesOf(entry.kit, data, entry); } catch (error) { problems.push(`${where}: ${error.message}`); continue; }
    if (/\.(icns|ico)$/i.test(entry.kit) && !images.some((each) => each.pt <= SMALL_PX)) problems.push(`${where}: holds no entry of ${SMALL_PX} px or smaller`);
    for (const each of images) {
      if (each.pt > SMALL_PX) continue;
      if (each.error) { problems.push(`${entry.surface} ${each.label}: ${each.error}`); continue; }
      const result = cut(each.image);
      if (result.cut !== 'small') problems.push(`${entry.surface} ${each.label}: shown at ${each.pt} pt, its D measures ${result.aspect?.toFixed(3) ?? '?'} wide for its height (${result.cut}); the small cut's D is square`);
    }
  }
  return problems;
}

export function signalProblems(manifest, repo = root) {
  const problems = [];
  for (const entry of list(manifest?.surfaces)) {
    if (!isKitFile(repo, entry?.kit)) continue;
    const where = `${entry.surface} ${entry.kit}`;
    const data = bytes(repo, entry.kit);
    const darkGround = DARK_GROUND_SURFACES.includes(entry.surface);
    if (/\.svg$/i.test(entry.kit)) {
      const { hasSignal, firstPaintDark } = svgSignal(data.toString('utf8'));
      if (!hasSignal) continue;
      if (entry.surface === 'readme-light') problems.push(`${where}: the light header paints Signal; GitHub shows it on white`);
      else if (entry.surface === 'menu-bar') problems.push(`${where}: a menu-bar template paints Signal; the light menu bar is white`);
      else if (!darkGround && !firstPaintDark) problems.push(`${where}: paints Signal and brings no dark ground (its first painted element is not an Ink fill), on a surface whose ground may be white or paper`);
      continue;
    }
    let images;
    try { images = imagesOf(entry.kit, data, entry); } catch (error) { problems.push(`${where}: ${error.message}`); continue; }
    for (const each of images) {
      const label = `${entry.surface} ${each.label}`;
      if (each.error) { problems.push(`${label}: ${each.error}`); continue; }
      const found = signalPixels(each.image, { groundKnownDark: darkGround });
      if (entry.surface === 'menu-bar' && found.count) problems.push(`${label}: a menu-bar template holds ${found.count} Signal pixels; the light menu bar is white`);
      if (found.onLight.length) problems.push(`${label}: Signal next to white or paper at ${found.onLight.join(' ')}`);
      if (found.onUnknown.length) problems.push(`${label}: Signal next to transparent pixels at ${found.onUnknown.join(' ')}, on a surface whose ground may be white or paper`);
    }
  }
  return problems;
}

// The kit itself: artwork approved for light grounds carries no Signal, and artwork that carries
// Signal is colour artwork for dark grounds or brings an Ink tile.
export function kitProblems(repo = root) {
  const problems = [];
  for (const path of trackedFiles(repo)) {
    if (!/^brand\/.+\.svg$/.test(path)) continue;
    const { hasSignal, firstPaintDark } = svgSignal(readFileSync(join(repo, path), 'utf8'));
    const lightGround = /-ink\.svg$|readme-light\.svg$|-white\.svg$|Template\.svg$|template\.svg$/.test(path);
    if (hasSignal && lightGround) problems.push(`${path}: artwork for light grounds (brand/README.md, Approved backgrounds) paints Signal`);
    if (hasSignal && !lightGround && !/color-dark|animated|readme-dark/.test(path) && !firstPaintDark) problems.push(`${path}: paints Signal but is neither colour artwork for dark grounds nor on an Ink tile`);
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Proof: the screenshots

export function shotProblems(manifest, repo = root) {
  const problems = [], bySurface = new Map();
  const home = process.env.HOME ?? '';
  for (const entry of list(manifest?.surfaces)) {
    for (const shot of list(entry?.shots)) {
      const where = `${entry?.surface} shot ${shot}`;
      if (!isRepoPath(shot) || !shot.startsWith(SHOTS) || !/\.png$/i.test(shot)) { problems.push(`${where}: shots are PNGs under ${SHOTS}`); continue; }
      if (!tracked(repo, shot)) { problems.push(`${where}: not a tracked file`); continue; }
      const data = bytes(repo, shot);
      if (data.length > SHOT_LIMIT) problems.push(`${where}: ${data.length} bytes; keep a shot under ${SHOT_LIMIT} (crop it to the surface)`);
      let image;
      try { image = decodePng(data); } catch (error) { problems.push(`${where}: ${error.message}`); continue; }
      if (image.width < 32 || image.height < 32) problems.push(`${where}: ${image.width}x${image.height} is too small to show a surface`);
      for (const chunk of image.text) if (/\/Users\/|\/home\//.test(chunk) || (home && chunk.includes(home))) problems.push(`${where}: a text chunk holds a home path`);
      const found = signalPixels(image, { groundKnownDark: true });
      if (found.onLight.length) problems.push(`${where}: Signal next to white or paper at ${found.onLight.join(' ')}`);
      const hash = sha256(data);
      for (const [surface, hashes] of bySurface) if (surface !== entry.surface && hashes.has(hash)) problems.push(`${where}: the same image as a ${surface} shot; each surface has its own`);
      if (!bySurface.has(entry.surface)) bySurface.set(entry.surface, new Set());
      bySurface.get(entry.surface).add(hash);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Criterion 3: the trademark search

export const SEARCH_STATUSES = ['clear', 'proceed-with-risk'];
export function searchProblems(record, readme) {
  const problems = [];
  if (!/^deep\s?build$/i.test(String(record?.mark ?? ''))) problems.push(`${SEARCH}: mark must be DeepBuild`);
  if (!isDate(record?.searchedOn) || record.searchedOn > today()) problems.push(`${SEARCH}: searchedOn must be a date (YYYY-MM-DD) not in the future`);
  if (typeof record?.searchedBy !== 'string' || record.searchedBy.trim().length < 3) problems.push(`${SEARCH}: searchedBy names who ran it (a firm, a service or a role; no personal data)`);
  const registers = list(record?.registers);
  if (!registers.length) problems.push(`${SEARCH}: registers is empty; no register was searched`);
  registers.forEach((register, index) => {
    const where = `${SEARCH} registers[${index}]`;
    if (typeof register?.register !== 'string' || !register.register.trim()) problems.push(`${where}: register names the office or database searched`);
    if (!isDate(register?.queriedOn) || register.queriedOn > today()) problems.push(`${where}: queriedOn must be a date not in the future`);
    const terms = list(register?.terms).filter((term) => typeof term === 'string');
    if (!terms.some((term) => /deep\s*build/i.test(term))) problems.push(`${where}: terms must include the name (DeepBuild)`);
    const classes = list(register?.classes).map(Number);
    if (!classes.includes(9) || !classes.includes(42)) problems.push(`${where}: classes must include Nice classes 9 (software) and 42 (software services)`);
    if (!Array.isArray(register?.hits)) problems.push(`${where}: hits must be a list (empty when the search found none)`);
    list(register?.hits).forEach((hit, hitIndex) => {
      if (typeof hit?.mark !== 'string' || !hit.mark.trim() || typeof hit?.status !== 'string' || !hit.status.trim() || typeof hit?.similarity !== 'string' || !hit.similarity.trim()) problems.push(`${where}.hits[${hitIndex}]: each hit names its mark, its status and its similarity to DeepBuild`);
    });
  });
  const conclusion = record?.conclusion;
  if (!SEARCH_STATUSES.includes(conclusion?.status)) problems.push(`${SEARCH}: conclusion.status must be ${SEARCH_STATUSES.join(' or ')}; the mark goes outside the repo only on one of those`);
  if (typeof conclusion?.reason !== 'string' || conclusion.reason.trim().length < 20) problems.push(`${SEARCH}: conclusion.reason says why, from the hits`);
  if (conclusion?.status === 'proceed-with-risk' && (typeof conclusion?.decidedBy !== 'string' || !conclusion.decidedBy.trim())) problems.push(`${SEARCH}: proceeding with a risk is a decision; conclusion.decidedBy names who took it`);
  if (/no trademark search/i.test(readme ?? '')) problems.push(`${BRAND_README} still says no trademark search has been done`);
  if (!(readme ?? '').includes('trademark-search.json')) problems.push(`${BRAND_README} doesn't point at ${SEARCH}`);
  return problems;
}

// The privacy rule on the manifest and the search record, redrafted 2026-10-20 from AGENTS.md ("No secrets or
// personal data in code, fixtures, logs or evidence") and README.md ("Neither file holds a home path or an
// email address outside `example.*`").
// A home path is a user's home folder written out, at the start of a path: `/Users/<name>`, `/home/<name>`,
// `<drive>:\Users\<name>` (with the backslashes JSON doubles) or this machine's HOME. A `home` segment inside
// a URL, such as a register's search page, is not one, and `~` is how the design redacts a home folder.
// An email address is a local part and a domain standing on their own. An `@` inside a path, after a `/`, or
// one that starts a raster's scale suffix (`trayTemplate@2x.png`, which the README's own manifest lists) is a
// file name, not an address. Addresses under `example.*`, the reserved documentation domains, are allowed,
// so nobody's; any other is somebody's. Problems name an address or a path with its person cut to one letter.
const HOME_PATH = /(?<![\w.-])(\/Users\/|\/home\/|[A-Za-z]:\\+Users\\+)([^\s"'\\/]+)/g;
const EMAIL = /(?<![\w./+-])([A-Za-z0-9._%+-]+)@((?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,})(?![\w-])/g;
export function privacyProblems(repo = root, paths = [MANIFEST, SEARCH]) {
  const problems = [], home = process.env.HOME ?? '';
  for (const path of paths) {
    if (!existsSync(join(repo, path))) continue;
    const text = readFileSync(join(repo, path), 'utf8');
    for (const [, folder, name] of text.matchAll(HOME_PATH)) problems.push(`${path} holds a home path: ${folder}${name[0]}…`);
    if (home && text.includes(home)) problems.push(`${path} holds this machine's home folder`);
    for (const [, local, domain] of text.matchAll(EMAIL)) {
      if (/^\d+x\.\w+$/i.test(domain)) continue;
      if (!/(^|\.)example\.[a-z]+$/i.test(domain)) problems.push(`${path} holds an email address: ${local[0]}…@${domain}`);
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------------------------
// Criterion 4: the mark's assets add under 200 KB to the app

export function appAssets(manifest, repo = root) {
  const files = new Map();
  for (const entry of list(manifest?.surfaces)) if (APP_SURFACES.includes(entry?.surface) && isKitFile(repo, entry.kit)) files.set(entry.kit, statSync(join(repo, entry.kit)).size);
  return { files, total: [...files.values()].reduce((sum, size) => sum + size, 0) };
}

export function budgetRecordProblems(manifest, repo = root) {
  const problems = [], app = manifest?.app;
  const { files, total } = appAssets(manifest, repo);
  if (!files.size) problems.push(`${MANIFEST}: no app surface names a kit file, so nothing is embedded`);
  if (total >= ASSET_LIMIT) problems.push(`the kit files the app embeds add up to ${total} bytes, not under ${ASSET_LIMIT}: ${[...files].map(([path, size]) => `${path} ${size}`).join(', ')}`);
  if (!app) { problems.push(`${MANIFEST}: no app record (mergeBase, machine, strippedBytes)`); return problems; }
  if (!/^[0-9a-f]{40}$/.test(app.mergeBase ?? '')) problems.push(`${MANIFEST} app.mergeBase must be a 40-hex commit`);
  else if (git(repo, 'merge-base', '--is-ancestor', app.mergeBase, 'HEAD').status !== 0) problems.push(`${MANIFEST} app.mergeBase ${app.mergeBase.slice(0, 7)} is not an ancestor of HEAD`);
  if (!REFERENCE_MODELS.includes(app.machine?.model)) problems.push(`${MANIFEST} app.machine.model ${JSON.stringify(app.machine?.model)} is neither reference Mac (${REFERENCE_MODELS.join(', ')}); off them a budget is only a reading: INCONCLUSIVE`);
  if (!/^\d\d[A-Z]\d+[a-z]?$/.test(app.machine?.macosBuild ?? '')) problems.push(`${MANIFEST} app.machine.macosBuild must be the build sw_vers prints`);
  if (!isDate(app.measuredOn) || app.measuredOn > today()) problems.push(`${MANIFEST} app.measuredOn must be a date not in the future`);
  const { base, head } = app.strippedBytes ?? {};
  if (!Number.isSafeInteger(base) || base <= 0 || !Number.isSafeInteger(head) || head <= 0) problems.push(`${MANIFEST} app.strippedBytes.base and .head are the stripped release binary's sizes in bytes`);
  else if (head - base >= ASSET_LIMIT) problems.push(`the stripped app grew ${head - base} bytes over the merge base, not under ${ASSET_LIMIT}`);
  else if (head - base < total * 0.5) problems.push(`the stripped app grew only ${head - base} bytes while the manifest says it embeds ${total}; the record and the binary disagree`);
  return problems;
}

export function thisMachine() {
  const model = spawnSync('sysctl', ['-n', 'hw.model'], { encoding: 'utf8' }).stdout?.trim() ?? '';
  const macosBuild = spawnSync('sw_vers', ['-buildVersion'], { encoding: 'utf8' }).stdout?.trim() ?? '';
  return { model, macosBuild, reference: REFERENCE_MODELS.includes(model) };
}
