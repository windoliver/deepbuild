// Shared by the #1433 acceptance tests: reads what the spike keeps (docs/spikes/1433/record.json, its copy of the
// gates and the raw readings the record cites) and works out from the raw readings everything a test can work out,
// instead of taking the record's word (AGENTS.md, invariant 1): each gate's verdict, each reading the record names,
// and the line each arm ends in. Missing, unrun or uncounted input is never a pass (invariant 2). Each check returns a
// list of problems; an empty list means it holds. Formats: README.md, "The surface under test".
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const ISSUE = 1433;
export const SPIKE = `docs/spikes/${ISSUE}`;
export const sha256 = (data) => createHash('sha256').update(data).digest('hex');

// The gates, fixed before the first run: this suite's own file, written before the work. Every value a check judges
// against is read from it, and it holds only the issue's and the design's values (README: Criteria to tests).
const GATES_BYTES = readFileSync(new URL('./gates.json', import.meta.url));
export const GATES = JSON.parse(GATES_BYTES.toString('utf8'));
export const GATES_SHA256 = sha256(GATES_BYTES);
export const ARMS = Object.keys(GATES.arms);
export const STATUSES = ['pass', 'fail', 'inconclusive'];
/** The mark every carried hunk carries (#1426; scripts/vendor-rebase.mjs, MARK). */
const MARK = 'DeepBuild patch \\(windoliver/deepbuild#[0-9]+\\)';

// A person's gates and the task each one is (design: Tasks only you can do).
const PERSON = {
  'text-input': 'a person types Pinyin, Kotoeri, dictation and the emoji picker into the candidate\'s text area',
  accessibility: 'a person walks the candidate\'s window with VoiceOver on while deep-live reads its tree',
  'question-card': 'a person presses the question card with hardware input',
};
/** Gates read in a real window that AppKit showed; the panel's tree and update time name no window. */
const WINDOWED = new Set(['canvas-handoff', 'idle', 'list-transcript', 'text-input', 'accessibility', 'question-card', 'retention-frames', 'still-ledger', 'list-shapes']);
/** Gates that hold a time, a CPU share, memory or wakeups: those count only as the design's budgets do. */
const TIMED = new Set(['canvas-handoff', 'idle', 'list-transcript', 'panel', 'list-shapes']);
/** Gates judged on the design's five runs after warm-up. */
const FIVE = new Set(['canvas-handoff', 'idle', 'list-transcript', 'panel']);

const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const amount = (v) => finite(v) && v >= 0;
const count = (v) => Number.isInteger(v) && v >= 0;
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const isHex64 = (v) => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
const isCommit = (v) => typeof v === 'string' && /^[0-9a-f]{40}$/.test(v);
const json = (v) => JSON.stringify(v ?? null);
/** A path a record may cite: inside the spike's folder, so relative, with no `..`. */
const relative = (p) => nonEmpty(p) && !p.startsWith('/') && !p.startsWith('~') && !p.split('/').includes('..') && !/^[A-Za-z]:/.test(p);
/** Equal as data, numbers to one part in a million: what a record says against what its raw reading gives. */
export function same(a, b) {
  if (finite(a) && finite(b)) return Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((x, i) => same(x, b[i]));
  if (isObj(a) && isObj(b)) { const k = Object.keys(a).sort(), l = Object.keys(b).sort(); return k.length === l.length && k.every((key, i) => key === l[i] && same(a[key], b[key])); }
  return a === b;
}
const mean = (values) => values.reduce((sum, v) => sum + v, 0) / values.length;
/** Nearest rank: the smallest sample with at least p of the samples at or below it (as #2649's and #3222's suites). */
export const percentile = (values, p) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)]; };
const samples = (v) => Array.isArray(v) && v.length > 0 && v.every(amount);

// ------------------------------------------------------------------ this checkout's history at the record's base

/** Git in this checkout, read only, with nothing from the caller's environment pointing it elsewhere. */
function git(...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  return spawnSync('git', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 2 ** 28 });
}
/** Why the record's `base`, the main commit the harness was built from, can't be read: nothing when it can. */
export function baseProblems(record) {
  if (!isCommit(record?.base)) return ['base is not the full hash of the main commit the harness was built from'];
  if (git('cat-file', '-e', `${record.base}^{commit}`).status !== 0) return [`BLOCKED: base ${record.base} is not a commit this checkout's git has`];
  if (git('merge-base', '--is-ancestor', record.base, 'HEAD').status !== 0) return [`base ${record.base} is not an ancestor of HEAD`];
  return [];
}
const files = new Map();
/** A file's text at a commit of this checkout's history, or null. */
export function fileAt(commit, path) {
  const key = `${commit}:${path}`;
  if (!files.has(key)) { const shown = isCommit(commit) ? git('show', key) : { status: 1 }; files.set(key, shown.status === 0 ? shown.stdout : null); }
  return files.get(key);
}
/** The status colours of the look the #140 colour check reads, as 8-bit values, at a commit; or null. */
export function lookAt(commit) {
  try {
    const { status } = JSON.parse(fileAt(commit, GATES.gates['canvas-handoff'].look));
    return Object.fromEntries(Object.entries(status).map(([name, hex]) => [name, [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))]));
  } catch { return null; }
}
/** The checksum Cargo.lock pins for a crate at a version, at a commit; or null. */
export function lockedAt(commit, crate, version) {
  const lock = fileAt(commit, 'Cargo.lock') ?? '';
  const entry = lock.split('[[package]]').find((p) => p.includes(`\nname = "${crate}"\n`) && p.includes(`\nversion = "${version}"\n`));
  return /\nchecksum = "([0-9a-f]{64})"/.exec(entry ?? '')?.[1] ?? null;
}
const marks = new Map();
/**
 * Every carried hunk of the gpui trees at a commit, each named by the mark it carries: `<file>:<line>#<issue>` for
 * each `DeepBuild patch (windoliver/deepbuild#<n>)` in a tree's own files (its `upstream/` notes aside). Null when git
 * can't list them.
 */
export function carriedAt(commit) {
  if (!marks.has(commit)) {
    const found = isCommit(commit) ? git('grep', '-n', '-I', '-o', '-E', MARK, commit, '--', ...GATES.gpui_fast.carried_trees) : { status: 2 };
    const rows = found.status > 1 ? null : (found.stdout ?? '').split('\n').flatMap((row) => {
      const [, path, line, issue] = /^[0-9a-f]{40}:(.+?):(\d+):.*#(\d+)\)$/.exec(row) ?? [];
      return path && !path.split('/').includes('upstream') ? [`${path}:${line}#${issue}`] : [];
    });
    marks.set(commit, rows && [...new Set(rows)]);
  }
  return marks.get(commit);
}

