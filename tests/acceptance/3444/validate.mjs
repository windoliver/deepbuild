// Shared by the #3444 acceptance tests: reads what the spike keeps under docs/spikes/3444/ (its record, the run
// outputs the record cites, its report and the split-module patch) and recomputes from the outputs' own rows every sum,
// share and "more than" a criterion states, instead of taking the spike's word (AGENTS.md, invariant 1). Nothing here
// runs the spike, a binary of this repository or the GPU. Each check returns a list of problems; an empty list means it
// holds. A problem that starts with BLOCKED, INCONCLUSIVE or INVALID is that state; any other is a FAIL. Missing or
// unread input is a problem, never a pass (invariant 2). Formats: README.md, "The surface under test".
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const REPO = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const SPIKE = 'docs/spikes/3444';
const ISSUE = 3444;

// ------------------------------------------------------------------ the issue's and the design's values

/** Criterion 1: "within 10%". */
const WITHIN = 0.1;
/** Criterion 3: "five runs a side". */
const ROUNDS = 5;
/** Criterion 4: "the three states", and "one more than 32". */
const STATES = ['one_window', 'four_windows', 'export'];
const SETS = 32;
const OUTCOMES = ['created', 'refused', 'lost'];
/** Criterion 5: "more than a fifth", "more than 5%", "more than 16 live sets". */
const FIFTH = 1 / 5;
const SHARE = 0.05;
const LIVE = 16;
/** Scope: "the forest of 100,000 instances (#484)". */
const TREES = 100_000;
/** Design, "The reference Macs". */
const REFERENCE_MACS = ['Mac15,7', 'Mac15,12', 'Mac17,10'];

// ------------------------------------------------------------------ facts of the base and of the pinned crates

/** wgpu-types 30.0.1, src/instance.rs: `InstanceFlags::VALIDATION_INDIRECT_CALL = 1 << 5`. */
const VALIDATION_INDIRECT_CALL = 1 << 5;
/** The label the app's one device is opened with (crates/deep-gpu/src/device.rs, `Device::open`). */
const APP_DEVICE = 'deep-gpu';
/** The label of the scene module (crates/deep-scene3d-render/src/lib.rs, `Renderer::sampled`). */
const SCENE_MODULE = 'scene3d';
/** What `deep-gpu`'s `adapter` call answers as `backend` on a Mac's GPU (crates/deep-gpu-layer/src/timing.rs). */
const METAL = 'metal';
/** What `envelope_opens` calls a scene's first open in a fresh process (crates/deep-gpu-layer/src/envelope/opens.rs). */
const FRESH = 'fresh';
/** #1903's every-pass scene: `docs/evidence/1903/envelope.json`'s `scene`, copied at the base as #2189's suite did. */
const EVERY_PASS = fileURLToPath(new URL('./fixtures/every-pass.json', import.meta.url));

const SHADER_STAGES = ['vertex', 'fragment', 'compute'];
/** A stage row that is no shader stage: Metal's own compile of the pipeline as a whole, when the spike times it. */
const WHOLE = 'pipeline';
const TIMES = ['override', 'source', 'compile'];

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const count = (v) => Number.isInteger(v) && v >= 0;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const isCommit = (v) => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v);
const isHash = (v) => typeof v === 'string' && /^[0-9a-f]{16,}$/i.test(v);
const when = (v) => (nonEmpty(v) ? Date.parse(v) : NaN);
/** A path a record may name: relative, no `..`, no absolute folder. */
const relative = (p) => nonEmpty(p) && !p.startsWith('/') && !p.startsWith('~') && !p.split('/').includes('..') && !/^[A-Za-z]:/.test(p);
const round3 = (x) => Number(x.toFixed(3));
const ms = (ns) => ns / 1e6;
/** Nearest rank, as #2649's and #3222's suites read it: the smallest sample with at least p of the samples at or below it. */
const percentile = (samples, p) => { const sorted = [...samples].sort((a, b) => a - b); return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]; };

// ------------------------------------------------------------------ a failure's state

const PRECEDENCE = ['FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE'];
const NAMED = /^(BLOCKED|INCONCLUSIVE|INVALID)\b:?\s*/;
/** The state a problem names: the one it starts with, else FAIL (as scripts/lanes.mjs reads a failure's message). */
export const stateOf = (problem) => NAMED.exec(problem)?.[1] ?? 'FAIL';

/**
 * Fails the test when `problems` holds any, in the worst state among them by the design's precedence (FAIL, INVALID,
 * BLOCKED, INCONCLUSIVE). The message starts with that state unless it is FAIL, then the criterion's tag and the first
 * problem in that state, then every problem.
 */
export function holds(tag, problems) {
  if (!problems.length) return;
  const worst = PRECEDENCE.find((state) => problems.some((p) => stateOf(p) === state));
  const first = problems.find((p) => stateOf(p) === worst).replace(NAMED, '');
  const head = `${worst === 'FAIL' ? '' : `${worst}: `}${tag}: ${first}`;
  assert.fail(problems.length > 1 ? `${head}\nall ${problems.length} problems:\n${problems.join('\n')}` : head);
}

// ------------------------------------------------------------------ reading what is kept

/** The record, or the problems that kept it from being read. `dir` is the checkout holding docs/spikes/3444/. */
export function loadRecord(dir = REPO) {
  const path = join(dir, SPIKE, 'record.json');
  if (!existsSync(path)) return { problems: [`BLOCKED: no spike record at ${SPIKE}/record.json: the spike hasn't been recorded`] };
  try {
    const record = JSON.parse(readFileSync(path, 'utf8'));
    return isObj(record) ? { record, problems: [] } : { problems: [`${SPIKE}/record.json is not a JSON object`] };
  } catch (error) {
    return { problems: [`${SPIKE}/record.json is not JSON: ${error.message}`] };
  }
}

