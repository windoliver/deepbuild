// Proves the #337 tests themselves: each planted wrong spike must be rejected by the check its
// criterion names, and a right one, gpui-kit or the native fallback, must pass. These test the tests,
// so they pass on the base. They build a small git repo in a temporary folder.
// Run: node --test tests/acceptance/337/validator.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  BUDGETS, budgetGateProblems, budgetProblems, buildProblems, decisionProblems, displayProblem, failedCriteria, FALLBACK, headlessProblems, judge, namedTests, PANELS,
  panelProblems, parseLibtest, preflightProblems, REFERENCE, screenProblems, sha256, STOCKS, stocksProblems, TOOLKIT_ROW, windowProblems,
} from './validate.mjs';

const clone = (value) => structuredClone(value);
const rejects = (problems, pattern) => assert.ok(problems.some((problem) => pattern.test(problem)), `expected a problem matching ${pattern}, got:\n${problems.join('\n') || '(none)'}`);
const holds = (problems) => assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
const put = (path, data) => { mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, data); };
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

const GPUI_TEXT = 'gpui-kit: the spike passed. Cold start 0.42 s, idle CPU 0.3%, memory 142 MB, app 48 MB, local preflight 3.9 min, clean build 6.5 min.';
const NATIVE_TEXT = 'A small native app per platform, Swift on macOS, for the line and the count, with no web view; extension panels wait for a toolkit that passes. Cold start 1.2 s, idle CPU 0.3%, memory 142 MB, app 48 MB, local preflight 3.9 min, clean build 6.5 min.';
const designWith = (text) => `# Design\n\n### Decided\n\n| Question | Decision | Reopens |\n|---|---|---|\n${TOOLKIT_ROW} ${text} | The two-day spike fails |\n`;
const PANEL_SOURCE = { claude: 'export default function view(ui, data) { return ui.table(data.quotes("watchlist")); }\n', codex: 'export function render(h, deep) { const rows = deep.store.get("quotes"); return h.list(rows); }\n' };
const QUOTES = { recorded: '2026-10-16T20:00:00Z', source: 'a fixture recorded from a market data source', quotes: [{ symbol: 'AAPL', time: '2026-10-16T19:59:00Z', price: 231.4 }, { symbol: 'MSFT', time: '2026-10-16T19:59:00Z', price: 512.1 }] };
const LANES = [{ name: 'unit', commands: [['cargo', 'test', '--workspace', '--locked'], ['cargo', 'test', '-p', 'deep-app', '--test', 'headless']] }];

function scratchRepo(t) {
  const repo = realpathSync(mkdtempSync(join(tmpdir(), 'deep-337-test-')));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  g(repo, 'init', '-q');
  put(join(repo, 'docs/technical-design.md'), designWith('gpui-kit, if a two-day spike gets all of this working.'));
  put(join(repo, 'docs/canvas-primitives.md'), '# Canvas primitives\n');
  g(repo, 'add', '-A'); g(repo, 'commit', '-qm', 'base');
  const base = g(repo, 'rev-parse', 'HEAD');
  put(join(repo, 'docs/spikes/337/panels/claude-code/stocks.js'), PANEL_SOURCE.claude);
  put(join(repo, 'docs/spikes/337/panels/codex/stocks.js'), PANEL_SOURCE.codex);
  put(join(repo, 'docs/spikes/337/quotes.json'), JSON.stringify(QUOTES));
  put(join(repo, 'docs/spikes/337/report.html'), '<table><tr><td>AAPL</td><td>231.40</td></tr><tr><td>MSFT</td><td>512.10</td></tr></table>');
  for (const [name, width] of [['sessions', 1200], ['menu-bar', 300], ['panel-claude-code', 800], ['panel-codex', 801]]) put(join(repo, `docs/spikes/337/screens/${name}.png`), png(width, 600));
  put(join(repo, 'docs/spikes/337/screens/not-a-png.png'), 'hello');
  put(join(repo, 'Cargo.lock'), 'version = 4\n\n[[package]]\nname = "gpui-kit"\nversion = "0.1.0"\n');
  put(join(repo, 'docs/technical-design.md'), designWith(GPUI_TEXT));
  g(repo, 'add', '-A'); g(repo, 'commit', '-qm', 'spike');
  return { repo, base };
}