// ------------------------------------------------------------------ reading what the spike keeps

/** The record, or the problems that kept it from being read. `dir` is the checkout holding docs/spikes/1433/. */
export function loadRecord(dir = REPO) {
  const path = join(dir, SPIKE, 'record.json');
  if (!existsSync(path)) return { problems: [`no spike record at ${SPIKE}/record.json: the spike hasn't been recorded`] };
  try {
    const record = JSON.parse(readFileSync(path, 'utf8'));
    return isObj(record) ? { record, problems: [] } : { problems: [`${SPIKE}/record.json is not a JSON object`] };
  } catch (error) {
    return { problems: [`${SPIKE}/record.json is not JSON: ${error.message}`] };
  }
}
/** A kept file of the spike's folder, by a path relative to it, or null. */
function kept(dir, file) {
  if (!relative(file)) return null;
  const path = join(dir, SPIKE, file);
  return existsSync(path) && statSync(path).isFile() ? readFileSync(path) : null;
}
/** A file the record cites as `{ file, sha256 }`: its bytes, or the problems. A hash that doesn't match is a problem. */
function cited(dir, cite, at) {
  if (!isObj(cite) || !relative(cite.file)) return { problems: [`BLOCKED: ${at}: ${json(cite?.file)} is not a path inside ${SPIKE}/`] };
  const bytes = kept(dir, cite.file);
  if (bytes === null) return { problems: [`BLOCKED: ${at}: ${cite.file} is not kept with the spike`] };
  return { bytes, problems: cite.sha256 === sha256(bytes) ? [] : [`BLOCKED: ${at}: sha256 of ${cite.file} is not what the record says`] };
}
/** A raw reading the record cites: the parsed file, or the problems. */
function readRaw(dir, cite, at) {
  const { bytes, problems } = cited(dir, cite, at);
  if (!bytes) return { problems };
  try {
    const raw = JSON.parse(bytes.toString('utf8'));
    return isObj(raw) ? { raw, problems } : { problems: [...problems, `BLOCKED: ${at}: ${cite.file} is not a JSON object`] };
  } catch (error) {
    return { problems: [...problems, `BLOCKED: ${at}: ${cite.file} is not JSON: ${error.message}`] };
  }
}

// ------------------------------------------------------------------ what counts

/** Why a machine is not the one the issue's `Runs on:` line names, the reference Air. Empty when it is. */
function offTheAir(machine) {
  const keys = ['model', 'chip', 'memoryBytes'];
  const off = keys.every((key) => machine?.[key] === GATES.runs_on[key]) ? [] : [`read off the reference Air (${keys.map((key) => `${key} ${json(machine?.[key])}`).join(', ')}; the issue runs on ${GATES.runs_on.model}, ${GATES.runs_on.chip}, ${GATES.runs_on.memoryBytes} bytes)`];
  if (!nonEmpty(machine?.macosBuild)) off.push('the macOS build is missing');
  return off;
}
/** Why a time, a CPU share, memory or wakeups read here is a reading and not a result (design: The reference Macs; parallel-proof 6 and 12a). */
function untimed(raw) {
  const off = Object.entries(GATES.conditions).filter(([key, value]) => raw.machine?.[key] !== value).map(([key, value]) => `${key} is ${json(raw.machine?.[key])}, not ${json(value)}`);
  if (raw.profile !== 'release') off.push(`profile is ${json(raw.profile)}: only a release build is timed`);
  const loads = list(raw.runs).flatMap((r) => [r?.load?.start, r?.load?.end]);
  const high = loads.filter((l) => amount(l) && l >= GATES.runs_on.cores);
  if (high.length) off.push(`a one-minute load of ${Math.max(...high)} at a run's start or end is at or above the Air's ${GATES.runs_on.cores} cores`);
  return off;
}
/**
 * The design's rule for a limit (Every task carries its own budgets): five runs after warm-up pass when all five are
 * within it, fail when all five are over it by more than the margin, the larger of 5% and the five runs' spread, and
 * are otherwise INCONCLUSIVE. `strict` is the issue's "under"; else "at most" and "within".
 */
export function judgeFive(runs, limit, strict) {
  if (runs.every((v) => (strict ? v < limit : v <= limit))) return 'pass';
  const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / limit);
  return runs.every((v) => v > limit * (1 + margin)) ? 'fail' : 'inconclusive';
}
/** One limit of a gate, judged on five runs' values into `out.fail` or `out.unsure`. */
function limit(out, what, values, bound, strict, off) {
  const said = `${what} ${json(values)} against ${strict ? 'under' : 'at most'} ${bound}`;
  if (values.length !== GATES.runs || !values.every(amount)) out.unsure.push(`${said}: a limit is judged on ${GATES.runs} runs after warm-up`);
  else if (off.length) out.unsure.push(`${said} is a reading, not a result: ${off.join('; ')}`);
  else {
    const status = judgeFive(values, bound, strict);
    if (status === 'fail') out.fail.push(`${said}: all five runs are over it by more than the margin`);
    if (status === 'inconclusive') out.unsure.push(`${said}: the five runs are neither all within it nor all over it by more than the margin`);
  }
}

// ------------------------------------------------------------------ the gates, each from its raw reading

/** A snapshot's nodes in pre-order, as #338's suite reads one: role, name, value and bounds in whole device pixels. */
function flatten(tree) {
  const nodes = [];
  let broken = null;
  (function walk(node, at) {
    if (!isObj(node)) { broken ??= `${at} is not a node`; return; }
    const bounds = node.bounds;
    if (!nonEmpty(node.role) || !(Array.isArray(bounds) && bounds.length === 4 && bounds.every(Number.isInteger))) broken ??= `${at} lacks a role or bounds [x, y, w, h] in whole device pixels`;
    nodes.push({ role: node.role, name: node.name ?? null, value: node.value ?? null, bounds });
    list(node.children).forEach((child, i) => walk(child, `${at}/children/${i}`));
  })(tree, 'tree');
  return { nodes, broken };
}
/** The first node, in pre-order, where two snapshots differ, or null when they are equal node for node (#338's rule). */
export function firstDifference(a, b) {
  if (!same(a?.window, b?.window)) return { index: 0, why: `the window differs: ${json(a?.window)} vs ${json(b?.window)}` };
  const left = flatten(a?.tree).nodes, right = flatten(b?.tree).nodes;
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const x = left[index], y = right[index];
    if (!x || !y) return { index, why: `${x ? 'the headless dump' : 'the live tree'} ends at node ${index}` };
    for (const field of ['role', 'name', 'value', 'bounds']) if (!same(x[field], y[field])) return { index, why: `node ${index} (${x.role} ${json(x.name)}) differs in ${field}: ${json(x[field])} vs ${json(y[field])}` };
  }
  return null;
}
/** Whether retention was on or off in a run, by its switch and by the views it drew again from their last frame. */
function retentionProblems(run, reused, at) {
  const sw = GATES.gates['retention-frames'].off_switch;
  if (!count(reused)) return [`${at}: reused (the views drawn again from their last frame) is missing`];
  if (run.retention === 'off') return [...(run.switch === sw ? [] : [`${at}: retention is off by ${json(run.switch)}, not by ${sw}, the only switch in a shipped build`]), ...(reused === 0 ? [] : [`${at}: ${reused} views were drawn again from their last frame, so retention wasn't off`])];
  if (run.retention === 'on') return run.switch == null ? [] : [`${at}: retention is on, yet the run names the switch ${json(run.switch)}`];
  return [`${at}: retention is ${json(run.retention)}, not on or off`];
}