/** A file of the spike folder, by a path relative to it, or null. */
function spikeBytes(dir, file) {
  if (!relative(file)) return null;
  const path = join(dir, SPIKE, file);
  return existsSync(path) && statSync(path).isFile() ? readFileSync(path) : null;
}

/** The spike's report, docs/spikes/3444/README.md, or null. */
const report = (dir) => spikeBytes(dir, 'README.md')?.toString('utf8') ?? null;
const NO_REPORT = `BLOCKED: no report at ${SPIKE}/README.md`;

/** Git in this checkout, with nothing from the caller's environment pointing it elsewhere. */
function git(args, extra = {}) {
  const env = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), ...extra };
  return spawnSync('git', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 2 ** 28 });
}

/** `main`: the full hash of the main commit the readings ran on, a commit of this checkout's history. */
function mainProblems(record) {
  if (!isCommit(record?.main)) return ['main is not the full hash of the main commit the readings ran on'];
  if (git(['cat-file', '-e', `${record.main}^{commit}`]).status !== 0) return [`BLOCKED: main ${record.main} is not a commit this checkout's git has`];
  if (git(['merge-base', '--is-ancestor', record.main, 'HEAD']).status !== 0) return [`main ${record.main} is not an ancestor of HEAD`];
  return [];
}

/**
 * One kept run output, named by the record as `{ command, out, sha256 }`: the command that took the run, its output's
 * path relative to the spike folder, pinned by its sha256. Returns the parsed output, or the problems.
 */
function readRef(dir, ref, at) {
  if (!isObj(ref)) return { problems: [`BLOCKED: ${at}: the record cites no run`] };
  const problems = [];
  if (!nonEmpty(ref.command)) problems.push(`${at}: command (the command that took the run) is missing`);
  if (!relative(ref.out)) return { problems: [...problems, `${at}: out ${JSON.stringify(ref.out)} is not a path inside ${SPIKE}/`] };
  const bytes = spikeBytes(dir, ref.out);
  if (bytes === null) return { problems: [...problems, `BLOCKED: ${at}: the run output ${ref.out} is not kept with the spike`] };
  if (ref.sha256 !== sha256(bytes)) problems.push(`BLOCKED: ${at}: the sha256 of ${ref.out} is not what the record says, so the output kept is not the one it cites`);
  let out;
  try { out = JSON.parse(bytes.toString('utf8')); } catch (error) { return { problems: [...problems, `${at}: ${ref.out} is not JSON: ${error.message}`] }; }
  if (!isObj(out)) return { problems: [...problems, `${at}: ${ref.out} is not a JSON object`] };
  return { out, problems };
}

/**
 * What every run output says of its run: the commit its build was made from (the record's `main`), the adapter it drew
 * on (a Mac's GPU, or the readings are BLOCKED) and the machine (a Mac of a reference model, with its macOS build).
 */
function runProblems(record, out, at) {
  const problems = [];
  if (!isCommit(out.commit)) problems.push(`${at}: commit (the full hash of the commit the build that ran was made from) is missing`);
  else if (isCommit(record?.main) && out.commit !== record.main) problems.push(`${at}: ran a build of ${out.commit}, not of the record's main ${record.main}`);
  const backend = out.adapter?.backend;
  if (backend !== METAL) problems.push(`BLOCKED: ${at}: ${backend === undefined ? 'names no adapter.backend' : `ran with adapter.backend ${JSON.stringify(backend)}`}, not on a Mac's GPU (${JSON.stringify(METAL)}): without a GPU the readings are BLOCKED`);
  const m = out.machine;
  if (!isObj(m) || !nonEmpty(m.model) || !nonEmpty(m.macosBuild)) problems.push(`${at}: machine must name its model and its macosBuild`);
  else if (!REFERENCE_MACS.includes(m.model)) problems.push(`INCONCLUSIVE: ${at}: machine.model ${JSON.stringify(m.model)} is not a reference Mac (${REFERENCE_MACS.join(', ')}), so its readings are not from a Mac of a reference model`);
  return problems;
}

const machineOf = (out) => JSON.stringify([out?.machine?.model ?? null, out?.machine?.chip ?? null, out?.machine?.memoryBytes ?? null, out?.machine?.macosBuild ?? null]);
/** "Every reading is from one machine": the runs' machines (model, chip, memoryBytes, macosBuild) are one. */
function oneMachineProblems(runs) {
  const [first, ...rest] = runs.filter(({ out }) => isObj(out?.machine));
  return rest.filter(({ out }) => machineOf(out) !== machineOf(first.out)).map(({ at, out }) => `${at}: ran on ${machineOf(out)}, and ${first.at} on ${machineOf(first.out)}: the readings are not from one Mac`);
}

/** A run's span: `started` and `ended`, ISO 8601, in order. */
function spanProblems(out, at) {
  const [from, to] = [when(out.started), when(out.ended)];
  return Number.isNaN(from) || Number.isNaN(to) || from > to ? [`${at}: started and ended (ISO 8601, in order) are required`] : [];
}

// ------------------------------------------------------------------ a report's tables

const cellsOf = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
/** A cell without the backticks around it. */
const plain = (cell = '') => cell.trim().replace(/^`+|`+$/g, '').trim();
/** A header cell as the tests match it: no backticks, lower case, single spaces. */
const key = (cell) => plain(cell).toLowerCase().replace(/\s+/g, ' ');

/** The markdown tables of a text: each its header's cells and its rows' cells, as written. */
export function tables(text) {
  const found = [];
  let rows = null;
  for (const line of [...text.split('\n'), '']) {
    if (line.trim().startsWith('|')) { (rows ??= []).push(cellsOf(line)); continue; }
    if (rows && rows.length >= 2 && rows[1].every((cell) => /^:?-+:?$/.test(cell))) found.push({ header: rows[0], rows: rows.slice(2) });
    rows = null;
  }
  return found;
}

/**
 * A number as a report's cell shows it: digits, `,` between thousands, a decimal point, `ms` after it or not. Its value
 * and how many decimals it shows; null for anything else.
 */
