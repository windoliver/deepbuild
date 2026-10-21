// Shared by the #338 acceptance tests: reads the replica-and-registries spike's record
// (docs/spikes/338/record.json), the headless run's output it keeps (record.out) and the files they name,
// and recomputes from them what a test can recompute instead of taking the spike's word: the Needs you rows
// from the fixture record's events, what each planted view got wrong and which ask it had to name, the
// first node where a scale-1 replica departs from the live tree, launch times against the 2 s, screenshot
// sizes against the reference window, file hashes, and that gpui-kit is used upstream with no fork.
// Each check returns a list of problems; an empty list means it holds.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const RECORD = 'docs/spikes/338/record.json';
export const DESIGN = 'docs/technical-design.md';
export const OUT_ENV = 'DEEP_338_OUT';

// Criterion IDs, by the rule in tests/acceptance/48/README.md.
export const REPLICA = '#338.6257cd5b';
export const NEEDS_YOU = '#338.ed0f5115';
export const PARITY = '#338.78331b15';

// The design's reference window (Decided, "The reference window"): 1512 × 982 points at 2×.
export const WINDOW = { size: [1512, 982], scale: 2 };
export const LAUNCH_LIMIT_MS = 2000;
export const LAUNCH_RUNS = 5;
// The shipped views the criteria name: Needs you, the sidebar and a session page.
export const VIEWS = ['needs-you', 'sidebar', 'session'];
// The issue's four planted Needs you views, and the fault each has.
export const PLANTED = ['cap20', 'drop-folded', 'list-superseded', 'hide-newest'];
export const CAP = 20;
// The areas the issue names for added pieces, and the replaced shipped view.
export const SLOTS = ['sidebar', 'home', 'tab', 'line', 'replace'];
// gpui-shell's ComponentArgument kinds (crates/shell/src/component_registry.rs), in snake_case.
export const ARGUMENT_TYPES = ['string', 'number', 'boolean', 'element', 'entity', 'callback', 'enum', 'array', 'optional'];
// The fixture record of asks: 40 open, of every kind, five folded after five open in one session.
export const OPEN_ASKS = 40;
export const ASK_KINDS = ['authority', 'unblock', 'taste', 'exception', 'choice', 'definition'];
export const FOLD_AFTER = 5;
// The kinds that end an ask at the base (Every ask ends; the ask.* schemas under packages/contracts/schemas).
export const CLOSING = ['ask.answered', 'ask.defaulted', 'ask.escalated', 'ask.cancelled', 'ask.superseded', 'ask.moot'];
export const UPSTREAM = 'https://github.com/longbridge/gpui-kit';
export const UPSTREAM_CRATES = ['gpui-kit', 'gpui-shell'];

// The design's two reference Macs (The reference Macs), in the field names of scripts/benchmark.mjs's fingerprint().
export const REFERENCES = [
  { name: 'Mac15,7 (M3 Pro, 36 GB)', model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30 },
  { name: 'Mac15,12 (M3, 16 GB)', model: 'Mac15,12', chip: 'Apple M3', memoryBytes: 16 * 2 ** 30 },
];
const HARDWARE = ['model', 'chip', 'memoryBytes'];
export const CONDITIONS = { power: 'ac', lowPowerMode: false, thermalState: 'nominal' };
export const REFERENCE = { ...Object.fromEntries(HARDWARE.map((key) => [key, REFERENCES[1][key]])), ...CONDITIONS, macosBuild: '23H723' };