const JUDGES = {
  // AC1: the slots shown with a translucent fixture and the #140 colour check, under 1 ms at 1936 x 1584, matching the headless canvas.
  'canvas-handoff'(raw, ctx, off) {
    const g = GATES.gates['canvas-handoff'], out = { fail: [], unsure: [] };
    for (const side of ['slot', 'headless']) if (!same(raw[side]?.size_px, g.size_px)) out.unsure.push(`${side}.size_px is ${json(raw[side]?.size_px)}, not ${g.size_px.join(' × ')}`);
    if (!(count(raw.slot?.translucent_px) && raw.slot.translucent_px > 0)) out.unsure.push('slot.translucent_px counts no pixel whose alpha is between 0 and 255: no translucent fixture was shown');
    const look = lookAt(ctx.base);
    if (!look) out.unsure.push(`BLOCKED: ${g.look} can't be read at base ${ctx.base}`);
    for (const [status, want] of Object.entries(look ?? {})) {
      const read = list(raw.swatches).find((s) => s?.status === status)?.read;
      if (!Array.isArray(read)) out.unsure.push(`the colour check read back no swatch for the status ${status}`);
      else if (!same(read.slice(0, 3), want)) out.fail.push(`the colour check failed: the ${status} swatch read back as ${json(read)}, not the look's ${json(want)}`);
    }
    if (!isHex64(raw.slot?.pixel_hash) || !isHex64(raw.headless?.pixel_hash)) out.unsure.push('slot.pixel_hash and headless.pixel_hash (the sha256 of the pixels shown and of the headless canvas\'s) are required');
    else if (raw.slot.pixel_hash !== raw.headless.pixel_hash) out.fail.push('the slot shown in the window doesn\'t match the headless canvas: their pixel hashes differ');
    const means = raw.runs.map((r) => (samples(r?.frame_ms) && r.frame_ms.length >= g.frames_at_least ? mean(r.frame_ms) : null));
    if (means.includes(null)) out.unsure.push(`each run gives frame_ms, the time of each of at least ${g.frames_at_least} frames in ms`);
    else limit(out, 'frame ms a run, on average', means, g.frame_ms_under, true, off);
    return { ...out, reading: { frame_ms: means } };
  },
  // AC2: under canvas-idle, 0 frames and at most 1 wakeup.
  idle(raw, ctx, off) {
    const g = GATES.gates.idle, out = { fail: [], unsure: [] };
    const frames = raw.runs.map((r) => r?.frames ?? null), wakeups = raw.runs.map((r) => r?.wakeups ?? null);
    if (raw.runs.some((r) => r?.seconds !== g.seconds)) out.unsure.push(`each run holds the still window ${g.seconds} s, as canvas-idle does`);
    if (!frames.every(count)) out.unsure.push(`frames ${json(frames)}: each run gives the frames it presented while still`);
    else if (frames.some((f) => f > g.frames)) out.fail.push(`frames ${json(frames)}: the still window presented a frame; the gate is ${g.frames}`);
    limit(out, 'wakeups', wakeups, g.wakeups_at_most, false, off);
    return { ...out, reading: { frames, wakeups } };
  },
  // AC3: the 1,000-row list plus a streaming transcript, in paired alternating runs, within 4 ms and #337's four numbers.
  'list-transcript'(raw, ctx, off) {
    const g = GATES.gates['list-transcript'], out = { fail: [], unsure: [] };
    if (raw.rows !== g.rows) out.unsure.push(`rows is ${json(raw.rows)}, not the ${g.rows}-row list`);
    if (!isHex64(raw.transcript)) out.unsure.push('transcript (the sha256 of the recorded transcript the runs streamed) is missing');
    if (!raw.runs.every((r) => count(r?.streamed) && r.streamed > 0)) out.unsure.push('each run gives streamed, the chunks its transcript streamed beside the list (at least 1)');
    const reading = { update_p99_ms: raw.runs.map((r) => (samples(r?.update_ms) ? percentile(r.update_ms, 0.99) : null)) };
    for (const key of ['coldStartMs', 'idleCpuPercent', 'memoryBytes', 'appBytes']) reading[key] = raw.runs.map((r) => r?.[key] ?? null);
    limit(out, 'update ms at p99', reading.update_p99_ms, g.update_p99_ms_at_most, false, off);
    for (const key of ['coldStartMs', 'idleCpuPercent', 'memoryBytes', 'appBytes']) limit(out, key, reading[key], g[`${key}_under`], true, off);
    // Paired with the other arm's runs, unless a kept reading closed that arm before it read the list.
    const paired = ARMS.find((arm) => arm !== ctx.arm), other = ctx.peek(paired, 'list-transcript');
    if (!other) { if (!ctx.closed(paired)) out.unsure.push(`not in paired alternating runs: the ${paired} arm keeps no list-transcript reading to pair with`); } else {
      if (other.transcript !== raw.transcript || other.rows !== raw.rows) out.unsure.push('the two arms didn\'t run the same list and transcript: their rows or transcript differ');
      const firsts = [];
      for (let pair = 1; pair <= GATES.runs; pair++) {
        const [mine, theirs] = [raw, other].map((r) => Date.parse(list(r.runs).find((run) => run?.pair === pair)?.started));
        firsts.push(Number.isFinite(mine) && Number.isFinite(theirs) && mine !== theirs ? mine < theirs : null);
      }
      if (firsts.includes(null)) out.unsure.push(`not in paired runs: each arm's run names its pair, 1 to ${GATES.runs}, and when it started`);
      else if (firsts.some((first, i) => i > 0 && first === firsts[i - 1])) out.unsure.push(`not in alternating runs: which arm ran first doesn't alternate from pair to pair (${firsts.map((first) => (first ? ctx.arm : 'the other')).join(', ')})`);
    }
    if (ctx.arm === 'gpui-fast') {
      const ships = ctx.peek('gpui-fast', 'list-shapes')?.ships;
      if (!GATES.gates['list-shapes'].shapes.includes(raw.shape) || raw.shape !== ships) out.unsure.push(`shape is ${json(raw.shape)}; the app's list is read in the shape it ships in, which the list-shapes reading names as ${json(ships)}`);
      if (raw.retention !== 'on') out.unsure.push(`retention is ${json(raw.retention)}; the gate reads the backend as it ships, with retention on`);
    }
    return { ...out, reading };
  },
  // AC4: no lost composition, wrong commit or misplaced candidate window, in each of the four ways of typing.
  'text-input'(raw) {
    const g = GATES.gates['text-input'], out = { fail: [], unsure: [] }, faults = [];
    for (const method of g.methods) for (const fault of g.faults) {
      const saw = raw.methods?.[method]?.[fault];
      if (saw === true) { faults.push(`${method}: ${fault}`); out.fail.push(`typing with ${method}, the person saw a ${fault.replaceAll('_', ' ')}`); }
      else if (saw !== false) out.unsure.push(`methods.${method}.${fault} is ${json(saw)}, not what the person saw (true or false)`);
    }
    return { ...out, reading: { faults } };
  },
  // AC5: deep-live's tree of the window, read with VoiceOver on, node-for-node equal to the headless dump.
  accessibility(raw) {
    const out = { fail: [], unsure: [] };
    if (raw.voiceover !== true) out.unsure.push('voiceover is not true: the tree wasn\'t read while VoiceOver was on');
    if (!new RegExp(`(^|[\\s/])${GATES.gates.accessibility.live}(\\s|$)`).test(raw.command ?? '')) out.unsure.push(`command doesn't name ${GATES.gates.accessibility.live}, which reads the live tree`);
    const [live, dump] = [raw.live, raw.headless].map((s) => flatten(s?.tree));
    for (const [name, s] of [['live', live], ['headless', dump]]) {
      if (s.broken) out.unsure.push(`${name}: ${s.broken}`);
      else if (!s.nodes.some((node) => nonEmpty(node.name))) out.unsure.push(`${name}: no node of the tree has a name`);
    }
    const difference = firstDifference(raw.live, raw.headless);
    if (difference) out.fail.push(`deep-live's tree and the headless dump aren't equal node for node: ${difference.why}`);
    return { ...out, reading: { nodes: live.nodes.length, first_difference: difference ? { index: difference.index } : null } };
  },
  // AC6: nothing covers the card, and a hardware press is told from a synthetic one.
  'question-card'(raw, ctx) {
    const g = GATES.gates['question-card'], out = { fail: [], unsure: [] };
    const source = fileAt(ctx.base, g.built_with);
    if (source === null) out.unsure.push(`BLOCKED: ${g.built_with} can't be read at base ${ctx.base}`);
    else if (raw.built_with?.path !== g.built_with || raw.built_with?.sha256 !== sha256(source)) out.unsure.push(`built_with is not ${g.built_with} as base ${ctx.base.slice(0, 9)} holds it (sha256 ${sha256(source)})`);
    if (raw.status_item?.shown !== true) out.unsure.push('status_item.shown is not true: the status item isn\'t shown beside the window shell');
    const cover = raw.card?.covered_by;
    if (!Array.isArray(cover)) out.unsure.push('card.covered_by (what covers the card; an empty list says nothing does) is missing');
    else if (cover.length) out.fail.push(`the card is covered by ${json(cover)}`);
    const presses = list(raw.presses), kinds = ['hardware', 'synthetic'];
    if (!presses.every((p) => kinds.includes(p?.sent) && kinds.includes(p?.told))) out.unsure.push('each press says how it was sent and how the card told it: hardware or synthetic');
    const sent = (kind) => presses.filter((p) => p?.sent === kind).length;
    for (const kind of kinds) if (!sent(kind)) out.unsure.push(`no ${kind} press was sent`);
    const mistold = presses.filter((p) => kinds.includes(p?.sent) && kinds.includes(p?.told) && p.sent !== p.told);
    if (mistold.length) out.fail.push(`${mistold.length} of ${presses.length} presses were told wrong: a ${mistold[0].sent} press was told as ${mistold[0].told}`);
    return { ...out, reading: { covered_by: Array.isArray(cover) ? cover : null, hardware: sent('hardware'), synthetic: sent('synthetic'), mistold: mistold.length } };
  },
  // AC7: claude-code/main.js through a shim builds the app's panel tree, each update within 4 ms.
  panel(raw, ctx, off) {
    const g = GATES.gates.panel, out = { fail: [], unsure: [] };
    const [source, tree] = [g.panel, g.tree].map((path) => fileAt(ctx.base, path));
    let parity = null;
    if (source === null || tree === null) out.unsure.push(`BLOCKED: ${source === null ? g.panel : g.tree} can't be read at base ${ctx.base}`);
    else {
      if (raw.panel?.path !== g.panel || raw.panel?.sha256 !== sha256(source)) out.unsure.push(`panel is not ${g.panel} as base ${ctx.base.slice(0, 9)} holds it (sha256 ${sha256(source)})`);
      if (!nonEmpty(raw.tree)) out.unsure.push('tree (the panel tree the shim built for one invalidation) is missing');
      else {
        const [got, want] = [raw.tree, tree].map((text) => text.trimEnd().split('\n'));
        const at = Array.from({ length: Math.max(got.length, want.length) }, (_, i) => i).find((i) => got[i] !== want[i]);
        parity = at === undefined;
        if (!parity) out.fail.push(`no panel-tree parity: line ${at + 1} is ${json(got[at])}; the app's tree (${g.tree}) holds ${json(want[at])}`);
      }
    }
    const p99 = raw.runs.map((r) => (samples(r?.update_ms) ? percentile(r.update_ms, 0.99) : null));
    limit(out, 'update ms at p99', p99, g.update_p99_ms_at_most, false, off);
    return { ...out, reading: { parity, update_p99_ms: p99 } };
  },
  // AC10: one recorded journey's frames with retention on and off, byte-equal.
  'retention-frames'(raw, ctx) {
    const out = { fail: [], unsure: [] }, reading = { frames: null, first_difference: null };
    const journey = ctx.entry?.journey?.sha256;
    const on = raw.runs.find((r) => r?.retention === 'on'), no = raw.runs.find((r) => r?.retention === 'off');
    if (raw.runs.length !== 2 || !on || !no) return { ...out, unsure: ['the reading holds two runs of the journey, one with retention on and one with it off'], reading };
    for (const [name, run] of [['on', on], ['off', no]]) {
      const frames = list(run.frames), at = `the run with retention ${name}`;
      if (!isHex64(journey) || run.journey !== journey) out.unsure.push(`${at} didn't replay the recorded journey the record cites (journey ${json(run.journey)})`);
      if (!frames.length || !frames.every((f) => isHex64(f?.sha256) && count(f?.reused) && isObj(f?.views) && Number.isInteger(f?.step))) out.unsure.push(`${at}: each frame gives its step, sha256, reused and views`);
      const reused = frames.reduce((sum, f) => sum + (count(f?.reused) ? f.reused : 0), 0);
      out.unsure.push(...retentionProblems(run, reused, at));
      if (name === 'on' && reused === 0) out.unsure.push(`${at} drew no view again from its last frame, as a replica's render_frame does: it says nothing about retention`);
    }
    reading.frames = list(on.frames).length;
    if (list(on.frames).length !== list(no.frames).length) reading.first_difference = { frame: Math.min(list(on.frames).length, list(no.frames).length) + 1, step: null, views: [] };
    else for (const [i, a] of list(on.frames).entries()) {
      const b = no.frames[i];
      if (a?.sha256 === b?.sha256 && a?.step === b?.step) continue;
      const views = [...new Set([...Object.keys(a?.views ?? {}), ...Object.keys(b?.views ?? {})])].filter((view) => a?.views?.[view] !== b?.views?.[view]).sort();
      reading.first_difference = { frame: i + 1, step: a?.step ?? null, views };
      break;
    }
    const d = reading.first_difference;
    if (d && !out.unsure.length) out.fail.push(d.step === null ? `the journey drew ${on.frames.length} frames with retention on and ${no.frames.length} with it off` : `frame ${d.frame} (step ${d.step}) is not byte-equal with retention on and off: ${d.views.length ? `it differs in the view ${d.views.map(json).join(', ')}` : 'it differs outside every view it lists'}`);
    return { ...out, reading };
  },
  // AC11: a still window reads no GPU work on a ledger that counts every command buffer.
  'still-ledger'(raw) {
    const out = { fail: [], unsure: [] }, vsyncs = raw.runs.flatMap((r) => list(r?.vsyncs));
    const shaped = vsyncs.every((v) => typeof v?.still === 'boolean' && count(v?.committed?.main) && count(v?.committed?.layers) && count(v?.ledger?.committed) && count(v?.ledger?.gpu_ns));
    const still = vsyncs.filter((v) => v?.still === true), moving = vsyncs.filter((v) => v?.still === false);
    const total = (rows, of) => rows.reduce((sum, v) => sum + (count(of(v)) ? of(v) : 0), 0);
    const reading = { still_vsyncs: still.length, still_command_buffers: total(still, (v) => v?.ledger?.committed), still_gpu_ns: total(still, (v) => v?.ledger?.gpu_ns), uncounted: total(vsyncs, (v) => v?.committed?.main) + total(vsyncs, (v) => v?.committed?.layers) - total(vsyncs, (v) => v?.ledger?.committed) };
    if (!vsyncs.length || !shaped) return { ...out, unsure: ['each vsync says whether the window was still, the command buffers committed by the main render and by layer paths, and the ledger\'s committed and gpu_ns'], reading };
    if (!still.length) out.unsure.push('no vsync of a still window was read');
    if (!total(moving, (v) => v.committed.layers)) out.unsure.push('no layer path committed a command buffer before the window went still, so the reading can\'t tell a ledger that counts every command buffer from one that counts only the main render');
    const missed = vsyncs.findIndex((v) => v.ledger.committed !== v.committed.main + v.committed.layers);
    if (missed >= 0) { const v = vsyncs[missed]; out.fail.push(`the ledger doesn't count every command buffer: at vsync ${missed + 1} it counted ${v.ledger.committed} of ${v.committed.main + v.committed.layers} (${v.committed.main} from the main render, ${v.committed.layers} from layer paths)`); }
    if (reading.still_command_buffers || reading.still_gpu_ns) out.fail.push(`the still window did GPU work: ${reading.still_command_buffers} command buffers and ${reading.still_gpu_ns} ns of GPU time over ${still.length} vsyncs`);
    return { ...out, reading };
  },
  // AC12: the list in both state shapes, and one label changing at 1,000 and 3,000 live rows, with retention on and off.
  'list-shapes'(raw, ctx, off) {
    const g = GATES.gates['list-shapes'], out = { fail: [], unsure: [] };
    const reading = { ships: raw.ships ?? null, list: {}, label: {} };
    if (off.length) out.unsure.push(`its update times and CPU are readings, not results: ${off.join('; ')}`);
    if (raw.subject !== 'list') out.unsure.push(`INCONCLUSIVE for the list: the reading's subject is ${json(raw.subject)}, not the list; a bench whose panels each own their state says nothing about a list fed by one model`);
    if (!g.shapes.includes(raw.ships)) out.unsure.push(`ships (the shape the app's list ships in: ${g.shapes.join(' or ')}) is ${json(raw.ships)}`);
    const cell = (kind, pick, at) => {
      const runs = raw.runs.filter((r) => r?.kind === kind && pick(r));
      if (runs.length !== 1) { out.unsure.push(`INCONCLUSIVE for the list: ${runs.length ? `${runs.length} runs` : 'no run'} for ${at}`); return null; }
      return runs[0];
    };
    for (const shape of g.shapes) for (const retention of g.retention) {
      const at = `the list in the ${shape} shape (${shape === 'shared' ? 'rows told by one shared model' : 'rows that each hold what they draw'}) with retention ${retention}`;
      const run = cell('list', (r) => r.shape === shape && r.retention === retention, at);
      (reading.list[shape] ??= {})[retention] = run && samples(run.update_ms) ? percentile(run.update_ms, 0.99) : null;
      if (!run) continue;
      if (!samples(run.update_ms)) out.unsure.push(`INCONCLUSIVE for the list: ${at} gives no update_ms`);
      const holders = shape === 'shared' ? 1 : g.rows;
      if (run.rows !== g.rows || run.state_entities !== holders) out.unsure.push(`INCONCLUSIVE for the list: ${at} has ${json(run.rows)} rows whose state ${json(run.state_entities)} entities hold; the shape is ${g.rows} rows and ${holders}`);
      out.unsure.push(...retentionProblems(run, run.reused, at));
    }
    for (const rows of g.live_rows) for (const retention of g.retention) {
      const at = `one label changing at ${rows} live rows with retention ${retention}`;
      const run = cell('label', (r) => r.live_rows === rows && r.retention === retention, at);
      const frames = list(run?.frames), ok = frames.length > 0 && frames.every((f) => count(f?.rendered) && count(f?.elements) && amount(f?.cpu_ms) && count(f?.reused));
      (reading.label[rows] ??= {})[retention] = ok ? { views_rendered: Math.max(...frames.map((f) => f.rendered)), elements_laid_out: Math.max(...frames.map((f) => f.elements)), cpu_ms_p50: percentile(frames.map((f) => f.cpu_ms), 0.5), cpu_ms_p95: percentile(frames.map((f) => f.cpu_ms), 0.95) } : null;
      if (!run) continue;
      if (!ok) out.unsure.push(`${at}: each frame gives rendered (views rendered), elements (elements laid out), cpu_ms and reused`);
      else out.unsure.push(...retentionProblems(run, frames.reduce((sum, f) => sum + f.reused, 0), at));
    }
    return { ...out, reading };
  },
};