export function shown(cell) {
  const text = plain(cell).replace(/\u2212/g, '-').replace(/\s*ms$/, '');
  const m = /^(-?)(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?$/.exec(text);
  return m ? { value: Number(`${m[1]}${m[2].replaceAll(',', '')}${m[3] ? `.${m[3]}` : ''}`), decimals: m[3]?.length ?? 0 } : null;
}
/** A shown number agrees with a recomputed one when it is that number rounded to the decimals it shows. */
const agrees = (cell, want) => Math.abs(cell.value - want) <= 0.5 * 10 ** -cell.decimals + 1e-9;
const blank = (cell = '') => ['', '-', '\u2013', '\u2014', 'n/a'].includes(plain(cell).toLowerCase());

const PIPELINE_HEADER = ['Pipeline', ...TIMES.map((t) => `main ${t} ms`), ...TIMES.map((t) => `split ${t} ms`)];
/** The report's pipeline table: the first table whose header holds `Pipeline` and `main override ms`. */
const pipelineTable = (readme) => tables(readme).find(({ header }) => ['pipeline', 'main override ms'].every((cell) => header.map(key).includes(cell))) ?? null;

/**
 * Where a side's three times are in the pipeline table, and how the report heads the side: `main override ms`,
 * `main source ms`, `main compile ms`; for the split-module branch `split ...` (the result) or `split (reading) ...`.
 */
function columnsOf(table, side) {
  const header = table.header.map(key);
  const at = (prefix) => { const places = TIMES.map((t) => header.indexOf(`${prefix} ${t} ms`)); return places.every((i) => i >= 0) ? places : null; };
  if (side === 'main') return { at: at('main'), standing: 'result' };
  const [result, reading] = [at('split'), at('split (reading)')];
  if (result && reading) return { at: null, twice: true };
  return result ? { at: result, standing: 'result' } : { at: reading, standing: reading ? 'reading' : null };
}

// ------------------------------------------------------------------ a cold run of the every-pass scene

/** The every-pass scene the record names by its path in the checkout and its sha256: #1903's scene, document for document. */
function sceneProblems(record, dir) {
  const scene = record?.pipelines?.scene;
  if (!isObj(scene) || !relative(scene.path)) return ['pipelines.scene.path (the every-pass scene the runs played, relative to the checkout) is missing'];
  const path = join(dir, scene.path);
  if (!existsSync(path) || !statSync(path).isFile()) return [`BLOCKED: pipelines.scene: ${scene.path} is not in this checkout`];
  const bytes = readFileSync(path);
  const problems = scene.sha256 === sha256(bytes) ? [] : [`BLOCKED: pipelines.scene: the sha256 of ${scene.path} is not what the record says`];
  let doc;
  try { doc = JSON.parse(bytes.toString('utf8')); } catch { return [...problems, `pipelines.scene: ${scene.path} is not JSON`]; }
  if (!isDeepStrictEqual(doc, JSON.parse(readFileSync(EVERY_PASS, 'utf8')))) problems.push(`pipelines.scene: ${scene.path} is not #1903's every-pass scene (docs/evidence/1903/envelope.json's scene, copied in tests/acceptance/3444/fixtures/every-pass.json)`);
  return problems;
}

/** A cold run's own shape, and its pipelines as rows: each pipeline's three times and the time around its call, in ms. */
function coldRows(out, at) {
  const problems = [];
  if (out.open !== FRESH) problems.push(`${at}: open is ${JSON.stringify(out.open)}, not ${JSON.stringify(FRESH)}: the run is not the scene's first open in a fresh process, a cold start`);
  if (!finite(out.first_settled_ms) || out.first_settled_ms <= 0) problems.push(`${at}: first_settled_ms (the ms from opening the scene in a fresh process to its first settled frame) is missing`);
  const pipelines = list(out.pipelines);
  if (!pipelines.length) problems.push(`${at}: pipelines holds no pipeline: a cold start makes its pipelines, and a run that made none was not one`);
  if (!Number.isInteger(out.pipelines_made) || out.pipelines_made !== pipelines.length) problems.push(`${at}: pipelines_made (the device's own count of the pipelines it made) is ${JSON.stringify(out.pipelines_made)}, and pipelines holds ${pipelines.length}`);
  const names = new Set();
  const rows = pipelines.map((p, i) => {
    const here = `${at}, pipeline ${i} (${p?.name})`;
    if (!nonEmpty(p?.name)) problems.push(`${here}: name is missing`);
    else if (names.has(p.name)) problems.push(`${here}: named twice; a name is one pipeline's`);
    names.add(p?.name);
    if (!finite(p?.around_ns) || p.around_ns <= 0) problems.push(`${here}: around_ns (the ns around the call that made it) is missing`);
    const stages = list(p?.stages);
    if (!stages.length) problems.push(`${here}: stages holds no stage`);
    stages.forEach((s, j) => {
      const stage = `${here}, stage ${j} (${s?.stage})`;
      if (![...SHADER_STAGES, WHOLE].includes(s?.stage)) problems.push(`${stage}: stage is not one of ${[...SHADER_STAGES, WHOLE].join(', ')}`);
      for (const t of TIMES) if (!finite(s?.[`${t}_ns`]) || s[`${t}_ns`] < 0) problems.push(`${stage}: ${t}_ns is not a number of ns`);
    });
    const sum = (t) => stages.reduce((total, s) => total + (finite(s?.[`${t}_ns`]) ? s[`${t}_ns`] : 0), 0);
    const inside = TIMES.reduce((total, t) => total + sum(t), 0);
    if (finite(p?.around_ns) && inside > p.around_ns) problems.push(`${here}: its stages' times sum to ${inside} ns, more than the ${p.around_ns} ns around the call they are inside, so around_ns was not read around the call`);
    return { name: p?.name, stages, override_ms: ms(sum('override')), source_ms: ms(sum('source')), compile_ms: ms(sum('compile')), around_ms: ms(p?.around_ns) };
  });
  return { rows, problems };
}

/**
 * What criterion 2 reads of a cold run beside its times: each shader stage's entry point, with the module it is made
 * from (main's run) or the entry points its module holds (the split run), and the frames the run hashed.
 */
function drawnProblems(cold, side) {
  const problems = [];
  const at = `${cold.at} (${cold.ref.out})`;
  for (const p of cold.rows) {
    p.stages.filter((s) => SHADER_STAGES.includes(s.stage)).forEach((s) => {
      const stage = `${at}, ${p.name}'s ${s.stage} stage`;
      if (!nonEmpty(s.entry_point)) problems.push(`${stage}: entry_point is missing`);
      if (side === 'main' && !nonEmpty(s.module)) problems.push(`${stage}: module (the label of the shader module the stage is made from) is missing`);
      if (side === 'split' && (!list(s.module_entry_points).length || !s.module_entry_points.every(nonEmpty) || !s.module_entry_points.includes(s.entry_point))) problems.push(`${stage}: module_entry_points (the names of the entry points its module holds, its own among them) is missing`);
    });
  }
  const frames = list(cold.out.frames);
  if (!frames.length) problems.push(`${at}: frames holds no frame with its pixel hash`);
  const seen = new Set();
  for (const f of frames) {
    if (!count(f?.frame) || seen.has(f.frame)) problems.push(`${at}: frame ${JSON.stringify(f?.frame)} is not a frame number, or is there twice`);
    seen.add(f?.frame);
    if (!isHash(f?.pixel_hash)) problems.push(`${at}, frame ${f?.frame}: pixel_hash is not a hex hash`);
  }
  return problems;
}

/**
 * A side's cold run of the every-pass scene (`pipelines.main` or `pipelines.split`), read from its kept output. `rows`
 * is there only when the output has the shape its times need.
 */
function readCold(record, dir, side) {
  const at = `pipelines.${side}`;
  const ref = record?.pipelines?.[side];
  const { out, problems } = readRef(dir, ref, at);
  if (!out) return { at, problems, runs: [] };
  const shape = [...runProblems(record, out, at)];
  if (side === 'main' && out.patch !== undefined && out.patch !== null) shape.push(`${at}: its build carries a patch (${JSON.stringify(out.patch)}); main's column is of main as it is`);
  const { rows, problems: own } = coldRows(out, `${at} (${ref.out})`);
  shape.push(...own);
  return { at, ref, out, rows: own.length ? undefined : rows, problems: [...problems, ...shape], runs: [{ at, out }] };
}

/**
 * One side's column of the report's pipeline table, against that side's kept run: every pipeline the run made has one
 * row with the side's three times, each the run's own to the decimals shown; no row gives the side times for a pipeline
 * the run didn't make; and the times the table shows sum to within 10% of the time the same run spent inside pipeline
 * creation, read around the calls. A pipeline left out is named.
 */
function columnProblems(dir, side, cold) {
  const readme = report(dir);
  if (readme === null) return [NO_REPORT];
  const table = pipelineTable(readme);
  if (!table) return [`the report has no pipeline table: a table whose header holds ${PIPELINE_HEADER.map((cell) => `\`${cell}\``).join(', ')}`];
  const columns = columnsOf(table, side);
  if (columns.twice) return ['the pipeline table heads the split-module column both as the result and as a reading'];
  if (!columns.at) return [`the pipeline table has no ${side} column (${TIMES.map((t) => `\`${side} ${t} ms\``).join(', ')}${side === 'split' ? ', or `split (reading) ...` for a reading' : ''})`];
  const nameAt = table.header.map(key).indexOf('pipeline');
  const listed = new Map();
  for (const row of table.rows) {
    const cell = row[nameAt] ?? '';
    // A row whose first cell is bold is a summary (a total), not a pipeline.
    if (/^\*\*.*\*\*$/.test(cell)) continue;
    listed.set(plain(cell), [...(listed.get(plain(cell)) ?? []), row]);
  }
  const problems = [];
  const where = `${cold.at} (${cold.ref.out})`;
  let total = 0;
  for (const p of cold.rows) {
    const rows = listed.get(p.name) ?? [];
    if (!rows.length) { problems.push(`the pipeline table leaves out ${p.name}, a pipeline ${where} shows the run making`); continue; }
    if (rows.length > 1) problems.push(`the pipeline table lists ${p.name} ${rows.length} times`);
    TIMES.forEach((t, j) => {
      const cell = rows[0][columns.at[j]] ?? '';
      const says = shown(cell);
      const want = p[`${t}_ms`];
      if (!says) return problems.push(`the pipeline table's ${side} ${t} ms for ${p.name} is ${JSON.stringify(cell)}, no number; ${where} gives ${round3(want)}`);
      total += says.value;
      if (!agrees(says, want)) problems.push(`the pipeline table's ${side} ${t} ms for ${p.name} is ${cell}; ${where} gives ${round3(want)}`);
    });
  }
  const made = new Set(cold.rows.map((p) => p.name));
  for (const [name, rows] of listed) {
    if (!made.has(name) && rows.some((row) => columns.at.some((i) => !blank(row[i])))) problems.push(`the pipeline table gives ${side} times for ${name}, a pipeline ${where} doesn't show the run making`);
  }
  const around = cold.rows.reduce((sum, p) => sum + p.around_ms, 0);
  if (!(Math.abs(total - around) <= WITHIN * around)) problems.push(`the pipeline table's ${side} times sum to ${round3(total)} ms, not within 10% of the ${round3(around)} ms ${where} spent inside pipeline creation, read around the calls`);
  return problems;
}

