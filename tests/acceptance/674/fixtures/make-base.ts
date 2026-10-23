// Makes the base-commit goldens of criterion 3 (`fixtures/base/*.png`): each document of default.test.ts, with no
// `sampling` field, drawn by the binaries of the UNMODIFIED base commit on each path. Run it once, from a checkout of
// the base commit with `cargo build --bin deep-canvas-render --bin deep-show` done, never against a tree that holds #674's
// change (the goldens would then prove nothing):
//
//   node --experimental-strip-types tests/acceptance/674/fixtures/make-base.ts <checkout root> <output folder>
//
// Plain node, no vitest. Render-back's asset is written straight into the evidence store's `<2 hex>/<62 hex>` layout.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CHECKER_SIZE, LOOK, SPRITE_SIZE, checkerDoc, checkerPng, forShow, sha256, spriteDoc, spritePng, type JsonObject,
} from '../scene.ts';

const [rootArg, outArg] = process.argv.slice(2);
if (!rootArg || !outArg) throw Error('usage: make-base.ts <checkout root> <output folder>');
const root: string = rootArg;
const outDir: string = outArg;
mkdirSync(outDir, { recursive: true });
const scratch = mkdtempSync(join(tmpdir(), 'deep-674-make-'));

function line(bin: string, subcommand: string, input: JsonObject): JsonObject {
  const run = spawnSync(join(root, 'target', 'debug', bin), [subcommand], { cwd: root, input: `${JSON.stringify(input)}\n`, encoding: 'utf8', maxBuffer: 1 << 28 });
  if (run.status !== 0) throw Error(`${bin} ${subcommand} exited ${run.status}: ${run.stderr}`);
  const out = JSON.parse(run.stdout.trim()) as JsonObject;
  if (out['ok'] !== true) throw Error(`${bin} ${subcommand} refused: ${run.stdout}`);
  return out;
}

const store = join(scratch, 'store');
mkdirSync(store);
const pictures = { checker: checkerPng(), sprite: spritePng() };
const hashes = { checker: sha256(pictures.checker), sprite: sha256(pictures.sprite) };
writeFileSync(join(store, hashes.checker), pictures.checker);
writeFileSync(join(store, hashes.sprite), pictures.sprite);

const documents = (asset: (name: 'checker' | 'sprite') => string): Record<'checker' | 'sprite', JsonObject> => ({
  checker: checkerDoc(asset('checker')), sprite: spriteDoc(asset('sprite')),
});

for (const [name, doc] of Object.entries(documents((n) => hashes[n]))) {
  for (const zoom of [1, 2]) {
    line('deep-canvas-render', 'render', { out: join(outDir, `${name}-gpui${zoom}.png`), doc, look: LOOK, view: { zoom }, store });
    line('deep-canvas-render', 'raster', { out: join(outDir, `${name}-vello${zoom}.png`), doc, look: LOOK, view: { zoom }, store });
  }
}

// Render-back: deep_show at t = 0 with a snapshot at the document's own size, the asset in an evidence store.
const sizes = { checker: CHECKER_SIZE, sprite: SPRITE_SIZE };
for (const name of ['checker', 'sprite'] as const) {
  const evidence = join(scratch, `evidence-${name}`);
  const hash = hashes[name];
  mkdirSync(join(evidence, hash.slice(0, 2)), { recursive: true });
  writeFileSync(join(evidence, hash.slice(0, 2), hash.slice(2)), pictures[name]);
  const doc = documents(() => hash)[name];
  const answer = line('deep-show', 'run', {
    evidence,
    sessions: { 'sess-alpha': { thread: 'thread-alpha', name: 'Claude Code: sampling', process: { pid: 4100, start: 1000 } } },
    panels: { main: { rect: [0, 0, 800, 600] } },
    docs: { '01JB7D00000000000000000001': { panel: 'main' } },
    calls: [{ call: 'deep_show', session: 'sess-alpha', doc: '01JB7D00000000000000000001', document: forShow(doc, hash), t: '0s', size: sizes[name], include: ['issues', 'pixels'] }],
  });
  const reply = (answer['replies'] as JsonObject[])[0]!;
  if (reply['outcome'] !== 'presented') throw Error(`render-back did not present ${name}: ${JSON.stringify(reply)}`);
  const snapshot = (reply['snapshots'] as JsonObject[])[0]!;
  const sha = String(snapshot['sha256']);
  writeFileSync(join(outDir, `${name}-back.png`), readFileSync(join(evidence, sha.slice(0, 2), sha.slice(2))));
}
rmSync(scratch, { recursive: true, force: true });
console.log(`wrote the goldens to ${outDir}`);