/**
 * One gate of one arm, worked out from the raw reading the record cites for it (`planted`: from the planted program's
 * kept run instead): its status, why, the reading, its machine and its load, and what is wrong with what is kept.
 */
function evaluateGate(record, dir, arm, gate, planted = false) {
  const at = `${arm}.${gate}${planted ? '.planted' : ''}`, entry = record?.arms?.[arm]?.gates?.[gate];
  const out = { status: 'inconclusive', why: [], problems: [], reading: null, machine: null, load: null, unrun: false, replica: null, blocked: false };
  const task = PERSON[gate];
  if (!isObj(entry)) return { ...out, unrun: true, blocked: Boolean(task), why: ['the record doesn\'t list the gate'], problems: [`${at}: the gate is missing from the record`] };
  const cite = planted ? entry.planted : entry.raw;
  if (cite === undefined || cite === null) return { ...out, unrun: true, blocked: Boolean(task), why: [task ? `no person has taken it (${task})` : `unrun${nonEmpty(entry.why) ? `: ${entry.why}` : ''}`] };
  const { raw, problems } = readRaw(dir, cite, at);
  out.problems.push(...problems);
  if (!raw) return { ...out, why: ['its raw reading can\'t be read'] };
  // What every raw reading says of itself.
  if (raw.spike !== ISSUE || raw.arm !== arm || raw.gate !== gate) out.problems.push(`${at}: ${cite.file} is a reading of ${json(raw.arm)} ${json(raw.gate)} for #${json(raw.spike)}`);
  if (raw.gates !== GATES_SHA256) out.problems.push(`${at}: ${cite.file} wasn't read under the gates fixed before the first run (gates is ${json(raw.gates)}, not the sha256 of gates.json)`);
  const harness = record?.arms?.[arm]?.harness?.sha256;
  if (!isHex64(raw.harness)) out.problems.push(`${at}: ${cite.file} names no harness (the sha256 of the binary that took it)`);
  else if (planted ? raw.harness === harness || !nonEmpty(raw.planted) : raw.harness !== harness) out.problems.push(planted ? `${at}: ${cite.file} is not a planted program's run: it names no planted program, or the arm's own harness` : `${at}: ${cite.file} was taken by another binary than the arm's harness`);
  if (!isObj(raw.machine)) out.problems.push(`${at}: ${cite.file} names no machine (the fingerprint it was read on)`);
  const runs = list(raw.runs);
  if (!runs.length || !runs.every((r) => isObj(r) && !Number.isNaN(Date.parse(r.started)) && amount(r.load?.start) && amount(r.load?.end))) {
    out.problems.push(`${at}: ${cite.file}: each run says when it started and the one-minute load at its start and end`);
    return { ...out, why: ['its raw reading holds no run with its load'] };
  }
  out.machine = raw.machine ?? null;
  out.load = Math.max(...runs.flatMap((r) => [r.load.start, r.load.end]));
  // What keeps a reading from counting at all, whatever it holds.
  const uncounted = [];
  if (!planted) {
    if (!/(^|[\s/])scripts\/lease(\s|$)/.test(raw.command ?? '')) uncounted.push('not taken under the repo\'s resource lease: command doesn\'t run through scripts/lease');
    uncounted.push(...offTheAir(raw.machine));
    if (task && raw.taken_by !== 'person') { out.blocked = true; uncounted.push(`no person took it: taken_by is ${json(raw.taken_by)} (${task})`); }
    if (FIVE.has(gate) && runs.length !== GATES.runs) uncounted.push(`the reading holds ${runs.length} runs; a limit is judged on ${GATES.runs} after warm-up`);
  }
  if (WINDOWED.has(gate)) {
    if (raw.surface !== 'window') { out.replica = raw.surface ?? 'unnamed surface'; uncounted.push(`taken through the ${out.replica}, not a real window: a reading through the replica reads INCONCLUSIVE`); }
    const hidden = runs.findIndex((r) => r.window?.state !== 'shown');
    if (hidden >= 0) uncounted.push(`run ${hidden + 1}'s window was ${json(runs[hidden].window?.state)}, not shown`);
  }
  const peek = (other, name) => { const there = record?.arms?.[other]?.gates?.[name]?.raw; return isObj(there) ? readRaw(dir, there, '').raw ?? null : null; };
  const closed = (other) => GATES.arms[other].some((name) => name !== gate && evaluateGate(record, dir, other, name).status === 'fail');
  const judged = JUDGES[gate](raw, { base: record?.base, arm, entry, peek, closed }, TIMED.has(gate) && !planted ? untimed(raw) : []);
  out.reading = judged.reading;
  if (uncounted.length) out.why = [...uncounted, ...judged.unsure];
  else if (judged.fail.length) { out.status = 'fail'; out.why = judged.fail; } else if (judged.unsure.length) out.why = judged.unsure;
  else out.status = 'pass';
  return out;
}