// ------------------------------------------------------------------ criterion 1: the pipeline table

/**
 * The report's pipeline table lists every pipeline the every-pass scene makes on a cold start of main, and its times
 * sum to within 10% of the time the same run spends inside pipeline creation, read around the calls.
 */
export function pipelineTableProblems(record, dir = REPO) {
  const problems = [...mainProblems(record), ...sceneProblems(record, dir)];
  const cold = readCold(record, dir, 'main');
  problems.push(...cold.problems);
  if (cold.rows) problems.push(...columnProblems(dir, 'main', cold));
  return problems;
}

// ------------------------------------------------------------------ criterion 2: the split-module branch

/** Why a patch doesn't apply to a commit's tree, or null when it does: `git apply --check` on an index of its own. */
function patchRefusal(commit, patch) {
  const scratch = mkdtempSync(join(tmpdir(), 'deep-3444-index-'));
  try {
    const own = { GIT_INDEX_FILE: join(scratch, 'index') };
    const read = git(['read-tree', commit], own);
    if (read.status !== 0) return `git read-tree ${commit}: ${read.stderr.trim().split('\n')[0]}`;
    const check = git(['apply', '--cached', '--check', patch], own);
    return check.status === 0 ? null : check.stderr.trim().split('\n')[0] || `git apply --check exited ${check.status}`;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

/** The branch that isn't merged, as a test can hold it: main and a patch kept beside the report, which the split run's build carried. */
function patchProblems(record, dir, cold) {
  const at = 'pipelines.split.patch';
  const patch = record?.pipelines?.split?.patch;
  if (!isObj(patch) || !relative(patch.path)) return [`${at}.path (the split-module branch as a patch on main, kept in ${SPIKE}/) is missing`];
  const bytes = spikeBytes(dir, patch.path);
  if (bytes === null) return [`BLOCKED: ${at}: ${patch.path} is not kept with the spike`];
  const problems = patch.sha256 === sha256(bytes) ? [] : [`BLOCKED: ${at}: the sha256 of ${patch.path} is not what the record says`];
  if (cold.out && cold.out.patch !== sha256(bytes)) problems.push(`${cold.at}: its build carried the patch ${JSON.stringify(cold.out.patch)}, not ${patch.path} (${sha256(bytes)}), so the kept patch is not the branch that drew its frames`);
  if (isCommit(record?.main) && git(['cat-file', '-e', `${record.main}^{commit}`]).status === 0) {
    const refusal = patchRefusal(record.main, join(dir, SPIKE, patch.path));
    if (refusal !== null) problems.push(`${at}: ${patch.path} doesn't apply to main ${record.main.slice(0, 9)}: ${refusal}`);
  }
  return problems;
}

/**
 * "The scene module split so that no pipeline's module holds an entry point it doesn't use": every stage main's run
 * made from the scene module is, in the split run's pipeline of the same name, made from a module that holds only
 * entry points that pipeline uses.
 */
function splitModuleProblems(main, split) {
  const problems = [];
  const fromScene = main.rows.flatMap((p) => p.stages.filter((s) => s.module === SCENE_MODULE).map((s) => ({ name: p.name, stage: s.stage })));
  if (!fromScene.length) return [`INVALID: ${main.at}: no stage of any pipeline is made from the scene module (module ${JSON.stringify(SCENE_MODULE)}), so nothing shows what the split changed`];
  for (const { name, stage } of fromScene) {
    const p = split.rows.find((row) => row.name === name);
    const s = p?.stages.find((row) => row.stage === stage);
    if (!s) { problems.push(`${split.at}: no ${stage} stage of a pipeline named ${name}, which main's run made from the scene module`); continue; }
    const used = new Set(p.stages.map((row) => row.entry_point));
    const unused = s.module_entry_points.filter((entry) => !used.has(entry));
    if (unused.length) problems.push(`${split.at}: the scene module isn't split: ${name}'s ${stage} module still holds ${unused.length} entry point${unused.length > 1 ? 's' : ''} ${name} doesn't use (${unused.slice(0, 4).join(', ')}${unused.length > 4 ? ', ...' : ''})`);
  }
  return problems;
}

/**
 * The split-module branch draws the every-pass scene to the same pixel hashes as main, and the report gives both
 * columns. The branch is main and the kept patch; its column is held as main's is; its pixel hashes are in the report.
 * A frame that differs makes the column a reading: INCONCLUSIVE when the report heads it `split (reading)`, and a
 * failure, naming the frame, when the report heads it as the result.
 */
export function splitModuleBranchProblems(record, dir = REPO) {
  const problems = [...mainProblems(record), ...sceneProblems(record, dir)];
  const main = readCold(record, dir, 'main');
  const split = readCold(record, dir, 'split');
  problems.push(...main.problems, ...split.problems, ...oneMachineProblems([...main.runs, ...split.runs]));
  if (isObj(record?.pipelines?.split)) problems.push(...patchProblems(record, dir, split));
  if (!main.rows || !split.rows) return problems;
  const drawn = [...drawnProblems(main, 'main'), ...drawnProblems(split, 'split')];
  if (drawn.length) return [...problems, ...drawn];
  problems.push(...splitModuleProblems(main, split));
  const readme = report(dir);
  if (readme === null) return [...problems, NO_REPORT];
  problems.push(...columnProblems(dir, 'split', split));
  const table = pipelineTable(readme);
  const standing = table ? columnsOf(table, 'split').standing : null;
  if (table && !columnsOf(table, 'main').at) problems.push('the pipeline table has no main column beside the split-module one: the report gives both columns');
  const [onMain, onSplit] = [main, split].map((cold) => new Map(cold.out.frames.map((f) => [f.frame, f.pixel_hash.toLowerCase()])));
  const frames = (hashes) => [...hashes.keys()].sort((a, b) => a - b).join(', ');
  if (frames(onMain) !== frames(onSplit)) problems.push(`${split.at} hashed frames ${frames(onSplit)}, and ${main.at} frames ${frames(onMain)}: the same frames are compared`);
  for (const [frame, hash] of onSplit) {
    if (!readme.toLowerCase().includes(hash)) problems.push(`the report doesn't give the split-module branch's pixel hash of frame ${frame} (${hash})`);
    if (!onMain.has(frame) || onMain.get(frame) === hash) continue;
    const differs = `frame ${frame} of the split-module branch has the pixel hash ${hash}, and main's has ${onMain.get(frame)}`;
    problems.push(standing === 'reading'
      ? `INCONCLUSIVE: ${differs}: the split-module column is a reading, as the report heads it, and the criterion needs the same pixel hashes`
      : `${differs}: a branch whose frame differs is a reading, never the result, and the report doesn't head its column \`split (reading)\``);
  }
  return problems;
}

// ------------------------------------------------------------------ criterion 3: the indirect readings

/**
 * The ten runs of the forest, five rounds of one with the flag on and one with it off, read from their kept outputs.
 * `rounds` is there only when the record has five rounds and all ten outputs have their whole shape (what a run says of
 * its commit, GPU and machine is a problem of its own and withholds nothing).
 */
function readIndirect(record, dir) {
  const problems = [], runs = [];
  const rounds = list(record?.indirect?.rounds);
  if (rounds.length !== ROUNDS) problems.push(`${rounds.length ? '' : 'BLOCKED: '}indirect.rounds holds ${rounds.length} rounds, not five runs a side`);
  let whole = rounds.length === ROUNDS;
  const outs = new Map();
  rounds.forEach((round, i) => {
    for (const side of ['on', 'off']) {
      const at = `indirect.rounds[${i}].${side}`;
      const ref = round?.[side];
      const { out, problems: read } = readRef(dir, ref, at);
      problems.push(...read);
      if (!out) { whole = false; continue; }
      if (outs.has(ref.out)) problems.push(`${at}: ${ref.out} is also ${outs.get(ref.out)}'s output; each run has its own`);
      outs.set(ref.out, at);
      problems.push(...runProblems(record, out, at));
      const shape = spanProblems(out, at);
      if (!count(out.instance_flags)) shape.push(`${at}: instance_flags (the bits of the instance's flags, read back from the instance the run drew with) is missing`);
      if (out.forest?.instances !== TREES) shape.push(`${at}: forest.instances is ${JSON.stringify(out.forest?.instances)}, not the forest's 100,000`);
      if (!Number.isInteger(out.forest?.indirect_draws) || out.forest.indirect_draws < 1) shape.push(`${at}: forest.indirect_draws (the indexed indirect draws of a frame's geometry pass) is not 1 or more, so the run read no indirect draw`);
      for (const clock of ['encode_ms', 'gpu_ms']) if (!finite(out.geometry?.[clock]) || out.geometry[clock] <= 0) shape.push(`${at}: geometry.${clock} (the geometry pass's ${clock === 'gpu_ms' ? 'GPU' : 'encode'} time) wasn't read`);
      problems.push(...shape);
      if (shape.length) whole = false;
      runs.push({ at, round: i + 1, side, ref, out });
    }
  });
  const sides = whole ? rounds.map((_, i) => Object.fromEntries(runs.filter((run) => run.round === i + 1).map((run) => [run.side, run.out]))) : undefined;
  return { rounds: sides, runs, problems };
}

/**
 * The indirect readings are from five runs a side in alternated rounds on one Mac, with the flag's state read back
 * from the instance in each run. A side whose flag was not what its column says is named by its round, side and output.
 */
export function indirectProblems(record, dir = REPO) {
  const problems = [...mainProblems(record)];
  const { runs, problems: read } = readIndirect(record, dir);
  problems.push(...read, ...oneMachineProblems(runs));
  for (const { round, side, ref, out } of runs) {
    if (!count(out.instance_flags)) continue;
    const on = (out.instance_flags & VALIDATION_INDIRECT_CALL) !== 0;
    if (on !== (side === 'on')) problems.push(`round ${round}'s ${side} run (${ref.out}) read its instance's flags as ${out.instance_flags}: VALIDATION_INDIRECT_CALL was ${on ? 'on' : 'off'}, not what its column says`);
  }
  // Alternated rounds, by the runs' own times: one run at a time, round after round, the side that runs first swapping.
  const order = [];
  for (let round = 1; round <= ROUNDS; round++) {
    const pair = ['on', 'off'].map((side) => runs.find((run) => run.round === round && run.side === side));
    if (pair.some((run) => !run || spanProblems(run.out, '').length)) { order.push(null); continue; }
    const [first, second] = pair.sort((a, b) => when(a.out.started) - when(b.out.started));
    if (when(first.out.ended) > when(second.out.started)) problems.push(`round ${round}: its ${second.side} run started before its ${first.side} run ended; the runs of a round are taken one after the other`);
    const before = order.at(-1);
    if (before && when(first.out.started) < before.ended) problems.push(`round ${round} started before round ${round - 1} ended; the rounds are taken one after the other`);
    if (before && before.first === first.side) problems.push(`round ${round} ran its ${first.side} side first, as round ${round - 1} did: the rounds were not alternated`);
    order.push({ first: first.side, ended: Math.max(when(first.out.ended), when(second.out.ended)) });
  }
  return problems;
}

// ------------------------------------------------------------------ criterion 4: the query sets

const isCounters = (hal) => isObj(hal) && count(hal.query_sets) && count(hal.buffers);

/**
 * The three states' runs on the app's device, read from their kept outputs: the count of live timestamp query sets
 * each state holds, the largest `hal.query_sets` among its reads of the device's own counters. `counts` is there only
 * when all three states were read.
 */
function readStates(record, dir) {
  const problems = [], runs = [], counts = {};
  for (const state of STATES) {
    const at = `query_sets.states.${state}`;
    const ref = record?.query_sets?.states?.[state];
    if (!isObj(ref)) { problems.push(`BLOCKED: ${at}: the state wasn't read: the record cites no run for it`); continue; }
    const { out, problems: read } = readRef(dir, ref, at);
    problems.push(...read);
    if (!out) continue;
    runs.push({ at, out });
    problems.push(...runProblems(record, out, at));
    const shape = spanProblems(out, at);
    if (out.state !== state) shape.push(`${at}: ${ref.out} is a run of the state ${JSON.stringify(out.state)}`);
    if (out.device?.label !== APP_DEVICE) shape.push(`${at}: read on a device labelled ${JSON.stringify(out.device?.label)}, not on the app's device (${JSON.stringify(APP_DEVICE)})`);
    if (state === 'one_window' && out.windows !== 1) shape.push(`${at}: windows is ${JSON.stringify(out.windows)}, not one window`);
    if (state === 'four_windows' && (out.windows !== 4 || out.views_3d !== 4)) shape.push(`${at}: windows is ${JSON.stringify(out.windows)} and views_3d ${JSON.stringify(out.views_3d)}, not four windows each showing a 3D view`);
    const reads = list(out.reads);
    if (!reads.length || !reads.every((r) => isCounters(r?.hal))) shape.push(`${at}: the count isn't the device's own: ${ref.out} holds no reads of the device's own counters (each \`hal\`, as wgpu::Device::get_internal_counters() returns it, with query_sets and buffers)`);
    else if (reads.every((r) => r.hal.buffers === 0)) shape.push(`BLOCKED: ${at}: the state wasn't read: the device's counters count nothing (hal.buffers reads 0 on a device that draws, as it does with wgpu's \`counters\` feature off)`);
    const [from, to] = [when(out.started), when(out.ended)];
    for (const r of reads) if (!(when(r?.at) >= from && when(r?.at) <= to)) shape.push(`${at}: a read at ${JSON.stringify(r?.at)} is not inside the run (${out.started} to ${out.ended}), so it wasn't taken in the state`);
    problems.push(...shape);
    if (!shape.length) counts[state] = Math.max(...reads.map((r) => r.hal.query_sets));
  }
  return { counts: STATES.every((state) => state in counts) ? counts : undefined, runs, problems };
}

/**
 * The one-more-than-32 run, on a device of its own: 32 sets created, the device's own counter reading each, then one
 * more, and what the device did, which the run's `outcome` reports as its 33rd attempt shows it.
 */
function oneMoreProblems(record, dir) {
  const at = 'query_sets.one_more';
  const ref = record?.query_sets?.one_more;
  if (!isObj(ref)) return { runs: [], problems: [`BLOCKED: ${at}: the one-more-than-${SETS} run wasn't taken: the record cites no run for it`] };
  const { out, problems } = readRef(dir, ref, at);
  if (!out) return { runs: [], problems };
  const runs = [{ at, out }];
  problems.push(...runProblems(record, out, at));
  const label = out.device?.label;
  if (!nonEmpty(label)) problems.push(`${at}: device.label (the label its device was opened with) is missing, so nothing tells its device from the app's`);
  else if (label === APP_DEVICE) problems.push(`${at}: ran on the app's own device (device.label ${JSON.stringify(APP_DEVICE)}, as crates/deep-gpu/src/device.rs opens it), not on a device of its own: a run on the app's own device fails the lane`);
  const attempts = list(out.attempts);
  const shaped = attempts.length > 0 && attempts.every((a, i) => a?.n === i + 1 && typeof a.lost === 'boolean' && (a.error === null || nonEmpty(a.error)) && count(a.query_sets));
  if (!shaped) return { runs, problems: [...problems, `${at}: attempts must hold each set the run tried, in order from n 1, with error (null or the error's text), lost (whether the device was lost) and query_sets (the device's own counter after it)`] };
  if (attempts.every((a) => a.query_sets === 0)) return { runs, problems: [...problems, `BLOCKED: ${at}: the device's counters count nothing (query_sets reads 0 after every set, as it does with wgpu's \`counters\` feature off), so what the device held wasn't read`] };
  const did = (a) => (a.lost ? 'lost' : a.error !== null ? 'refused' : 'created');
  const early = attempts.slice(0, SETS).find((a) => did(a) !== 'created');
  if (early) return { runs, problems: [...problems, `INCONCLUSIVE: ${at}: set ${early.n} was ${did(early)} before ${SETS} were alive, so creating one more than ${SETS} was not run`] };
  for (const a of attempts.slice(0, SETS)) if (a.query_sets !== a.n) problems.push(`${at}: after set ${a.n} the device's own counter read ${a.query_sets}, not ${a.n}: the count is not of a device of its own that holds the run's sets alone`);
  if (attempts.length !== SETS + 1) return { runs, problems: [...problems, attempts.length <= SETS ? `BLOCKED: ${at}: ${attempts.length} sets were tried: the one more than ${SETS} was not` : `${at}: ${attempts.length} sets were tried, not ${SETS} and one more`] };
  const last = attempts[SETS];
  if (!OUTCOMES.includes(out.outcome)) problems.push(`${at}: outcome is ${JSON.stringify(out.outcome)}, not what the device did: ${OUTCOMES.join(', ')}`);
  else if (out.outcome !== did(last)) problems.push(`${at}: reports ${out.outcome}, and its attempt ${last.n} shows ${did(last)} (error ${JSON.stringify(last.error)}, lost ${last.lost})`);
  const kept = { created: SETS + 1, refused: SETS }[did(last)];
  if (kept !== undefined && last.query_sets !== kept) problems.push(`${at}: its attempt ${last.n} was ${did(last)}, and the device's own counter then read ${last.query_sets}, not ${kept}`);
  return { runs, problems };
}

/**
 * The count of live timestamp query sets is read from the device's own counters in each of the three states, and the
 * one-more-than-32 run reports what the device did. A run on the app's own device is a failure.
 */
export function querySetProblems(record, dir = REPO) {
  const states = readStates(record, dir);
  const oneMore = oneMoreProblems(record, dir);
  return [...mainProblems(record), ...states.problems, ...oneMore.problems, ...oneMachineProblems([...states.runs, ...oneMore.runs])];
}

// ------------------------------------------------------------------ criterion 5: the three thresholds and their tasks

const THRESHOLD_HEADER = ['threshold', 'reading', 'of', 'more than', 'task'];
/** The report's rows for each threshold, and what each row's statement is of. */
const THRESHOLDS = {
  translation: { rows: ['translation'], is: 'translation is more than a fifth of the time to the first settled frame' },
  validation: { rows: ['validation encode', 'validation gpu'], is: 'validation is more than 5% of the geometry pass on the forest' },
  query_sets: { rows: ['query sets'], is: 'a state holds more than 16 live sets' },
};

/** A filed task, as a record can hold it (#3222's suite's `followUp`): its issue number, its title and its own criteria. */
function taskProblems(task, at) {
  const problems = [];
  if (!isObj(task) || !Number.isInteger(task.issue) || task.issue <= ISSUE) problems.push(`${at}.issue is not the number of an issue filed after #${ISSUE}`);
  if (!nonEmpty(task?.title)) problems.push(`${at}.title is missing`);
  if (!list(task?.criteria).length || !task.criteria.every(nonEmpty)) problems.push(`${at}.criteria (the task's own acceptance criteria) is missing or has an empty one`);
  return problems;
}

/**
 * The report states, with its readings, whether translation is more than a fifth of the time to the first settled
 * frame, whether validation is more than 5% of the geometry pass on the forest and whether any state holds more than
 * 16 live sets, each recomputed here from the kept runs, and a task is filed for each that does.
 */
export function thresholdProblems(record, dir = REPO) {
  const problems = [...mainProblems(record)];
  const cold = readCold(record, dir, 'main');
  const indirect = readIndirect(record, dir);
  const states = readStates(record, dir);
  problems.push(...cold.problems, ...indirect.problems, ...states.problems, ...oneMachineProblems([...cold.runs, ...indirect.runs, ...states.runs]));
  // What each row's readings are, from the kept runs.
  const want = {};
  if (cold.rows) {
    const reading = cold.rows.reduce((sum, p) => sum + p.override_ms + p.source_ms + p.compile_ms, 0);
    want.translation = { reading, of: cold.out.first_settled_ms, over: reading > FIFTH * cold.out.first_settled_ms };
  } else problems.push('BLOCKED: the translation row can\'t be recomputed: main\'s cold run isn\'t whole');
  if (indirect.rounds) {
    for (const clock of ['encode', 'gpu']) {
      // The rounds are pairs, so validation's time is the median of each round's difference, on less off.
      const reading = percentile(indirect.rounds.map(({ on, off }) => on.geometry[`${clock}_ms`] - off.geometry[`${clock}_ms`]), 0.5);
      const of = percentile(indirect.rounds.map(({ on }) => on.geometry[`${clock}_ms`]), 0.5);
      want[`validation ${clock}`] = { reading, of, over: reading > SHARE * of };
    }
  } else problems.push('BLOCKED: the validation rows can\'t be recomputed: the five rounds\' runs aren\'t whole');
  if (states.counts) {
    const reading = Math.max(...Object.values(states.counts));
    want['query sets'] = { reading, of: LIVE, over: reading > LIVE };
  } else problems.push('BLOCKED: the query sets row can\'t be recomputed: the three states weren\'t all read');

  const readme = report(dir);
  if (readme === null) return [...problems, NO_REPORT];
  const table = tables(readme).find(({ header }) => THRESHOLD_HEADER.every((cell) => header.map(key).includes(cell)));
  if (!table) return [...problems, `the report has no threshold table: a table whose header holds ${THRESHOLD_HEADER.map((cell) => `\`${cell}\``).join(', ')}`];
  const at = Object.fromEntries(THRESHOLD_HEADER.map((cell) => [cell, table.header.map(key).indexOf(cell)]));
  const cell = (row, name) => row[at[name]] ?? '';
  for (const [name, { rows, is }] of Object.entries(THRESHOLDS)) {
    const task = record?.tasks?.[name];
    const filed = task !== undefined && task !== null;
    if (filed) problems.push(...taskProblems(task, `tasks.${name}`));
    let over = false;
    for (const label of rows) {
      const w = want[label];
      if (!w) continue;
      over ||= w.over;
      const found = table.rows.filter((row) => key(cell(row, 'threshold')) === label);
      if (found.length !== 1) { problems.push(`the threshold table has ${found.length} \`${label}\` rows, not one`); continue; }
      const [row] = found;
      for (const part of ['reading', 'of']) {
        const says = shown(cell(row, part));
        if (!says || !agrees(says, w[part])) problems.push(`the threshold table's \`${label}\` row gives its ${part === 'of' ? '`of`' : 'reading'} as ${JSON.stringify(cell(row, part))}; the kept runs give ${round3(w[part])}`);
      }
      const says = key(cell(row, 'more than'));
      const readings = `${round3(w.reading)} against ${round3(w.of)}`;
      if (says !== 'yes' && says !== 'no') problems.push(`the threshold table's \`${label}\` row says ${JSON.stringify(cell(row, 'more than'))} under \`more than\`, neither yes nor no`);
      else if (says === 'no' && w.over) problems.push(`the report says no for \`${label}\`, and its own readings pass the threshold: ${is} (${readings})`);
      else if (says === 'yes' && !w.over) problems.push(`the report says yes for \`${label}\`, and its own readings don't pass the threshold (${readings})`);
      if (w.over && filed && Number.isInteger(task.issue) && !new RegExp(`#${task.issue}(?!\\d)`).test(cell(row, 'task'))) problems.push(`the threshold table's \`${label}\` row doesn't name its task #${task.issue}`);
    }
    if (over && !filed) problems.push(`${is}, and no task is filed for it: the record has no tasks.${name}`);
  }
  const numbers = Object.values(isObj(record?.tasks) ? record.tasks : {}).map((task) => task?.issue).filter(Number.isInteger);
  if (new Set(numbers).size !== numbers.length) problems.push('two thresholds name one task; a task is filed for each');
  return problems;
}
