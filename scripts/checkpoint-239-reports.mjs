#!/usr/bin/env node
// #239's Proof: each check's report on each fixture film beside its planted twin's, the twins made as
// tests/acceptance/239/helpers.ts makes them (README: Planted twins). Writes docs/evidence/239/reports.json:
//   <film>.document.determinism   the verdict row on the film; the tick twin's row unplanted and under
//                                 checkpoint_nearest_in_distance
//   <film>.film.audit             the row on the film; on the twin whose first text is too long to read
//   <film>.film.layout            the row on the film; on the twin with layout-twin, a line the frame cuts
//   <film>.frame_budget           the run on this machine's own fingerprint; the twin read at 100 ms of GPU a frame
//                                 under the reference Mac's stub fingerprint
// Usage: node scripts/checkpoint-239-reports.mjs  (builds deep-show and deep-gpu; needs macOS)

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILMS = join(REPO, 'tests/fixtures/films');
const FLICKS = 705_600_000;
const DOC = '01JB239D000000000000000001';
const CLAIM = 'claim:01JB239C000000000000000001';
const REFERENCE = { model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30, power: 'ac', lowPowerMode: false, thermalState: 'nominal', macosBuild: '25B78' };
const sha = (b) => createHash('sha256').update(b).digest('hex');
const clone = (v) => JSON.parse(JSON.stringify(v));
const run = (cmd, args, opts = {}) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 30, ...opts });
  if (r.status !== 0) throw Error(`${cmd} ${args.join(' ')} failed: ${(r.stderr ?? '').slice(-2000)}`);
  return r.stdout;
};

const work = mkdtempSync(join(tmpdir(), 'deep-239-reports-'));
const bin = (name, features) => {
  run('cargo', ['build', '--locked', '--bin', name, ...features], { cwd: REPO, stdio: ['ignore', 'ignore', 'pipe'] });
  const to = join(work, `${name}${features.join('').replace(/\W/g, '-')}`);
  copyFileSync(join(process.env.CARGO_TARGET_DIR ?? join(REPO, 'target'), 'debug', name), to);
  return to;
};
const show = bin('deep-show', ['--no-default-features', '--features', 'full']);
const ticks = bin('deep-show', ['--no-default-features', '--features', 'full,test-tick']);
const gpu = bin('deep-gpu', []);
const meter = bin('deep-gpu', ['--features', 'test-meter']);

/** One verdict on `document` with `checks`, as the agent's claim (#403): the rows by requirement. */
function verdict(binary, name, document, checks, planted) {
  const evidence = join(work, `ev-${Math.random().toString(36).slice(2)}`);
  for (const file of readdirSync(join(FILMS, name, 'assets'))) {
    const bytes = readFileSync(join(FILMS, name, 'assets', file));
    mkdirSync(join(evidence, sha(bytes).slice(0, 2)), { recursive: true });
    writeFileSync(join(evidence, sha(bytes).slice(0, 2), sha(bytes).slice(2)), bytes);
  }
  const requirements = checks.map((check, i) => ({ id: `req:01JB239Q${String(i + 1).padStart(18, '0')}`, check }));
  const scenario = {
    evidence, ...(planted ? { planted } : {}),
    sessions: { 'sess-alpha': { thread: 'thread-alpha', name: 'Test agent: the spine gate', process: { pid: 4100, start: 1_000 } } },
    processes: [{ pid: 1, ppid: 0, start: 0 }, { pid: 3001, ppid: 1, start: 110 }, { pid: 4100, ppid: 3001, start: 1_000 }],
    panels: { main: { rect: [0, 0, 1280, 720] } }, docs: { [DOC]: { panel: 'main' } },
    claims: { [CLAIM]: { session: 'sess-alpha', deliverables: [DOC], requirements } },
    calls: [{ call: 'deep_show', session: 'sess-alpha', doc: DOC, document, include: ['issues'] }, { call: 'verdict', claim: CLAIM }],
  };
  const out = JSON.parse(run(binary, ['run'], { input: `${JSON.stringify(scenario)}\n` }));
  if (!out.ok || out.replies[0].outcome !== 'presented') throw Error(`${name}: ${JSON.stringify(out).slice(0, 1500)}`);
  return out.replies[1].requirements;
}
/** One frame-budget run (#1899's call) of the film's document. */
function budget(binary, document, extra, noop) {
  const look = JSON.parse(readFileSync(join(FILMS, document.id, 'assets', `${document.look.asset.replace(/@\d+$/, '')}.json`), 'utf8'));
  const doc = join(work, `${document.id}.json`);
  writeFileSync(doc, JSON.stringify(document));
  const call = { call: 'frame_budget', look, writer: 'agent:alpha', doc, render: { seconds: 10, pixels: document.size }, fps: 30, ...extra };
  const out = JSON.parse(run(binary, ['run', ...(noop ? ['--backend', 'noop'] : [])], { input: `${JSON.stringify({ out: work, calls: [call] })}\n` }));
  return out.replies[0];
}