/**
 * The line an arm ends in, from its gates' verdicts: `closed: <gates>` when any failed, naming each; else
 * `INCONCLUSIVE: <gates>` when any is unrun or undecided, naming each; else `fallback`.
 */
export function lineOf(verdicts) {
  const of = (status) => Object.entries(verdicts).filter(([, v]) => v.status === status).map(([gate]) => gate);
  if (of('fail').length) return `closed: ${of('fail').join(', ')}`;
  return of('inconclusive').length ? `INCONCLUSIVE: ${of('inconclusive').join(', ')}` : 'fallback';
}

/** Every gate of both arms, worked out from what is kept, and the line each arm ends in. */
export function evaluate(record, dir = REPO) {
  const gates = {}, lines = {};
  for (const arm of ARMS) {
    gates[arm] = Object.fromEntries(GATES.arms[arm].map((gate) => [gate, evaluateGate(record, dir, arm, gate)]));
    lines[arm] = lineOf(gates[arm]);
  }
  return { gates, lines };
}

// ------------------------------------------------------------------ criteria 1 to 7 and 10 to 12: one gate

/**
 * A gate, for each arm that has it. Holds when the gate passed. A gate that failed is the spike's result, not the
 * suite's failure: it holds when the record says so and ends the arm closed with it. A gate that isn't decided holds
 * only on an arm another gate's kept reading closes; anywhere else it is INCONCLUSIVE, or BLOCKED for a person's
 * gate no person took, naming the gate. `notes` says which of these a holding gate was.
 */
