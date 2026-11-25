// Shared by the #3445 acceptance tests (spike: what a sandboxed program costs that the fuel doesn't count): reads the
// spike's record (docs/spikes/3445/record.json), the run outputs it cites and the spike's report (README.md), and
// recomputes from the raw rows everything a test can recompute instead of taking the spike's word (AGENTS.md,
// invariant 1). What the base gives (the shipped packs, the metering record, the logic goldens) is read from this
// checkout's history at the record's `main`, never from the spike's folder. Each check returns a list of problems; an
// empty list means it holds. Something missing is BLOCKED and a reading that can't decide is INCONCLUSIVE, each a
// problem, never a pass (invariant 2). Formats: README.md, "The surface under test".
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const SPIKE = 'docs/spikes/3445';
export const ISSUE = 3445;

// The issue's own values. None is a number this suite measured.
/** "read five times"; "5 runs". */
export const READINGS = 5;
/** "20 steps". */
export const STEPS = 20;
/** "the times sum to within 5%". */
export const WITHIN = 0.05;
/** "waits more than 1 s on compiling", in ms. */
export const COMPILING_MS = 1000;
/** "the checks cost a live step more than 5%". */
export const CHECKS_SHARE = 0.05;
/** "more than twice the record's ns per fuel unit". */
export const WRITES_TIMES = 2;

/** "The record": the metering benchmark's, and the benchmark that writes it. */
export const METERING = 'crates/deep-logic/metering.json';
export const BENCHMARK = 'benchmarks/logic.mjs';
/** Where `Program::new` counts a compile and sets `epoch_interruption(true)` for every program. */
export const ENGINE = 'crates/deep-sandbox-wasmtime/src/lib.rs';
/** The logic goldens the base keeps as files with their step hashes (README: Readings, "every golden of the logic kit"). */
export const GOLDENS = ['tests/acceptance/2324/fixtures/base-golden.json', 'tests/acceptance/2662/fixtures/golden.json'];
/** The design's reference Macs (Numbers version 0 has to hold: The reference Macs), as scripts/benchmark.mjs lists them. */
export const REFERENCES = [
  { model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30, cores: 12 },
  { model: 'Mac15,12', chip: 'Apple M3', memoryBytes: 16 * 2 ** 30, cores: 8 },
  { model: 'Mac17,10', chip: 'Apple M5 Max', memoryBytes: 64 * 2 ** 30, cores: 18 },
];
const HARDWARE = ['model', 'chip', 'memoryBytes'];

/**
 * Criterion 4's three questions, each in the issue's words: the report's line states the clause, a colon, and yes or no.
 * `over` works the answer out from the readings; `says` puts them in a sentence.
 */
export const QUESTIONS = [
  { key: 'compiling', clause: 'the first reply waits more than 1 s on compiling', fields: ['ms'],
    over: (r) => r.ms > COMPILING_MS, says: (r) => `${r.ms} ms inside the calls the compile counter counts, against ${COMPILING_MS} ms` },
  { key: 'checks', clause: 'the checks cost a live step more than 5%', fields: ['in', 'out'],
    over: (r) => r.in > (1 + CHECKS_SHARE) * r.out, says: (r) => `${r.in} ns per fuel unit with the checks in against ${r.out} with them out, ${((r.in / r.out - 1) * 100).toFixed(2)}% more` },
  { key: 'writes', clause: 'a step that mostly writes costs more than twice the record\'s ns per fuel unit', fields: ['ns_per_fuel', 'record'],
    over: (r) => r.ns_per_fuel > WRITES_TIMES * r.record, says: (r) => `${r.ns_per_fuel} ns per fuel unit against twice the record's ${r.record}` },
];

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
/** The median as the metering benchmark takes it (benchmarks/logic.mjs): the middle of the sorted readings, the upper of two. */
export const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
/** The benchmark's rounding of the record's ns per fuel unit: three decimals. */
export const round3 = (x) => Math.round(x * 1000) / 1000;
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const isCommit = (v) => /^[0-9a-f]{40}$/.test(v ?? '');
const isHash = (v) => /^[0-9a-f]{64}$/.test(v ?? '');
const close = (a, b, tolerance = 1e-6) => finite(a) && finite(b) && Math.abs(a - b) <= tolerance;
const show = (v) => (v === undefined ? 'missing' : JSON.stringify(v));
/** A path a record may name: relative, no `..`, no absolute folder. */
const relative = (p) => nonEmpty(p) && !p.startsWith('/') && !p.startsWith('~') && !p.split('/').includes('..') && !/^[A-Za-z]:/.test(p);

// ------------------------------------------------------------------ what is kept