const runtime = () => ({ origin: 'agent_built', runtime: 'panel_host', thread: 'host_main', policy: 'empty', update_budget_ms: 4, limits: { interrupt: true, heap: 268435456, stack: 1048576, microtasks: 100000, pending: 1024 }, output: 'element_tree', jit: 'off' });
// The redrafted runtime requirement: an agent-built panel may run in process for the spike, as a declared deviation.
const IN_PROCESS_TEXT = `${GPUI_TEXT} Both agents' panels ran in process through gpui-shell; the panel host isn't tested by this spike and lands in R2.`;
const inProcess = () => ({ ...runtime(), runtime: 'in_process', thread: 'ui_main', deviation: { fields: ['runtime', 'thread'], reason: 'the panel host lands in R2; the spike loads the panels through gpui-shell in the app', until: 'panel_host' } });
function inProcessRecord(base) {
  const record = rightRecord(base);
  for (const panel of record.panels) panel.runtime = inProcess();
  Object.assign(record.decision, { agentPanels: 'in_process', text: IN_PROCESS_TEXT });
  return record;
}
const five = (value) => [value * 0.96, value * 0.98, value, value * 0.97, value * 0.99];

function rightRecord(base) {
  return {
    spike: 337,
    mergeBase: base,
    machine: { ...REFERENCE, macosBuild: '25A354' },
    window: { screen: 'sessions', sessionRows: 1000 },
    menuBar: { screen: 'menu-bar', count: 3 },
    screens: [
      { id: 'sessions', test: 'sessions::thousand_rows_scroll_and_select', snapshot: 'docs/spikes/337/screens/sessions.png', clicks: ['row 500', 'row 999'] },
      { id: 'menu-bar', test: 'menu_bar::count_opens_needs_you', snapshot: 'docs/spikes/337/screens/menu-bar.png', clicks: ['the count'] },
      { id: 'panel-claude-code', test: 'panels::claude_code_stocks', snapshot: 'docs/spikes/337/screens/panel-claude-code.png', clicks: ['AAPL row', 'Open report'] },
      { id: 'panel-codex', test: 'panels::codex_stocks', snapshot: 'docs/spikes/337/screens/panel-codex.png', clicks: ['MSFT row'] },
    ],
    panels: [
      { agent: 'claude-code', agentVersion: '2.1.0', file: 'docs/spikes/337/panels/claude-code/stocks.js', sha256: sha256(PANEL_SOURCE.claude), screen: 'panel-claude-code', inputs: ['issue#337', 'docs/technical-design.md', 'docs/canvas-primitives.md'], rounds: [{ result: 'fail', fix: 'the table component takes rows, not a source' }, { result: 'pass' }], runtime: runtime() },
      { agent: 'codex', agentVersion: '0.50.0', file: 'docs/spikes/337/panels/codex/stocks.js', sha256: sha256(PANEL_SOURCE.codex), screen: 'panel-codex', inputs: ['issue#337', 'docs/canvas-primitives.md'], rounds: [{ result: 'pass' }], runtime: runtime() },
    ],
    stocks: { quotes: 'docs/spikes/337/quotes.json', test: 'stocks::loads_recorded_quotes', result: 'pass' },
    report: { test: 'stocks::report_opens_in_browser', result: 'pass', sample: 'docs/spikes/337/report.html' },
    headless: { command: ['cargo', 'test', '-p', 'deep-app', '--test', 'headless'] },
    build: { kind: 'clean', command: ['cargo', 'build', '-p', 'deep-app', '--release', '--locked'], ms: 390_000, display: '6.5 min' },
    budgets: {
      coldStartMs: { runs: five(420), display: '0.42 s', method: 'launch to first frame of the session list', base: null, baseReason: 'the merge base has no app' },
      idleCpuPercent: { runs: five(0.3), display: '0.3%', method: 'ps %cpu over 60 s idle', base: null, baseReason: 'the merge base has no app' },
      memoryBytes: { runs: five(142e6), display: '142 MB', method: 'phys_footprint idle with 1,000 rows', base: null, baseReason: 'the merge base has no app' },
      appBytes: { runs: [48e6, 48e6, 48e6, 48e6, 48e6], display: '48 MB', method: 'du of the release app bundle', base: null, baseReason: 'the merge base has no app' },
      preflightMs: { runs: five(234_000), display: '3.9 min', method: 'scripts/preflight wall time', base: { runs: five(150_000) } },
    },
    decision: { toolkit: 'gpui-kit', failed: [], extensionPanels: 'gpui-shell', agentPanels: 'panel_host', webView: false, text: GPUI_TEXT },
  };
}