export function gateProblems(gate, record, dir = REPO) {
  const { gates, lines } = evaluate(record, dir);
  const problems = [...baseProblems(record)], notes = [];
  for (const arm of ARMS.filter((each) => GATES.arms[each].includes(gate))) {
    const v = gates[arm][gate], entry = record?.arms?.[arm]?.gates?.[gate], name = `${arm} ${gate}`;
    problems.push(...v.problems);
    if (!isObj(entry)) continue;
    const ended = record?.lines?.[arm] === lines[arm];
    if (entry.status !== v.status) problems.push(`${arm}.${gate}: status is ${json(entry.status)}, but its kept reading gives ${v.status}${v.why.length ? `: ${v.why.join('; ')}` : ''}`);
    else if (v.status === 'fail') {
      if (ended) notes.push(`${name} FAILED, a result of the spike: ${v.why.join('; ')}. The record ends the arm "${lines[arm]}"`);
      else problems.push(`lines[${json(arm)}] is ${json(record?.lines?.[arm])}; ${name} failed (${v.why.join('; ')}), so the arm ends ${json(lines[arm])}`);
    } else if (v.status === 'inconclusive') {
      if (ended && lines[arm].startsWith('closed: ')) notes.push(`${name} wasn't decided (${v.why.join('; ')}): the ${arm} arm is ${lines[arm]}, by a kept reading that fails it`);
      else problems.push(`${v.blocked ? 'BLOCKED' : 'INCONCLUSIVE'}: ${name}: ${v.why.join('; ')}`);
    }
  }
  return { problems: [...new Set(problems)], notes };
}