// Calls a panel would make to reach the network or a program itself.
const ESCAPES = [['fetch()', /\bfetch\s*\(/], ['XMLHttpRequest', /\bXMLHttpRequest\b/], ['WebSocket', /\bWebSocket\b/], ['EventSource', /\bEventSource\b/], ['child_process', /\bchild_process\b/], ['require()', /\brequire\s*\(/], ['Deno', /\bDeno\./], ['Bun', /\bBun\./]];
const ROLE = /^[a-z][a-z0-9_]*$/;
const HANDLE = /^ask:[0-9A-Za-z]+$/;

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const list = (value) => (Array.isArray(value) ? value : []);
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const squash = (text) => String(text).replace(/\s+/g, ' ').trim();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const isInt = (value) => Number.isInteger(value);

export function loadRecord(path = join(root, RECORD)) {
  if (!existsSync(path)) assert.fail(`no spike record at ${RECORD}: the spike hasn't been recorded`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function git(repo, ...args) {
  return spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}
const safePath = (path) => nonEmpty(path) && !path.startsWith('/') && !path.split('/').includes('..');
const tracked = (repo, path) => safePath(path) && git(repo, 'ls-files', '--error-unmatch', '--', path).status === 0;
const readTracked = (repo, path) => readFileSync(join(repo, path));

// Reads a JSON file under a directory; returns { value } or { problem }.
function readJson(dir, name) {
  const path = join(dir, name);
  if (!existsSync(path)) return { problem: `${name} is missing` };
  try { return { value: JSON.parse(readFileSync(path, 'utf8')) }; } catch (error) { return { problem: `${name} isn't JSON: ${error.message}` }; }
}

// ------------------------------------------------------------------ the output directory

// The headless run writes its outputs into $DEEP_338_OUT; the record keeps a tracked copy at record.out.
// Every output file read by the tests is listed here, so a fresh run and the tracked copy are checked alike.
export const OUTPUTS = {
  launch: 'launch-ms.json',
  snapshot: (view) => `snapshots/${view}.json`,
  scale1: (view) => `snapshots/${view}.scale1.json`,
  live: (view) => `live/${view}.json`,
  screenshot: (view) => `screens/${view}.png`,
  rows: 'needs-you/rows.json',
  plantedRows: (id) => `needs-you/planted/${id}.rows.json`,
  kit: 'needs-you/kit.json',
  parity: 'parity.json',
  canvas: 'canvas.json',
};

// The tracked copy: a directory under docs/spikes/338/ whose files are all tracked.
export function outProblems(record, repo = root) {
  const out = record?.out;
  if (!nonEmpty(out) || !/^docs\/spikes\/338\//.test(out) || !safePath(out)) return [`record.out ${JSON.stringify(out)} isn't a directory under docs/spikes/338/`];
  if (!existsSync(join(repo, out))) return [`record.out ${out} doesn't exist`];
  const untracked = git(repo, 'ls-files', '--others', '--exclude-standard', '--', out).stdout.split('\n').filter(Boolean);
  return untracked.map((file) => `${file} in record.out isn't tracked by git`);
}
export const outDir = (record, repo = root) => join(repo, String(record?.out ?? ''));

// ------------------------------------------------------------------ PNG

export function pngSize(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature) || bytes.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

// ------------------------------------------------------------------ the machine

// Why a machine's fingerprint isn't a reference Mac's: hardware matching neither, a condition unmet, no build.
export function offReference(machine) {
  const off = REFERENCES.some((reference) => HARDWARE.every((key) => machine?.[key] === reference[key])) ? []
    : [`${HARDWARE.map((key) => `${key} is ${JSON.stringify(machine?.[key] ?? null)}`).join(', ')}: neither ${REFERENCES.map(({ name }) => name).join(' nor ')}`];
  off.push(...Object.entries(CONDITIONS).filter(([key, value]) => machine?.[key] !== value).map(([key, value]) => `${key} is ${JSON.stringify(machine?.[key] ?? null)}, not ${JSON.stringify(value)}`));
  if (!nonEmpty(machine?.macosBuild)) off.push('the macOS build is missing');
  return off;
}

// ------------------------------------------------------------------ snapshots: a text tree of roles, names, values and bounds, with canvas items

// Walks a snapshot tree in pre-order; returns flat nodes { role, name, value, bounds, depth } or a problem.
export function flatten(tree) {
  const nodes = [];
  const problems = [];
  (function walk(node, depth, at) {
    if (!isObject(node)) { problems.push(`${at}: not a node object`); return; }
    if (!ROLE.test(node.role ?? '')) problems.push(`${at}: role ${JSON.stringify(node.role)} isn't a snake_case accessibility role`);
    if (!(node.name === null || node.name === undefined || typeof node.name === 'string')) problems.push(`${at}: name isn't a string or null`);
    const bounds = node.bounds;
    if (!(Array.isArray(bounds) && bounds.length === 4 && bounds.every(isInt) && bounds[2] >= 0 && bounds[3] >= 0)) problems.push(`${at}: bounds ${JSON.stringify(bounds)} aren't [x, y, w, h] in whole device pixels`);
    nodes.push({ role: node.role, name: node.name ?? null, value: node.value ?? null, bounds, depth });
    list(node.children).forEach((child, index) => walk(child, depth + 1, `${at}/children/${index}`));
  })(tree, 0, 'tree');
  return { nodes, problems };
}

// A snapshot file: { window: {size, scale}, tree, items: [{id, value}] }, bounds inside the window in device pixels.
export function snapshotProblems(snapshot, at, { scale = WINDOW.scale } = {}) {
  const problems = [];
  if (!isObject(snapshot)) return [`${at}: not a snapshot object`];
  if (!same(snapshot.window?.size, WINDOW.size)) problems.push(`${at}: window.size is ${JSON.stringify(snapshot.window?.size)}, not the reference window ${JSON.stringify(WINDOW.size)}`);
  if (snapshot.window?.scale !== scale) problems.push(`${at}: window.scale is ${JSON.stringify(snapshot.window?.scale)}, not ${scale}`);
  const { nodes, problems: shape } = flatten(snapshot.tree);
  problems.push(...shape.map((problem) => `${at}: ${problem}`));
  if (!nodes.length) problems.push(`${at}: an empty tree`);
  if (!nodes.some((node) => nonEmpty(node.name))) problems.push(`${at}: no node has a name`);
  const [w, h] = WINDOW.size.map((points) => points * (snapshot.window?.scale ?? scale));
  const outside = nodes.find((node) => Array.isArray(node.bounds) && node.bounds.length === 4 && (node.bounds[0] < 0 || node.bounds[1] < 0 || node.bounds[0] + node.bounds[2] > w || node.bounds[1] + node.bounds[3] > h));
  if (outside) problems.push(`${at}: node ${outside.role} ${JSON.stringify(outside.name)} at ${JSON.stringify(outside.bounds)} lies outside the ${w} × ${h} px window`);
  if (!Array.isArray(snapshot.items)) problems.push(`${at}: items isn't a list of canvas items`);
  else snapshot.items.forEach((item, index) => { if (!isObject(item) || !nonEmpty(item.id) || !('value' in item)) problems.push(`${at}: items[${index}] isn't {id, value}`); });
  return problems;
}

// The first node, in pre-order, where two snapshots differ, or null when they're equal node for node.
export function firstDifference(a, b) {
  const left = flatten(a?.tree).nodes, right = flatten(b?.tree).nodes;
  const n = Math.max(left.length, right.length);
  for (let index = 0; index < n; index++) {
    const x = left[index], y = right[index];
    if (!x || !y) return { index, why: `${!x ? 'the first' : 'the second'} tree ends at node ${index}` };
    for (const field of ['role', 'name', 'value', 'bounds']) if (!same(x[field], y[field])) return { index, why: `node ${index} (${x.role} ${JSON.stringify(x.name)}) differs in ${field}: ${JSON.stringify(x[field])} vs ${JSON.stringify(y[field])}` };
  }
  return null;
}

// ------------------------------------------------------------------ criterion 1: the replica launches and sees

export function replicaProblems(record, dir, repo = root) {
  const problems = [];
  if (!same(record?.window, WINDOW)) problems.push(`record.window is ${JSON.stringify(record?.window)}, not the reference window ${JSON.stringify(WINDOW)}`);
  if (record?.clock !== 'virtual') problems.push(`record.clock is ${JSON.stringify(record?.clock)}, not virtual`);
  const off = offReference(record?.machine);
  if (off.length) problems.push(`not run on a reference Mac, so the launch time is INCONCLUSIVE: ${off.join('; ')}`);
  if (!nonEmpty(record?.launch?.test)) problems.push('launch.test names no headless test');
  if (!nonEmpty(record?.launch?.method)) problems.push('launch.method says nothing about how the launch is timed');
  const launch = readJson(dir, OUTPUTS.launch);
  if (launch.problem) problems.push(launch.problem);
  else {
    const runs = launch.value;
    if (!Array.isArray(runs) || runs.length < LAUNCH_RUNS || !runs.every((run) => typeof run === 'number' && Number.isFinite(run) && run >= 0)) problems.push(`${OUTPUTS.launch} must hold at least ${LAUNCH_RUNS} launch times in ms`);
    else { const slow = runs.filter((run) => run >= LAUNCH_LIMIT_MS); if (slow.length) problems.push(`launch isn't under ${LAUNCH_LIMIT_MS} ms on every run: ${JSON.stringify(runs)}`); }
  }
  const views = list(record?.views);
  for (const id of VIEWS) if (!views.some((view) => view?.id === id)) problems.push(`views lacks the shipped view ${id}`);
  let items = 0;
  for (const view of views) {
    if (!nonEmpty(view?.id)) { problems.push('a view with no id'); continue; }
    if (!nonEmpty(view.test)) problems.push(`view ${view.id} names no headless test`);
    const snapshot = readJson(dir, OUTPUTS.snapshot(view.id));
    if (snapshot.problem) problems.push(snapshot.problem);
    else { problems.push(...snapshotProblems(snapshot.value, OUTPUTS.snapshot(view.id))); items += list(snapshot.value?.items).length; }
    const shot = join(dir, OUTPUTS.screenshot(view.id));
    if (!existsSync(shot)) { problems.push(`${OUTPUTS.screenshot(view.id)} is missing`); continue; }
    const size = pngSize(readFileSync(shot));
    if (!size) problems.push(`${OUTPUTS.screenshot(view.id)} isn't a PNG`);
    else if (size.width !== WINDOW.size[0] * WINDOW.scale || size.height !== WINDOW.size[1] * WINDOW.scale) problems.push(`${OUTPUTS.screenshot(view.id)} is ${size.width} × ${size.height}, not the reference window at ${WINDOW.scale}× (${WINDOW.size[0] * WINDOW.scale} × ${WINDOW.size[1] * WINDOW.scale})`);
  }
  if (views.length && items === 0) problems.push('no view snapshot lists a canvas item by ID');
  return problems;
}

// ------------------------------------------------------------------ criterion 2: Needs you from the fixture record

// Reads the fixture record: one JSON object per line, {session_id, event}, sorted by event.log_pos.
export function readFixture(record, repo = root) {
  const path = record?.needsYou?.fixture;
  if (!/\.jsonl$/.test(path ?? '') || !tracked(repo, path)) return { problems: [`needsYou.fixture ${JSON.stringify(path)} isn't a tracked .jsonl file`] };
  const problems = [];
  const rows = [];
  readTracked(repo, path).toString('utf8').split('\n').forEach((line, index) => {
    if (!line.trim()) return;
    let row;
    try { row = JSON.parse(line); } catch { problems.push(`${path}:${index + 1} isn't JSON`); return; }
    if (!isObject(row) || !nonEmpty(row.session_id) || !isObject(row.event)) { problems.push(`${path}:${index + 1} isn't {session_id, event}`); return; }
    const { event } = row;
    if (!isInt(event.log_pos) || event.log_pos < 1) problems.push(`${path}:${index + 1}: event.log_pos isn't a positive integer`);
    if (!nonEmpty(event.kind) || !nonEmpty(event.id)) problems.push(`${path}:${index + 1}: event lacks kind or id`);
    rows.push(row);
  });
  for (let index = 1; index < rows.length; index++) if (!(rows[index].event.log_pos > rows[index - 1].event.log_pos)) problems.push(`${path}: log_pos ${rows[index].event.log_pos} doesn't follow ${rows[index - 1].event.log_pos}; the record is in log order and never reuses a position`);
  return { rows, problems };
}

// The inbox projection's list for Needs you as of a log position: every ask created and not closed by then,
// oldest first by its creation's log_pos. Also what the fixture holds: the Later, superseded, moot and folded asks.
export function needsYou(rows, asOf) {
  const seen = rows.filter((row) => row.event.log_pos <= asOf);
  const asks = new Map();
  for (const { session_id, event } of seen) {
    if (event.kind !== 'ask.created') continue;
    const handle = `ask:${event.id}`;
    asks.set(handle, { handle, session: session_id, created: event.log_pos, kind: event.data?.kind, deadline: event.data?.deadline, closed: null, later: null });
  }
  for (const { event } of seen) {
    const ask = asks.get(event.subject);
    if (!ask || event.log_pos <= ask.created) continue;
    if (CLOSING.includes(event.kind) && !ask.closed) ask.closed = { kind: event.kind, by: event.data?.by, log_pos: event.log_pos };
    if (event.kind === 'ask.later') ask.later = { until: event.data?.until, log_pos: event.log_pos };
  }
  const open = [...asks.values()].filter((ask) => !ask.closed).sort((a, b) => a.created - b.created);
  const bySession = new Map();
  for (const ask of open) bySession.set(ask.session, [...(bySession.get(ask.session) ?? []), ask]);
  const folded = [...bySession.values()].flatMap((session) => session.slice(FOLD_AFTER));
  return {
    rows: open.map((ask) => ask.handle),
    open,
    asks,
    bySession,
    folded: folded.map((ask) => ask.handle),
    later: open.filter((ask) => ask.later).map((ask) => ask.handle),
    superseded: [...asks.values()].filter((ask) => ask.closed?.kind === 'ask.superseded'),
    moot: [...asks.values()].filter((ask) => ask.closed?.kind === 'ask.moot'),
  };
}

// The fixture record is the issue's: 40 open asks of every kind, one in Later, one held, five folded, one
// superseded and one moot, as of the record's log_pos on its virtual clock.
export function fixtureProblems(record, repo = root) {
  const { rows, problems = [] } = readFixture(record, repo);
  if (!rows) return problems;
  const asOf = record?.needsYou?.log_pos, now = record?.needsYou?.now;
  if (!isInt(asOf) || asOf < 1) problems.push(`needsYou.log_pos ${JSON.stringify(asOf)} isn't a log position`);
  if (!isInt(now) || now < 0) problems.push(`needsYou.now ${JSON.stringify(now)} isn't the virtual clock's time in ms`);
  if (problems.length) return problems;
  if (!rows.some((row) => row.event.log_pos === asOf)) problems.push(`no event in the fixture has log_pos ${asOf}; the view is built as of an event`);
  const view = needsYou(rows, asOf);
  if (view.open.length !== OPEN_ASKS) problems.push(`${view.open.length} asks are open at log_pos ${asOf}, not ${OPEN_ASKS}`);
  for (const kind of ASK_KINDS) if (!view.open.some((ask) => ask.kind === kind)) problems.push(`no open ask of kind ${kind}`);
  for (const ask of view.open) if (!(isInt(ask.deadline) && ask.deadline > now)) problems.push(`${ask.handle}'s deadline ${JSON.stringify(ask.deadline)} isn't after the virtual clock's ${now}, so it would have defaulted`);
  if (view.later.length !== 1) problems.push(`${view.later.length} open asks are in Later, not 1`);
  for (const handle of view.later) {
    const ask = view.asks.get(handle);
    if (!(isInt(ask.later.until) && ask.later.until > now && ask.later.until < ask.deadline)) problems.push(`${handle} in Later until ${JSON.stringify(ask.later.until)}: Later hides an ask until a time after now (${now}) and never past its deadline (${ask.deadline})`);
  }
  if (view.superseded.length !== 1) problems.push(`${view.superseded.length} asks are superseded, not 1`);
  for (const ask of view.superseded) {
    const by = view.asks.get(ask.closed.by);
    if (!by || by.closed || by.session !== ask.session || by.created <= ask.created) problems.push(`${ask.handle} is superseded by ${JSON.stringify(ask.closed.by)}, which isn't a newer open ask from the same session`);
  }
  if (view.moot.length !== 1) problems.push(`${view.moot.length} asks are moot, not 1`);
  const folding = [...view.bySession.entries()].filter(([, asks]) => asks.length > FOLD_AFTER);
  if (folding.length !== 1 || folding[0][1].length !== 2 * FOLD_AFTER) problems.push(`five asks fold into one exception once a session holds five open asks: expected exactly one session with ${2 * FOLD_AFTER} open asks, found ${JSON.stringify(folding.map(([session, asks]) => [session, asks.length]))}`);
  const held = record?.needsYou?.held;
  const heldAsk = view.asks.get(held);
  if (!HANDLE.test(held ?? '') || !heldAsk || heldAsk.closed) problems.push(`needsYou.held ${JSON.stringify(held)} isn't an open ask of the fixture`);
  else if (folding.some(([session]) => session === heldAsk.session)) problems.push(`needsYou.held ${held} is in the folding session, so it's folded, not held`);
  else if (view.later.includes(held)) problems.push(`needsYou.held ${held} is the Later ask, not a held one`);
  return problems;
}

// The fixture panel and the planted views: tracked JavaScript files that reach no network or program.
function panelFileProblems(panel, at, repo) {
  const problems = [];
  if (!/\.(m?js)$/.test(panel?.file ?? '') || !tracked(repo, panel.file)) return [`${at}: file ${JSON.stringify(panel?.file)} isn't a tracked JavaScript file`];
  const source = readTracked(repo, panel.file);
  if (sha256(source) !== panel.sha256) problems.push(`${at}: ${panel.file} doesn't hash to its recorded sha256`);
  for (const [name, pattern] of ESCAPES) if (pattern.test(source.toString('utf8'))) problems.push(`${at}: ${panel.file} uses ${name}, reaching outside DeepBuild's modules`);
  if (!nonEmpty(panel.test)) problems.push(`${at}: no headless test named`);
  return problems;
}

// The view's rows equal the inbox projection's list, row for row; each planted view fails naming an ask.
export function rowsProblems(record, dir, repo = root) {
  const problems = [];
  const { rows: fixture, problems: shape = [] } = readFixture(record, repo);
  if (!fixture || shape.length) return shape.length ? shape : ['no fixture'];
  const asOf = record?.needsYou?.log_pos;
  if (!isInt(asOf)) return [`needsYou.log_pos ${JSON.stringify(asOf)} isn't a log position`];
  const expected = needsYou(fixture, asOf);
  problems.push(...panelFileProblems(record?.needsYou?.panel, 'the fixture Needs you panel', repo));
  if (!nonEmpty(record?.needsYou?.kit?.test)) problems.push('needsYou.kit.test names no headless test for needs-you@1');
  const rows = readJson(dir, OUTPUTS.rows);
  if (rows.problem) problems.push(rows.problem);
  else {
    const got = rows.value;
    if (!Array.isArray(got) || !got.every((row) => HANDLE.test(row))) problems.push(`${OUTPUTS.rows} isn't a list of ask handles`);
    else {
      const first = expected.rows.findIndex((handle, index) => got[index] !== handle);
      if (got.length !== expected.rows.length || first >= 0) {
        const at = first >= 0 ? first : Math.min(got.length, expected.rows.length);
        problems.push(`the view's rows differ from the inbox projection's ${expected.rows.length} rows at row ${at}: the view shows ${JSON.stringify(got[at] ?? null)}, the projection ${JSON.stringify(expected.rows[at] ?? null)} (view: ${got.length} rows)`);
      }
    }
  }
  const kit = readJson(dir, OUTPUTS.kit);
  if (kit.problem) problems.push(kit.problem);
  else if (kit.value?.fixture?.result !== 'pass') problems.push(`${OUTPUTS.kit}: the fixture panel's needs-you@1 result is ${JSON.stringify(kit.value?.fixture?.result)}, not pass`);
  for (const id of PLANTED) {
    const planted = record?.needsYou?.planted?.[id];
    if (!planted) { problems.push(`no planted view ${id} recorded`); continue; }
    problems.push(...panelFileProblems(planted, `planted ${id}`, repo));
    const got = readJson(dir, OUTPUTS.plantedRows(id));
    if (got.problem) { problems.push(got.problem); continue; }
    const fault = plantedFault(id, got.value, expected);
    if (fault.problem) problems.push(`planted ${id}: ${fault.problem}`);
    const verdict = kit.value?.planted?.[id];
    if (verdict?.result !== 'fail') problems.push(`${OUTPUTS.kit}: planted ${id} has result ${JSON.stringify(verdict?.result)}, not fail`);
    if (!fault.problem && !fault.wrong.includes(verdict?.names)) problems.push(`${OUTPUTS.kit}: planted ${id} names ${JSON.stringify(verdict?.names ?? null)}, not one of the asks it got wrong (${fault.wrong.join(', ')})`);
  }
  return problems;
}

// What a planted view's rows must look like, given the projection's: the issue's fault and nothing else.
// Returns { wrong: [asks the kit may name] } or { problem }.
export function plantedFault(id, rows, expected) {
  if (!Array.isArray(rows) || !rows.every((row) => HANDLE.test(row))) return { problem: 'its rows aren\'t a list of ask handles' };
  const want = expected.rows;
  const missing = want.filter((handle) => !rows.includes(handle)), extra = rows.filter((handle) => !want.includes(handle));
  const check = (ok, wrong, why) => (ok ? { wrong } : { problem: why });
  switch (id) {
    case 'cap20':
      return check(want.length > CAP && same(rows, want.slice(0, CAP)), want.slice(CAP), `its rows aren't the projection's first ${CAP} (${rows.length} rows, ${missing.length} missing, ${extra.length} extra)`);
    case 'drop-folded':
      return check(expected.folded.length === FOLD_AFTER && same(rows, want.filter((handle) => !expected.folded.includes(handle))), expected.folded, `its rows aren't the projection's without the ${expected.folded.length} folded asks (${missing.length} missing, ${extra.length} extra)`);
    case 'list-superseded': {
      const superseded = expected.superseded.map((ask) => ask.handle);
      return check(superseded.length === 1 && same(rows.filter((handle) => !superseded.includes(handle)), want) && extra.length === 1 && superseded.includes(extra[0]), superseded, `its rows aren't the projection's plus the superseded ask (${missing.length} missing, ${extra.length} extra)`);
    }
    case 'hide-newest':
      return check(want.length > 0 && same(rows, want.slice(0, -1)), want.slice(-1), `its rows aren't the projection's without the newest (${missing.length} missing, ${extra.length} extra)`);
    default:
      return { problem: `unknown planted view ${id}` };
  }
}

// ------------------------------------------------------------------ criterion 3: the replica against the live tree

export function parityProblems(record, dir, repo = root) {
  const problems = [];
  const off = offReference(record?.machine);
  if (off.length) problems.push(`the live tree wasn't captured on a reference Mac: ${off.join('; ')}`);
  if (!nonEmpty(record?.parity?.test)) problems.push('parity.test names no headless test');
  if (!nonEmpty(record?.parity?.scale1?.test)) problems.push('parity.scale1.test names no headless test for the scale-1 replica');
  if (!nonEmpty(record?.parity?.liveCapture)) problems.push('parity.liveCapture says nothing about how the live accessibility tree was read');
  const verdicts = readJson(dir, OUTPUTS.parity);
  if (verdicts.problem) problems.push(verdicts.problem);
  const liveDir = outDir(record, repo);
  for (const view of VIEWS) {
    const replica = readJson(dir, OUTPUTS.snapshot(view));
    const live = readJson(liveDir, OUTPUTS.live(view));
    const scale1 = readJson(dir, OUTPUTS.scale1(view));
    for (const file of [replica, live, scale1]) if (file.problem) problems.push(file.problem);
    if (live.value) problems.push(...snapshotProblems(live.value, OUTPUTS.live(view)));
    if (scale1.value) problems.push(...snapshotProblems(scale1.value, OUTPUTS.scale1(view), { scale: 1 }));
    if (replica.value && live.value) {
      const difference = firstDifference(replica.value, live.value);
      if (difference) problems.push(`${view}: the replica's snapshot differs from the live tree: ${difference.why}`);
      if (verdicts.value && verdicts.value?.[view]?.result !== 'pass') problems.push(`${OUTPUTS.parity}: ${view} has result ${JSON.stringify(verdicts.value?.[view]?.result)}, not pass`);
    }
    if (scale1.value && live.value) {
      const difference = firstDifference(scale1.value, live.value);
      if (!difference) problems.push(`${view}: the scale-1 replica's snapshot equals the live tree, so laying out at scale 1 wouldn't fail`);
      const verdict = verdicts.value?.scale1?.[view];
      if (verdicts.value && verdict?.result !== 'fail') problems.push(`${OUTPUTS.parity}: scale1.${view} has result ${JSON.stringify(verdict?.result)}, not fail`);
      if (verdicts.value && difference && verdict?.firstNode?.index !== difference.index) problems.push(`${OUTPUTS.parity}: scale1.${view} names node ${JSON.stringify(verdict?.firstNode?.index ?? null)} as the first that differs; it's node ${difference.index} (${difference.why})`);
    }
  }
  return problems;
}

// ------------------------------------------------------------------ scope: the panel registry against the app's slots

export function registryProblems(record, repo = root) {
  const problems = [];
  const slots = record?.registry?.slots;
  if (!isObject(slots)) return ['registry.slots is missing'];
  for (const area of SLOTS) {
    const slot = slots[area];
    if (!slot) { problems.push(`registry.slots lacks ${area}`); continue; }
    problems.push(...panelFileProblems(slot, `slot ${area}`, repo));
    if (area === 'replace' && slot.view !== 'needs-you') problems.push(`slot replace replaces ${JSON.stringify(slot.view)}, not the shipped needs-you view`);
  }
  for (const area of Object.keys(slots)) if (!SLOTS.includes(area)) problems.push(`registry.slots names ${area}, not one of ${SLOTS.join(', ')}`);
  const files = Object.values(slots).map((slot) => slot?.file);
  if (new Set(files).size !== files.length) problems.push('two slots share one panel file');
  if (record?.decision?.registryCovers !== true) problems.push(`decision.registryCovers is ${JSON.stringify(record?.decision?.registryCovers)}; the record says the registry doesn't cover every slot, which reopens the toolkit decision`);
  return problems;
}

// ------------------------------------------------------------------ scope: the canvas through gpui-shell's component registry, no fork

export function canvasProblems(record, dir, repo = root) {
  const problems = [];
  if (!nonEmpty(record?.canvas?.test)) problems.push('canvas.test names no headless test');
  const canvas = readJson(dir, OUTPUTS.canvas);
  if (canvas.problem) problems.push(canvas.problem);
  else {
    const { component, arguments: args, retainedState } = canvas.value ?? {};
    if (!nonEmpty(component)) problems.push(`${OUTPUTS.canvas}: no component name`);
    if (!Array.isArray(args) || !args.length) problems.push(`${OUTPUTS.canvas}: no argument schemas`);
    else args.forEach((arg, index) => { if (!nonEmpty(arg?.name) || !ARGUMENT_TYPES.includes(arg?.type)) problems.push(`${OUTPUTS.canvas}: arguments[${index}] isn't {name, type} with a type among ${ARGUMENT_TYPES.join(', ')}`); });
    if (retainedState !== true) problems.push(`${OUTPUTS.canvas}: retainedState is ${JSON.stringify(retainedState)}, not true`);
  }
  problems.push(...forkProblems(repo));
  return problems;
}

// No fork: gpui-kit and gpui-shell come from upstream at a commit, with no [patch], path or other source.
export function forkProblems(repo = root) {
  const problems = [];
  const lock = join(repo, 'Cargo.lock');
  if (!existsSync(lock)) return ['no Cargo.lock'];
  const packages = [...readFileSync(lock, 'utf8').matchAll(/^\[\[package\]\]\nname = "([^"]+)"\nversion = "[^"]+"\n(?:source = "([^"]+)"\n)?/gm)];
  for (const crate of UPSTREAM_CRATES) {
    const found = packages.filter(([, name]) => name === crate);
    if (!found.length) { problems.push(`Cargo.lock has no ${crate}`); continue; }
    for (const [, name, source] of found) if (!(source ?? '').startsWith(`git+${UPSTREAM}?rev=`) && !(source ?? '').startsWith(`git+${UPSTREAM}#`)) problems.push(`Cargo.lock's ${name} comes from ${JSON.stringify(source ?? 'this workspace')}, not upstream ${UPSTREAM} at a commit: a fork`);
  }
  for (const manifest of ['Cargo.toml', ...readdirSync(join(repo, 'crates'), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => `crates/${entry.name}/Cargo.toml`)]) {
    if (!existsSync(join(repo, manifest))) continue;
    const text = readFileSync(join(repo, manifest), 'utf8');
    if (/^\[patch\b/m.test(text)) problems.push(`${manifest} has a [patch] table, which replaces a dependency's source: a fork`);
    for (const match of text.matchAll(/^(gpui(?:-kit|-shell)?)\s*=\s*\{([^}]*)\}/gm)) if (/\bpath\s*=/.test(match[2])) problems.push(`${manifest}: ${match[1]} comes from a path, not upstream: a fork`);
  }
  return problems;
}

// ------------------------------------------------------------------ scope: the decision, with the GPU-layer spike

export function decisionProblems(record, repo = root) {
  const problems = [];
  const decision = record?.decision;
  if (!decision) return ['no decision recorded'];
  if (typeof decision.registryCovers !== 'boolean') problems.push('decision.registryCovers must say whether the registry covers every slot');
  if (decision.fork !== false) problems.push('decision.fork must be false: the canvas is registered with no fork');
  if (!nonEmpty(decision.text)) problems.push('no decision text');
  else {
    if (!/\bIOSurface\b/.test(decision.text)) problems.push('the decision text doesn\'t record the macOS GPU-layer spike\'s IOSurface handoff');
    if (!/\d+(?:\.\d+)?(?:\s?[–-]\s?\d+(?:\.\d+)?)?\s?ms\b/.test(decision.text)) problems.push('the decision text doesn\'t give the handoff\'s cost in ms');
    if (!/\bregistry\b/i.test(decision.text)) problems.push('the decision text doesn\'t say what the panel registry covered');
    if (!/\breplica\b/i.test(decision.text)) problems.push('the decision text doesn\'t say what the replica does');
    if (!nonEmpty(decision.row) || !decision.row.startsWith('| ')) problems.push('decision.row must name the Decided row the text is in, as its "| <question> |" start');
    else {
      const path = join(repo, DESIGN);
      const row = existsSync(path) ? readFileSync(path, 'utf8').split('\n').find((line) => line.startsWith(decision.row)) : null;
      if (!row) problems.push(`${DESIGN} has no row starting ${JSON.stringify(decision.row)}`);
      else if (!squash(row).includes(squash(decision.text))) problems.push(`${DESIGN}'s ${JSON.stringify(decision.row)} row doesn't hold the decision text`);
    }
  }
  return problems;
}

// ------------------------------------------------------------------ scope: the headless command in a preflight lane, no CI

export function preflightProblems(record, lanes, repo = root) {
  const problems = [];
  const command = record?.headless?.command;
  if (!Array.isArray(command) || !command.length || !command.every(nonEmpty)) return ['headless.command must be an argv list'];
  const laneCommands = list(lanes).flatMap((lane) => list(lane?.commands));
  const exact = laneCommands.some((each) => same(each, command));
  const workspaceTest = laneCommands.some((each) => each[0] === 'cargo' && each[1] === 'test' && each.includes('--workspace'));
  const member = command[0] === 'cargo' && command[1] === 'test' && (() => {
    const index = command.findIndex((arg) => arg === '-p' || arg === '--package');
    const name = index >= 0 ? command[index + 1] : null;
    if (!name) return false;
    const metadata = spawnSync('cargo', ['metadata', '--no-deps', '--format-version', '1', '--offline'], { cwd: repo, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    try { return metadata.status === 0 && JSON.parse(metadata.stdout).packages.some((pkg) => pkg.name === name); } catch { return false; }
  })();
  if (!exact && !(workspaceTest && member)) problems.push(`headless.command ${JSON.stringify(command)} isn't run by any local preflight lane`);
  if (command.some((arg) => /\b(xvfb|Xvfb)\b/.test(arg))) problems.push('headless.command starts a display server; it must need no display');
  const workflows = join(repo, '.github', 'workflows');
  if (existsSync(workflows) && readdirSync(workflows).length) problems.push('.github/workflows exists: checks run locally, never in CI');
  return problems;
}

// ------------------------------------------------------------------ the live headless run

// libtest's lines: `test <name> ... ok | FAILED | ignored`.
export function parseLibtest(output) {
  const results = new Map();
  for (const match of String(output).matchAll(/^test (.+?) \.\.\. (ok|FAILED|ignored)(?:,.*)?$/gm)) results.set(match[1], match[2]);
  return results;
}

// The headless tests a live run must report ok, by criterion and scope item.
export function namedTests(record) {
  const planted = record?.needsYou?.planted ?? {};
  return {
    replica: [['the replica launch', record?.launch?.test], ...list(record?.views).map((view) => [`the ${view?.id} view`, view?.test])],
    needsYou: [['the fixture panel against needs-you@1', record?.needsYou?.kit?.test], ['the fixture panel', record?.needsYou?.panel?.test], ...PLANTED.map((id) => [`planted ${id}`, planted[id]?.test])],
    parity: [['the replica against the live tree', record?.parity?.test], ['the scale-1 replica', record?.parity?.scale1?.test]],
    registry: SLOTS.map((area) => [`slot ${area}`, record?.registry?.slots?.[area]?.test]),
    canvas: [['the canvas component', record?.canvas?.test]],
  };
}

export function headlessProblems(named, run) {
  if (run.error) return [`BLOCKED: the headless command didn't run: ${run.error.message}`];
  const problems = [];
  const results = parseLibtest(run.stdout + run.stderr);
  if (!named.length) problems.push('no headless tests are named');
  for (const [what, name] of named) {
    const result = results.get(name);
    if (result !== 'ok') problems.push(`${what}: test ${JSON.stringify(name)} ${result === undefined ? "didn't run" : `reported ${result}`}`);
  }
  if (run.status !== 0) problems.push(`the headless command exited ${run.signal ?? run.status}`);
  return problems;
}

// Runs headless.command once from the repo root, with DISPLAY, WAYLAND_DISPLAY and CI unset and DEEP_338_OUT
// set to a fresh directory the tests then read.
export function runHeadless(record, repo = root) {
  const command = record?.headless?.command;
  if (!Array.isArray(command) || !command.length) return { error: Error('headless.command is missing'), stdout: '', stderr: '', out: null };
  const out = mkdtempSync(join(tmpdir(), 'deep-338-out-'));
  const env = { ...process.env, [OUT_ENV]: out };
  for (const key of ['DISPLAY', 'WAYLAND_DISPLAY', 'CI']) delete env[key];
  return { ...spawnSync(command[0], command.slice(1), { cwd: repo, env, encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 256 * 1024 * 1024 }), out };
}
