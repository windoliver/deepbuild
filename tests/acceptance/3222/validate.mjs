// Shared by the #3222 acceptance tests: reads the spike's record (docs/spikes/3222/record.json) and the harness output
// it cites, and recomputes from them everything a test can recompute instead of taking the spike's word (AGENTS.md,
// invariant 1). Each check returns a list of problems; an empty list means it holds. Missing or unreadable input is a
// problem, never a pass (invariant 2). Formats: README.md, "Surface choices".
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const SPIKE = 'docs/spikes/3222';
export const HARNESS = `${SPIKE}/harness.mjs`;
export const ISSUE = 3222;

export const AC1 = 'AC1 #3222.74eeafb1';
export const AC2 = 'AC2 #3222.a59f91a3';
export const AC3 = 'AC3 #3222.ddd84c68';
export const AC4 = 'AC4 #3222.40f85375';

/** The issue's kinds of call: a whole revision, a patch of one value, a check, and a render-back in 2D and in 3D. */
export const KINDS = ['revision', 'patch', 'check', 'render_back_2d', 'render_back_3d'];
/** The issue's session counts for the table. */
export const COUNTS = [1, 4, 16];
/** The planted slow call's run: 15 sessions patching one value each. */
export const PATCHERS = 15;
/** The four things the issue says a call may read or write that another session's call could change. */
export const THINGS = ['document', 'shown', 'world', 'evidence'];

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const nonEmpty = (v) => typeof v === 'string' && v.trim().length > 0;
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const isCommit = (v) => /^[0-9a-f]{40}$/.test(v ?? '');
/** A path a record may name: relative, no `..`, no absolute folder. */
const relative = (p) => nonEmpty(p) && !p.startsWith('/') && !p.startsWith('~') && !p.split('/').includes('..') && !/^[A-Za-z]:/.test(p);

// ------------------------------------------------------------------ reading

/** The record, or the problems that kept it from being read. `dir` is the checkout holding docs/spikes/3222/. */
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

/** A file of the spike folder, by a path relative to it, or null. */
export function spikeText(dir, file) {
  if (!relative(file)) return null;
  const path = join(dir, SPIKE, file);
  return existsSync(path) && statSync(path).isFile() ? readFileSync(path, 'utf8') : null;
}

/** Git in this checkout, with nothing from the caller's environment pointing it elsewhere. */
export function git(...args) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  return spawnSync('git', args, { cwd: REPO, env, encoding: 'utf8', maxBuffer: 2 ** 28 });
}

/**
 * One kept harness output (README: the harness's output), named by a run of the record as `{ out, sha256 }`: its path
 * relative to the spike folder, pinned by its sha256. Returns the parsed output or the problems.
 */
export function readOut(dir, run, at) {
  if (!isObj(run)) return { problems: [`${at}: missing`] };
  if (!relative(run.out)) return { problems: [`${at}: out ${JSON.stringify(run.out)} is not a path relative to ${SPIKE}/`] };
  const text = spikeText(dir, run.out);
  if (text === null) return { problems: [`${at}: the harness output ${run.out} is not kept with the spike`] };
  const problems = [];
  if (run.sha256 !== sha256(text)) problems.push(`${at}: sha256 of ${run.out} is not what the record says`);
  let out;
  try { out = JSON.parse(text); } catch (error) { return { problems: [...problems, `${at}: ${run.out} is not JSON: ${error.message}`] }; }
  if (!isObj(out)) return { problems: [...problems, `${at}: ${run.out} is not a JSON object`] };
  problems.push(...outProblems(out, `${at} (${run.out})`));
  return { out, problems };
}

/** The harness output's own shape: the run's date, machine and load, and one row per call with its three times. */
export function outProblems(out, at) {
  const problems = [];
  if (!nonEmpty(out.date) || Number.isNaN(Date.parse(out.date))) problems.push(`${at}: date (when the run was taken, ISO 8601) is missing`);
  const m = out.machine;
  if (!isObj(m) || !nonEmpty(m.model) || !Number.isInteger(m.cpus) || m.cpus < 1 || !nonEmpty(m.os)) problems.push(`${at}: machine must name its model, cpus (a whole number) and os`);
  for (const when of ['start', 'end']) {
    const l = out.load?.[when];
    if (!Array.isArray(l) || l.length !== 3 || !l.every((x) => finite(x) && x >= 0)) problems.push(`${at}: load.${when} is not the 1, 5 and 15 minute load averages`);
  }
  const calls = list(out.calls);
  if (!calls.length) problems.push(`${at}: calls holds no call`);
  calls.forEach((c, i) => {
    const here = `${at}, call ${i} (${c?.session}/${c?.kind}/${c?.doc})`;
    if (!nonEmpty(c?.session) || !nonEmpty(c?.kind) || !nonEmpty(c?.doc)) problems.push(`${here}: session, kind and doc are required`);
    if (![c?.arrivedMs, c?.startedMs, c?.repliedMs].every(finite)) problems.push(`${here}: arrivedMs, startedMs and repliedMs must be numbers`);
    else if (!(c.arrivedMs <= c.startedMs && c.startedMs <= c.repliedMs)) problems.push(`${here}: arrived ${c.arrivedMs}, started ${c.startedMs}, replied ${c.repliedMs} are out of order`);
    if (c?.planted !== undefined && c.planted !== true) problems.push(`${here}: planted is true or absent`);
  });
  return problems;
}