/**
 * The planted program a criterion names, by its kept run: the same check the gate's own reading takes must fail it.
 * `retention-frames`: a glyph page retired under a retained view, naming the view. `still-ledger`: a ledger that
 * counts only the main render.
 */
export function plantedProblems(gate, record, dir = REPO) {
  const arm = 'gpui-fast', { gates, lines } = evaluate(record, dir);
  const own = gates[arm][gate], entry = record?.arms?.[arm]?.gates?.[gate], problems = [...baseProblems(record), ...own.problems];
  if (!isObj(entry)) return { problems, notes: [] };
  if (own.unrun) {
    if (record?.lines?.[arm] === lines[arm] && lines[arm].startsWith('closed: ')) return { problems, notes: [`${arm} ${gate} wasn't read, so no planted program was run against it: the arm is ${lines[arm]}, by a kept reading that fails it`] };
    return { problems: [...problems, `INCONCLUSIVE: ${arm} ${gate} is unrun, so no planted program was run against its check`], notes: [] };
  }
  if (!isObj(entry.planted)) return { problems: [...problems, `${arm}.${gate}.planted (the planted program's kept run) is missing`], notes: [] };
  const run = evaluateGate(record, dir, arm, gate, true);
  problems.push(...run.problems);
  if (run.status !== 'fail') problems.push(`the planted program doesn't fail the gate's check: its kept run reads ${run.status}${run.why.length ? ` (${run.why.join('; ')})` : ''}`);
  else if (gate === 'retention-frames') {
    const named = run.reading.first_difference?.views ?? [];
    if (!nonEmpty(entry.planted.view)) problems.push(`${arm}.${gate}.planted.view (the retained view the glyph page was retired under) is missing`);
    else if (!named.includes(entry.planted.view)) problems.push(`the check fails the planted run without naming the view the glyph page was retired under, ${json(entry.planted.view)}: ${run.why.join('; ')}`);
  } else if (!(run.reading.uncounted > 0)) problems.push(`the planted run fails for another reason than a ledger that counts only the main render: ${run.why.join('; ')}`);
  return { problems: [...new Set(problems)], notes: [`the planted program fails the check: ${run.why.join('; ')}`] };
}

// ------------------------------------------------------------------ criterion 8: the record

/** Every `{ file, sha256 }` the record cites, anywhere in it. */
function citations(value, found = []) {
  if (Array.isArray(value)) value.forEach((each) => citations(each, found));
  else if (isObj(value)) {
    if (typeof value.file === 'string' && 'sha256' in value) found.push(value);
    Object.values(value).forEach((each) => citations(each, found));
  }
  return found;
}

/**
 * The record names, for every gate, the reading, its machine and its load, each equal to what the raw reading gives,
 * and ends in one line per arm, the one its gates give: fallback, closed with the failed gates, or INCONCLUSIVE with
 * an unrun gate. The gates are the ones fixed first, the folder holds the record, the gates and the raw readings and
 * nothing else, and the record calls the second toolkit the candidate. An arm that ends INCONCLUSIVE is not a pass.
 */
