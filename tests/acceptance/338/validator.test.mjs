// Proves the #338 tests themselves: each planted wrong spike must be rejected by the check its criterion
// names, and a right one must pass. These test the tests, so they pass on the base. They build a small git
// repo in a temporary folder with a record, a fixture record of asks, panels, snapshots and screenshots.
// Run: node --test tests/acceptance/338/validator.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  ASK_KINDS, canvasProblems, CLOSING, decisionProblems, firstDifference, fixtureProblems, forkProblems, headlessProblems, namedTests, needsYou, OPEN_ASKS, outDir, outProblems, OUTPUTS, parityProblems, parseLibtest,
  plantedFault, PLANTED, preflightProblems, REFERENCE, REFERENCES, registryProblems, replicaProblems, rowsProblems, sha256, SLOTS, snapshotProblems, VIEWS, WINDOW,
} from './validate.mjs';

const rejects = (problems, pattern) => assert.ok(problems.some((problem) => pattern.test(problem)), `expected a problem matching ${pattern}, got:\n${problems.join('\n') || '(none)'}`);
const holds = (problems) => assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
const put = (path, data) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, typeof data === 'string' || Buffer.isBuffer(data) ? data : JSON.stringify(data, null, 1)); };
function g(cwd, ...args) {
  const result = spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, `git ${args.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}
// A PNG's signature and IHDR chunk, which is all the tests read.
function png(width, height) {
  const ihdr = Buffer.alloc(25);
  ihdr.writeUInt32BE(13, 0); ihdr.write('IHDR', 4, 'latin1'); ihdr.writeUInt32BE(width, 8); ihdr.writeUInt32BE(height, 12); ihdr[16] = 8; ihdr[17] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), ihdr]);
}

const readKit = (dir) => readFileSync(join(dir, OUTPUTS.kit), 'utf8');

// ------------------------------------------------------------------ a fixture record of asks

const NOW = 1_800_000_000_000; // the virtual clock
const ULID = (n) => `01K8${String(n).padStart(22, '0').replace(/[^0-9A-Z]/g, '0')}`;
const ask = (n, { kind, session, deadline = NOW + 3_600_000 }) => ({ session_id: session, event: { v: 1, id: ULID(n), kind: 'ask.created', writer: 'app', actor: 'you', scope: 'you', ts: NOW - 1000, data: { kind, question: `Question ${n}?`, deadline } } });
const closing = (n, kind, subject, data) => ({ session_id: 'sess-b', event: { v: 1, id: ULID(n), kind, subject, writer: 'core', actor: 'you', scope: 'you', ts: NOW - 500, data } });

// 42 asks: 10 open in session a (five fold), 30 open across b..g (five each), one superseded (by an open
// ask of b) and one moot. One Later in session c. The held ask is in session d.
function fixtureRows() {
  const rows = [];
  let n = 0;
  const add = (row) => { rows.push(row); return row; };
  for (let i = 0; i < 10; i++) add(ask(++n, { kind: ASK_KINDS[i % 6], session: 'sess-a' }));
  for (const session of ['sess-b', 'sess-c', 'sess-d', 'sess-e', 'sess-f', 'sess-g']) for (let i = 0; i < 5; i++) add(ask(++n, { kind: ASK_KINDS[(n + i) % 6], session }));
  const superseded = add(ask(++n, { kind: 'authority', session: 'sess-b' }));
  const moot = add(ask(++n, { kind: 'taste', session: 'sess-e' }));
  const byOpen = rows.find((row) => row.session_id === 'sess-b');
  add(closing(++n, 'ask.superseded', `ask:${superseded.event.id}`, { by: `ask:${byOpen.event.id}` }));
  add(closing(++n, 'ask.moot', `ask:${moot.event.id}`, { because: 'check_passed', verdict: 'verdict:01K8V' }));
  const later = rows.find((row) => row.session_id === 'sess-c');
  add({ session_id: 'sess-c', event: { v: 1, id: ULID(++n), kind: 'ask.later', subject: `ask:${later.event.id}`, writer: 'app', actor: 'you', scope: 'you', ts: NOW - 100, data: { until: NOW + 600_000 } } });
  rows.forEach((row, index) => { row.event.log_pos = index + 1; });
  // The superseding ask must be newer than the one it supersedes: move it after.
  const bySupersedes = byOpen;
  rows.splice(rows.indexOf(bySupersedes), 1);
  rows.splice(rows.indexOf(superseded) + 1, 0, bySupersedes);
  rows.forEach((row, index) => { row.event.log_pos = index + 1; });
  return rows;
}
const jsonl = (rows) => rows.map((row) => JSON.stringify(row)).join('\n') + '\n';
const heldAsk = (rows) => `ask:${rows.find((row) => row.session_id === 'sess-d').event.id}`;

// ------------------------------------------------------------------ snapshots

const node = (role, name, bounds, children = [], value = null) => ({ role, name, value, bounds, children });
function snapshot(view, scale = 2) {
  const s = scale / 2;
  const px = (points) => Math.round(points * scale);
  const tree = node('window', 'DeepBuild', [0, 0, px(1512), px(982)], [
    node('list', 'Sessions', [0, 0, px(260), px(982)], [node('list_item', 'Session 0001', [0, px(40), px(260), px(28)])]),
    node('pane', view, [px(260), 0, px(1252), px(982)], [node('button', 'Report', [px(1400), px(8), px(90), px(24)]), node('label', `${view} ${s}`, [px(280), px(40), px(400), px(20)])]),
  ]);
  const items = view === 'session' ? [{ id: 'line#issue', value: 'PASS' }] : [];
  return { window: { size: WINDOW.size, scale }, tree, items };
}
const PANEL = { needs: 'export default function view(ui, deep) { return ui.list(deep.asks.open().map((a) => ui.row(a.handle))); }\n', slot: (area) => `export default function ${area}(ui) { return ui.text("${area}"); }\n` };
const LANES = [{ name: 'unit', commands: [['cargo', 'test', '--workspace', '--locked'], ['cargo', 'test', '-p', 'deep-app', '--test', 'replica']] }];
const ROW = '| The app\'s toolkit |';
const TEXT = 'gpui-kit stays: the panel registry fills every slot of the app and replaces Needs you, the canvas is a component registered through gpui-shell with no fork, and the replica launches headless on a virtual clock in under 2 s. The macOS GPU layer\'s IOSurface handoff costs 0.7–0.9 ms per 1936 × 1584 frame.';
const designWith = (text) => `# Design\n\n### Decided\n\n| Question | Decision | Reopens |\n|---|---|---|\n${ROW} ${text} | #338 finds a slot the registry can't fill |\n`;
const LOCK = (shellSource = 'source = "git+https://github.com/longbridge/gpui-kit?rev=1676826d9d49b90f4d7b6808b69924f58796f6f1#1676826d9d49b90f4d7b6808b69924f58796f6f1"\n') => `version = 4\n\n[[package]]\nname = "deep-app"\nversion = "0.0.0"\n\n[[package]]\nname = "gpui-kit"\nversion = "0.1.0"\nsource = "git+https://github.com/longbridge/gpui-kit?rev=1676826d9d49b90f4d7b6808b69924f58796f6f1#1676826d9d49b90f4d7b6808b69924f58796f6f1"\n\n[[package]]\nname = "gpui-shell"\nversion = "0.1.0"\n${shellSource}`;
const MANIFEST = '[package]\nname = "deep-app"\n\n[dependencies]\ngpui-kit = { git = "https://github.com/longbridge/gpui-kit", rev = "1676826d9d49b90f4d7b6808b69924f58796f6f1" }\ngpui-shell = { git = "https://github.com/longbridge/gpui-kit", rev = "1676826d9d49b90f4d7b6808b69924f58796f6f1" }\n';

// The headless run's outputs, right: written into `dir`.
function writeOut(dir, rows, { expected = needsYou(rows, rows.at(-1).event.log_pos) } = {}) {
  put(join(dir, OUTPUTS.launch), [812.4, 790.1, 845.9, 801.0, 777.7]);
  for (const view of VIEWS) {
    put(join(dir, OUTPUTS.snapshot(view)), snapshot(view));
    put(join(dir, OUTPUTS.live(view)), snapshot(view));
    put(join(dir, OUTPUTS.scale1(view)), snapshot(view, 1));
    put(join(dir, OUTPUTS.screenshot(view)), png(3024, 1964));
  }
  put(join(dir, OUTPUTS.rows), expected.rows);
  const planted = {
    cap20: expected.rows.slice(0, 20),
    'drop-folded': expected.rows.filter((handle) => !expected.folded.includes(handle)),
    'list-superseded': [...expected.rows.slice(0, 3), expected.superseded[0]?.handle ?? 'ask:NONE', ...expected.rows.slice(3)],
    'hide-newest': expected.rows.slice(0, -1),
  };
  const names = { cap20: expected.rows[25], 'drop-folded': expected.folded[2], 'list-superseded': expected.superseded[0]?.handle, 'hide-newest': expected.rows.at(-1) };
  for (const id of PLANTED) put(join(dir, OUTPUTS.plantedRows(id)), planted[id]);
  put(join(dir, OUTPUTS.kit), { fixture: { result: 'pass' }, planted: Object.fromEntries(PLANTED.map((id) => [id, { result: 'fail', names: names[id] }])) });
  put(join(dir, OUTPUTS.parity), { ...Object.fromEntries(VIEWS.map((view) => [view, { result: 'pass' }])), scale1: Object.fromEntries(VIEWS.map((view) => [view, { result: 'fail', firstNode: { index: 0 } }])) });
  put(join(dir, OUTPUTS.canvas), { component: 'canvas', arguments: [{ name: 'scene', type: 'string' }, { name: 'on_hit', type: 'callback' }, { name: 'camera', type: 'enum' }], retainedState: true });
}

function rightRecord(rows) {
  const panel = (file) => ({ file, sha256: sha256(file.includes('needs-you') ? PANEL.needs : PANEL.slot(file.split('/').at(-1).replace('.js', ''))), test: `${file.split('/').at(-1).replace('.js', '').replace(/-/g, '_')}_loads` });
  return {
    spike: 338,
    machine: { ...REFERENCE },
    out: 'docs/spikes/338/out',
    window: { ...WINDOW },
    clock: 'virtual',
    headless: { command: ['cargo', 'test', '-p', 'deep-app', '--test', 'replica'] },
    launch: { test: 'replica_launches_under_two_seconds', method: 'from spawn to the first settled frame of the shipped view, five launches after one warm-up' },
    views: VIEWS.map((id) => ({ id, test: `${id.replace('-', '_')}_snapshot_and_screenshot` })),
    needsYou: {
      fixture: 'docs/spikes/338/fixtures/needs-you.events.jsonl', log_pos: rows.at(-1).event.log_pos, now: NOW, held: heldAsk(rows),
      panel: { ...panel('docs/spikes/338/panels/needs-you.js') },
      kit: { test: 'fixture_needs_you_passes_needs_you_kit' },
      planted: Object.fromEntries(PLANTED.map((id) => [id, { file: `docs/spikes/338/panels/planted/${id}.js`, sha256: sha256(PANEL.slot(id)), test: `planted_${id.replace('-', '_')}_fails_naming_the_ask` }])),
    },
    parity: { test: 'replica_snapshot_equals_live_tree', scale1: { test: 'scale_one_replica_fails_naming_first_node' }, liveCapture: 'AXUIElement tree of the live app on the reference Mac, bounds in points times the backing scale' },
    registry: { slots: Object.fromEntries(SLOTS.map((area) => [area, { ...panel(`docs/spikes/338/panels/slots/${area}.js`), ...(area === 'replace' ? { view: 'needs-you' } : {}) }])) },
    canvas: { test: 'canvas_component_registered_with_schemas_and_retained_state' },
    decision: { registryCovers: true, fork: false, row: ROW, text: TEXT },
  };
}

function scratchRepo(t, { rows = fixtureRows(), record = rightRecord(rows), design = designWith(TEXT), lock = LOCK(), manifest = MANIFEST, rootManifest = '[workspace]\nmembers = ["crates/deep-app"]\n', out = writeOut } = {}) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'deep-338-test-')));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  g(repo, 'init', '-q');
  put(join(repo, 'docs/technical-design.md'), design);
  put(join(repo, 'Cargo.lock'), lock);
  put(join(repo, 'Cargo.toml'), rootManifest);
  put(join(repo, 'crates/deep-app/Cargo.toml'), manifest);
  put(join(repo, record.needsYou.fixture), jsonl(rows));
  put(join(repo, 'docs/spikes/338/panels/needs-you.js'), PANEL.needs);
  for (const id of PLANTED) put(join(repo, `docs/spikes/338/panels/planted/${id}.js`), PANEL.slot(id));
  for (const area of SLOTS) put(join(repo, `docs/spikes/338/panels/slots/${area}.js`), PANEL.slot(area));
  out(join(repo, record.out), rows);
  put(join(repo, 'docs/spikes/338/record.json'), record);
  g(repo, 'add', '-A'); g(repo, 'commit', '-qm', 'spike');
  return { repo, record, rows, dir: outDir(record, repo) };
}