/** The record, or the problems that kept it from being read. `dir` is the checkout holding docs/spikes/3445/. */
export function loadRecord(dir = REPO) {
  const path = join(dir, SPIKE, 'record.json');
  if (!existsSync(path)) return { problems: [`BLOCKED: no spike record at ${SPIKE}/record.json: the spike hasn't been recorded`] };
  try {
    const record = JSON.parse(readFileSync(path, 'utf8'));
    return isObj(record) ? { record, problems: [] } : { problems: [`BLOCKED: ${SPIKE}/record.json is not a JSON object`] };
  } catch (error) {
    return { problems: [`BLOCKED: ${SPIKE}/record.json is not JSON: ${error.message}`] };
  }
}

/** A file of the spike folder as text, by a path relative to it, or null. */
export function spikeText(dir, file) {
  if (!relative(file)) return null;
  const path = join(dir, SPIKE, file);
  return existsSync(path) && statSync(path).isFile() ? readFileSync(path, 'utf8') : null;
}

/** A file the record cites as `{ <key>, sha256 }`: its text, pinned by its sha256, or the problems. */
function kept(dir, ref, at, key = 'out') {
  if (!isObj(ref)) return { problems: [`BLOCKED: ${at}: missing from the record`] };
  if (!relative(ref[key])) return { problems: [`BLOCKED: ${at}: ${key} ${show(ref[key])} is not a path relative to ${SPIKE}/`] };
  const text = spikeText(dir, ref[key]);
  if (text === null) return { problems: [`BLOCKED: ${at}: ${ref[key]} is not kept with the spike`] };
  return { text, problems: ref.sha256 === sha256(text) ? [] : [`BLOCKED: ${at}: sha256 of ${ref[key]} is not what the record says`] };
}

/** A kept run output that is one JSON object. */
function keptJson(dir, ref, at) {
  const { text, problems } = kept(dir, ref, at);
  if (text === undefined) return { problems };
  try {
    const out = JSON.parse(text);
    return isObj(out) ? { out, problems } : { problems: [...problems, `BLOCKED: ${at}: ${ref.out} is not a JSON object`] };
  } catch (error) {
    return { problems: [...problems, `BLOCKED: ${at}: ${ref.out} is not JSON: ${error.message}`] };
  }
}

// ------------------------------------------------------------------ what the base gives, at the record's main

/** Git in this checkout, with nothing from the caller's environment pointing it elsewhere. Read-only calls. */
export function git(...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  return spawnSync('git', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 2 ** 28 });
}

const files = new Map();
/** The text of a file at a commit of this checkout's history, or null. */
export function fileAt(commit, file) {
  const key = `${commit}:${file}`;
  if (!files.has(key)) {
    const shown = git('show', key);
    files.set(key, shown.status === 0 ? shown.stdout : null);
  }
  return files.get(key);
}

function mainProblems(record) {
  if (!isCommit(record?.main)) return ['BLOCKED: main is not the full hash of the main commit the readings ran on'];
  if (git('cat-file', '-e', `${record.main}^{commit}`).status !== 0) return [`BLOCKED: main ${record.main} is not a commit this checkout's git has`];
  if (git('merge-base', '--is-ancestor', record.main, 'HEAD').status !== 0) return [`main ${record.main} is not an ancestor of HEAD`];
  return [];
}

const shipped = new Map();
/**
 * The packs a release ships, at `main`: each folder of packs/ that holds a pack.json (packages/hub/src/packs.ts,
 * releasePacks), by the reference the hub gives it, `deepbuild/<name>@<version>`. `compiles` says the core's pack check
 * runs programs of it: it carries libraries or interfaces (crates/deep-show/src/sandbox.rs, vet_libs).
 */
export function shippedPacks(main) {
  if (shipped.has(main)) return shipped.get(main);
  const listed = git('ls-tree', '-r', '--name-only', main, '--', 'packs');
  const packs = [];
  const problems = listed.status === 0 ? [] : [`BLOCKED: packs/ can't be listed at main ${String(main).slice(0, 9)}`];
  for (const path of listed.status === 0 ? listed.stdout.split('\n') : []) {
    const [, folder] = /^packs\/([^/]+)\/pack\.json$/.exec(path) ?? [];
    if (!folder) continue;
    try {
      const m = JSON.parse(fileAt(main, path));
      const id = typeof m.id === 'string' ? m.id : `deepbuild/${m.name}`;
      packs.push({ folder, ref: `${id}@${m.version}`, name: `${m.name}@${m.version}`, compiles: ['libs', 'interfaces'].some((k) => isObj(m[k]) && Object.keys(m[k]).length > 0) });
    } catch (error) {
      problems.push(`BLOCKED: ${path} at main ${main.slice(0, 9)} can't be read: ${error.message}`);
    }
  }
  if (!packs.length && !problems.length) problems.push(`BLOCKED: main ${main.slice(0, 9)} ships no pack under packs/`);
  const found = { packs, problems };
  shipped.set(main, found);
  return found;
}

