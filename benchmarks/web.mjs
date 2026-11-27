// The web player's budget (issue #172, #172.1e1f958d): node benchmarks/web.mjs, for the perf lane. One `deep-show run`
// (target/debug) exports a small 2D figure to the web and reads the bundle's player: the WebAssembly and JavaScript the
// player is made of, each compressed with Brotli at quality 11, as a static host serves them. It prints the player's
// compressed and raw bytes and the bundle's bytes as one JSON line. The criterion's own limits (the player under 12 MB
// compressed, the lab's first frame under 3 s in Chrome and 60 fps at 1080p) stay with
// tests/acceptance/172/budgets.test.ts on a reference Mac.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..');
const DOC = '01JB172B000000000000000001';
const document = {
  format: 1, id: DOC, profile: 'figure', title: 'Web export bench', description: 'A plate and a band, exported to the web.', size: [320, 180], camera: 'cam',
  items: Object.fromEntries([
    { id: 'cam', kind: 'camera@1', name: 'Camera', order: 'a0000', params: { projection: 'orthographic', target: [160, 90, 0], view_width: 320 } },
    { id: 'back', kind: 'rect@1', name: 'Back', role: 'decoration', order: 'a0001', params: { box: [0, 0, 320, 180], paint: { fill: { role: 'ground' } } } },
    { id: 'band', kind: 'rect@1', name: 'Band', role: 'part', order: 'a0002', params: { box: [0, 120, 320, 60], paint: { fill: { role: 'ink' } } } },
  ].map((i) => [i.id, i])),
  transport: { span: '2s', frame_rate: [30, 1] },
};
const brotli = (b) => brotliCompressSync(b, { params: { [constants.BROTLI_PARAM_QUALITY]: 11, [constants.BROTLI_PARAM_SIZE_HINT]: b.length } }).length;

const keptSizes = join(process.env.XDG_CACHE_HOME || join(homedir(), process.platform === 'darwin' ? 'Library/Caches' : '.cache'), 'deepbuild-perf', `brotli-11-${process.versions.brotli}`);
function keptBrotli(bytes) {
  const kept = join(keptSizes, createHash('sha256').update(bytes).digest('hex'));
  try {
    const size = Number(readFileSync(kept, 'utf8'));
    if (Number.isSafeInteger(size) && size > 0) return size;
  } catch {}
  const size = brotli(bytes);
  mkdirSync(keptSizes, { recursive: true });
  writeFileSync(`${kept}.${process.pid}`, String(size));
  renameSync(`${kept}.${process.pid}`, kept);
  return size;
}

const PLAYER_LIMIT_BYTES = 12_000_000;
const inBytes = (count) => `${Number(count).toLocaleString('en-US')} B`;
const fileOrNull = (path) => {
  try {
    return readFileSync(join(root, path));
  } catch {
    return null;
  }
};
const ceilings = JSON.parse(readFileSync(join(root, 'benchmarks/budgets.json'), 'utf8')).tasks.find(({ id }) => id === 'web-export').limits;
const sets = {}, untrueRecords = [];
for (const [set, { wasm, glue, compressed }] of Object.entries(JSON.parse(readFileSync(join(root, 'crates/deep-player/web/dist/sets.json'), 'utf8')).sets)) {
  const files = [fileOrNull(wasm.path), fileOrNull(glue.path)];
  const recorded = files.includes(null) ? null : compressed;
  const measured = recorded === null ? null : keptBrotli(files[0]) + keptBrotli(files[1]);
  if (measured !== recorded) untrueRecords.push(`the size record gives ${set} ${inBytes(recorded)}, and its two files measure ${inBytes(measured)} at Brotli 11`);
  const ceiling = ceilings[`report.${set}_brotli_bytes`] ?? null;
  if (ceiling !== null && recorded > ceiling) console.error(`web-export: ${set} is ${inBytes(recorded)} compressed, ${inBytes(recorded - ceiling)} over its ceiling of ${inBytes(ceiling)}`);
  Object.assign(sets, { [`${set}_brotli_bytes`]: recorded, [`${set}_ceiling_bytes`]: ceiling, [`${set}_share`]: recorded === null ? null : recorded / PLAYER_LIMIT_BYTES });
}
if (untrueRecords.length) throw Error(`web-export: ${untrueRecords.join('; ')}`);

function exportedPlayer() {
  const evidence = mkdtempSync(join(tmpdir(), 'deep-web-bench-'));
  try {
    const peer = { pid: 3002, start: 3_000 };
    const processes = [{ pid: 1, ppid: 0, start: 0 }, { pid: 3000, ppid: 1, start: 100 }, { pid: 3001, ppid: 3000, start: 110 }, { pid: 3002, ppid: 3001, start: 3_000 }];
    const out = join(evidence, 'web');
    const calls = [{ call: 'deep show', peer, doc: DOC, document }, { call: 'export', doc: DOC, out, video: { codec: 'web' } }];
    const sc = { evidence, sessions: {}, processes, panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [DOC]: { panel: 'main' } }, calls };
    const run = spawnSync(join(root, 'target', 'debug', 'deep-show'), ['run'], { input: `${JSON.stringify(sc)}\n`, encoding: 'utf8', maxBuffer: 1 << 30 });
    if (run.status !== 0) throw Error(`deep-show run exited ${run.status}: ${run.stderr}`);
    const reply = JSON.parse(run.stdout.trim()).replies?.[1];
    if (reply?.outcome !== 'exported') throw Error(`the bundle wasn't exported: ${JSON.stringify(reply).slice(0, 2000)}`);
    let compressed = 0;
    let raw = 0;
    for (const name of readdirSync(out)) {
      const b = readFileSync(join(out, name));
      if (!(name.endsWith('.wasm') || name.endsWith('.js'))) continue;
      compressed += brotli(b);
      raw += b.length;
    }
    return { player_brotli_bytes: compressed, player_bytes: raw, bundle_bytes: reply.receipt.bytes };
  } finally {
    rmSync(evidence, { recursive: true, force: true });
  }
}
const hasDebugBuild = existsSync(join(root, 'target', 'debug'));
console.log(JSON.stringify({ task: 'web-export', ...hasDebugBuild ? exportedPlayer() : { player_brotli_bytes: null, player_bytes: null, bundle_bytes: null }, ...sets }));
