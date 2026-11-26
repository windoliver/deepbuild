// The Proof line's readings for #3467 (README.md beside this file): the request lines the blind suite's tests send,
// sent to the change's binaries and to the merge base's, with what each answered, judged by the suite's own judges.
// Run from the checkout's root: node docs/evidence/3467/readings.mjs <change bin dir> <base bin dir> <out dir>
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { loadavg, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();
const [changeDir, baseDir, outDir] = process.argv.slice(2).map((p) => resolve(p));
const suite = join(root, 'tests/acceptance/3467');
const { LOOK, asset, documentOf, ffmpeg, putStore, videoItem } = await import(join(root, 'tests/acceptance/499/video/helpers.ts'));
const { REORDERED, IN_ORDER, REORDERED_4K, frameTime, keyBefore, recipeArgs, seededJumps } = await import(join(suite, 'fixtures.ts'));
const J = await import(join(suite, 'judges.ts'));

const ITEM = 'rec';
const VIEW = { zoom: 1, theme: 'light' };
const dir = mkdtempSync(join(tmpdir(), 'deep-3467-readings-'));
mkdirSync(outDir, { recursive: true });
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const bins = { change: changeDir, base: baseDir };
const out = { at: new Date().toISOString(), load: loadavg(), binaries: {}, readings: {} };
for (const [side, d] of Object.entries(bins)) out.binaries[side] = { 'deep-canvas-render': sha256(join(d, 'deep-canvas-render')), 'deep-show': sha256(join(d, 'deep-show')) };

function fixture(recipe) {
  const path = join(dir, `${recipe.name}.mp4`);
  ffmpeg(recipeArgs(recipe, path));
  const store = join(dir, `store-${recipe.name}`);
  return { path, store, sha: putStore(store, readFileSync(path)) };
}
const board = (name, sha, box, span) => documentOf(`3467-${name}`, 'board', [640, 360], [videoItem(ITEM, sha, [0, 0, box[0], box[1]])], { [ITEM]: asset(sha) }, {}, { span: `${span}s` });
const sessionLine = (doc, store, times, planted) => ({ look: LOOK, store, steps: times.map((t, i) => (i === 0 ? { doc, t, view: VIEW, frames: 1 } : { t, frames: 1 })), ...(planted ? { planted } : {}) });

/** One line to one call of a side's deep-canvas-render: its answer and how long the process took. */
function render(side, sub, line) {
  const start = performance.now();
  const run = spawnSync(join(bins[side], 'deep-canvas-render'), [sub], { cwd: root, input: `${JSON.stringify(line)}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: 1_800_000 });
  const ms = Math.round(performance.now() - start);
  const text = (run.stdout ?? '').split('\n').filter((l) => l !== '')[0];
  return { answer: text ? JSON.parse(text) : { ok: false, exit: run.status, stderr: (run.stderr ?? '').slice(-400) }, ms };
}
const rowsOf = (answer, call) => J.requestsOf(answer, ITEM, call);
const sumOf = (rows) => (typeof rows === 'string' ? rows : { requests: rows.length, sum: rows.reduce((t, r) => t + r.samples, 0), most: Math.max(...rows.map((r) => r.samples)) });

// ---- Criterion 1: the reordered recording played forward.
{
  const { store, sha } = fixture(REORDERED);
  const doc = board('forward', sha, [REORDERED.width, REORDERED.height], 12);
  const every = Array.from({ length: REORDERED.frames }, (_, k) => frameTime(k));
  const r = {};
  for (const side of ['change', 'base']) {
    const idle = render(side, 'idle', { doc, look: LOOK, view: VIEW, seconds: 10, store });
    const shown = J.shownOf(idle.answer, ITEM, 'idle');
    r[`${side} idle 10 s`] = { judge: J.judgePlay(idle.answer, ITEM, 'idle', REORDERED.frames, false), samples: sumOf(rowsOf(idle.answer, 'idle')), shown: typeof shown === 'string' ? shown : shown.length, ms: idle.ms };
    const stepped = render(side, 'session', sessionLine(doc, store, every));
    r[`${side} session, 250 steps`] = { judge: J.judgePlay(stepped.answer, ITEM, 'session', REORDERED.frames, true), samples: sumOf(rowsOf(stepped.answer, 'session')), ms: stepped.ms };
  }
  const planted = render('change', 'session', sessionLine(doc, store, every, 'keeps_base_start_rule'));
  r['change session, 250 steps, planted keeps_base_start_rule'] = { judge: J.judgePlay(planted.answer, ITEM, 'session', REORDERED.frames, true), samples: sumOf(rowsOf(planted.answer, 'session')), ms: planted.ms };
  out.readings['AC1 #3467.261c442a'] = r;

  // ---- Criterion 2: 200 seeded jumps on the same recording.
  const jumps = seededJumps(REORDERED, 200);
  const scenario = { evidence: join(dir, 'evidence'), calls: [{ call: 'media_decode', path: join(dir, 'reordered.mp4'), out: join(dir, 'canonical'), frames: Array.from({ length: REORDERED.frames }, (_, k) => k) }] };
  mkdirSync(scenario.evidence, { recursive: true });
  const canon = {};
  for (const side of ['change', 'base']) {
    const run = spawnSync(join(bins[side], 'deep-show'), ['run'], { cwd: root, input: `${JSON.stringify(scenario)}\n`, encoding: 'utf8', maxBuffer: 1 << 30, timeout: 900_000 });
    const answer = JSON.parse((run.stdout ?? '').split('\n').filter((l) => l !== '')[0]);
    canon[side] = answer.replies[0].decoded.streams.find((s) => s.type === 'video').frames.map((f) => f.planes);
  }
  const times = jumps.map((j) => j.t);
  const j2 = { 'canonical decode': { frames: canon.change.length, distinct: new Set(canon.change).size, 'the change gives the merge base\'s hashes': JSON.stringify(canon.change) === JSON.stringify(canon.base) } };
  const shipped = render('change', 'session', sessionLine(doc, store, times));
  const failures = J.judgeJumps(shipped.answer, ITEM, jumps, canon.base);
  const shown = new Map(J.shownOf(shipped.answer, ITEM, 'session').map((s) => [s.t, s]));
  const hashes = jumps.map((jump, i) => ({ jump: i + 1, t: jump.t, frame: jump.frame, shown: shown.get(jump.t)?.planes ?? null, canonical: canon.base[jump.frame], equal: shown.get(jump.t)?.planes === canon.base[jump.frame] }));
  writeFileSync(join(outDir, 'jumps-200-hashes.json'), `${JSON.stringify(hashes, null, 1)}\n`);
  j2['change session, 200 jumps'] = { failures: failures.length, equal: hashes.filter((h) => h.equal).length, back: jumps.filter((j, i) => i > 0 && j.frame < jumps[i - 1].frame).length, samples: sumOf(rowsOf(shipped.answer, 'session')), ms: shipped.ms };
  for (const plant of ['answers_picture_kept_for_another', 'keeps_base_start_rule']) {
    const run = render('change', 'session', sessionLine(doc, store, times, plant));
    const f = J.judgeJumps(run.answer, ITEM, jumps, canon.base);
    j2[`change session, 200 jumps, planted ${plant}`] = { failures: f.length, first: f[0] ?? null, samples: sumOf(rowsOf(run.answer, 'session')), ms: run.ms };
  }
  j2['base session, 200 jumps'] = { judge: J.judgeJumps(render('base', 'session', sessionLine(doc, store, times)).answer, ITEM, jumps, canon.base)[0] };
  out.readings['AC2 #3467.6bd8eb71'] = j2;
}

// ---- Criteria 3 and 4: the recording stored in order.
{
  const { store, sha } = fixture(IN_ORDER);
  const doc = board('in-order', sha, [IN_ORDER.width, IN_ORDER.height], 61);
  const jump = [frameTime(29), frameTime(1515)];
  const reach = 1515 - keyBefore(IN_ORDER, 1515) + 1;
  const r3 = {};
  for (const [name, side, plant] of [['change', 'change'], ['change, planted keeps_base_start_rule', 'change', 'keeps_base_start_rule'], ['base', 'base']]) {
    const run = render(side, 'session', sessionLine(doc, store, jump, plant));
    const rows = rowsOf(run.answer, 'session');
    r3[name] = { judge: J.judgeJumpForward(run.answer, ITEM, 30, 1515, reach, 16), requests: typeof rows === 'string' ? rows : rows.map((x) => `${x.frame}: ${x.samples}`), ms: run.ms };
  }
  out.readings['AC3 #3467.f53de7f6'] = r3;
  const back = keyBefore(IN_ORDER, 47);
  const times = [...Array.from({ length: 91 }, (_, k) => frameTime(k)), frameTime(47)];
  const r4 = {};
  for (const [name, side, plant] of [['change', 'change'], ['change, planted starts_every_request_at_key_frame', 'change', 'starts_every_request_at_key_frame'], ['change, planted keeps_base_start_rule', 'change', 'keeps_base_start_rule'], ['base', 'base']]) {
    const run = render(side, 'session', sessionLine(doc, store, times, plant));
    const rows = rowsOf(run.answer, 'session');
    r4[name] = { judge: J.judgeForwardAndBack(run.answer, ITEM, 0, 90, 47, back), forward: J.forwardSum(run.answer, ITEM), 'jump back to 47': typeof rows === 'string' ? rows : rows.at(-2)?.frame === 47 ? rows.at(-2).samples : rows.find((x, i) => i > 0 && x.frame < rows[i - 1].frame)?.samples, ms: run.ms };
  }
  out.readings['AC4 #3467.4c4b1527'] = r4;
}

// ---- Criterion 5: the 4K recording in a 640 × 360 player.
{
  const { store, sha } = fixture(REORDERED_4K);
  const doc = board('bytes', sha, [640, 360], 12);
  const times = Array.from({ length: REORDERED_4K.frames }, (_, k) => frameTime(k));
  const r5 = {};
  for (const [name, side, plant] of [['change', 'change'], ['change, planted keeps_every_picture', 'change', 'keeps_every_picture'], ['change, planted keeps_base_start_rule', 'change', 'keeps_base_start_rule'], ['base', 'base']]) {
    const run = render(side, 'session', sessionLine(doc, store, times, plant));
    r5[name] = { judge: J.judgeBytes(run.answer, ITEM, REORDERED_4K.frames, 8_000_000, 345_600), frame_bytes: J.frameBytesOf(run.answer, ITEM, 'session'), samples: sumOf(rowsOf(run.answer, 'session')), ms: run.ms };
  }
  out.readings['AC5 #3467.1a19a5d4'] = r5;
}

out.loadAfter = loadavg();
rmSync(dir, { recursive: true, force: true });
const text = JSON.stringify(out, null, 1).replaceAll(process.env.HOME, '~');
writeFileSync(join(outDir, 'readings.json'), `${text}\n`);
console.log(text);