/** The metering record at `main`: its ns per fuel unit in the app, its fuel and its engine. */
export function meteringAt(main) {
  const text = fileAt(main, METERING);
  if (text === null) return { problems: [`BLOCKED: ${METERING} is not in main ${String(main).slice(0, 9)}`] };
  try {
    const rec = JSON.parse(text);
    const ok = finite(rec?.ns_per_fuel?.app) && rec.ns_per_fuel.app > 0 && Number.isInteger(rec?.fuel?.bench) && Number.isInteger(rec?.fuel?.twin) && nonEmpty(rec?.engines?.app);
    return ok ? { rec, problems: [] } : { problems: [`BLOCKED: ${METERING} at main ${main.slice(0, 9)} doesn't give ns_per_fuel.app, fuel and engines.app`] };
  } catch (error) {
    return { problems: [`BLOCKED: ${METERING} at main ${main.slice(0, 9)} is not JSON: ${error.message}`] };
  }
}

// ------------------------------------------------------------------ what a time read on this machine may decide

const reference = (print) => REFERENCES.find((r) => HARDWARE.every((key) => print?.[key] === r[key]));

/**
 * The issue's `Runs on:` line and the design's rule for a result (The reference Macs; parallel-proof, sections 6 and
 * 12a), on one run the record takes as a result: a reference Mac, on mains power, Low Power Mode off, the thermal state
 * nominal, the macOS build recorded; taken under the machine's timed grant, which is exclusive of every other grant
 * ("no other job holding a lease"); and the 1-minute load at its start and its end no higher than that Mac's cores.
 * Anything else is a reading, and the criterion is INCONCLUSIVE, naming the run.
 */
function conditionProblems(run, print, at) {
  const off = [];
  const mac = reference(print);
  if (!mac) off.push(`${HARDWARE.map((key) => `${key} ${show(print?.[key])}`).join(', ')} is none of the reference Macs (${REFERENCES.map((r) => r.model).join(', ')})`);
  for (const [key, want, label] of [['power', 'ac', 'power'], ['lowPowerMode', false, 'Low Power Mode'], ['thermalState', 'nominal', 'the thermal state']]) {
    if (print?.[key] !== want) off.push(`${label} is ${show(print?.[key])}, not ${JSON.stringify(want)}`);
  }
  if (!nonEmpty(print?.macosBuild)) off.push('the macOS build is not recorded');
  if (!/^timed:[0-9a-f]+$/.test(run?.lease ?? '')) off.push(`lease is ${show(run?.lease)}, not a timed grant of scripts/throttle.mjs (timed:<id>, what DEEP_THROTTLE holds under one): the readings are taken with no other job holding a lease`);
  for (const when of ['start', 'end']) {
    const load = run?.load?.[when];
    if (!Array.isArray(load) || load.length !== 3 || !load.every((x) => finite(x) && x >= 0)) off.push(`load.${when} is not the 1, 5 and 15 minute load averages`);
    else if (mac && load[0] > mac.cores) off.push(`the 1-minute load ${load[0]} at the run's ${when} is above the ${mac.cores} cores of ${mac.model}: a loaded run counts neither way`);
  }
  return off.map((why) => `INCONCLUSIVE: ${at}: a reading, not a result: ${why}`);
}

/** "Every reading is from one machine": the runs' fingerprints name the same hardware. */
function oneMachineProblems(prints) {
  const named = prints.filter(([, print]) => isObj(print));
  const [first] = named;
  return named.slice(1).filter(([, print]) => HARDWARE.some((key) => print[key] !== first[1][key]))
    .map(([at, print]) => `INCONCLUSIVE: ${at} ran on ${HARDWARE.map((key) => show(print[key])).join(' ')} and ${first[0]} on ${HARDWARE.map((key) => show(first[1][key])).join(' ')}: every reading is from one machine`);
}

const commandProblems = (run, at, names = []) => {
  if (!nonEmpty(run?.command)) return [`${at}: command (the command that took the run) is missing`];
  return names.filter((name) => !run.command.includes(name)).map((name) => `${at}: command ${JSON.stringify(run.command)} doesn't name ${name}`);
};

// ------------------------------------------------------------------ the canvas core's runs (criteria 1 and 2)

/**
 * A kept output of the spike's runs of the canvas core (README: the canvas core's run output): the machine, the packs
 * its world held, which must be the packs main ships, and one row for each reply it timed.
 */