export const waitOf = (c) => c.startedMs - c.arrivedMs;
export const serviceOf = (c) => c.repliedMs - c.startedMs;
/** Nearest rank: the smallest sample with at least p of the samples at or below it. */
export const percentile = (sorted, p) => sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)];
const close = (a, b) => finite(a) && Math.abs(a - b) <= 1e-6;
const sessionsOf = (calls) => [...new Set(calls.map((c) => c.session))];

/** Problems with the sessions of a run: `n` of them, and no document shared by two. */
function sessionProblems(calls, n, at) {
  const problems = [];
  const sessions = sessionsOf(calls);
  if (sessions.length !== n) problems.push(`${at}: ${sessions.length} sessions made calls, not ${n}`);
  const owner = new Map();
  for (const c of calls) {
    const was = owner.get(c.doc);
    if (was !== undefined && was !== c.session) problems.push(`${at}: document ${c.doc} is used by ${was} and ${c.session}; each session is on a document of its own`);
    owner.set(c.doc, c.session);
  }
  return [...new Set(problems)];
}

const commandProblems = (run, at, need) => {
  const cmd = run?.command;
  if (!nonEmpty(cmd)) return [`${at}: command (the command that took the run) is missing`];
  return [`harness.mjs`, ...need].filter((w) => !new RegExp(`(^|\\s|/)${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\s|$)`).test(cmd)).map((w) => `${at}: command ${JSON.stringify(cmd)} doesn't name ${w}`);
};

function mainProblems(record) {
  if (!isCommit(record?.main)) return ['main is not the full hash of the main commit the readings ran on'];
  if (git('cat-file', '-e', `${record.main}^{commit}`).status !== 0) return [`BLOCKED: main ${record.main} is not a commit this checkout's git has`];
  if (git('merge-base', '--is-ancestor', record.main, 'HEAD').status !== 0) return [`main ${record.main} is not an ancestor of HEAD`];
  return [];
}

// ------------------------------------------------------------------ criterion 1: the table

/**
 * For 1, 4 and 16 sessions: each kind of call's wait and service at the median and the 95th percentile, with the
 * machine and its load, recomputed from the kept harness output of each run.
 */
export function tableProblems(record, dir = REPO) {
  const problems = [...mainProblems(record)];
  const runs = isObj(record?.runs) ? record.runs : {};
  for (const n of COUNTS) {
    const at = `runs["${n}"]`;
    const run = runs[String(n)];
    if (!isObj(run)) { problems.push(`${at}: the run with ${n} session${n > 1 ? 's' : ''} is missing`); continue; }
    problems.push(...commandProblems(run, at, []));
    if (!new RegExp(`--sessions[ =]${n}(\\s|$)`).test(run.command ?? '')) problems.push(`${at}: command doesn't run --sessions ${n}`);
    const { out, problems: read } = readOut(dir, run, at);
    problems.push(...read);
    if (!out || !Array.isArray(out.calls)) continue;
    const calls = out.calls.filter((c) => [c?.arrivedMs, c?.startedMs, c?.repliedMs].every(finite) && nonEmpty(c?.kind));
    problems.push(...sessionProblems(calls, n, at));
    if (calls.some((c) => c.planted === true)) problems.push(`${at}: a call is planted; the planted slow call has runs of its own`);
    const byKind = new Map();
    for (const c of calls) byKind.set(c.kind, [...(byKind.get(c.kind) ?? []), c]);
    for (const kind of KINDS) if (!byKind.has(kind)) problems.push(`${at}: no ${kind} call was made`);
    const table = isObj(run.kinds) ? run.kinds : {};
    for (const kind of Object.keys(table)) if (!byKind.has(kind)) problems.push(`${at}: kinds.${kind} has no call in ${run.out}`);
    for (const [kind, rows] of byKind) {
      const row = table[kind];
      const here = `${at}: kinds.${kind}`;
      if (!isObj(row)) { problems.push(`${here} is missing from the table`); continue; }
      if (row.calls !== rows.length) problems.push(`${here}.calls is ${row.calls}, ${run.out} holds ${rows.length}`);
      for (const [name, of] of [['wait', waitOf], ['service', serviceOf]]) {
        const sorted = rows.map(of).sort((a, b) => a - b);
        for (const [q, p] of [['p50', 0.5], ['p95', 0.95]]) {
          const want = percentile(sorted, p);
          if (!close(row[name]?.[q], want)) problems.push(`${here}.${name}.${q} is ${row[name]?.[q]}, ${run.out} gives ${want}`);
        }
      }
    }
  }
  const readme = spikeText(dir, 'README.md');
  if (readme === null) problems.push(`${SPIKE}/README.md (the table to read) is missing`);
  else {
    for (const kind of KINDS) if (!readme.includes(kind)) problems.push(`README.md doesn't name the kind ${kind}`);
    if (!/p95|95th/i.test(readme)) problems.push('README.md has no 95th percentile in its table');
  }
  return problems;
}