// Every check, on one repo.
function everything({ repo, record, dir }) {
  return [
    ...outProblems(record, repo), ...replicaProblems(record, dir, repo), ...fixtureProblems(record, repo), ...rowsProblems(record, dir, repo), ...parityProblems(record, dir, repo),
    ...registryProblems(record, repo), ...canvasProblems(record, dir, repo), ...decisionProblems(record, repo), ...preflightProblems(record, LANES, repo),
  ];
}

test('a right spike passes every check', (t) => {
  holds(everything(scratchRepo(t)));
});

test('a right spike on the other reference Mac passes', (t) => {
  const rows = fixtureRows();
  const record = rightRecord(rows);
  const { name, ...hardware } = REFERENCES[0];
  record.machine = { ...record.machine, ...hardware };
  holds(everything(scratchRepo(t, { rows, record })));
});

// ------------------------------------------------------------------ criterion 1: the replica

const withOut = (t, edit, recordEdit = () => {}) => {
  const rows = fixtureRows();
  const record = rightRecord(rows);
  recordEdit(record, rows);
  return scratchRepo(t, { rows, record, out: (dir, rows) => { writeOut(dir, rows); edit(dir, rows); } });
};

test(`${'#338.6257cd5b'} wrong replicas fail`, async (t) => {
  await t.test('a launch of 2,000 ms is not under 2 s', (t) => { const r = withOut(t, (dir) => put(join(dir, OUTPUTS.launch), [812, 790, 2000, 801, 777])); rejects(replicaProblems(r.record, r.dir, r.repo), /launch isn't under 2000 ms/); });
  await t.test('four launches are not five', (t) => { const r = withOut(t, (dir) => put(join(dir, OUTPUTS.launch), [812, 790, 801, 777])); rejects(replicaProblems(r.record, r.dir, r.repo), /at least 5 launch times/); });
  await t.test('a Mac that is neither reference makes the launch time INCONCLUSIVE', (t) => { const r = withOut(t, () => {}, (record) => { record.machine.model = 'Mac14,2'; }); rejects(replicaProblems(r.record, r.dir, r.repo), /INCONCLUSIVE.*neither/); });
  await t.test('the thermal state fair is off reference', (t) => { const r = withOut(t, () => {}, (record) => { record.machine.thermalState = 'fair'; }); rejects(replicaProblems(r.record, r.dir, r.repo), /thermalState is "fair"/); });
  await t.test('a window that is not the reference window', (t) => { const r = withOut(t, () => {}, (record) => { record.window = { size: [1440, 900], scale: 2 }; }); rejects(replicaProblems(r.record, r.dir, r.repo), /not the reference window/); });
  await t.test('a replica on the real clock', (t) => { const r = withOut(t, () => {}, (record) => { record.clock = 'real'; }); rejects(replicaProblems(r.record, r.dir, r.repo), /clock is "real", not virtual/); });
  await t.test('a snapshot at scale 1', (t) => { const r = withOut(t, (dir) => put(join(dir, OUTPUTS.snapshot('sidebar')), snapshot('sidebar', 1))); rejects(replicaProblems(r.record, r.dir, r.repo), /sidebar\.json: window\.scale is 1/); });
  await t.test('a snapshot with no names', (t) => { const r = withOut(t, (dir) => { const s = snapshot('sidebar'); (function strip(n) { n.name = null; n.children.forEach(strip); })(s.tree); put(join(dir, OUTPUTS.snapshot('sidebar')), s); }); rejects(replicaProblems(r.record, r.dir, r.repo), /no node has a name/); });
  await t.test('a snapshot whose roles are not snake_case', (t) => { const r = withOut(t, (dir) => { const s = snapshot('sidebar'); s.tree.children[0].role = 'List'; put(join(dir, OUTPUTS.snapshot('sidebar')), s); }); rejects(replicaProblems(r.record, r.dir, r.repo), /role "List" isn't a snake_case/); });
  await t.test('a node outside the window', (t) => { const r = withOut(t, (dir) => { const s = snapshot('sidebar'); s.tree.children[0].bounds = [3000, 0, 100, 10]; put(join(dir, OUTPUTS.snapshot('sidebar')), s); }); rejects(replicaProblems(r.record, r.dir, r.repo), /lies outside the 3024 × 1964 px window/); });
  await t.test('bounds in fractional points, not whole pixels', (t) => { const r = withOut(t, (dir) => { const s = snapshot('sidebar'); s.tree.bounds = [0, 0, 1512.5, 982]; put(join(dir, OUTPUTS.snapshot('sidebar')), s); }); rejects(replicaProblems(r.record, r.dir, r.repo), /aren't \[x, y, w, h\] in whole device pixels/); });
  await t.test('no snapshot lists a canvas item', (t) => { const r = withOut(t, (dir) => { const s = snapshot('session'); s.items = []; put(join(dir, OUTPUTS.snapshot('session')), s); }); rejects(replicaProblems(r.record, r.dir, r.repo), /no view snapshot lists a canvas item by ID/); });
  await t.test('a screenshot at 1×', (t) => { const r = withOut(t, (dir) => put(join(dir, OUTPUTS.screenshot('needs-you')), png(1512, 982))); rejects(replicaProblems(r.record, r.dir, r.repo), /needs-you\.png is 1512 × 982, not the reference window at 2×/); });
  await t.test('a screenshot that is not a PNG', (t) => { const r = withOut(t, (dir) => put(join(dir, OUTPUTS.screenshot('needs-you')), 'hello')); rejects(replicaProblems(r.record, r.dir, r.repo), /needs-you\.png isn't a PNG/); });
  await t.test('a missing screenshot', (t) => { const r = withOut(t, (dir) => rmSync(join(dir, OUTPUTS.screenshot('session')))); rejects(replicaProblems(r.record, r.dir, r.repo), /session\.png is missing/); });
  await t.test('a shipped view left out', (t) => { const r = withOut(t, () => {}, (record) => { record.views = record.views.filter((view) => view.id !== 'session'); }); rejects(replicaProblems(r.record, r.dir, r.repo), /lacks the shipped view session/); });
  await t.test('no launch method', (t) => { const r = withOut(t, () => {}, (record) => { delete record.launch.method; }); rejects(replicaProblems(r.record, r.dir, r.repo), /launch\.method/); });
  await t.test('an output file that is not tracked', (t) => { const r = withOut(t, () => {}); put(join(r.repo, r.record.out, 'extra.json'), '{}'); rejects(outProblems(r.record, r.repo), /extra\.json in record\.out isn't tracked/); });
  await t.test('an output directory outside docs/spikes/338', (t) => { const r = withOut(t, () => {}, (record) => { record.out = 'target/out'; }); rejects(outProblems(r.record, r.repo), /isn't a directory under docs\/spikes\/338/); });
});

// ------------------------------------------------------------------ criterion 2: Needs you

const withRows = (t, edit, recordEdit = () => {}) => {
  const rows = fixtureRows();
  edit(rows);
  rows.forEach((row, index) => { row.event.log_pos = index + 1; });
  const record = rightRecord(rows);
  recordEdit(record, rows);
  return scratchRepo(t, { rows, record });
};

test(`${'#338.ed0f5115'} wrong fixture records fail`, async (t) => {
  await t.test('39 open asks', (t) => { const r = withRows(t, (rows) => { const i = rows.findIndex((row) => row.session_id === 'sess-f'); rows.splice(i, 1); }); rejects(fixtureProblems(r.record, r.repo), /39 asks are open.*not 40/); });
  await t.test('41 open asks', (t) => { const r = withRows(t, (rows) => rows.splice(-1, 0, ask(99, { kind: 'choice', session: 'sess-h' }))); rejects(fixtureProblems(r.record, r.repo), /41 asks are open.*not 40/); });
  await t.test('a kind missing', (t) => { const r = withRows(t, (rows) => { for (const row of rows) if (row.event.kind === 'ask.created' && row.event.data.kind === 'definition') row.event.data.kind = 'choice'; }); rejects(fixtureProblems(r.record, r.repo), /no open ask of kind definition/); });
  await t.test('no ask in Later', (t) => { const r = withRows(t, (rows) => rows.splice(rows.findIndex((row) => row.event.kind === 'ask.later'), 1)); rejects(fixtureProblems(r.record, r.repo), /0 open asks are in Later, not 1/); });
  await t.test('Later past the deadline', (t) => { const r = withRows(t, (rows) => { rows.find((row) => row.event.kind === 'ask.later').event.data.until = NOW + 7_200_000; }); rejects(fixtureProblems(r.record, r.repo), /never past its deadline/); });
  await t.test('Later already over on the virtual clock', (t) => { const r = withRows(t, (rows) => { rows.find((row) => row.event.kind === 'ask.later').event.data.until = NOW - 1; }); rejects(fixtureProblems(r.record, r.repo), /until a time after now/); });
  await t.test('Later on a closed ask does not count', (t) => { const r = withRows(t, (rows) => { const moot = rows.find((row) => row.event.kind === 'ask.moot'); rows.find((row) => row.event.kind === 'ask.later').event.subject = moot.event.subject; }); rejects(fixtureProblems(r.record, r.repo), /0 open asks are in Later/); });
  await t.test('no superseded ask', (t) => { const r = withRows(t, (rows) => rows.splice(rows.findIndex((row) => row.event.kind === 'ask.superseded'), 1)); rejects(fixtureProblems(r.record, r.repo), /0 asks are superseded, not 1/); });
  await t.test('superseded by an ask from another session', (t) => { const r = withRows(t, (rows) => { rows.find((row) => row.event.kind === 'ask.superseded').event.data.by = `ask:${rows.find((row) => row.session_id === 'sess-g').event.id}`; }); rejects(fixtureProblems(r.record, r.repo), /isn't a newer open ask from the same session/); });
  await t.test('no moot ask', (t) => { const r = withRows(t, (rows) => rows.splice(rows.findIndex((row) => row.event.kind === 'ask.moot'), 1)); rejects(fixtureProblems(r.record, r.repo), /0 asks are moot, not 1/); });
  await t.test('nine open asks in the folding session fold four, not five', (t) => { const r = withRows(t, (rows) => { rows.find((row) => row.session_id === 'sess-a').session_id = 'sess-z'; }); rejects(fixtureProblems(r.record, r.repo), /exactly one session with 10 open asks/); });
  await t.test('two folding sessions', (t) => { const r = withRows(t, (rows) => { for (const row of rows) if (['sess-b', 'sess-c'].includes(row.session_id)) row.session_id = 'sess-bc'; }); rejects(fixtureProblems(r.record, r.repo), /exactly one session with 10 open asks/); });
  await t.test('an open ask past its deadline on the virtual clock', (t) => { const r = withRows(t, (rows) => { rows.find((row) => row.session_id === 'sess-g').event.data.deadline = NOW - 1; }); rejects(fixtureProblems(r.record, r.repo), /deadline .* isn't after the virtual clock/); });
  await t.test('the held ask is the Later ask', (t) => { const r = withRows(t, () => {}, (record, rows) => { record.needsYou.held = rows.find((row) => row.event.kind === 'ask.later').event.subject; }); rejects(fixtureProblems(r.record, r.repo), /is the Later ask, not a held one/); });
  await t.test('the held ask is folded', (t) => { const r = withRows(t, () => {}, (record, rows) => { record.needsYou.held = `ask:${rows.filter((row) => row.session_id === 'sess-a')[7].event.id}`; }); rejects(fixtureProblems(r.record, r.repo), /in the folding session/); });
  await t.test('the held ask is closed', (t) => { const r = withRows(t, () => {}, (record, rows) => { record.needsYou.held = rows.find((row) => row.event.kind === 'ask.moot').event.subject; }); rejects(fixtureProblems(r.record, r.repo), /held .* isn't an open ask/); });
  await t.test('a log position reused', (t) => { const r = withRows(t, () => {}); const rows = r.rows.map((row) => ({ ...row, event: { ...row.event } })); rows[5].event.log_pos = rows[4].event.log_pos; put(join(r.repo, r.record.needsYou.fixture), jsonl(rows)); rejects(fixtureProblems(r.record, r.repo), /doesn't follow/); });
  await t.test('a log_pos the fixture never reaches', (t) => { const r = withRows(t, () => {}, (record) => { record.needsYou.log_pos = 999; }); rejects(fixtureProblems(r.record, r.repo), /no event in the fixture has log_pos 999/); });
  await t.test('a fixture that is not tracked', (t) => { const r = withRows(t, () => {}); r.record.needsYou.fixture = 'docs/spikes/338/fixtures/other.jsonl'; rejects(fixtureProblems(r.record, r.repo), /isn't a tracked \.jsonl file/); });
});

test(`${'#338.ed0f5115'} the rows are recomputed from the events, oldest first, superseded and moot left out, folded ones kept`, () => {
  const rows = fixtureRows();
  const view = needsYou(rows, rows.at(-1).event.log_pos);
  assert.equal(view.rows.length, OPEN_ASKS);
  assert.equal(view.folded.length, 5);
  assert.ok(view.folded.every((handle) => view.rows.includes(handle)));
  assert.ok(!view.rows.includes(view.superseded[0].handle) && !view.rows.includes(view.moot[0].handle));
  const created = view.rows.map((handle) => view.asks.get(handle).created);
  assert.deepEqual(created, [...created].sort((a, b) => a - b));
  // Before the superseding and moot events, both asks are still open.
  const earlier = needsYou(rows, rows.find((row) => row.event.kind === 'ask.superseded').event.log_pos - 1);
  assert.equal(earlier.rows.length, OPEN_ASKS + 2);
  assert.ok(CLOSING.includes('ask.cancelled'));
});

test(`${'#338.ed0f5115'} wrong Needs you views and kits fail`, async (t) => {
  const edit = (t, change, recordEdit) => withOut(t, change, recordEdit);
  const expected = (rows) => needsYou(rows, rows.at(-1).event.log_pos);
  await t.test('a view capping at 20 rows fails at row 20', (t) => { const r = edit(t, (dir, rows) => put(join(dir, OUTPUTS.rows), expected(rows).rows.slice(0, 20))); rejects(rowsProblems(r.record, r.dir, r.repo), /differ from the inbox projection's 40 rows at row 20: the view shows null/); });
  await t.test('a view dropping the folded asks', (t) => { const r = edit(t, (dir, rows) => { const e = expected(rows); put(join(dir, OUTPUTS.rows), e.rows.filter((h) => !e.folded.includes(h))); }); rejects(rowsProblems(r.record, r.dir, r.repo), /differ from the inbox projection's 40 rows at row 5/); });
  await t.test('a view listing the superseded ask', (t) => { const r = edit(t, (dir, rows) => { const e = expected(rows); put(join(dir, OUTPUTS.rows), [...e.rows, e.superseded[0].handle]); }); rejects(rowsProblems(r.record, r.dir, r.repo), /at row 40: the view shows "ask:/); });
  await t.test('a view hiding the newest ask', (t) => { const r = edit(t, (dir, rows) => put(join(dir, OUTPUTS.rows), expected(rows).rows.slice(0, -1))); rejects(rowsProblems(r.record, r.dir, r.repo), /at row 39: the view shows null, the projection "ask:/); });
  await t.test('a view hiding the oldest ask', (t) => { const r = edit(t, (dir, rows) => put(join(dir, OUTPUTS.rows), expected(rows).rows.slice(1))); rejects(rowsProblems(r.record, r.dir, r.repo), /at row 0/); });
  await t.test('a view newest first', (t) => { const r = edit(t, (dir, rows) => put(join(dir, OUTPUTS.rows), [...expected(rows).rows].reverse())); rejects(rowsProblems(r.record, r.dir, r.repo), /at row 0/); });
  await t.test('a view listing the moot ask in place of a folded one', (t) => { const r = edit(t, (dir, rows) => { const e = expected(rows); put(join(dir, OUTPUTS.rows), e.rows.map((h) => (h === e.folded[0] ? e.moot[0].handle : h))); }); rejects(rowsProblems(r.record, r.dir, r.repo), /differ from the inbox projection/); });
  await t.test('rows that are not ask handles', (t) => { const r = edit(t, (dir) => put(join(dir, OUTPUTS.rows), ['Question 1?'])); rejects(rowsProblems(r.record, r.dir, r.repo), /isn't a list of ask handles/); });
  await t.test('no rows written', (t) => { const r = edit(t, (dir) => rmSync(join(dir, OUTPUTS.rows))); rejects(rowsProblems(r.record, r.dir, r.repo), /rows\.json is missing/); });
  await t.test('the kit passing the fixture panel is not recorded', (t) => { const r = edit(t, (dir, rows) => { const kit = JSON.parse(readKit(dir)); kit.fixture.result = 'fail'; put(join(dir, OUTPUTS.kit), kit); }); rejects(rowsProblems(r.record, r.dir, r.repo), /fixture panel's needs-you@1 result is "fail"/); });
  await t.test('the kit passes a planted view', (t) => { const r = edit(t, (dir) => { const kit = JSON.parse(readKit(dir)); kit.planted.cap20.result = 'pass'; put(join(dir, OUTPUTS.kit), kit); }); rejects(rowsProblems(r.record, r.dir, r.repo), /planted cap20 has result "pass", not fail/); });
  await t.test('the kit names an ask the planted view got right', (t) => { const r = edit(t, (dir, rows) => { const kit = JSON.parse(readKit(dir)); kit.planted.cap20.names = expected(rows).rows[0]; put(join(dir, OUTPUTS.kit), kit); }); rejects(rowsProblems(r.record, r.dir, r.repo), /planted cap20 names "ask:.*not one of the asks it got wrong/); });
  await t.test('the kit names no ask', (t) => { const r = edit(t, (dir) => { const kit = JSON.parse(readKit(dir)); delete kit.planted['hide-newest'].names; put(join(dir, OUTPUTS.kit), kit); }); rejects(rowsProblems(r.record, r.dir, r.repo), /planted hide-newest names null/); });
  await t.test('a planted cap20 that caps at 19 is not the issue\'s', (t) => { const r = edit(t, (dir, rows) => put(join(dir, OUTPUTS.plantedRows('cap20')), expected(rows).rows.slice(0, 19))); rejects(rowsProblems(r.record, r.dir, r.repo), /planted cap20: its rows aren't the projection's first 20/); });
  await t.test('a planted drop-folded that drops only four', (t) => { const r = edit(t, (dir, rows) => { const e = expected(rows); put(join(dir, OUTPUTS.plantedRows('drop-folded')), e.rows.filter((h) => !e.folded.slice(1).includes(h))); }); rejects(rowsProblems(r.record, r.dir, r.repo), /planted drop-folded: its rows aren't the projection's without the 5 folded/); });
  await t.test('a planted list-superseded that lists the moot one instead', (t) => { const r = edit(t, (dir, rows) => { const e = expected(rows); put(join(dir, OUTPUTS.plantedRows('list-superseded')), [...e.rows, e.moot[0].handle]); }); rejects(rowsProblems(r.record, r.dir, r.repo), /planted list-superseded: its rows aren't the projection's plus the superseded ask/); });
  await t.test('a planted hide-newest that hides the oldest', (t) => { const r = edit(t, (dir, rows) => put(join(dir, OUTPUTS.plantedRows('hide-newest')), expected(rows).rows.slice(1))); rejects(rowsProblems(r.record, r.dir, r.repo), /planted hide-newest: its rows aren't the projection's without the newest/); });
  await t.test('a planted view with the right rows', (t) => { const r = edit(t, (dir, rows) => put(join(dir, OUTPUTS.plantedRows('hide-newest')), expected(rows).rows)); rejects(rowsProblems(r.record, r.dir, r.repo), /planted hide-newest: its rows aren't/); });
  await t.test('a planted view with no rows written', (t) => { const r = edit(t, (dir) => rmSync(join(dir, OUTPUTS.plantedRows('cap20')))); rejects(rowsProblems(r.record, r.dir, r.repo), /cap20\.rows\.json is missing/); });
  await t.test('a planted view not recorded', (t) => { const r = edit(t, () => {}, (record) => { delete record.needsYou.planted['drop-folded']; }); rejects(rowsProblems(r.record, r.dir, r.repo), /no planted view drop-folded recorded/); });
  await t.test('the fixture panel with the wrong hash', (t) => { const r = edit(t, () => {}, (record) => { record.needsYou.panel.sha256 = 'f'.repeat(64); }); rejects(rowsProblems(r.record, r.dir, r.repo), /doesn't hash to its recorded sha256/); });
  await t.test('the fixture panel reaching the network', (t) => { const r = edit(t, () => {}); put(join(r.repo, 'docs/spikes/338/panels/needs-you.js'), 'fetch("https://example.invalid")\n'); g(r.repo, 'add', '-A'); const record = { ...r.record, needsYou: { ...r.record.needsYou, panel: { ...r.record.needsYou.panel, sha256: sha256('fetch("https://example.invalid")\n') } } }; rejects(rowsProblems(record, r.dir, r.repo), /uses fetch\(\)/); });
  await t.test('no kit test named', (t) => { const r = edit(t, () => {}, (record) => { delete record.needsYou.kit; }); rejects(rowsProblems(r.record, r.dir, r.repo), /kit\.test names no headless test/); });
});

test('plantedFault knows each fault and nothing else', () => {
  const rows = fixtureRows();
  const e = needsYou(rows, rows.at(-1).event.log_pos);
  assert.deepEqual(plantedFault('cap20', e.rows.slice(0, 20), e).wrong, e.rows.slice(20));
  assert.deepEqual(plantedFault('drop-folded', e.rows.filter((h) => !e.folded.includes(h)), e).wrong, e.folded);
  assert.deepEqual(plantedFault('list-superseded', [e.superseded[0].handle, ...e.rows], e).wrong, [e.superseded[0].handle]);
  assert.deepEqual(plantedFault('hide-newest', e.rows.slice(0, -1), e).wrong, e.rows.slice(-1));
  assert.match(plantedFault('cap20', e.rows, e).problem, /first 20/);
  assert.match(plantedFault('other', e.rows, e).problem, /unknown planted view/);
});

// ------------------------------------------------------------------ criterion 3: parity

test(`${'#338.78331b15'} wrong replicas fail against the live tree`, async (t) => {
  await t.test('a snapshot one pixel off the live tree names the view and the node', (t) => { const r = withOut(t, (dir) => { const s = snapshot('sidebar'); s.tree.children[1].children[0].bounds[0] += 1; put(join(dir, OUTPUTS.snapshot('sidebar')), s); }); rejects(parityProblems(r.record, r.dir, r.repo), /sidebar: the replica's snapshot differs from the live tree: node 4 \(button "Report"\) differs in bounds/); });
  await t.test('a snapshot with a node missing', (t) => { const r = withOut(t, (dir) => { const s = snapshot('needs-you'); s.tree.children[1].children.pop(); put(join(dir, OUTPUTS.snapshot('needs-you')), s); }); rejects(parityProblems(r.record, r.dir, r.repo), /needs-you: .* the first tree ends at node 5/); });
  await t.test('a snapshot with a different name', (t) => { const r = withOut(t, (dir) => { const s = snapshot('session'); s.tree.children[0].children[0].name = 'Session 0002'; put(join(dir, OUTPUTS.snapshot('session')), s); }); rejects(parityProblems(r.record, r.dir, r.repo), /session: .* node 2 \(list_item "Session 0002"\) differs in name: "Session 0002" vs "Session 0001"/); });
  await t.test('a snapshot with a different role', (t) => { const r = withOut(t, (dir) => { const s = snapshot('session'); s.tree.children[0].role = 'table'; put(join(dir, OUTPUTS.snapshot('session')), s); }); rejects(parityProblems(r.record, r.dir, r.repo), /node 1 \(table "Sessions"\) differs in role/); });
  await t.test('a scale-1 replica whose snapshot equals the live tree', (t) => { const r = withOut(t, (dir) => put(join(dir, OUTPUTS.scale1('sidebar')), { ...snapshot('sidebar'), window: { size: WINDOW.size, scale: 1 } })); rejects(parityProblems(r.record, r.dir, r.repo), /sidebar: the scale-1 replica's snapshot equals the live tree/); });
  await t.test('a scale-1 file that is not at scale 1', (t) => { const r = withOut(t, (dir) => put(join(dir, OUTPUTS.scale1('sidebar')), snapshot('sidebar'))); rejects(parityProblems(r.record, r.dir, r.repo), /sidebar\.scale1\.json: window\.scale is 2, not 1/); });
  await t.test('the scale-1 verdict names the wrong node', (t) => { const r = withOut(t, (dir) => { const p = { ...Object.fromEntries(VIEWS.map((v) => [v, { result: 'pass' }])), scale1: Object.fromEntries(VIEWS.map((v) => [v, { result: 'fail', firstNode: { index: v === 'session' ? 3 : 0 } }])) }; put(join(dir, OUTPUTS.parity), p); }); rejects(parityProblems(r.record, r.dir, r.repo), /scale1\.session names node 3 as the first that differs; it's node 0/); });
  await t.test('the scale-1 verdict passes', (t) => { const r = withOut(t, (dir) => { const p = { ...Object.fromEntries(VIEWS.map((v) => [v, { result: 'pass' }])), scale1: Object.fromEntries(VIEWS.map((v) => [v, { result: v === 'sidebar' ? 'pass' : 'fail', firstNode: { index: 0 } }])) }; put(join(dir, OUTPUTS.parity), p); }); rejects(parityProblems(r.record, r.dir, r.repo), /scale1\.sidebar has result "pass", not fail/); });
  await t.test('a parity verdict that fails a view', (t) => { const r = withOut(t, (dir) => { const p = { ...Object.fromEntries(VIEWS.map((v) => [v, { result: v === 'session' ? 'fail' : 'pass' }])), scale1: Object.fromEntries(VIEWS.map((v) => [v, { result: 'fail', firstNode: { index: 0 } }])) }; put(join(dir, OUTPUTS.parity), p); }); rejects(parityProblems(r.record, r.dir, r.repo), /session has result "fail", not pass/); });
  await t.test('no live tree for a view', (t) => { const r = withOut(t, (dir) => rmSync(join(dir, OUTPUTS.live('session')))); rejects(parityProblems(r.record, r.dir, r.repo), /live\/session\.json is missing/); });
  await t.test('no scale-1 snapshot', (t) => { const r = withOut(t, (dir) => rmSync(join(dir, OUTPUTS.scale1('needs-you')))); rejects(parityProblems(r.record, r.dir, r.repo), /needs-you\.scale1\.json is missing/); });
  await t.test('a live tree captured off the reference Mac', (t) => { const r = withOut(t, () => {}, (record) => { record.machine.memoryBytes = 8 * 2 ** 30; }); rejects(parityProblems(r.record, r.dir, r.repo), /live tree wasn't captured on a reference Mac/); });
  await t.test('no account of how the live tree was read', (t) => { const r = withOut(t, () => {}, (record) => { delete record.parity.liveCapture; }); rejects(parityProblems(r.record, r.dir, r.repo), /liveCapture/); });
});

test('firstDifference is null for equal trees and names the first node otherwise', () => {
  assert.equal(firstDifference(snapshot('sidebar'), snapshot('sidebar')), null);
  assert.equal(firstDifference(snapshot('sidebar'), snapshot('sidebar', 1)).index, 0);
  holds(snapshotProblems(snapshot('sidebar'), 'x'));
  rejects(snapshotProblems({ window: WINDOW, tree: { role: 'window', bounds: [0, 0, 1, 1] }, items: 'no' }, 'x'), /items isn't a list/);
});

// ------------------------------------------------------------------ scope: registry, canvas, decision, preflight

test('scope: wrong registries, canvases, decisions and preflights fail', async (t) => {
  const edit = (recordEdit) => { const rows = fixtureRows(); const record = rightRecord(rows); recordEdit(record); return { rows, record }; };
  await t.test('a slot missing', (t) => { const { rows, record } = edit((r) => { delete r.registry.slots.line; }); const s = scratchRepo(t, { rows, record }); rejects(registryProblems(s.record, s.repo), /registry\.slots lacks line/); });
  await t.test('two slots sharing one panel', (t) => { const { rows, record } = edit((r) => { r.registry.slots.home = { ...r.registry.slots.sidebar }; }); const s = scratchRepo(t, { rows, record }); rejects(registryProblems(s.record, s.repo), /two slots share one panel file/); });
  await t.test('a replacement of another view', (t) => { const { rows, record } = edit((r) => { r.registry.slots.replace.view = 'numbers'; }); const s = scratchRepo(t, { rows, record }); rejects(registryProblems(s.record, s.repo), /replaces "numbers", not the shipped needs-you view/); });
  await t.test('an area the issue does not name', (t) => { const { rows, record } = edit((r) => { r.registry.slots.toolbar = { ...r.registry.slots.sidebar, file: 'docs/spikes/338/panels/slots/line.js' }; }); const s = scratchRepo(t, { rows, record }); rejects(registryProblems(s.record, s.repo), /names toolbar, not one of/); });
  await t.test('a slot panel with the wrong hash', (t) => { const { rows, record } = edit((r) => { r.registry.slots.tab.sha256 = '0'.repeat(64); }); const s = scratchRepo(t, { rows, record }); rejects(registryProblems(s.record, s.repo), /slot tab: .* doesn't hash/); });
  await t.test('a slot with no test', (t) => { const { rows, record } = edit((r) => { delete r.registry.slots.home.test; }); const s = scratchRepo(t, { rows, record }); rejects(registryProblems(s.record, s.repo), /slot home: no headless test named/); });
  await t.test('a decision that the registry does not cover', (t) => { const { rows, record } = edit((r) => { r.decision.registryCovers = false; }); const s = scratchRepo(t, { rows, record }); rejects(registryProblems(s.record, s.repo), /registryCovers is false/); });
  await t.test('no canvas output', (t) => { const r = withOut(t, (dir) => rmSync(join(dir, OUTPUTS.canvas))); rejects(canvasProblems(r.record, r.dir, r.repo), /canvas\.json is missing/); });
  await t.test('a canvas with no argument schemas', (t) => { const r = withOut(t, (dir) => put(join(dir, OUTPUTS.canvas), { component: 'canvas', arguments: [], retainedState: true })); rejects(canvasProblems(r.record, r.dir, r.repo), /no argument schemas/); });
  await t.test('an argument of an unknown type', (t) => { const r = withOut(t, (dir) => put(join(dir, OUTPUTS.canvas), { component: 'canvas', arguments: [{ name: 'scene', type: 'json' }], retainedState: true })); rejects(canvasProblems(r.record, r.dir, r.repo), /arguments\[0\] isn't \{name, type\}/); });
  await t.test('a canvas with no retained state', (t) => { const r = withOut(t, (dir) => put(join(dir, OUTPUTS.canvas), { component: 'canvas', arguments: [{ name: 'scene', type: 'string' }], retainedState: false })); rejects(canvasProblems(r.record, r.dir, r.repo), /retainedState is false/); });
  await t.test('gpui-shell from a fork', (t) => { const s = scratchRepo(t, { lock: LOCK('source = "git+https://github.com/windoliver/gpui-kit?branch=canvas#abc"\n') }); rejects(forkProblems(s.repo), /gpui-shell comes from .*windoliver.*a fork/); });
  await t.test('gpui-shell vendored into the workspace', (t) => { const s = scratchRepo(t, { lock: LOCK('') }); rejects(forkProblems(s.repo), /gpui-shell comes from "this workspace"/); });
  await t.test('a [patch] table', (t) => { const s = scratchRepo(t, { rootManifest: '[workspace]\nmembers = ["crates/deep-app"]\n\n[patch."https://github.com/longbridge/gpui-kit"]\ngpui-shell = { path = "vendor/gpui-shell" }\n' }); rejects(forkProblems(s.repo), /Cargo\.toml has a \[patch\] table/); });
  await t.test('a path dependency', (t) => { const s = scratchRepo(t, { manifest: '[package]\nname = "deep-app"\n\n[dependencies]\ngpui-shell = { path = "../../vendor/gpui-shell" }\n' }); rejects(forkProblems(s.repo), /gpui-shell comes from a path/); });
  await t.test('a decision without the IOSurface handoff', (t) => { const text = TEXT.replace('IOSurface', 'surface'); const { rows, record } = edit((r) => { r.decision.text = text; }); const s = scratchRepo(t, { rows, record, design: designWith(text) }); rejects(decisionProblems(s.record, s.repo), /IOSurface/); });
  await t.test('a decision without the cost', (t) => { const text = TEXT.replace('0.7–0.9 ms', 'a fraction of a frame'); const { rows, record } = edit((r) => { r.decision.text = text; }); const s = scratchRepo(t, { rows, record, design: designWith(text) }); rejects(decisionProblems(s.record, s.repo), /cost in ms/); });
  await t.test('a decision not in the design', (t) => { const { rows, record } = edit(() => {}); const s = scratchRepo(t, { rows, record, design: designWith('gpui-kit, pending #338.') }); rejects(decisionProblems(s.record, s.repo), /row doesn't hold the decision text/); });
  await t.test('a decision in a row the design lacks', (t) => { const { rows, record } = edit((r) => { r.decision.row = '| The replica |'; }); const s = scratchRepo(t, { rows, record }); rejects(decisionProblems(s.record, s.repo), /has no row starting/); });
  await t.test('a decision silent on the registry', (t) => { const text = TEXT.replace('the panel registry fills', 'the panels fill'); const { rows, record } = edit((r) => { r.decision.text = text; }); const s = scratchRepo(t, { rows, record, design: designWith(text) }); rejects(decisionProblems(s.record, s.repo), /registry/); });
  await t.test('a decision claiming a fork', (t) => { const { rows, record } = edit((r) => { r.decision.fork = true; }); const s = scratchRepo(t, { rows, record }); rejects(decisionProblems(s.record, s.repo), /fork must be false/); });
  await t.test('a headless command no lane runs', (t) => { const { rows, record } = edit((r) => { r.headless.command = ['node', 'scripts/replica.mjs']; }); const s = scratchRepo(t, { rows, record }); rejects(preflightProblems(s.record, LANES, s.repo), /isn't run by any local preflight lane/); });
  await t.test('a workflow file', (t) => { const s = scratchRepo(t); put(join(s.repo, '.github/workflows/ci.yml'), 'on: push\n'); rejects(preflightProblems(s.record, LANES, s.repo), /\.github\/workflows exists/); });
});

// ------------------------------------------------------------------ the live run's results

test('libtest results: every named test must report ok and the command exit 0', () => {
  const record = rightRecord(fixtureRows());
  const named = namedTests(record);
  const all = [...named.replica, ...named.needsYou, ...named.parity, ...named.registry, ...named.canvas];
  assert.equal(all.length, 1 + 3 + 2 + 4 + 2 + 5 + 1);
  const ok = all.map(([, name]) => `test ${name} ... ok`).join('\n');
  holds(headlessProblems(all, { status: 0, stdout: ok, stderr: '' }));
  rejects(headlessProblems(all, { status: 0, stdout: ok.replace(`test ${record.parity.scale1.test} ... ok`, `test ${record.parity.scale1.test} ... FAILED`), stderr: '' }), /the scale-1 replica: .* reported FAILED/);
  rejects(headlessProblems(all, { status: 0, stdout: ok.replace(`test ${record.launch.test} ... ok\n`, ''), stderr: '' }), /the replica launch: .* didn't run/);
  rejects(headlessProblems(all, { status: 0, stdout: ok.replace(`test ${record.canvas.test} ... ok`, `test ${record.canvas.test} ... ignored`), stderr: '' }), /the canvas component: .* reported ignored/);
  rejects(headlessProblems(all, { status: 101, stdout: ok, stderr: '' }), /exited 101/);
  rejects(headlessProblems(all, { error: Error('spawn cargo ENOENT'), stdout: '', stderr: '' }), /^BLOCKED/);
  assert.deepEqual([...parseLibtest('test a::b ... ok\ntest c ... FAILED\nnoise\ntest d ... ignored, reason').entries()], [['a::b', 'ok'], ['c', 'FAILED'], ['d', 'ignored']]);
});