function coreOut(dir, run, at, main) {
  const { out, problems } = keptJson(dir, run, at);
  if (!out) return { problems };
  const here = `${at} (${run.out})`;
  const { packs, problems: unread } = shippedPacks(main);
  problems.push(...unread);
  if (!Array.isArray(out.packs)) problems.push(`${here}: packs (the packs the core's world held) is missing`);
  else if (!unread.length) {
    for (const { ref } of packs) if (!out.packs.includes(ref)) problems.push(`${here}: the core's world didn't hold the shipped pack ${ref}`);
    for (const ref of out.packs) if (!packs.some((p) => p.ref === ref)) problems.push(`${here}: the core's world held ${show(ref)}, which is none of the ${packs.length} packs main ships`);
  }
  const replies = list(out.replies);
  if (!replies.length) problems.push(`BLOCKED: ${here}: replies holds no timed reply`);
  replies.forEach((r, i) => {
    const row = `${here}, replies[${i}] (pid ${show(r?.pid)}, reply ${show(r?.reply)})`;
    if (!Number.isInteger(r?.pid) || r.pid < 1) problems.push(`${row}: pid is not a process ID`);
    if (!Number.isInteger(r?.reply) || r.reply < 1) problems.push(`${row}: reply is not which of its process's replies was timed, from 1`);
    if (!nonEmpty(r?.build?.profile)) problems.push(`${row}: build.profile (the build's own word for its Cargo profile) is missing`);
    if (![r?.startedMs, r?.repliedMs].every(finite)) problems.push(`${row}: startedMs and repliedMs must be numbers`);
    else if (r.startedMs > r.repliedMs) problems.push(`${row}: started ${r.startedMs} is after replied ${r.repliedMs}`);
  });
  return { out, replies: replies.filter((r) => Number.isInteger(r?.pid) && Number.isInteger(r?.reply) && [r?.startedMs, r?.repliedMs].every(finite)), problems };
}

/** Why a timed reply is a reading and never the result: it isn't its process's first, or its build isn't release. */
function readingOnly(row) {
  const why = [];
  if (row.reply !== 1) why.push(`is from a warm process, which had answered ${row.reply - 1} call${row.reply === 2 ? '' : 's'} before it`);
  if (row.build?.profile !== 'release') why.push(`is from a ${row.build?.profile ?? 'unnamed'} build, not a release build`);
  return why;
}

/**
 * Criterion 2: the first reply's time is read five times, each from a fresh process of a release build. The record's
 * `firstReply.result` names five replies of the kept output: five processes, each one's first reply, each a release
 * build's, each time recomputed from the row. A dev build's reading or a warm process's among them fails, naming it.
 */
export function firstReplyProblems(record, dir = REPO) {
  const problems = [...mainProblems(record)];
  if (problems.some((p) => p.startsWith('BLOCKED'))) return problems;
  const at = 'firstReply';
  const run = record.firstReply;
  problems.push(...(isObj(run) ? commandProblems(run, at) : []));
  const { out, replies, problems: read } = coreOut(dir, run, at, record.main);
  problems.push(...read);
  if (!out) return problems;
  problems.push(...conditionProblems(run, out.fingerprint, at));
  const result = list(run.result);
  if (result.length !== READINGS) problems.push(`${at}.result holds ${result.length} reading${result.length === 1 ? '' : 's'}, not ${READINGS}: the first reply's time is read five times`);
  const taken = new Set();
  result.forEach((entry, i) => {
    const here = `${at}.result[${i}]`;
    const row = replies.find((r) => r.pid === entry?.pid && r.reply === entry?.reply);
    if (!row) { problems.push(`BLOCKED: ${here}: ${run.out} holds no reply ${show(entry?.reply)} of pid ${show(entry?.pid)}: a reading that isn't there`); return; }
    const name = `pid ${row.pid}'s reply ${row.reply}`;
    for (const why of readingOnly(row)) problems.push(`${here}: ${name} ${why}: a reading, never the result`);
    if (taken.has(row.pid)) problems.push(`${here}: pid ${row.pid} is taken twice: five readings are five fresh processes`);
    taken.add(row.pid);
    const ms = row.repliedMs - row.startedMs;
    if (!close(entry.ms, ms)) problems.push(`${here}.ms is ${show(entry.ms)}, ${run.out} gives ${ms} for ${name} (repliedMs - startedMs)`);
  });
  return problems;
}

/**
 * The run the compile table is read from: the first reply of the process `compile.pid` names, a release build's, with
 * the compile counter's value at that reply (`compiles`), the time the process spent inside the calls it counts
 * (`compileNs`) and one row for each such call (`programs`).
 */
function compileRun(record, dir) {
  const at = 'compile';
  const run = record.compile;
  const problems = isObj(run) ? commandProblems(run, at) : [];
  const { out, replies, problems: read } = coreOut(dir, run, at, record.main);
  problems.push(...read);
  if (!out) return { problems };
  problems.push(...conditionProblems(run, out.fingerprint, at));
  const row = replies.find((r) => r.pid === run.pid && r.reply === 1);
  if (!row) return { out, problems: [...problems, `BLOCKED: ${at}.pid ${show(run.pid)}: ${run.out} holds no first reply of that process`] };
  if (row.build?.profile !== 'release') problems.push(`${at}: pid ${row.pid}'s reply 1 is from a ${row.build?.profile ?? 'unnamed'} build, not a release build: a reading, never the result`);
  const here = `${at} (${run.out}, pid ${row.pid})`;
  if (!Number.isInteger(row.compiles) || row.compiles < 0 || !finite(row.compileNs) || row.compileNs < 0 || !Array.isArray(row.programs)) {
    return { out, problems: [...problems, `BLOCKED: ${here}: the reply carries no compiles (the compile counter's value), compileNs (the time inside the calls it counts) and programs (a row for each): the run's compile times weren't read`] };
  }
  row.programs.forEach((p, i) => {
    if (!(p?.pack === null || nonEmpty(p?.pack)) || !isHash(p?.program) || !finite(p?.ns) || p.ns < 0) problems.push(`${here}: programs[${i}] is not { pack (a shipped pack's reference, or null), program (64 hex digits), ns }`);
  });
  const calls = row.programs.filter((p) => (p?.pack === null || nonEmpty(p?.pack)) && isHash(p?.program) && finite(p?.ns) && p.ns >= 0);
  return { run, out, row, calls, problems };
}