export function recordProblems(record, dir = REPO) {
  const problems = [...baseProblems(record)];
  if (record?.spike !== ISSUE) problems.push(`spike is ${json(record?.spike)}, not ${ISSUE}`);
  const gatesFile = kept(dir, 'gates.json');
  if (gatesFile === null) problems.push(`${SPIKE}/gates.json (the gates, fixed before the first run) is not kept`);
  else if (!gatesFile.equals(GATES_BYTES)) problems.push(`${SPIKE}/gates.json is not tests/acceptance/${ISSUE}/gates.json byte for byte: the gates are fixed before the first run`);
  if (record?.gates?.file !== 'gates.json' || record?.gates?.sha256 !== GATES_SHA256) problems.push(`gates is ${json(record?.gates)}, not gates.json with the sha256 ${GATES_SHA256}`);
  const arms = isObj(record?.arms) ? record.arms : {};
  if (!same(Object.keys(arms), ARMS)) problems.push(`arms are ${json(Object.keys(arms))}, not ${json(ARMS)}: the record calls the second toolkit the candidate`);
  const pin = arms.candidate?.pin;
  if (!/^[0-9a-f]{40,64}$/.test(pin?.revision ?? '') || !isHex64(pin?.mirror?.sha256)) problems.push('arms.candidate.pin names no pinned and mirrored revision: revision (the commit, in full) and mirror.sha256 (the mirrored source\'s)');
  const { gates, lines } = evaluate(record, dir);
  for (const arm of ARMS) {
    if (!isHex64(arms[arm]?.harness?.sha256)) problems.push(`arms[${json(arm)}].harness.sha256 (the harness binary's) is missing`);
    for (const extra of Object.keys(arms[arm]?.gates ?? {}).filter((gate) => !GATES.arms[arm].includes(gate))) problems.push(`${arm}.${extra} is not a gate fixed before the first run`);
    for (const gate of GATES.arms[arm]) {
      const v = gates[arm][gate], entry = arms[arm]?.gates?.[gate], at = `${arm}.${gate}`;
      problems.push(...v.problems);
      if (!isObj(entry)) continue;
      if (!STATUSES.includes(entry.status)) problems.push(`${at}: status is ${json(entry.status)}, not ${STATUSES.join(', ')}`);
      else if (entry.status !== v.status) problems.push(`${at}: status is ${json(entry.status)}, but its kept reading gives ${v.status}${v.why.length ? `: ${v.why.join('; ')}` : ''}`);
      if (v.status === 'inconclusive' && !nonEmpty(entry.why)) problems.push(`${at}: a gate that reads INCONCLUSIVE says why (why)`);
      for (const key of ['reading', 'machine', 'load']) {
        if (v.unrun) { if (entry[key] != null) problems.push(`${at}: names a ${key} with no raw reading cited`); continue; }
        if (entry[key] == null) problems.push(`${at}: the record names no ${key} for the gate`);
        else if (v[key] !== null && !same(entry[key], v[key])) problems.push(`${at}: ${key} is ${json(entry[key])}; its raw reading gives ${json(v[key])}`);
      }
    }
    if (record?.lines?.[arm] !== lines[arm]) problems.push(`lines[${json(arm)}] is ${json(record?.lines?.[arm])}; its gates give ${json(lines[arm])}`);
  }
  if (Object.keys(record ?? {}).at(-1) !== 'lines' || !same(Object.keys(record?.lines ?? {}), ARMS)) problems.push(`the record doesn't end in lines, one line per arm (${ARMS.join(', ')})`);
  // Nothing added to main but the record and its raw readings.
  const cites = citations(record);
  for (const cite of cites) problems.push(...cited(dir, cite, 'the record').problems);
  const named = new Set(['record.json', 'gates.json', 'README.md', ...cites.map((cite) => cite.file)]);
  const root = join(dir, SPIKE);
  for (const file of existsSync(root) ? readdirSync(root, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath, e.name).slice(root.length + 1)) : []) {
    if (!named.has(file)) problems.push(`${SPIKE}/${file} is neither the record, the gates nor a file the record cites: the spike adds its record and raw readings, and nothing else`);
  }
  if (existsSync(join(dir, 'spikes', String(ISSUE)))) problems.push(`spikes/${ISSUE}/ is in the checkout: the harness is throwaway and outside the workspace, and isn't added to main`);
  const wellFormed = problems.length === 0;
  for (const arm of ARMS) if (wellFormed && lines[arm].startsWith('INCONCLUSIVE')) problems.push(`INCONCLUSIVE: the ${arm} arm ends ${json(lines[arm])}: ${GATES.arms[arm].filter((gate) => gates[arm][gate].status === 'inconclusive').map((gate) => `${gate} (${gates[arm][gate].why.join('; ')})`).join('; ')}`);
  return [...new Set(problems)];
}

// ------------------------------------------------------------------ criterion 9: the gpui-fast arm's record

/**
 * The gpui-fast arm names its version, with the checksum Cargo.lock pins for each copied crate, and every carried
 * hunk of the gpui trees at the record's base, each by its mark; and a gate of the arm read through the replica reads
 * INCONCLUSIVE in the record, with the arm never ending fallback.
 */
export function gpuiFastProblems(record, dir = REPO) {
  const based = baseProblems(record), arm = record?.arms?.['gpui-fast'], g = GATES.gpui_fast;
  if (based.length || !isObj(arm)) return [...based, ...(isObj(arm) ? [] : ['arms["gpui-fast"] is missing'])];
  const problems = [];
  if (arm.version !== g.version) problems.push(`arms["gpui-fast"].version is ${json(arm.version)}: the arm's record names its version, ${g.version}`);
  for (const crate of g.copies) {
    const pinned = lockedAt(record.base, crate, g.version);
    if (!pinned) problems.push(`BLOCKED: Cargo.lock at base ${record.base} pins no ${crate} ${g.version}`);
    else if (arm.copies?.[crate] !== pinned) problems.push(`arms["gpui-fast"].copies[${json(crate)}] is ${json(arm.copies?.[crate])}, not the checksum Cargo.lock pins for ${crate} ${g.version}, ${pinned}`);
  }
  const carried = carriedAt(record.base);
  if (!carried?.length) problems.push(`BLOCKED: the carried hunks of ${g.carried_trees.join(', ')} can't be listed at base ${record.base}`);
  else {
    const named = list(arm.carry).map((h) => `${h?.file}:${h?.line}#${h?.issue}`);
    const left = carried.filter((hunk) => !named.includes(hunk)), extra = named.filter((hunk) => !carried.includes(hunk));
    if (left.length) problems.push(`arms["gpui-fast"].carry leaves out ${left.length} of the ${carried.length} carried hunks, first ${left[0]}`);
    if (extra.length) problems.push(`arms["gpui-fast"].carry names ${extra.length} hunks the carry at base ${record.base.slice(0, 9)} doesn't hold, first ${extra[0]}`);
    if (new Set(named).size !== named.length) problems.push('arms["gpui-fast"].carry names a hunk twice');
  }
  const { gates } = evaluate(record, dir);
  for (const gate of GATES.arms['gpui-fast']) {
    const v = gates['gpui-fast'][gate];
    if (v.replica === null) continue;
    if (arm.gates?.[gate]?.status !== 'inconclusive') problems.push(`gpui-fast.${gate}: its reading was taken through the ${v.replica}, so it reads INCONCLUSIVE; the record says ${json(arm.gates?.[gate]?.status)}`);
    if (record?.lines?.['gpui-fast'] === 'fallback') problems.push(`lines["gpui-fast"] is "fallback" with ${gate} read through the ${v.replica}`);
  }
  return problems;
}