const items = (d) => Object.entries(d.items);
const top = (d) => `${items(d).map(([, i]) => i.order ?? '').sort().at(-1)}z`;
const firstText = (d) => items(d).filter(([, i]) => i.kind === 'text@1' && i.params?.text?.trim()).sort(([a, x], [b, y]) => (x.order < y.order ? -1 : x.order > y.order ? 1 : a < b ? -1 : 1))[0];
/** The films' twins (tests/acceptance/239/helpers.ts: withTicks, longCopy, cutText). */
function withTicks(d) {
  const t = clone(d); const [W, H] = t.size; const base = top(t);
  const w = Math.max(8, Math.round(W / 48)); const h = Math.max(6, Math.round(H / 36));
  for (let k = 0; k < 256; k++) {
    const n = String(k).padStart(3, '0'); const gx = k % 16; const gy = Math.floor(k / 16);
    t.items[`twin-tick-${n}`] = { id: `twin-tick-${n}`, kind: 'test.tick@1', name: `Twin tick ${n}`, order: `${base}${n}`, params: { box: [Math.round(-W / 2 + (gx * W) / 8), Math.round(-H / 2 + (gy * H) / 8), w, h] } };
  }
  t.requires.modules['test.tick'] = '^1';
  return t;
}
function longCopy(d) {
  const t = clone(d); const [id] = firstText(t);
  t.items[id].params.text = Array.from({ length: Math.ceil(Math.ceil(15 * (10 + 2)) / 5) }, () => 'drawn').join(' ');
  return t;
}
function cutText(d) {
  const t = clone(d); const [W, H] = t.size; const size = Math.max(16, Math.round(H / 4)); const [, first] = firstText(t);
  t.items['layout-twin'] = {
    id: 'layout-twin', kind: 'text@1', name: 'Layout twin', order: top(t),
    params: { text: 'THE FRAME CUTS THIS LINE AT BOTH SIDES '.repeat(3).trim(), font: first.params.font, size, box: { w: 12 * W, h: 2 * size }, align: 'center', ...(first.params.paint ? { paint: first.params.paint } : {}) },
    at: { pos: [W / 2 - 6 * W, H / 2 - size, 0] },
  };
  return t;
}

const DETERMINISM = { kind: 'document.determinism', compare: 'same_machine' };
const TWIN_TIMES = { ...DETERMINISM, at_times: [0, 352_799_999, 352_800_000] };
const reports = {};
for (const name of ['strokes-and-paper', 'camera-and-transitions']) {
  const film = JSON.parse(readFileSync(join(FILMS, name, 'film.json'), 'utf8'));
  const [det, audit, layout] = verdict(show, name, film, [DETERMINISM, { kind: 'film.audit' }, { kind: 'film.layout' }]);
  reports[name] = {
    'document.determinism': { film: det, twin_unplanted: verdict(ticks, name, withTicks(film), [TWIN_TIMES])[0], twin: verdict(ticks, name, withTicks(film), [TWIN_TIMES], 'checkpoint_nearest_in_distance')[0] },
    'film.audit': { film: audit, twin: verdict(show, name, longCopy(film), [{ kind: 'film.audit' }])[0] },
    'film.layout': { film: layout, twin: verdict(show, name, cutText(film), [{ kind: 'film.layout' }])[0] },
    frame_budget: { film: budget(gpu, film, {}), twin: budget(meter, film, { stub_meter: { frames: [{ from: 0, gpu_ms: 100 }] }, stub_environment: REFERENCE }, true) },
  };
  console.log(name, Object.fromEntries(Object.entries(reports[name]).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).map(([s, r]) => [s, r.result ?? r.verdict]))])));
}
writeFileSync(join(REPO, 'docs/evidence/239/reports.json'), `${JSON.stringify(reports, null, 2)}\n`);
rmSync(work, { recursive: true, force: true });