/**
 * Criterion 1: the report gives each shipped pack's programs with their compile times, and the times sum to within 5%
 * of the time the same run spends inside the calls the compile counter counts. Recomputed from the run's own rows, one
 * for each counted call: every program a row holds for a shipped pack is in the table with its count and its time, the
 * table names every pack main ships, and its times are summed against the run's own total. A program the rows hold and
 * the table doesn't fails, naming it.
 */
export function compileTableProblems(record, dir = REPO) {
  const problems = [...mainProblems(record)];
  if (problems.some((p) => p.startsWith('BLOCKED'))) return problems;
  const { run, row, calls, problems: read } = compileRun(record, dir);
  problems.push(...read);
  if (!row) return problems;
  const { packs } = shippedPacks(record.main);
  const at = 'compile';
  const totalMs = row.compileNs / 1e6;
  if (row.programs.length !== row.compiles) problems.push(`${at}: the run counted ${row.compiles} compiles and ${run.out} holds ${row.programs.length} rows: every call the compile counter counts has a row`);
  if (run.compiles !== row.compiles) problems.push(`${at}.compiles is ${show(run.compiles)}, ${run.out} gives ${row.compiles}`);
  if (!close(run.ms, totalMs)) problems.push(`${at}.ms (the run's own total, beside the table) is ${show(run.ms)}, ${run.out} gives ${totalMs}`);

  // The rows by pack and program: how often each was compiled, and the time inside those calls.
  const raw = new Map();
  for (const call of calls) {
    if (call.pack !== null && !packs.some((p) => p.ref === call.pack)) { problems.push(`${at}: a counted call names the pack ${show(call.pack)}, which is none of the packs main ships`); continue; }
    const key = `${call.pack}\u0000${call.program}`;
    const seen = raw.get(key) ?? { pack: call.pack, program: call.program, compiles: 0, ns: 0 };
    raw.set(key, { ...seen, compiles: seen.compiles + 1, ns: seen.ns + call.ns });
  }
  const table = isObj(run.packs) ? run.packs : {};
  if (!isObj(run.packs)) problems.push(`${at}.packs (the table: each shipped pack's programs with their compile times) is missing`);
  for (const ref of Object.keys(table)) if (!packs.some((p) => p.ref === ref)) problems.push(`${at}.packs names ${ref}, which is none of the ${packs.length} packs main ships`);
  const listed = new Set();
  let sumMs = 0;
  for (const pack of packs) {
    const rows = table[pack.ref];
    if (isObj(run.packs) && !Array.isArray(rows)) problems.push(`${at}.packs: the table leaves out the shipped pack ${pack.ref} (a pack that compiles nothing has an empty list)`);
    for (const [i, entry] of list(rows).entries()) {
      const here = `${at}.packs["${pack.ref}"][${i}]`;
      if (!isHash(entry?.program)) { problems.push(`${here}: program is not the 64 hex digits of the sha256 of the bytes compiled`); continue; }
      const key = `${pack.ref}\u0000${entry.program}`;
      if (listed.has(key)) problems.push(`${here}: program ${entry.program} is listed twice`);
      listed.add(key);
      if (finite(entry.ms)) sumMs += entry.ms;
      const counted = raw.get(key);
      if (!counted) { problems.push(`${here}: program ${entry.program} has no counted call in ${run.out}`); continue; }
      if (entry.compiles !== counted.compiles) problems.push(`${here}.compiles is ${show(entry.compiles)}, ${run.out} holds ${counted.compiles} counted call${counted.compiles === 1 ? '' : 's'} of ${entry.program}`);
      if (!close(entry.ms, counted.ns / 1e6)) problems.push(`${here}.ms is ${show(entry.ms)}, ${run.out} gives ${counted.ns / 1e6} for ${entry.program}`);
    }
    // The core's check of a pack with libraries or interfaces compiles and runs its fixtures (sandbox.rs, vet_libs).
    if (pack.compiles && Array.isArray(rows) && !rows.length) problems.push(`${at}.packs: ${pack.ref} carries libraries or interfaces, whose fixtures the core's pack check compiles and runs, and the table gives it no program`);
  }
  for (const { pack, program, compiles, ns } of raw.values()) {
    if (pack !== null && !listed.has(`${pack}\u0000${program}`)) problems.push(`${at}.packs: the table leaves out program ${program} of ${pack} (${compiles} counted call${compiles === 1 ? '' : 's'}, ${ns / 1e6} ms in ${run.out})`);
  }
  if (Math.abs(sumMs - totalMs) > WITHIN * totalMs) {
    const outside = [...raw.values()].filter((r) => r.pack === null);
    const named = outside.length ? `; ${outside.length} program${outside.length === 1 ? ' was' : 's were'} compiled outside every shipped pack's check: ${outside.slice(0, 10).map((r) => `${r.program} (${r.ns / 1e6} ms)`).join(', ')}` : '';
    problems.push(`${at}: the table's times sum to ${sumMs} ms, ${(Math.abs(sumMs / totalMs - 1) * 100).toFixed(1)}% ${sumMs < totalMs ? 'under' : 'over'} the ${totalMs} ms the same run spent inside the ${row.compiles} calls the compile counter counts; they sum to within ${WITHIN * 100}%${named}`);
  }

  const readme = spikeText(dir, 'README.md');
  if (readme === null) problems.push(`BLOCKED: ${SPIKE}/README.md (the report) is missing`);
  else {
    for (const pack of packs) {
      if (!readme.includes(pack.name)) problems.push(`README.md's table leaves out the shipped pack ${pack.name}`);
      for (const entry of list(table[pack.ref])) if (isHash(entry?.program) && !readme.includes(entry.program.slice(0, 12))) problems.push(`README.md's table leaves out program ${entry.program.slice(0, 12)} of ${pack.name}`);
    }
  }
  return problems;
}