function nativeRecord(base) {
  const record = rightRecord(base);
  record.budgets.coldStartMs = { ...record.budgets.coldStartMs, runs: [1200, 1190, 1210, 1205, 1200], display: '1.2 s' };
  record.decision = { toolkit: 'native', failed: [BUDGETS], native: { macos: 'Swift' }, extensionPanels: 'wait', agentPanels: 'panel_host', webView: false, text: NATIVE_TEXT };
  return record;
}

const all = (record, repo) => [
  ...panelProblems(record, repo), ...decisionProblems(record, repo), ...stocksProblems(record, repo), ...budgetProblems(record, repo), ...budgetGateProblems(record),
  ...windowProblems(record), ...screenProblems(record, repo), ...preflightProblems(record, LANES, repo), ...buildProblems(record),
];

test('a right gpui-kit record passes every check', (t) => {
  const { repo, base } = scratchRepo(t);
  holds(all(rightRecord(base), repo));
});

test(`${PANELS} a right record whose agent-built panels ran in process, as a declared deviation, passes every check`, (t) => {
  const { repo, base } = scratchRepo(t);
  put(join(repo, 'docs/technical-design.md'), designWith(IN_PROCESS_TEXT));
  holds(all(inProcessRecord(base), repo));
});

test(`${FALLBACK} a right native record, after cold start missed its budget, passes the decision and budget checks`, (t) => {
  const { repo, base } = scratchRepo(t);
  put(join(repo, 'docs/technical-design.md'), designWith(NATIVE_TEXT));
  const record = nativeRecord(base);
  assert.deepEqual(failedCriteria(record), [BUDGETS]);
  holds(decisionProblems(record, repo));
  holds(budgetProblems(record, repo));
  holds(budgetGateProblems(record));
});

