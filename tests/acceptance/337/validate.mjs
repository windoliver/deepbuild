// Shared by the #337 acceptance tests: reads the gpui-kit spike's record (docs/spikes/337/record.json)
// and the files it names, and recomputes from them what a test can recompute, instead of taking the
// spike's word: budget verdicts from their five runs, the decision from the outcomes, displayed numbers
// from the runs, file hashes, PNG headers and the decision's text in the technical design.
// Each check returns a list of problems; an empty list means it holds.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const RECORD = 'docs/spikes/337/record.json';
export const DESIGN = 'docs/technical-design.md';
export const TOOLKIT_ROW = "| The app's toolkit |";

// Criterion IDs, by the rule in tests/acceptance/48/README.md.
export const PANELS = '#337.05b344ec';
export const FALLBACK = '#337.9e506bd8';
export const STOCKS = '#337.e2f507ac';
export const BUDGETS = '#337.649cb21e';
// The criteria whose failure sends the app to the native fallback (criterion 2 names "any criterion").
export const GATED = [PANELS, STOCKS, BUDGETS];

export const AGENTS = ['claude-code', 'codex'];
export const MAX_FIX_ROUNDS = 2;
export const SESSION_ROWS = 1000;
const MB = 1_000_000; // as benchmarks/budgets.json counts megabytes
// The issue's budgets, each strictly "under" its limit.
export const LIMITS = {
  coldStartMs: { limit: 1000, units: { ms: 1, s: 1000 }, label: 'cold start' },
  idleCpuPercent: { limit: 1, units: { '%': 1 }, label: 'idle CPU' },
  memoryBytes: { limit: 200 * MB, units: { MB }, label: 'memory' },
  appBytes: { limit: 60 * MB, units: { MB }, label: 'app size' },
  preflightMs: { limit: 5 * 60_000, units: { ms: 1, s: 1000, min: 60_000 }, label: 'local preflight' },
};
const BUILD_UNITS = { ms: 1, s: 1000, min: 60_000 };
// The design's reference Mac (The reference Mac), in the field names of scripts/benchmark.mjs's fingerprint().
export const REFERENCE = { model: 'Mac15,7', chip: 'Apple M3 Pro', memoryBytes: 36 * 2 ** 30, power: 'ac', lowPowerMode: false, thermalState: 'nominal' };
// The issue's Fields for an agent-built panel (Panel runtime and panel host).
export const PANEL_LIMITS = { interrupt: true, heap: 256 * 2 ** 20, stack: 2 ** 20, microtasks: 100_000, pending: 1024 };
// Web view crates a Rust app would pull in to show web content.
const WEB_VIEW_CRATES = ['wry', 'webkit2gtk', 'webkit6', 'webview2-com', 'webview2', 'objc2-web-kit', 'cef', 'tauri'];
// Calls a panel would make to reach the network or a program itself.
const ESCAPES = [['fetch()', /\bfetch\s*\(/], ['XMLHttpRequest', /\bXMLHttpRequest\b/], ['WebSocket', /\bWebSocket\b/], ['EventSource', /\bEventSource\b/], ['child_process', /\bchild_process\b/], ['require()', /\brequire\s*\(/], ['Deno', /\bDeno\./], ['Bun', /\bBun\./]];

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const list = (value) => (Array.isArray(value) ? value : []);
const nonEmpty = (value) => typeof value === 'string' && value.trim().length > 0;
const squash = (text) => String(text).replace(/\s+/g, ' ').trim();
const finiteRuns = (runs) => Array.isArray(runs) && runs.length === 5 && runs.every((run) => typeof run === 'number' && Number.isFinite(run) && run >= 0);

export function loadRecord(path = join(root, RECORD)) {
  if (!existsSync(path)) assert.fail(`no spike record at ${RECORD}: the spike hasn't been recorded`);
  return JSON.parse(readFileSync(path, 'utf8'));
}

export function git(repo, ...args) {
  return spawnSync('git', args, { cwd: repo, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
}
const tracked = (repo, path) => nonEmpty(path) && !path.startsWith('/') && !path.split('/').includes('..') && git(repo, 'ls-files', '--error-unmatch', '--', path).status === 0;
const readTracked = (repo, path) => readFileSync(join(repo, path));

// ------------------------------------------------------------------ PNG and displayed numbers

export function pngSize(bytes) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature) || bytes.subarray(12, 16).toString('latin1') !== 'IHDR') return null;
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

// "0.42 s", "380 ms", "0.3%", "142 MB", "3.9 min": the number must equal `value` (in base units)
// to the precision it's written with.
export function displayProblem(display, value, units) {
  const match = String(display ?? '').trim().match(/^(\d+(?:\.(\d+))?)\s?(ms|s|min|%|MB)$/);
  if (!match) return `display ${JSON.stringify(display)} isn't "<number> <unit>" with a unit of ${Object.keys(units).join(', ')}`;
  const [, number, decimals = '', unit] = match;
  if (!(unit in units)) return `display ${JSON.stringify(display)} uses ${unit}, not one of ${Object.keys(units).join(', ')}`;
  const shown = Number(number), actual = value / units[unit], tolerance = 0.5 * 10 ** -decimals.length + 1e-9;
  return Math.abs(shown - actual) <= tolerance ? null : `display ${JSON.stringify(display)} isn't the recorded worst run, ${actual} ${unit}`;
}

// ------------------------------------------------------------------ budget verdicts

const offReference = (machine) => {
  const off = Object.entries(REFERENCE).filter(([key, value]) => machine?.[key] !== value).map(([key, value]) => `${key} is ${JSON.stringify(machine?.[key] ?? null)}, not ${JSON.stringify(value)}`);
  if (!nonEmpty(machine?.macosBuild)) off.push('the macOS build is missing');
  return off;
};

// The design's rule (Every task carries its own budgets): five runs after warm-up pass when all five
// are within the limit (here strictly under it, as the issue says), fail when all five are over it by
// more than the margin, the larger of 5% and the runs' spread, and are otherwise INCONCLUSIVE, as is
// every result off the reference Mac.
export function judge(runs, limit, machine) {
  if (!finiteRuns(runs)) return 'BLOCKED';
  if (offReference(machine).length) return 'INCONCLUSIVE';
  const margin = Math.max(0.05, (Math.max(...runs) - Math.min(...runs)) / limit);
  if (runs.every((run) => run < limit)) return 'PASS';
  if (runs.every((run) => run > limit * (1 + margin))) return 'FAIL';
  return 'INCONCLUSIVE';
}

export function verdicts(record) {
  return Object.fromEntries(Object.entries(LIMITS).map(([key, { limit }]) => [key, judge(record?.budgets?.[key]?.runs, limit, record?.machine)]));
}

// ------------------------------------------------------------------ outcomes, as the record states them

function panelOutcome(record) {
  const panels = list(record?.panels);
  return AGENTS.every((agent) => {
    const mine = panels.filter((panel) => panel?.agent === agent);
    const rounds = list(mine[0]?.rounds);
    return mine.length === 1 && rounds.length >= 1 && rounds.length - 1 <= MAX_FIX_ROUNDS && rounds.at(-1)?.result === 'pass';
  });
}
const stocksOutcome = (record) => record?.stocks?.result === 'pass' && record?.report?.result === 'pass';

// The criteria that failed, recomputed from the record's outcomes and runs.
export function failedCriteria(record) {
  const failed = [];
  if (!panelOutcome(record)) failed.push(PANELS);
  if (!stocksOutcome(record)) failed.push(STOCKS);
  if (Object.values(verdicts(record)).some((verdict) => verdict !== 'PASS')) failed.push(BUDGETS);
  return failed;
}

// ------------------------------------------------------------------ criterion 1: both agents' panels

export function panelProblems(record, repo = root) {
  const problems = [];
  const panels = list(record?.panels);
  const screens = new Set(list(record?.screens).map((screen) => screen?.id));
  for (const agent of AGENTS) {
    const mine = panels.filter((panel) => panel?.agent === agent);
    if (mine.length !== 1) problems.push(`${mine.length} panels recorded for ${agent}, not 1`);
  }
  for (const panel of panels.filter((each) => !AGENTS.includes(each?.agent))) problems.push(`a panel by ${JSON.stringify(panel?.agent)}, not one of ${AGENTS.join(', ')}`);
  const files = new Set();
  for (const panel of panels.filter((each) => AGENTS.includes(each?.agent))) {
    const at = `${panel.agent}'s panel`;
    if (!nonEmpty(panel.agentVersion)) problems.push(`${at}: no agentVersion`);
    if (!/\.(m?js)$/.test(panel.file ?? '') || !tracked(repo, panel.file)) problems.push(`${at}: file ${JSON.stringify(panel.file)} isn't a tracked JavaScript file`);
    else {
      if (sha256(readTracked(repo, panel.file)) !== panel.sha256) problems.push(`${at}: ${panel.file} doesn't hash to its recorded sha256`);
      if (files.has(panel.file)) problems.push(`${at}: ${panel.file} is the other agent's file too`);
      files.add(panel.file);
    }
    if (!screens.has(panel.screen)) problems.push(`${at}: screen ${JSON.stringify(panel.screen)} isn't one of the recorded screens`);
    // Written from the docs alone: every input is the issue or a doc at the merge base.
    const inputs = list(panel.inputs);
    if (!inputs.length) problems.push(`${at}: no inputs recorded`);
    for (const input of inputs) {
      if (input === 'issue#337') continue;
      if (!/^docs\//.test(input ?? '') || git(repo, 'cat-file', '-e', `${record?.mergeBase}:${input}`).status !== 0) problems.push(`${at}: input ${JSON.stringify(input)} isn't the issue or a doc at the merge base`);
    }
    const rounds = list(panel.rounds);
    if (!rounds.length) problems.push(`${at}: no rounds recorded`);
    if (rounds.length - 1 > MAX_FIX_ROUNDS) problems.push(`${at}: ${rounds.length - 1} rounds of fixes, more than ${MAX_FIX_ROUNDS}`);
    rounds.forEach((round, index) => {
      if (!['pass', 'fail'].includes(round?.result)) problems.push(`${at}: round ${index} has result ${JSON.stringify(round?.result)}, not pass or fail`);
      if (index < rounds.length - 1 && round?.result !== 'fail') problems.push(`${at}: round ${index} isn't the last but didn't fail, so it needed no fix`);
      if (index < rounds.length - 1 && !nonEmpty(round?.fix)) problems.push(`${at}: round ${index} failed with no fix named`);
    });
    if (rounds.length && rounds.at(-1)?.result !== 'pass') problems.push(`${at}: its last round didn't pass the headless test`);
    problems.push(...runtimeProblems(panel.runtime, at));
  }
  problems.push(...panelHostDecisionProblems(record));
  return problems;
}

// The issue's Fields for an agent-built panel (redrafted once, see the README). The panel host lands in R2
// (canvas-primitives "Lands"), so the spike may load an agent-built panel in process through gpui-shell, but
// only as a declared deviation: the record says which Fields it departs from and why, and the decision says
// the panels ran in process and never claims the panel host was proven.
export const HOST_FIELDS = { runtime: 'panel_host', thread: 'host_main', output: 'element_tree', jit: 'off' };
export const DEVIATION_FIELDS = Object.keys(HOST_FIELDS);
export function runtimeProblems(runtime, at) {
  const problems = [];
  if (runtime?.origin !== 'agent_built') problems.push(`${at}: origin is ${JSON.stringify(runtime?.origin)}, not agent_built`);
  if (runtime?.policy !== 'empty') problems.push(`${at}: policy is ${JSON.stringify(runtime?.policy)}, not empty (plus DeepBuild's modules)`);
  if (!(typeof runtime?.update_budget_ms === 'number' && runtime.update_budget_ms > 0 && runtime.update_budget_ms <= 4)) problems.push(`${at}: update_budget_ms is ${JSON.stringify(runtime?.update_budget_ms)}, not over 0 and at most 4`);
  for (const [key, value] of Object.entries(PANEL_LIMITS)) if (runtime?.limits?.[key] !== value) problems.push(`${at}: limits.${key} is ${JSON.stringify(runtime?.limits?.[key])}, not ${value}`);
  const deviation = runtime?.deviation;
  if (runtime?.runtime === 'panel_host') {
    if (runtime?.thread !== 'host_main') problems.push(`${at}: thread is ${JSON.stringify(runtime?.thread)}, not the host's main thread (host_main)`);
    if (runtime?.output !== 'element_tree') problems.push(`${at}: output is ${JSON.stringify(runtime?.output)}, not element_tree`);
    if (runtime?.jit !== 'off') problems.push(`${at}: jit is ${JSON.stringify(runtime?.jit)}, not off`);
    if (deviation !== undefined) problems.push(`${at}: runs in the panel_host but declares a deviation; a deviation is only for an agent-built panel run in_process`);
    return problems;
  }
  if (runtime?.runtime !== 'in_process') {
    problems.push(`${at}: runtime is ${JSON.stringify(runtime?.runtime)}, not panel_host or a declared in_process deviation`);
    return problems;
  }
  // In process: the Fields' "never in the app's process unless shipped" is broken, so it must be declared.
  if (!deviation || typeof deviation !== 'object') {
    problems.push(`${at}: an agent-built panel runs in_process with no declared deviation; only a shipped panel runs in_process, an agent-built one in the panel_host unless runtime.deviation says otherwise`);
    return problems;
  }
  if (runtime?.thread !== 'ui_main') problems.push(`${at}: in process, thread is ${JSON.stringify(runtime?.thread)}, not the UI thread (ui_main), where gpui-shell runs script`);
  if (!nonEmpty(runtime?.output)) problems.push(`${at}: output is ${JSON.stringify(runtime?.output)}, not named`);
  if (!['off', 'on'].includes(runtime?.jit)) problems.push(`${at}: jit is ${JSON.stringify(runtime?.jit)}, not off or on`);
  const differs = DEVIATION_FIELDS.filter((key) => runtime?.[key] !== HOST_FIELDS[key]);
  const listed = list(deviation.fields);
  for (const key of differs) if (!listed.includes(key)) problems.push(`${at}: ${key} is ${JSON.stringify(runtime?.[key])}, not ${HOST_FIELDS[key]}, but isn't listed in deviation.fields`);
  for (const key of listed) if (!differs.includes(key)) problems.push(`${at}: deviation.fields lists ${JSON.stringify(key)}, which doesn't depart from the panel host's Fields`);
  if (!nonEmpty(deviation.reason)) problems.push(`${at}: the deviation gives no reason`);
  if (deviation.until !== 'panel_host') problems.push(`${at}: deviation.until is ${JSON.stringify(deviation.until)}, not panel_host (the deviation lasts until the panel host lands)`);
  return problems;
}

// The decision says where the agents' panels ran, and an in-process spike never claims the panel host was proven.
const CLAIM = /\b(proven|proved|passed|passes|works|worked|verified|validated|tested|ran|runs|holds|fits)\b/i;
const NEGATION = /\b(not|never|no|untested|unproven|unmeasured|yet)\b|n't\b/i;
export function panelHostDecisionProblems(record) {
  const problems = [];
  const panels = list(record?.panels).filter((panel) => AGENTS.includes(panel?.agent));
  const where = panels.some((panel) => panel?.runtime?.runtime === 'in_process') ? 'in_process' : 'panel_host';
  const decision = record?.decision;
  if (!decision) return problems;
  if (decision.agentPanels !== where) problems.push(`decision.agentPanels is ${JSON.stringify(decision.agentPanels)}, but the agents' panels ran ${where === 'in_process' ? 'in_process' : 'in the panel_host'}`);
  if (where === 'in_process' && nonEmpty(decision.text)) {
    if (!/\bin[ -]process\b/i.test(decision.text)) problems.push('the decision text must say the agent-built panels ran in process');
    const sentences = decision.text.split(/(?<=[.;!?])\s+/).filter((sentence) => /panel host/i.test(sentence));
    if (!sentences.length) problems.push('the decision text must say the panel host is untested by the spike');
    for (const sentence of sentences) if (CLAIM.test(sentence) && !NEGATION.test(sentence)) problems.push(`the decision text claims the panel host was proven, though the panels ran in process: ${JSON.stringify(sentence)}`);
  }
  return problems;
}

// ------------------------------------------------------------------ criterion 3: stocks on recorded quotes, a report in the browser

export function stocksProblems(record, repo = root) {
  const problems = [];
  const { stocks, report } = record ?? {};
  let symbols = [];
  if (!/\.json$/.test(stocks?.quotes ?? '') || !tracked(repo, stocks.quotes)) problems.push(`stocks.quotes ${JSON.stringify(stocks?.quotes)} isn't a tracked JSON file`);
  else {
    let quotes;
    try { quotes = JSON.parse(readTracked(repo, stocks.quotes)); } catch { problems.push(`${stocks.quotes} doesn't parse as JSON`); }
    if (quotes) {
      if (!nonEmpty(quotes.recorded) || Number.isNaN(Date.parse(quotes.recorded))) problems.push(`${stocks.quotes}: recorded isn't a date`);
      if (!nonEmpty(quotes.source)) problems.push(`${stocks.quotes}: no source named`);
      const rows = list(quotes.quotes);
      if (!rows.length) problems.push(`${stocks.quotes}: no quotes`);
      rows.forEach((row, index) => {
        if (!/^[A-Z0-9.^-]{1,12}$/.test(row?.symbol ?? '') || !(typeof row?.price === 'number' && Number.isFinite(row.price) && row.price > 0) || Number.isNaN(Date.parse(row?.time ?? '')))
          problems.push(`${stocks.quotes}: quote ${index} needs a symbol, a positive price and a time`);
      });
      symbols = [...new Set(rows.map((row) => row?.symbol).filter(nonEmpty))];
    }
  }
  if (!nonEmpty(stocks?.test)) problems.push('stocks: no headless test named');
  if (stocks?.result !== 'pass') problems.push(`stocks: the panel's headless test on recorded quotes has result ${JSON.stringify(stocks?.result)}, not pass`);
  // The recorded quotes are the panel's only data: it reaches no network and no program itself.
  for (const panel of list(record?.panels)) {
    if (!tracked(repo, panel?.file)) continue;
    const source = readTracked(repo, panel.file).toString('utf8');
    for (const [name, pattern] of ESCAPES) if (pattern.test(source)) problems.push(`${panel.agent}'s panel ${panel.file} uses ${name}, reaching outside DeepBuild's modules`);
  }
  if (!nonEmpty(report?.test)) problems.push('report: no headless test named');
  if (report?.result !== 'pass') problems.push(`report: opening the report in the browser has result ${JSON.stringify(report?.result)}, not pass`);
  if (!/\.html?$/.test(report?.sample ?? '') || !tracked(repo, report.sample)) problems.push(`report.sample ${JSON.stringify(report?.sample)} isn't a tracked HTML file`);
  else {
    const html = readTracked(repo, report.sample).toString('utf8');
    for (const symbol of symbols) if (!html.includes(symbol)) problems.push(`report ${report.sample} doesn't show the recorded quote ${symbol}`);
  }
  return problems;
}

// ------------------------------------------------------------------ criterion 4: the budgets

export function budgetProblems(record, repo = root) {
  const problems = [];
  const off = offReference(record?.machine);
  if (off.length) problems.push(`not measured on the reference Mac: ${off.join('; ')}`);
  if (!/^[0-9a-f]{40}$/.test(record?.mergeBase ?? '')) problems.push('mergeBase is not a full commit hash');
  else if (git(repo, 'merge-base', '--is-ancestor', record.mergeBase, 'HEAD').status !== 0) problems.push(`mergeBase ${record.mergeBase} isn't an ancestor of HEAD`);
  const judged = verdicts(record);
  for (const [key, { limit, units, label }] of Object.entries(LIMITS)) {
    const budget = record?.budgets?.[key];
    if (!budget) { problems.push(`budgets.${key} (${label}) is missing`); continue; }
    if (!finiteRuns(budget.runs)) { problems.push(`budgets.${key}: runs must be five non-negative numbers taken after warm-up`); continue; }
    if (!nonEmpty(budget.method)) problems.push(`budgets.${key}: no method recorded`);
    const shown = displayProblem(budget.display, Math.max(...budget.runs), units);
    if (shown) problems.push(`budgets.${key}: ${shown}`);
    // Compared with the merge base: its five runs, or why it has none (it has no app yet).
    if (budget.base === null || budget.base === undefined) {
      if (key === 'preflightMs') problems.push('budgets.preflightMs: the merge base has a preflight, so its five runs are required');
      else if (!nonEmpty(budget.baseReason)) problems.push(`budgets.${key}: no merge-base runs and no baseReason`);
    } else if (!finiteRuns(budget.base.runs)) problems.push(`budgets.${key}: base.runs must be five non-negative numbers`);
    if (judged[key] === 'INCONCLUSIVE' && !off.length) problems.push(`budgets.${key} (${label}): the five runs ${JSON.stringify(budget.runs)} are neither all under ${limit} nor all over it by more than the margin; INCONCLUSIVE decides nothing`);
  }
  return problems;
}

// The toolkit passes only when every budget passes.
export function budgetGateProblems(record) {
  const judged = verdicts(record);
  const failing = Object.entries(judged).filter(([, verdict]) => verdict !== 'PASS');
  if (record?.decision?.toolkit === 'gpui-kit' && failing.length)
    return [`the decision is gpui-kit though ${failing.map(([key, verdict]) => `${LIMITS[key].label} is ${verdict} (${JSON.stringify(record.budgets?.[key]?.runs)}, limit ${LIMITS[key].limit})`).join('; ')}`];
  return [];
}

// ------------------------------------------------------------------ criterion 2: the decision

export function toolkitRow(repo = root) {
  const path = join(repo, DESIGN);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8').split('\n').find((line) => line.startsWith(TOOLKIT_ROW)) ?? null;
}

export function decisionProblems(record, repo = root) {
  const problems = [];
  const decision = record?.decision;
  if (!decision) return ['no decision recorded'];
  const failed = failedCriteria(record);
  const stated = list(decision.failed);
  const missing = failed.filter((id) => !stated.includes(id)), extra = stated.filter((id) => !failed.includes(id));
  if (missing.length) problems.push(`decision.failed omits ${missing.join(', ')}, which failed`);
  if (extra.length) problems.push(`decision.failed names ${extra.join(', ')}, which didn't fail`);
  if (decision.webView !== false) problems.push('decision.webView must be false: the app has no web view either way');
  if (failed.length) {
    if (decision.toolkit !== 'native') problems.push(`decision.toolkit is ${JSON.stringify(decision.toolkit)} though ${failed.join(', ')} failed; it must fall back to native`);
    if (decision.native?.macos !== 'Swift') problems.push('the fallback must name Swift as the native app on macOS (decision.native.macos)');
    if (decision.extensionPanels !== 'wait') problems.push('on the fallback, extension panels wait for a toolkit that passes (decision.extensionPanels: wait)');
    if (!/\bSwift\b/.test(decision.text ?? '') || !/\bwait/i.test(decision.text ?? '')) problems.push('the fallback decision text must name Swift and say extension panels wait');
  } else {
    if (decision.toolkit !== 'gpui-kit') problems.push(`decision.toolkit is ${JSON.stringify(decision.toolkit)} though every criterion passed; it must be gpui-kit`);
    if (decision.extensionPanels !== 'gpui-shell') problems.push('with gpui-kit, extension panels run in gpui-shell (decision.extensionPanels: gpui-shell)');
    if (!/\bgpui-kit\b/.test(decision.text ?? '')) problems.push('the decision text must name gpui-kit');
  }
  if (!nonEmpty(decision.text)) problems.push('no decision text');
  else {
    // The decision with its numbers: every budget's and the build's displayed number is in it.
    for (const [key] of Object.entries(LIMITS)) {
      const shown = record?.budgets?.[key]?.display;
      if (nonEmpty(shown) && !decision.text.includes(shown)) problems.push(`the decision text doesn't give ${LIMITS[key].label}, ${shown}`);
    }
    if (nonEmpty(record?.build?.display) && !decision.text.includes(record.build.display)) problems.push(`the decision text doesn't give the build time, ${record.build.display}`);
    const row = toolkitRow(repo);
    if (!row) problems.push(`${DESIGN} has no "${TOOLKIT_ROW}" row under Decided`);
    else if (!squash(row).includes(squash(decision.text))) problems.push(`${DESIGN}'s "${TOOLKIT_ROW}" row doesn't hold the decision text`);
  }
  problems.push(...webViewProblems(repo));
  return problems;
}

// No web view, on either branch of the decision: no web view crate in the lockfile.
export function webViewProblems(repo = root) {
  const path = join(repo, 'Cargo.lock');
  if (!existsSync(path)) return [];
  const names = [...readFileSync(path, 'utf8').matchAll(/^name = "([^"]+)"$/gm)].map((match) => match[1]);
  return names.filter((name) => WEB_VIEW_CRATES.includes(name)).map((name) => `Cargo.lock pulls in ${name}, a web view; the app has no web view`);
}

// ------------------------------------------------------------------ scope

export function windowProblems(record) {
  const problems = [];
  const ids = new Set(list(record?.screens).map((screen) => screen?.id));
  if (!(Number.isInteger(record?.window?.sessionRows) && record.window.sessionRows >= SESSION_ROWS)) problems.push(`window.sessionRows is ${JSON.stringify(record?.window?.sessionRows)}, not at least ${SESSION_ROWS}`);
  if (!ids.has(record?.window?.screen)) problems.push(`window.screen ${JSON.stringify(record?.window?.screen)} isn't one of the recorded screens`);
  if (!ids.has(record?.menuBar?.screen)) problems.push(`menuBar.screen ${JSON.stringify(record?.menuBar?.screen)} isn't one of the recorded screens`);
  if (!(Number.isInteger(record?.menuBar?.count) && record.menuBar.count >= 0)) problems.push(`menuBar.count is ${JSON.stringify(record?.menuBar?.count)}, not the count the menu bar showed`);
  return problems;
}

export function screenProblems(record, repo = root) {
  const problems = [];
  const screens = list(record?.screens);
  if (!screens.length) problems.push('no screens recorded');
  const ids = new Set(), hashes = new Map();
  for (const [index, screen] of screens.entries()) {
    const at = `screen ${screen?.id ?? `#${index}`}`;
    if (!nonEmpty(screen?.id) || ids.has(screen.id)) problems.push(`${at}: missing or duplicate id`);
    ids.add(screen?.id);
    if (!nonEmpty(screen?.test)) problems.push(`${at}: no headless test named`);
    if (!list(screen?.clicks).length || !list(screen?.clicks).every(nonEmpty)) problems.push(`${at}: no clicks named`);
    if (!/\.png$/.test(screen?.snapshot ?? '') || !tracked(repo, screen.snapshot)) { problems.push(`${at}: snapshot ${JSON.stringify(screen?.snapshot)} isn't a tracked PNG`); continue; }
    const bytes = readTracked(repo, screen.snapshot);
    if (!pngSize(bytes)) problems.push(`${at}: ${screen.snapshot} isn't a PNG with a size`);
    const hash = sha256(bytes);
    if (hashes.has(hash)) problems.push(`${at}: ${screen.snapshot} is the same image as screen ${hashes.get(hash)}'s`);
    hashes.set(hash, screen?.id);
  }
  const needed = [['the session list window', record?.window?.screen], ['the menu-bar count', record?.menuBar?.screen], ...list(record?.panels).map((panel) => [`${panel?.agent}'s panel`, panel?.screen])];
  for (const [what, id] of needed) if (!ids.has(id)) problems.push(`${what} has no rendered screen`);
  return problems;
}

// The headless tests run in the local preflight: a lane runs the recorded command, or the command is
// `cargo test` on a workspace crate and a lane runs `cargo test --workspace`. And no CI runs anything.
export function preflightProblems(record, lanes, repo = root) {
  const problems = [];
  const command = record?.headless?.command;
  if (!Array.isArray(command) || !command.length || !command.every(nonEmpty)) return ['headless.command must be an argv list'];
  const laneCommands = list(lanes).flatMap((lane) => list(lane?.commands));
  const exact = laneCommands.some((each) => JSON.stringify(each) === JSON.stringify(command));
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

export function buildProblems(record) {
  const build = record?.build;
  const problems = [];
  if (!(typeof build?.ms === 'number' && Number.isFinite(build.ms) && build.ms > 0)) problems.push(`build.ms is ${JSON.stringify(build?.ms)}, not a build time`);
  else { const shown = displayProblem(build.display, build.ms, BUILD_UNITS); if (shown) problems.push(`build: ${shown.replace('the recorded worst run', 'build.ms')}`); }
  if (!Array.isArray(build?.command) || !build.command.length || !build.command.every(nonEmpty)) problems.push('build.command must be the argv timed');
  if (!['clean', 'incremental'].includes(build?.kind)) problems.push('build.kind must be clean or incremental');
  return problems;
}

// ------------------------------------------------------------------ the live headless run

// libtest's lines: `test <name> ... ok | FAILED | ignored`.
export function parseLibtest(output) {
  const results = new Map();
  for (const match of String(output).matchAll(/^test (.+?) \.\.\. (ok|FAILED|ignored)(?:,.*)?$/gm)) results.set(match[1], match[2]);
  return results;
}

// The headless tests a live run must report ok: every screen's, the stocks panel's and the report's.
export function namedTests(record) {
  return {
    panels: list(record?.panels).map((panel) => [`${panel?.agent}'s panel`, list(record?.screens).find((screen) => screen?.id === panel?.screen)?.test]),
    stocks: [['the stocks panel on recorded quotes', record?.stocks?.test], ['the report opened in the browser', record?.report?.test]],
    screens: list(record?.screens).map((screen) => [`screen ${screen?.id}`, screen?.test]),
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

export function runHeadless(record, repo = root) {
  const command = record?.headless?.command;
  if (!Array.isArray(command) || !command.length) return { error: Error('headless.command is missing'), stdout: '', stderr: '' };
  const env = { ...process.env };
  for (const key of ['DISPLAY', 'WAYLAND_DISPLAY', 'CI']) delete env[key];
  return spawnSync(command[0], command.slice(1), { cwd: repo, env, encoding: 'utf8', timeout: 10 * 60_000, maxBuffer: 256 * 1024 * 1024 });
}