// ------------------------------------------------------------------ ns per fuel unit (criteria 3 and 4)

/** A kept reading of ns per fuel unit, in the shape the metering benchmark prints and writes: its app runs, each a finite number above 0. */
function benchOut(dir, run, at, names = []) {
  const problems = isObj(run) ? commandProblems(run, at, names) : [];
  const { out, problems: read } = keptJson(dir, run, at);
  problems.push(...read);
  if (!out) return { problems };
  const here = `${at} (${run.out})`;
  problems.push(...conditionProblems(run, out.fingerprint, at));
  if (out.build?.profile !== 'release') problems.push(`${here}: build.profile is ${show(out.build?.profile)}, not "release": a reading, never the result`);
  const runs = out.runs?.app;
  if (!Array.isArray(runs) || !runs.length || !runs.every((x) => finite(x) && x > 0)) return { out, problems: [...problems, `BLOCKED: ${here}: runs.app holds no readings of ns per fuel unit in the app`] };
  return { out, runs, problems };
}

/**
 * "Read by the metering benchmark as the record's was, 20 steps and 5 runs": the output is the benchmark's own, with
 * the record's 20 steps and five app runs, its ns per fuel unit the benchmark's median of them, on the record's engine,
 * and charging the benchmark program and its twin the fuel the record holds, since the rewrite counts fuel and the
 * engine's settings can't move it.
 */
function asTheRecordsProblems(out, runs, at, rec) {
  const problems = [];
  if (out.steps !== STEPS) problems.push(`${at}: steps is ${show(out.steps)}, not the record's ${STEPS}`);
  if (runs.length !== READINGS) problems.push(`${at}: runs.app holds ${runs.length} run${runs.length === 1 ? '' : 's'}, not the record's ${READINGS}`);
  if (out.ns_per_fuel?.app !== round3(median(runs))) problems.push(`${at}: ns_per_fuel.app is ${show(out.ns_per_fuel?.app)}, and the benchmark's median of its runs.app is ${round3(median(runs))}`);
  if (!rec) return problems;
  for (const key of ['bench', 'twin']) if (out.fuel?.[key] !== rec.fuel[key]) problems.push(`${at}: fuel.${key} is ${show(out.fuel?.[key])}, not the ${rec.fuel[key]} the record's benchmark program is charged: the rewrite counts fuel, not the engine`);
  if (out.engines?.app !== rec.engines.app) problems.push(`${at}: engines.app is ${show(out.engines?.app)}, not the record's ${JSON.stringify(rec.engines.app)}`);
  return problems;
}

/** One side of the epoch reading (`in` or `out`): the benchmark's kept output, held to the record's way of reading. */
function epochSide(record, dir, side, rec) {
  const at = `epochs.${side}`;
  const { out, runs, problems } = benchOut(dir, record.epochs?.[side], at, [BENCHMARK]);
  if (runs) problems.push(...asTheRecordsProblems(out, runs, `${at} (${record.epochs[side].out})`, rec));
  return { out, runs, problems };
}

/**
 * The change that takes the epoch checks out, kept as a patch against main beside the report: in ENGINE it takes out
 * `epoch_interruption(true)`, and no line it adds can turn the checks on again, so every build of a copy it is applied
 * to has them out, whatever its features and environment.
 */