// ------------------------------------------------------------------ criterion 2: the planted slow call

/**
 * The planted slow call's run (15 sessions patching one value each, and one 3D render-back of the heavy fixture,
 * marked planted) and the same 15 patches with no slow call: every patch reached the hub while the slow call was in
 * flight, and each patch's wait in both runs is recorded beside the other, recomputed from both outputs.
 */
export function plantedProblems(record, dir = REPO) {
  const problems = [...mainProblems(record)];
  const planted = record?.planted;
  if (!isObj(planted)) return [...problems, 'planted (the slow call\'s run and the run without it) is missing'];
  const fixture = planted.fixture;
  if (!isObj(fixture) || !relative(fixture.path)) problems.push('planted.fixture.path (the heavy fixture, relative to the checkout) is missing');
  else {
    const path = join(dir, fixture.path);
    if (!existsSync(path)) problems.push(`planted.fixture: ${fixture.path} is not in this checkout`);
    else {
      const bytes = readFileSync(path);
      if (fixture.sha256 !== sha256(bytes)) problems.push(`planted.fixture: sha256 of ${fixture.path} is not what the record says`);
      try { if (!isObj(JSON.parse(bytes.toString('utf8'))?.items)) problems.push(`planted.fixture: ${fixture.path} is not a document with items`); }
      catch { problems.push(`planted.fixture: ${fixture.path} is not JSON`); }
    }
  }
  const patchesOf = {};
  for (const side of ['slow', 'without']) {
    const at = `planted.${side}`;
    const run = planted[side];
    problems.push(...commandProblems(run, at, ['--patches', ...(side === 'slow' ? ['--slow'] : [])]));
    if (!new RegExp(`--sessions[ =]${PATCHERS}(\\s|$)`).test(run?.command ?? '')) problems.push(`${at}: command doesn't run --sessions ${PATCHERS}`);
    if (side === 'without' && /(^|\s)--slow(\s|$)/.test(run?.command ?? '')) problems.push(`${at}: command plants the slow call`);
    const { out, problems: read } = readOut(dir, run, at);
    problems.push(...read);
    if (!out || !Array.isArray(out.calls)) continue;
    const calls = out.calls.filter((c) => [c?.arrivedMs, c?.startedMs, c?.repliedMs].every(finite) && nonEmpty(c?.kind));
    const patches = calls.filter((c) => c.kind === 'patch' && c.planted !== true);
    const slow = calls.filter((c) => c.planted === true);
    if (patches.length !== PATCHERS) problems.push(`${at}: ${patches.length} patches, not ${PATCHERS}`);
    if (sessionsOf(patches).length !== patches.length) problems.push(`${at}: a session patched more than once; each of the ${PATCHERS} patches one value`);
    problems.push(...sessionProblems(patches, PATCHERS, `${at}'s patches`));
    patchesOf[side] = patches;
    if (side === 'without') { if (slow.length) problems.push(`${at}: a call is planted in the run with no slow call`); continue; }
    if (slow.length !== 1) { problems.push(`${at}: ${slow.length} planted calls, not one`); continue; }
    const [s] = slow;
    if (s.kind !== 'render_back_3d') problems.push(`${at}: the planted call is a ${s.kind}, not a render_back_3d of the heavy fixture`);
    for (const p of patches) {
      if (!(s.arrivedMs <= p.arrivedMs && p.arrivedMs <= s.repliedMs)) problems.push(`${at}: ${p.session}'s patch reached the hub at ${p.arrivedMs}, outside the slow call's flight (${s.arrivedMs} to ${s.repliedMs})`);
    }
  }
  const pairs = list(planted.patches);
  if (patchesOf.slow && patchesOf.without) {
    const key = (c) => `${c.session}\u0000${c.doc}`;
    const without = new Map(patchesOf.without.map((c) => [key(c), c]));
    const slow = new Map(patchesOf.slow.map((c) => [key(c), c]));
    for (const k of slow.keys()) if (!without.has(k)) problems.push(`planted: ${k.replace('\u0000', ' on ')}'s patch is not among the patches of the run with no slow call`);
    if (pairs.length !== PATCHERS) problems.push(`planted.patches lists ${pairs.length} patches, not ${PATCHERS}`);
    const seen = new Set();
    for (const [i, row] of pairs.entries()) {
      const k = `${row?.session}\u0000${row?.doc}`;
      const here = `planted.patches[${i}] (${row?.session})`;
      if (seen.has(k)) problems.push(`${here}: listed twice`);
      seen.add(k);
      const a = slow.get(k), b = without.get(k);
      if (!a || !b) { problems.push(`${here}: no such patch in both runs`); continue; }
      if (!close(row.slow, waitOf(a))) problems.push(`${here}.slow is ${row.slow}, the slow call's run gives a wait of ${waitOf(a)}`);
      if (!close(row.without, waitOf(b))) problems.push(`${here}.without is ${row.without}, the run with no slow call gives ${waitOf(b)}`);
    }
  }
  return problems;
}

