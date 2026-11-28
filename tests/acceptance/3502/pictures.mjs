// Criterion 3's tools (README: The pictures): the replica's picture of each shipped page, taken through `deep-drive`
// as #124 and #1458 drive it (`launch`, `screenshot`), a PNG read to its pixels, and the judge that holds the head's
// pictures against the merge base's and against the list of differing pictures. Nothing here draws a page.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { blocked, clip, EVIDENCE, read, REPO, tempDir, tilde } from './common.mjs';

/** The record every picture draws, the replica's own fixture of 40 open asks, read from this checkout by both sides. */
export const RECORD = join(REPO, 'docs/spikes/338/fixtures/needs-you.events.jsonl');
/** Where the differing pictures are listed with their causes. */
export const LIST = `${EVIDENCE}/pictures.json`;
export const THEMES = ['light', 'dark'];

/**
 * The two windows: `opening`, the size the app opens at, which the clean look names (`window_width`, `window_height`),
 * and `reference`, the design's reference window, which a launch that names no size opens.
 */
export function windows(root = REPO) {
  const look = JSON.parse(read(root, 'crates/deep-canvas-marks/looks/clean.json') ?? 'null');
  const find = (value) => (value && typeof value === 'object'
    ? (Number.isInteger(value.window_width) && Number.isInteger(value.window_height) ? [value.window_width, value.window_height] : Object.values(value).map(find).find(Boolean))
    : undefined);
  const opening = find(look);
  if (!opening) blocked("the clean look names no window_width and window_height, the size the app opens at");
  return [{ name: 'opening', size: opening }, { name: 'reference', size: null }];
}

let homes = null;
/**
 * One `deep-drive` process fed `calls` and read to its end: its reply to each call, after its `{"ready": true}`.
 * Every process of a run gets the same home folder, emptied first, so a page that draws from its home draws the same
 * for both sides and nothing one replica leaves there reaches the next.
 */
function drive(bin, calls) {
  homes ??= tempDir('home');
  const [out, home] = [join(tempDir('drive'), 'out'), join(homes, 'home')];
  rmSync(home, { recursive: true, force: true });
  mkdirSync(out);
  mkdirSync(home);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:DEEP_|XDG_)/.test(key)));
  const run = spawnSync(bin, ['--out', out], {
    cwd: REPO, input: `${calls.map((call) => JSON.stringify(call)).join('\n')}\n`, encoding: 'utf8', maxBuffer: 1 << 28, timeout: 600_000, killSignal: 'SIGKILL',
    env: { ...env, HOME: home, TZ: 'UTC', LC_ALL: 'C' },
  });
  const lines = (run.stdout ?? '').split('\n').filter(Boolean).map((line) => { try { return JSON.parse(line); } catch { return { unparsed: line }; } });
  if (run.error || lines[0]?.ready !== true) blocked(`${tilde(bin)} didn't say {"ready": true} (${run.error?.message ?? `exit ${run.status}`}): ${tilde(clip(`${run.stdout ?? ''}${run.stderr ?? ''}`, 800))}`);
  return lines.slice(1);
}

/** The shipped pages: the values `deep-drive`'s `launch.center` accepts, as its refusal of an unknown one lists them (#1458, #1592). */
export function shippedPages(bin) {
  const [reply] = drive(bin, [{ call: 'launch', launch: { from: 'fixture', fixture: RECORD, center: 'deepbuild/no-such-page' } }]);
  const listed = /one of (\[[^\]]*\])/.exec(String(reply?.error?.message ?? ''));
  if (reply?.ok || !listed) blocked(`deep-drive's refusal of an unknown center lists no pages: ${clip(JSON.stringify(reply ?? null), 400)}`);
  const pages = JSON.parse(listed[1]);
  if (!pages.length) blocked("deep-drive's refusal of an unknown center lists no pages");
  return pages;
}

export const keyOf = (page, window, theme) => `${page} ${window} ${theme}`;
/**
 * The first-launch page shows only on a machine whose setup hasn't finished (#1461's `launch.setup`): launched as
 * any other center the replica draws the page behind it, so its launch says `setup: "unfinished"`.
 */
const FIRST_LAUNCH = /(?:^|\/)welcome$/;

/**
 * The picture of each page in each window and theme, from the build `bin`: a map from `<page> <window> <theme>` to
 * `{path, sha256}` or `{error}`, each page in a replica of its own, as #1458 launches them.
 */
export function takePictures(bin, pages, sizes) {
  const taken = new Map();
  for (const page of pages) for (const window of sizes) for (const theme of THEMES) {
    const launch = { from: 'fixture', fixture: RECORD, center: page, theme, ...(FIRST_LAUNCH.test(page) ? { setup: 'unfinished' } : {}), ...(window.size ? { size: window.size } : {}) };
    const [launched, shot] = drive(bin, [{ call: 'launch', launch }, { call: 'screenshot', screenshot: { target: 'window' } }]);
    const key = keyOf(page, window.name, theme);
    if (launched?.ok !== true) taken.set(key, { error: `launch refused: ${clip(JSON.stringify(launched ?? null), 300)}` });
    else if (shot?.ok !== true || typeof shot.path !== 'string' || !existsSync(shot.path)) taken.set(key, { error: `no screenshot: ${clip(JSON.stringify(shot ?? null), 300)}` });
    else taken.set(key, { path: shot.path, sha256: createHash('sha256').update(readFileSync(shot.path)).digest('hex') });
  }
  return taken;
}

// ---------------------------------------------------------------------------------------------------
// A PNG's pixels: 8 bits a sample, not interlaced, as the replica writes its screenshots.

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
const CHANNELS = { 0: 1, 2: 3, 4: 2, 6: 4 };