// [criterion, name, check, plant, the problem it must raise]
const planted = [
  [PANELS, 'no Codex panel', panelProblems, (r) => { r.panels.pop(); }, /0 panels recorded for codex/],
  [PANELS, 'three rounds of fixes', panelProblems, (r) => { r.panels[0].rounds = [{ result: 'fail', fix: 'a' }, { result: 'fail', fix: 'b' }, { result: 'fail', fix: 'c' }, { result: 'pass' }]; }, /3 rounds of fixes, more than 2/],
  [PANELS, 'a panel whose last round failed', panelProblems, (r) => { r.panels[1].rounds = [{ result: 'fail', fix: 'a' }]; }, /codex's panel: its last round didn't pass/],
  [PANELS, 'a failed round with no fix named', panelProblems, (r) => { delete r.panels[0].rounds[0].fix; }, /failed with no fix named/],
  [PANELS, 'a panel file that is not the recorded one', panelProblems, (r) => { r.panels[1].sha256 = sha256('other'); }, /doesn't hash to its recorded sha256/],
  [PANELS, 'a panel file that does not exist', panelProblems, (r) => { r.panels[1].file = 'docs/spikes/337/panels/codex/missing.js'; }, /isn't a tracked JavaScript file/],
  [PANELS, 'both agents credited with one file', panelProblems, (r) => { Object.assign(r.panels[1], { file: r.panels[0].file, sha256: r.panels[0].sha256 }); }, /is the other agent's file too/],
  [PANELS, 'a panel written from the code, not the docs', panelProblems, (r) => { r.panels[0].inputs.push('crates/deep-app/src/main.rs'); }, /isn't the issue or a doc at the merge base/],
  [PANELS, 'a panel written from a doc the merge base lacks', panelProblems, (r) => { r.panels[0].inputs.push('docs/spikes/337/report.html'); }, /isn't the issue or a doc at the merge base/],
  [PANELS, "an agent-built panel in the app's process, undeclared", panelProblems, (r) => { Object.assign(r.panels[0].runtime, { runtime: 'in_process', thread: 'ui_main' }); }, /runs in_process with no declared deviation/],
  [PANELS, 'an agent-built panel claiming to be shipped', panelProblems, (r) => { r.panels[1].runtime.origin = 'shipped'; }, /origin is "shipped", not agent_built/],
  [PANELS, 'JIT on for an agent-built panel in the panel host', panelProblems, (r) => { r.panels[1].runtime.jit = 'on'; }, /jit is "on"/],
  [PANELS, 'a panel-host panel declaring a deviation', panelProblems, (r) => { r.panels[1].runtime.deviation = inProcess().deviation; }, /runs in the panel_host but declares a deviation/],
  [PANELS, 'an in-process panel on a thread other than the UI thread', panelProblems, (r) => { Object.assign(r, inProcessRecord(r.mergeBase)); r.panels[0].runtime.thread = 'worker'; }, /thread is "worker", not the UI thread/],
  [PANELS, 'an in-process deviation that hides JIT on', panelProblems, (r) => { Object.assign(r, inProcessRecord(r.mergeBase)); r.panels[1].runtime.jit = 'on'; }, /jit is "on", not off, but isn't listed in deviation\.fields/],
  [PANELS, 'an in-process deviation that lists a field it keeps', panelProblems, (r) => { Object.assign(r, inProcessRecord(r.mergeBase)); r.panels[0].runtime.deviation.fields.push('output'); }, /deviation\.fields lists "output", which doesn't depart/],
  [PANELS, 'an in-process deviation with no reason', panelProblems, (r) => { Object.assign(r, inProcessRecord(r.mergeBase)); delete r.panels[0].runtime.deviation.reason; }, /the deviation gives no reason/],
  [PANELS, 'an in-process deviation with no end', panelProblems, (r) => { Object.assign(r, inProcessRecord(r.mergeBase)); delete r.panels[0].runtime.deviation.until; }, /deviation\.until is undefined, not panel_host/],
  [PANELS, 'in-process panels with a decision saying they ran in the panel host', panelProblems, (r) => { Object.assign(r, inProcessRecord(r.mergeBase)); r.decision.agentPanels = 'panel_host'; }, /decision\.agentPanels is "panel_host", but the agents' panels ran in_process/],
  [PANELS, 'in-process panels with a decision claiming the panel host was proven', panelProblems, (r) => { Object.assign(r, inProcessRecord(r.mergeBase)); r.decision.text = `${GPUI_TEXT} The panels ran in process, and the panel host was proven.`; }, /claims the panel host was proven/],
  [PANELS, 'in-process panels with a decision that never says so', panelProblems, (r) => { Object.assign(r, inProcessRecord(r.mergeBase)); r.decision.text = GPUI_TEXT; }, /must say the agent-built panels ran in process/],
  [PANELS, 'a 512 MiB heap', panelProblems, (r) => { r.panels[0].runtime.limits.heap = 512 * 2 ** 20; }, /limits\.heap is 536870912, not 268435456/],
  [PANELS, 'a 5 ms update budget', panelProblems, (r) => { r.panels[0].runtime.update_budget_ms = 5; }, /update_budget_ms is 5/],
  [PANELS, 'a panel by a third agent', panelProblems, (r) => { r.panels.push({ ...clone(r.panels[0]), agent: 'cursor' }); }, /a panel by "cursor"/],

  [FALLBACK, 'gpui-kit though a panel failed', decisionProblems, (r) => { r.panels[1].rounds = [{ result: 'fail', fix: 'a' }, { result: 'fail', fix: 'b' }, { result: 'fail', fix: 'c' }]; }, /decision\.toolkit is "gpui-kit" though #337\.05b344ec failed/],
  [FALLBACK, 'gpui-kit though the report never opened', decisionProblems, (r) => { r.report.result = 'fail'; }, /though #337\.e2f507ac failed/],
  [FALLBACK, 'gpui-kit though cold start was 1.2 s', decisionProblems, (r) => { r.budgets.coldStartMs.runs = [1200, 1200, 1200, 1200, 1200]; }, /though #337\.649cb21e failed/],
  [FALLBACK, 'a fallback that names no failed criterion', decisionProblems, (r) => { r.budgets.coldStartMs.runs = [1200, 1200, 1200, 1200, 1200]; r.decision.toolkit = 'native'; }, /decision\.failed omits #337\.649cb21e/],
  [FALLBACK, 'native though every criterion passed', decisionProblems, (r) => { Object.assign(r.decision, { toolkit: 'native', native: { macos: 'Swift' }, extensionPanels: 'wait' }); }, /though every criterion passed; it must be gpui-kit/],
  [FALLBACK, 'a failure named that did not fail', decisionProblems, (r) => { r.decision.failed = [PANELS]; }, /names #337\.05b344ec, which didn't fail/],
  [FALLBACK, 'a fallback to Electron on macOS', decisionProblems, (r) => { Object.assign(r, nativeRecord(r.mergeBase)); r.decision.native.macos = 'Electron'; }, /must name Swift/],
  [FALLBACK, 'a fallback that keeps extension panels', decisionProblems, (r) => { Object.assign(r, nativeRecord(r.mergeBase)); r.decision.extensionPanels = 'gpui-shell'; }, /extension panels wait/],
  [FALLBACK, 'a web view', decisionProblems, (r) => { r.decision.webView = true; }, /decision\.webView must be false/],
  [FALLBACK, 'a decision without its numbers', decisionProblems, (r) => { r.decision.text = 'gpui-kit: the spike passed.'; }, /doesn't give cold start, 0\.42 s/],
  [FALLBACK, 'a decision not written in the technical design', decisionProblems, (r) => { r.decision.text = `${GPUI_TEXT} More.`; }, /row doesn't hold the decision text/],
  [FALLBACK, 'no decision', decisionProblems, (r) => { delete r.decision; }, /no decision recorded/],

  [STOCKS, 'no recorded quotes', stocksProblems, (r) => { r.stocks.quotes = 'docs/spikes/337/missing.json'; }, /isn't a tracked JSON file/],
  [STOCKS, 'the stocks test failed', stocksProblems, (r) => { r.stocks.result = 'fail'; }, /stocks: .* not pass/],
  [STOCKS, 'the report never opened', stocksProblems, (r) => { r.report.result = 'fail'; }, /report: opening the report .* not pass/],
  [STOCKS, 'no kept report', stocksProblems, (r) => { delete r.report.sample; }, /report\.sample undefined isn't a tracked HTML file/],
  [STOCKS, 'a report that is not from the recorded quotes', stocksProblems, (r) => { r.stocks.quotes = 'docs/spikes/337/other-quotes.json'; }, /doesn't show the recorded quote NVDA/],
  [BUDGETS, 'cold start 1.2 s with gpui-kit', budgetGateProblems, (r) => { r.budgets.coldStartMs.runs = [1200, 1210, 1190, 1200, 1205]; }, /gpui-kit though cold start is FAIL/],
  [BUDGETS, 'memory 210 MB with gpui-kit', budgetGateProblems, (r) => { r.budgets.memoryBytes.runs = five(210e6).map((x) => x + 10e6); }, /gpui-kit though memory is FAIL/],
  [BUDGETS, 'a 61 MB app with gpui-kit', budgetGateProblems, (r) => { r.budgets.appBytes.runs = [61e6, 61e6, 61e6, 61e6, 61e6]; }, /gpui-kit though app size is/],
  [BUDGETS, 'idle CPU at exactly 1%, not under it', budgetGateProblems, (r) => { r.budgets.idleCpuPercent.runs = [1, 1, 1, 1, 1]; }, /idle CPU is INCONCLUSIVE/],
  [BUDGETS, 'idle CPU at exactly 1% decides nothing', budgetProblems, (r) => { r.budgets.idleCpuPercent.runs = [1, 1, 1, 1, 1]; r.budgets.idleCpuPercent.display = '1%'; }, /idle CPU.*INCONCLUSIVE decides nothing/],
  [BUDGETS, 'a 5.5-minute preflight with gpui-kit', budgetGateProblems, (r) => { r.budgets.preflightMs.runs = five(330_000); }, /local preflight is FAIL/],
  [BUDGETS, 'measured off the reference Mac', budgetProblems, (r) => { r.machine.model = 'Mac14,6'; }, /not measured on the reference Mac: model is "Mac14,6"/],
  [BUDGETS, 'measured on battery', budgetGateProblems, (r) => { r.machine.power = 'battery'; }, /is INCONCLUSIVE/],
  [BUDGETS, 'no macOS build', budgetProblems, (r) => { delete r.machine.macosBuild; }, /the macOS build is missing/],
  [BUDGETS, 'four runs', budgetProblems, (r) => { r.budgets.coldStartMs.runs.pop(); }, /coldStartMs: runs must be five/],
  [BUDGETS, 'no app size', budgetProblems, (r) => { delete r.budgets.appBytes; }, /budgets\.appBytes \(app size\) is missing/],
  [BUDGETS, 'a displayed number that is not the worst run', budgetProblems, (r) => { r.budgets.coldStartMs.display = '0.40 s'; }, /coldStartMs: display "0\.40 s" isn't the recorded worst run/],
  [BUDGETS, 'no merge-base preflight to compare with', budgetProblems, (r) => { r.budgets.preflightMs.base = null; }, /merge base has a preflight/],
  [BUDGETS, 'no merge-base runs and no reason', budgetProblems, (r) => { delete r.budgets.memoryBytes.baseReason; }, /no merge-base runs and no baseReason/],
  [BUDGETS, 'a merge base not in this history', budgetProblems, (r) => { r.mergeBase = '1'.repeat(40); }, /isn't an ancestor of HEAD/],

  ['scope', 'a 999-row session list', windowProblems, (r) => { r.window.sessionRows = 999; }, /sessionRows is 999/],
  ['scope', 'no menu-bar count screen', windowProblems, (r) => { r.menuBar.screen = 'tray'; }, /menuBar\.screen "tray"/],
  ['scope', 'no count read', windowProblems, (r) => { delete r.menuBar.count; }, /menuBar\.count is undefined/],
  ['scope', 'a screen with no snapshot', screenProblems, (r) => { r.screens[1].snapshot = 'docs/spikes/337/screens/none.png'; }, /isn't a tracked PNG/],
  ['scope', 'a snapshot that is not a PNG', screenProblems, (r) => { r.screens[1].snapshot = 'docs/spikes/337/screens/not-a-png.png'; }, /isn't a PNG with a size/],
  ['scope', 'one image for two screens', screenProblems, (r) => { r.screens[3].snapshot = r.screens[2].snapshot; }, /is the same image as screen panel-claude-code's/],
  ['scope', 'a screen never clicked', screenProblems, (r) => { r.screens[0].clicks = []; }, /screen sessions: no clicks named/],
  ['scope', "a panel's screen not rendered", screenProblems, (r) => { r.screens.pop(); }, /codex's panel has no rendered screen/],
  ['scope', 'headless tests outside the preflight', (r, repo) => preflightProblems(r, LANES, repo), (r) => { r.headless.command = ['cargo', 'test', '-p', 'deep-app', '--test', 'other']; }, /isn't run by any local preflight lane/],
  ['scope', 'no build time', buildProblems, (r) => { delete r.build.ms; }, /build\.ms is undefined/],
  ['scope', 'a build time display that is not the build time', buildProblems, (r) => { r.build.display = '5 min'; }, /isn't build\.ms/],
];

for (const [id, name, check, plant, pattern] of planted) {
  test(`${id} rejects a planted wrong spike: ${name}`, (t) => {
    const { repo, base } = scratchRepo(t);
    if (name === 'a report that is not from the recorded quotes') {
      put(join(repo, 'docs/spikes/337/other-quotes.json'), JSON.stringify({ ...QUOTES, quotes: [...QUOTES.quotes, { symbol: 'NVDA', time: '2026-10-16T19:59:00Z', price: 181.2 }] }));
      g(repo, 'add', '-A'); g(repo, 'commit', '-qm', 'other quotes');
    }
    const record = rightRecord(base);
    plant(record);
    rejects(check(record, repo), pattern);
  });
}

test(`${STOCKS} a panel that fetches its own quotes is refused`, (t) => {
  const { repo, base } = scratchRepo(t);
  const source = 'export default async function view(ui) { const r = await fetch("https://example.invalid/q"); return ui.table(await r.json()); }\n';
  put(join(repo, 'docs/spikes/337/panels/codex/stocks.js'), source);
  g(repo, 'add', '-A'); g(repo, 'commit', '-qm', 'fetch');
  const record = rightRecord(base);
  record.panels[1].sha256 = sha256(source);
  rejects(stocksProblems(record, repo), /codex's panel .* uses fetch\(\)/);
});

test(`${FALLBACK} a web view crate in the lockfile is refused`, (t) => {
  const { repo, base } = scratchRepo(t);
  put(join(repo, 'Cargo.lock'), 'version = 4\n\n[[package]]\nname = "wry"\nversion = "0.50.0"\n');
  rejects(decisionProblems(rightRecord(base), repo), /Cargo\.lock pulls in wry/);
});

test('scope: a CI workflow is refused', (t) => {
  const { repo, base } = scratchRepo(t);
  put(join(repo, '.github/workflows/ci.yml'), 'on: push\n');
  rejects(preflightProblems(rightRecord(base), LANES, repo), /never in CI/);
});

test(`${BUDGETS} the budget rule: under the limit passes, over by more than the margin fails, anything else or off the reference Mac is INCONCLUSIVE`, () => {
  const machine = { ...REFERENCE, macosBuild: '25A354' };
  assert.equal(judge([990, 995, 999, 980, 985], 1000, machine), 'PASS');
  assert.equal(judge([990, 995, 1000, 980, 985], 1000, machine), 'INCONCLUSIVE');
  assert.equal(judge([1200, 1200, 1200, 1200, 1200], 1000, machine), 'FAIL');
  assert.equal(judge([1040, 1040, 1040, 1040, 1040], 1000, machine), 'INCONCLUSIVE');
  assert.equal(judge([500, 500, 500, 500, 500], 1000, { ...machine, thermalState: 'fair' }), 'INCONCLUSIVE');
  assert.equal(judge([500, 500, 500, 500], 1000, machine), 'BLOCKED');
});

test('displayed numbers are read to their written precision', () => {
  assert.equal(displayProblem('0.42 s', 420, { ms: 1, s: 1000 }), null);
  assert.equal(displayProblem('420 ms', 420, { ms: 1, s: 1000 }), null);
  assert.equal(displayProblem('3.9 min', 234_000, { min: 60_000 }), null);
  assert.match(displayProblem('0.4 s', 460, { s: 1000 }), /worst run/);
  assert.match(displayProblem('48 MB', 48e6, { '%': 1 }), /uses MB/);
  assert.match(displayProblem('about half a second', 500, { s: 1000 }), /isn't "<number> <unit>"/);
});

test(`${PANELS} the live run's results: every named test must report ok, and the command must exit 0`, (t) => {
  const { base } = scratchRepo(t);
  const named = namedTests(rightRecord(base));
  const lines = (codex) => [
    'running 6 tests', 'test sessions::thousand_rows_scroll_and_select ... ok', 'test menu_bar::count_opens_needs_you ... ok',
    'test panels::claude_code_stocks ... ok', `test panels::codex_stocks ... ${codex}`, 'test stocks::loads_recorded_quotes ... ok', 'test stocks::report_opens_in_browser ... ok',
  ].join('\n');
  assert.equal(parseLibtest(lines('ok')).get('panels::codex_stocks'), 'ok');
  holds(headlessProblems(named.panels, { status: 0, stdout: lines('ok'), stderr: '' }));
  holds(headlessProblems([...named.screens, ...named.stocks], { status: 0, stdout: lines('ok'), stderr: '' }));
  rejects(headlessProblems(named.panels, { status: 101, stdout: lines('FAILED'), stderr: '' }), /codex's panel: test "panels::codex_stocks" reported FAILED/);
  rejects(headlessProblems(named.panels, { status: 0, stdout: lines('ignored'), stderr: '' }), /reported ignored/);
  rejects(headlessProblems(named.stocks, { status: 0, stdout: 'test stocks::loads_recorded_quotes ... ok', stderr: '' }), /report opened in the browser: test "stocks::report_opens_in_browser" didn't run/);
  rejects(headlessProblems(named.panels, { status: 101, stdout: lines('ok'), stderr: '' }), /exited 101/);
  rejects(headlessProblems(named.panels, { error: Error('spawn cargo ENOENT'), stdout: '', stderr: '' }), /^BLOCKED/);
});