// ------------------------------------------------------------------ criterion 2: the harness against a held-busy core

/**
 * What a harness read against a canvas core the test held busy (ac2-held-busy.test.mjs): every call of the harness's
 * sessions was sent after the go line; the first call of each session reached the hub while the test's held calls
 * filled the core's line ahead of it, so its start in the core comes no earlier than they could end (`heldUntil`) and
 * its wait is at least `minWaitMs`. Each problem names the call.
 */
export function heldBusyProblems(out, held) {
  const problems = [];
  const calls = list(out?.calls).filter((c) => nonEmpty(c?.session) && [c?.arrivedMs, c?.startedMs, c?.repliedMs].every(finite));
  if (!calls.length) return [`${AC2}: the harness's output holds no timed call`];
  for (const session of sessionsOf(calls)) {
    const first = calls.filter((c) => c.session === session).sort((a, b) => a.arrivedMs - b.arrivedMs)[0];
    const name = `session ${JSON.stringify(first.session)}'s ${first.kind} call on doc ${first.doc}`;
    const wait = waitOf(first);
    if (first.arrivedMs < held.goAt) problems.push(`${AC2}: ${name} arrived at ${first.arrivedMs}, before the go line (${held.goAt}): the harness sent it before the core was held`);
    if (first.startedMs < held.heldUntil) problems.push(`${AC2}: the harness read ${name} as started in the core at ${first.startedMs}, before the calls held ahead of it could end (${held.heldUntil})`);
    if (!(wait >= held.minWaitMs)) problems.push(`${AC2}: the harness read a wait of ${wait} ms for ${name}, its first call, which reached the hub while the test held the canvas core busy ahead of it; it waited at least ${held.minWaitMs} ms`);
  }
  return problems;
}

// ------------------------------------------------------------------ criterion 3: the list

/** The text of a file at a commit of this checkout's history, or null. */
function fileAt(commit, file) {
  const shown = git('show', `${commit}:${file}`);
  return shown.status === 0 ? shown.stdout : null;
}

/**
 * For each kind of call (at least the issue's five and every kind the table has): what it reads and writes and which
 * other kinds it must follow, each with the line of code that shows it, checked against this checkout's history at
 * the record's `main`: the cited line of the cited file holds the cited text.
 */