/** `{width, height, channels, data}` of a PNG file, `data` its samples row by row; throws for a file it can't read so. */
export function readPng(path) {
  const bytes = readFileSync(path);
  if (!bytes.subarray(0, 8).equals(SIGNATURE)) throw Error(`${tilde(path)} is no PNG`);
  let header = null;
  const packed = [];
  for (let at = 8; at + 8 <= bytes.length;) {
    const length = bytes.readUInt32BE(at), type = bytes.toString('latin1', at + 4, at + 8), body = bytes.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') header = { width: body.readUInt32BE(0), height: body.readUInt32BE(4), depth: body[8], color: body[9], interlace: body[12] };
    if (type === 'IDAT') packed.push(body);
    at += 12 + length;
  }
  const channels = CHANNELS[header?.color];
  if (!header || header.depth !== 8 || !channels || header.interlace !== 0) throw Error(`${tilde(path)} isn't an 8-bit PNG without interlace: ${JSON.stringify(header)}`);
  const raw = inflateSync(Buffer.concat(packed));
  const stride = header.width * channels, data = Buffer.alloc(stride * header.height);
  for (let y = 0; y < header.height; y += 1) {
    const filter = raw[y * (stride + 1)], line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)), row = y * stride;
    for (let x = 0; x < stride; x += 1) {
      const a = x >= channels ? data[row + x - channels] : 0, b = y ? data[row - stride + x] : 0, c = y && x >= channels ? data[row - stride + x - channels] : 0;
      const p = a + b - c, [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
      const predicted = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][filter];
      if (predicted === undefined) throw Error(`${tilde(path)} has a row with the unknown filter ${filter}`);
      data[row + x] = (line[x] + predicted) & 255;
    }
  }
  return { width: header.width, height: header.height, channels, data };
}

/** Writes pixels as a PNG, for a planted picture. */
export function writePng(path, { width, height, channels, data }) {
  const chunk = (type, body) => {
    const head = Buffer.alloc(8), tail = Buffer.alloc(4);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'latin1');
    tail.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])), 0);
    return Buffer.concat([head, body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, Number(Object.keys(CHANNELS).find((color) => CHANNELS[color] === channels)), 0, 0, 0], 8);
  const stride = width * channels, raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y += 1) data.copy(raw, y * (stride + 1) + 1, y * stride, (y + 1) * stride);
  writeFileSync(path, Buffer.concat([SIGNATURE, chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]));
}

/** How two pictures differ, as a phrase naming how many pixels and the first; null when they are equal pixel for pixel. */
export function difference(a, b) {
  if (a.error || b.error) return a.error && b.error ? `neither side has it (${a.error}; ${b.error})` : `one side has no picture (${a.error ?? b.error})`;
  if (a.sha256 === b.sha256) return null;
  let one, two;
  try { [one, two] = [readPng(a.path), readPng(b.path)]; } catch (error) { return `a picture can't be read: ${error.message}`; }
  if (one.width !== two.width || one.height !== two.height || one.channels !== two.channels) return `${one.width} × ${one.height} with ${one.channels} channels against ${two.width} × ${two.height} with ${two.channels}`;
  let count = 0, first = -1;
  for (let pixel = 0; pixel < one.width * one.height; pixel += 1) {
    const at = pixel * one.channels;
    if (one.data.compare(two.data, at, at + one.channels, at, at + one.channels) !== 0) { count += 1; if (first < 0) first = pixel; }
  }
  return count ? `${count} of ${one.width * one.height} pixels differ, the first at ${first % one.width}, ${Math.floor(first / one.width)}` : null;
}

/** The list of differing pictures (README: The pictures): `{differing: [{page, window, theme, cause}]}`; none when the file isn't there. */
export function listed(root = REPO) {
  const text = read(root, LIST);
  if (text === null) return [];
  let list;
  try { list = JSON.parse(text).differing; } catch { list = null; }
  if (!Array.isArray(list)) throw Error(`${LIST} isn't {"differing": [{"page", "window", "theme", "cause"}]}`);
  return list;
}
/** A cause is a sentence: three words or more. */
const isCause = (cause) => typeof cause === 'string' && cause.trim().split(/\s+/).length >= 3;

/**
 * Criterion 3: every picture of the head equals the merge base's, or is on the list with its cause; and nothing on
 * the list is equal. `head` and `base` are `takePictures`' maps, `list` the list's entries. Each failure names its picture.
 */
export function judgePictures(head, base, list) {
  const failures = [], differing = [];
  const named = new Map(list.map((entry) => [keyOf(entry.page, entry.window, entry.theme), entry]));
  for (const key of new Set([...head.keys(), ...base.keys()])) {
    const how = difference(head.get(key) ?? { error: 'the head took none' }, base.get(key) ?? { error: 'the merge base took none' });
    if (how) differing.push({ key, how });
    if (how && !named.has(key)) failures.push(`the picture ${key} differs between the head and the merge base (${how}) and ${LIST} doesn't list it with its cause`);
    if (!how && named.has(key)) failures.push(`${LIST} lists ${key} as differing, and the head's picture equals the merge base's`);
  }
  for (const [key, entry] of named) {
    if (!head.has(key) && !base.has(key)) failures.push(`${LIST} lists ${key}, which is no picture of a shipped page in a window and theme this run took`);
    else if (!isCause(entry.cause)) failures.push(`${LIST} lists ${key} with no cause: ${JSON.stringify(entry.cause ?? null)}`);
  }
  return { failures, differing };
}

/** Whether a picture shows anything: it has pixels, and they aren't all one color. */
export function drawn(picture) {
  if (picture.error) return false;
  const { width, height, channels, data } = readPng(picture.path);
  if (!width || !height) return false;
  for (let at = channels; at < data.length; at += channels) if (data.compare(data, 0, channels, at, at + channels) !== 0) return true;
  return false;
}