function patchProblems(dir, patch) {
  const at = 'epochs.patch';
  const { text, problems } = kept(dir, patch, at, 'path');
  if (text === undefined) return problems;
  let file = null;
  const removed = [], added = [];
  for (const line of text.split('\n')) {
    if (line.startsWith('+++ ')) file = line.slice(4).split('\t')[0].replace(/^[ab]\//, '');
    else if (line.startsWith('--- ')) file = null;
    else if (file === ENGINE && line.startsWith('-')) removed.push(line.slice(1));
    else if (line.startsWith('+')) added.push(line.slice(1));
  }
  if (!removed.some((line) => line.includes('epoch_interruption(true)'))) problems.push(`${at}: ${patch.path} doesn't take epoch_interruption(true) out of ${ENGINE}, where Program::new turns the epoch checks on for every program`);
  for (const line of added) {
    if (/epoch_interruption\s*\(/.test(line) && !/epoch_interruption\s*\(\s*false\s*\)/.test(line)) problems.push(`${at}: ${patch.path} adds ${JSON.stringify(line.trim())}, which can turn the checks on again: with the checks out, a program's engine sets epoch_interruption(false) or doesn't set it`);
  }
  return problems;
}

const firstDifference = (a, b) => { for (let k = 0; k < Math.max(a.length, b.length); k++) if (a[k] !== b[k]) return k; return -1; };

/**
 * Every golden of GOLDENS, replayed by a build with the checks out: the kept golden of the same piece, step for step
 * against the step hashes the golden holds at main. A hash that moves fails, naming the golden and the step.
 */
function goldenProblems(record, dir) {
  const problems = [];
  const replays = isObj(record.epochs?.goldens) ? record.epochs.goldens : {};
  for (const path of GOLDENS) {
    const at = `epochs.goldens["${path}"]`;
    const text = fileAt(record.main, path);
    let held;
    try { held = JSON.parse(text ?? 'null')?.golden?.step_hashes; } catch { held = undefined; }
    if (!isObj(held) || !Object.keys(held).length) { problems.push(`BLOCKED: the golden ${path} holds no step hashes at main ${record.main.slice(0, 9)}`); continue; }
    if (!isObj(replays[path])) { problems.push(`BLOCKED: ${at}: the golden ${path} wasn't replayed with the epoch checks out`); continue; }
    problems.push(...commandProblems(replays[path], at));
    const { out, problems: read } = keptJson(dir, replays[path], at);
    problems.push(...read);
    if (!out) continue;
    // deep-logic's reply to `golden` as it prints it, or the golden it holds.
    const now = isObj(out.golden) ? out.golden.step_hashes : out.step_hashes;
    if (!isObj(now)) { problems.push(`BLOCKED: ${at}: ${replays[path].out} holds no step_hashes: the golden wasn't replayed`); continue; }
    for (const id of Object.keys(held).sort()) {
      const k = firstDifference(list(now[id]), list(held[id]));
      if (k >= 0) problems.push(`golden ${path}: step ${k} of ${id} hashes ${list(now[id])[k] ?? 'nothing'} with the epoch checks out, and the golden holds ${list(held[id])[k] ?? 'nothing'}`);
    }
    for (const id of Object.keys(now)) if (!(id in held)) problems.push(`golden ${path}: the replay holds step hashes of ${id}, an item the golden doesn't have`);
  }
  return problems;
}

/**
 * Criterion 3: the ns per fuel unit with the epoch checks out is read by the metering benchmark as the record's was,
 * 20 steps and 5 runs, and every golden of the logic kit keeps its step hashes with them out.
 */
export function epochsOutProblems(record, dir = REPO) {
  const problems = [...mainProblems(record)];
  if (problems.some((p) => p.startsWith('BLOCKED'))) return problems;
  if (!isObj(record.epochs)) return [...problems, 'BLOCKED: epochs (the reading with the epoch checks out, the patch that takes them out and the goldens replayed) is missing from the record'];
  const { rec, problems: unread } = meteringAt(record.main);
  problems.push(...unread, ...patchProblems(dir, record.epochs.patch), ...epochSide(record, dir, 'out', rec).problems, ...goldenProblems(record, dir));
  return problems;
}

// ------------------------------------------------------------------ criterion 4: the three answers and their tasks

/** A filed task as the record holds it: its issue number, its title and its own criteria. */
function taskProblems(task, at) {
  const problems = [];
  if (!isObj(task) || !Number.isInteger(task.issue) || task.issue < 1 || task.issue === ISSUE) problems.push(`${at}.issue is not the number of a task filed apart from #${ISSUE}`);
  if (!nonEmpty(task?.title)) problems.push(`${at}.title is missing`);
  const criteria = list(task?.criteria);
  if (!criteria.length || !criteria.every(nonEmpty)) problems.push(`${at}.criteria (the task's own acceptance criteria) is missing or has an empty one`);
  return problems;
}

/** What the report states for a question, each time it does: the clause in the issue's words, a colon, then yes or no. */
export function stated(readme, clause) {
  const words = clause.split(/\s+/).map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/'/g, '[\'\u2019]'));
  return [...readme.matchAll(new RegExp(`${words.join('\\s+')}\\s*:\\s*[*_\`]*\\s*(yes|no)\\b`, 'gi'))].map(([, answer]) => answer.toLowerCase() === 'yes');
}

/**
 * Criterion 4: the report states, with its readings, whether the first reply waits more than 1 s on compiling, whether
 * the checks cost a live step more than 5%, and whether a step that mostly writes costs more than twice the record's
 * ns per fuel unit, and a task is filed for each that does. Each reading is recomputed from the kept runs, and each
 * answer worked out from them: the record's and the report's must be that answer, and each yes names its task.
 */
export function answersProblems(record, dir = REPO) {
  const problems = [...mainProblems(record)];
  if (problems.some((p) => p.startsWith('BLOCKED'))) return problems;
  const { rec, problems: unread } = meteringAt(record.main);
  problems.push(...unread);
  const compile = compileRun(record, dir);
  const sides = Object.fromEntries(['in', 'out'].map((side) => [side, isObj(record.epochs) ? epochSide(record, dir, side, rec) : { problems: [`BLOCKED: epochs.${side}: missing from the record`] }]));
  const writes = benchOut(dir, record.tracker?.logic, 'tracker.logic');
  problems.push(...compile.problems, ...sides.in.problems, ...sides.out.problems, ...writes.problems);
  problems.push(...oneMachineProblems([['compile', compile.out?.fingerprint], ['epochs.in', sides.in.out?.fingerprint], ['epochs.out', sides.out.out?.fingerprint], ['tracker.logic', writes.out?.fingerprint]]));
  if (sides.in.out && sides.out.out && ['bench', 'twin'].some((key) => sides.in.out.fuel?.[key] !== sides.out.out.fuel?.[key])) problems.push('epochs: the benchmark program is charged other fuel with the checks in than with them out, so the two readings aren\'t of the same fuel units');

  // Each question's readings, or null where a run that gives one is missing.
  const readings = {
    compiling: compile.row ? { ms: compile.row.compileNs / 1e6 } : null,
    checks: sides.in.runs && sides.out.runs ? { in: median(sides.in.runs), out: median(sides.out.runs) } : null,
    writes: writes.runs && rec ? { ns_per_fuel: median(writes.runs), record: rec.ns_per_fuel.app } : null,
  };
  const readme = spikeText(dir, 'README.md');
  if (readme === null) problems.push(`BLOCKED: ${SPIKE}/README.md (the report) is missing`);
  const answers = isObj(record.answers) ? record.answers : {};
  const filed = new Map();
  for (const { key, clause, fields, over, says } of QUESTIONS) {
    const at = `answers.${key}`;
    const answer = answers[key];
    if (!isObj(answer)) { problems.push(`${at} is missing: the report states whether ${clause}`); continue; }
    if (answer.task !== undefined && answer.task !== null) {
      problems.push(...taskProblems(answer.task, `${at}.task`));
      const n = answer.task?.issue;
      if (filed.has(n)) problems.push(`${at}.task is #${n}, the task ${filed.get(n)} names: a task is filed for each`);
      else if (Number.isInteger(n)) filed.set(n, at);
      if (readme !== null && Number.isInteger(n) && !new RegExp(`#${n}(?!\\d)`).test(readme)) problems.push(`README.md doesn't name the task #${n} filed for "${clause}"`);
    }
    const read = readings[key];
    if (!read) { problems.push(`BLOCKED: ${at}: its readings are missing, so whether ${clause} isn't decided`); continue; }
    // A milliseconds reading is held to 1e-6, an ns per fuel unit to 1e-9.
    for (const field of fields) if (!close(answer[field], read[field], field === 'ms' ? 1e-6 : 1e-9)) problems.push(`${at}.${field} is ${show(answer[field])}, the kept runs give ${read[field]}`);
    const does = over(read);
    const word = (yes) => (yes ? 'yes' : 'no');
    if (answer.over !== does) problems.push(`${at}.over is ${show(answer.over)}, and its own readings say ${word(does)}: ${says(read)}`);
    const lines = readme === null ? null : stated(readme, clause);
    if (lines && !lines.length) problems.push(`README.md has no line stating whether ${clause}: "${clause}: yes" or "${clause}: no"`);
    else if (lines && lines.some((yes) => yes !== does)) problems.push(`README.md says "${clause}: ${word(!does)}", and its own readings say ${word(does)}: ${says(read)}`);
    if (does && (answer.task === undefined || answer.task === null)) problems.push(`${at}: no task is filed, and ${clause}: ${says(read)}`);
  }
  return problems;
}