export function listProblems(record, dir = REPO) {
  const problems = [...mainProblems(record)];
  const rows = list(record?.list);
  if (!rows.length) return [...problems, 'list (what each kind of call reads and writes, and which kinds it must follow) is missing'];
  const kinds = new Set(KINDS);
  for (const run of Object.values(isObj(record?.runs) ? record.runs : {})) for (const k of Object.keys(isObj(run?.kinds) ? run.kinds : {})) kinds.add(k);
  const listed = new Map();
  for (const row of rows) {
    if (!nonEmpty(row?.kind)) { problems.push('list: a row names no kind'); continue; }
    if (listed.has(row.kind)) problems.push(`list: ${row.kind} is listed twice`);
    listed.set(row.kind, row);
  }
  for (const kind of kinds) if (!listed.has(kind)) problems.push(`list: the kind ${kind} is not listed`);
  const cache = new Map();
  const cite = (entry, at) => {
    if (!relative(entry?.file) || !/^(packages|crates)\//.test(entry.file)) return [`${at}: file ${JSON.stringify(entry?.file)} is not a code path under packages/ or crates/`];
    if (!Number.isInteger(entry.line) || entry.line < 1) return [`${at}: line is not a line number`];
    if (!nonEmpty(entry.text) || entry.text.trim().length < 8) return [`${at}: text (what the line holds) is missing or too short to name it`];
    if (!isCommit(record?.main)) return [];
    const key = entry.file;
    if (!cache.has(key)) cache.set(key, fileAt(record.main, key));
    const source = cache.get(key);
    if (source === null) return [`${at}: ${entry.file} is not in main ${record.main.slice(0, 9)}`];
    const line = source.split('\n')[entry.line - 1];
    if (line === undefined) return [`${at}: ${entry.file} has no line ${entry.line} at main ${record.main.slice(0, 9)}`];
    return line.includes(entry.text.trim()) ? [] : [`${at}: ${entry.file}:${entry.line} at main ${record.main.slice(0, 9)} doesn't hold ${JSON.stringify(entry.text.trim())}; it holds ${JSON.stringify(line.trim().slice(0, 160))}`];
  };
  for (const [kind, row] of listed) {
    for (const field of ['reads', 'writes', 'follows']) {
      if (!Array.isArray(row[field])) problems.push(`list: ${kind}.${field} is not a list (an empty list says none)`);
    }
    if (Array.isArray(row.reads) && !row.reads.length) problems.push(`list: ${kind} reads nothing; every call is played against the world the hub sends`);
    for (const field of ['reads', 'writes']) {
      list(row[field]).forEach((entry, i) => {
        const at = `list: ${kind}.${field}[${i}]`;
        if (!nonEmpty(entry?.thing)) problems.push(`${at}: thing (what it ${field === 'reads' ? 'reads' : 'writes'}) is missing`);
        problems.push(...cite(entry, at));
      });
    }
    list(row.follows).forEach((entry, i) => {
      const at = `list: ${kind}.follows[${i}]`;
      if (!listed.has(entry?.kind)) problems.push(`${at}: ${JSON.stringify(entry?.kind)} is not a listed kind`);
      problems.push(...cite(entry, at));
    });
  }
  // The issue: "A document's revisions and writer layers need theirs" (their order).
  const patch = listed.get('patch');
  if (patch && !list(patch.follows).some((f) => f?.kind === 'revision')) problems.push('list: a patch doesn\'t follow a revision, though the issue says a document\'s revisions need their order');
  return problems;
}

// ------------------------------------------------------------------ criterion 4: the follow-up, or why the line stays

/**
 * Either a follow-up filed with its own criteria (`followUp`: its issue number, title and criteria), named in the
 * spike's README, or one paragraph saying why the line stays (`stays`), the same paragraph in the README. Not both.
 */
export function followUpProblems(record, dir = REPO) {
  const f = record?.followUp;
  const stays = record?.stays;
  const filed = f !== undefined && f !== null;
  const said = stays !== undefined && stays !== null;
  if (filed === said) return ['the record holds either followUp (the task filed) or stays (why the line stays), not both and not neither'];
  const readme = spikeText(dir, 'README.md');
  const problems = readme === null ? [`${SPIKE}/README.md is missing`] : [];
  const squash = (t) => t.replace(/\s+/g, ' ').trim();
  if (filed) {
    if (!isObj(f) || !Number.isInteger(f.issue) || f.issue < 1 || f.issue === ISSUE) problems.push(`followUp.issue is not the number of an issue filed apart from #${ISSUE}`);
    if (!nonEmpty(f?.title)) problems.push('followUp.title is missing');
    const criteria = list(f?.criteria);
    if (!criteria.length || !criteria.every(nonEmpty)) problems.push('followUp.criteria (its own acceptance criteria) is missing or has an empty one');
    if (readme !== null && Number.isInteger(f?.issue) && !new RegExp(`#${f.issue}(?!\\d)`).test(readme)) problems.push(`README.md doesn't name the follow-up #${f.issue}`);
  } else {
    if (!nonEmpty(stays)) problems.push('stays (why the line stays as it is) is empty');
    else if (/\n[ \t]*\n/.test(stays.trim())) problems.push('stays is more than one paragraph');
    else if (readme !== null && !squash(readme).includes(squash(stays))) problems.push('README.md doesn\'t hold the paragraph saying why the line stays');
  }
  return problems;
}
