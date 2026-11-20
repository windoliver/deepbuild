// Shared by the #2401 acceptance tests. The spike is reached only through what it leaves in the repo: its committed
// record at spikes/2401/record.json, its write-up at spikes/2401/README.md, the row under Decided in
// docs/technical-design.md, and the owner's taste call in tests/acceptance/2401/TASTE.json. README.md has the shapes.
// Nothing here runs Claude Code: the 40 runs spend plan usage and run once, by hand (the issue's "Runs on" line).
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const SPIKE = 'spikes/2401';
export const RECORD = `${SPIKE}/record.json`;
export const WRITE_UP = `${SPIKE}/README.md`;
export const DESIGN = 'docs/technical-design.md';
export const TASTE = 'tests/acceptance/2401/TASTE.json';
export const FACTS = 'adapters/claude-code.facts.json';

// The issue's criteria, by the trace lane's ID (first eight hex digits of the SHA-256 of each criterion's text).
export const AC = {
  1: '#2401.ed54ac04',
  2: '#2401.fb765468',
  3: '#2401.96860f79',
  4: '#2401.76fa3238',
  5: '#2401.4cfdbe12',
};

// Scope: Claude Code's default for -p, and CLAUDE_CODE_ENTRYPOINT=deepbuild. No other client's name, ever.
export const LABELS = ['default', 'deepbuild'];
export const ENTRYPOINT = { default: null, deepbuild: 'deepbuild' };
export const RUNS_PER_LABEL = 20;
// AC2: with fewer than 15 kept runs on either side the reading is INCONCLUSIVE and gives no ratio.
export const MIN_KEPT = 15;
// Scope: the rule written before the runs. The 1.25 is #1796's.
export const RATIO_FLOOR = 1.25;
export const OUTCOMES = ['not set', 'offered and off'];
export const DECISIONS = [...OUTCOMES, 'on by default'];
export const WINDOWS = ['five_hour', 'seven_day'];
// Design, Budgets: "The reference Macs". The issue: "Runs on: The reference Mac".
export const REFERENCE_MACS = ['Mac15,7', 'Mac15,12', 'Mac17,10'];
// The job flags that take a tool out of a Claude Code run.
export const REMOVING_FLAG = /^--(?:disallowedTools|disallowed-tools|tools)(?:[ =]|$)/;
// Hosts of Claude Code's maker, where its own written word can be linked from.
export const MAKER_HOST = /(^|\.)(anthropic\.com|claude\.com|claude\.ai)$/i;

export const obj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
export const count = (x) => Number.isInteger(x) && x >= 0;
export const finite = (x) => typeof x === 'number' && Number.isFinite(x);
export const iso = (x) => typeof x === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?(\.\d+)?(Z|[+-]\d\d:\d\d)$/.test(x) && !Number.isNaN(Date.parse(x));
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
// Recorded readings are compared with what the runs give, to a relative 1e-3 (a value rounded to four figures).
export const close = (a, b) => finite(a) && finite(b) && Math.abs(a - b) <= 1e-3 * Math.max(Math.abs(a), Math.abs(b), 1e-9);

export function readText(rel, what) {
  const path = join(root, rel);
  if (!existsSync(path)) throw new Error(`BLOCKED: ${what} is not at ${rel}`);
  return readFileSync(path, 'utf8');
}

// The committed record of the 40 runs, made on a reference Mac.
export function loadRecord() {
  const text = readText(RECORD, 'the record of the 40 runs');
  let r;
  try {
    r = JSON.parse(text);
  } catch (e) {
    throw new Error(`INVALID: ${RECORD} is not JSON: ${e.message}`);
  }
  if (!obj(r) || r.issue !== 2401) throw new Error(`INVALID: ${RECORD} is not #2401's record (issue: ${JSON.stringify(r?.issue)})`);
  const h = r.host;
  if (!obj(h) || !REFERENCE_MACS.includes(h.model) || h.os !== 'macOS' || typeof h.os_build !== 'string' || !h.os_build.trim()) {
    throw new Error(`INVALID: ${RECORD} wasn't made on a reference Mac (${REFERENCE_MACS.join(', ')}) with its macOS build named: host ${JSON.stringify(h)}`);
  }
  if (!Array.isArray(r.runs)) throw new Error(`INVALID: ${RECORD} has no runs list`);
  return r;
}

export function loadFacts() {
  return JSON.parse(readText(FACTS, "Claude Code's adapter facts"));
}

// A run's tokens, all four kinds: what the window percent is per million of.
export const total = (t) => t.input + t.output + t.cache_creation + t.cache_read;

// The runs by their order, each checked for the fields every test reads. Fails on the first malformed run.
export function runs(r) {
  const list = [...r.runs].sort((a, b) => a?.n - b?.n);
  for (const [i, run] of list.entries()) {
    const at = `${RECORD} runs[n=${run?.n}]`;
    assert.ok(obj(run) && run.n === i + 1, `${RECORD}: the runs are numbered 1 to ${list.length} in order, but the ${i + 1}th is ${JSON.stringify(run?.n)}`);
    assert.ok(LABELS.includes(run.label), `${at}: label is one of ${LABELS.join(', ')}: ${JSON.stringify(run.label)}`);
    const t = run.tokens;
    assert.ok(obj(t) && ['input', 'output', 'cache_creation', 'cache_read'].every((k) => count(t[k])), `${at}: tokens by kind (input, output, cache_creation, cache_read), each a count: ${JSON.stringify(t)}`);
    assert.ok(total(t) > 0, `${at}: the run used no tokens`);
    assert.ok(obj(run.window) && WINDOWS.every((w) => obj(run.window[w]) && 'before' in run.window[w] && 'after' in run.window[w]), `${at}: window.five_hour and window.seven_day, each with before and after (a reading, or null for unknown): ${JSON.stringify(run.window)}`);
    for (const w of WINDOWS) {
      for (const side of ['before', 'after']) {
        const v = run.window[w][side];
        assert.ok(v === null || (obj(v) && finite(v.used_percent) && v.used_percent >= 0 && v.used_percent <= 100 && (v.resets_at === null || finite(v.resets_at))),
          `${at}: window.${w}.${side} is null (unknown, never zero) or {used_percent 0..100, resets_at epoch seconds or null}: ${JSON.stringify(v)}`);
      }
    }
    assert.ok(obj(run.first_entry) && obj(run.result_entry), `${at}: the stream's first entry and its result entry are on the record`);
  }
  return list;
}

// A window's change over a run, or null when it can't be read: a reading missing on either side, or a reset between.
export function change(run, w) {
  const { before, after } = run.window[w];
  if (!before || !after || before.resets_at !== after.resets_at) return null;
  return after.used_percent - before.used_percent;
}

export const rate = (run, w) => change(run, w) / (total(run.tokens) / 1e6);

// AC1: a run is kept only when it ended in success and its 5-hour window moved by no more than its own use: its
// tokens at the ceiling the record fixed before the runs (own_use.max_pct_per_mtok). A move it can't explain, a
// reset, a fall or a missing reading leaves it out.
export function whyLeftOut(r, run) {
  const res = run.result_entry;
  if (res.subtype !== 'success' || res.is_error !== false) return `the run ended ${res.subtype}${res.is_error ? ' (is_error)' : ''}`;
  const c = change(run, 'five_hour');
  if (c === null) return 'its 5-hour window was not read on both sides, or reset during the run';
  if (c < 0) return 'its 5-hour window fell during the run';
  const own = (total(run.tokens) / 1e6) * r.own_use.max_pct_per_mtok;
  if (c > own + 1e-9) return `its 5-hour window moved ${c} points, more than its own use (${own})`;
  return null;
}

// AC2: the reading of one window, recomputed from the runs: per label the kept runs behind it, the pooled window
// percent per million tokens and its range over those runs; their ratio (default over deepbuild) only with at least
// 15 kept on each side. The weekly reading uses the 5-hour reading's kept runs whose weekly window was read.
export function recompute(r, list, w) {
  const out = { status: 'MEASURED' };
  for (const label of LABELS) {
    const kept = list.filter((run) => run.label === label && whyLeftOut(r, run) === null && change(run, w) !== null && change(run, w) >= 0);
    const rates = kept.map((run) => rate(run, w));
    const sumChange = kept.reduce((s, run) => s + change(run, w), 0);
    const sumTokens = kept.reduce((s, run) => s + total(run.tokens), 0);
    out[label] = {
      runs: kept.map((run) => run.n),
      pct_per_mtok: kept.length ? sumChange / (sumTokens / 1e6) : null,
      range: kept.length ? [Math.min(...rates), Math.max(...rates)] : null,
    };
  }
  const [d, b] = [out.default, out.deepbuild];
  if (d.runs.length < MIN_KEPT || b.runs.length < MIN_KEPT || !(b.pct_per_mtok > 0)) {
    out.status = 'INCONCLUSIVE';
    out.ratio = null;
    out.ranges_apart = null;
  } else {
    out.ratio = d.pct_per_mtok / b.pct_per_mtok;
    out.ranges_apart = d.range[0] > b.range[1] || b.range[0] > d.range[1];
  }
  return out;
}

// Scope: the rule written before the runs, on the 5-hour reading.
export function outcome(reading) {
  if (reading.status !== 'MEASURED') return 'not set';
  return reading.ratio >= RATIO_FLOOR && reading.ranges_apart ? 'offered and off' : 'not set';
}

// Strings that must never be on the record or in the write-up: an account or session UUID, a key or token, a home
// path, an email address (AGENTS.md: no secrets or personal data in evidence).
export const SECRETS = [
  ['a UUID (an account or session ID)', /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i],
  ['an Anthropic key or token', /sk-ant-[A-Za-z0-9_-]+/],
  ['an account field', /accountUuid|organizationUuid|emailAddress|oauthAccount/],
  ['a home path', /\/Users\/[^/\s"]+|\/home\/[^/\s"]+/],
  ['an email address', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/],
];

// The rows of the table under "### Decided", each split into cells outside backtick spans.
export function decidedRows(text) {
  const start = text.search(/^### Decided\s*$/m);
  if (start < 0) return [];
  const rest = text.slice(text.indexOf('\n', start) + 1);
  const end = rest.search(/^#{1,3} /m);
  const section = end < 0 ? rest : rest.slice(0, end);
  return section.split('\n').filter((l) => l.startsWith('|') && !/^\|\s*-/.test(l) && !/^\|\s*Question\s*\|/.test(l)).map((line) => {
    const cells = [];
    let cell = '', code = false;
    for (const ch of line.slice(1)) {
      if (ch === '`') code = !code;
      if (ch === '|' && !code) cells.push(cell.trim()), (cell = '');
      else cell += ch;
    }
    return { line, cells };
  });
}

// The ways a reading's date (YYYY-MM-DD) may be written in the design: as is, or with its month's name.
export function dateForms(day) {
  const d = new Date(`${day}T00:00:00Z`);
  const long = d.toLocaleString('en-US', { month: 'long', timeZone: 'UTC' });
  const short = d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const n = d.getUTCDate(), y = d.getUTCFullYear();
  return [day, `${long} ${n}, ${y}`, `${long} ${n} ${y}`, `${short} ${n} ${y}`, `${short} ${n}, ${y}`, `${n} ${long} ${y}`];
}

// Markdown links in a text, as URLs.
export const links = (text) => [...text.matchAll(/\]\((https?:\/\/[^)\s]+)\)/g)].map(([, url]) => url);
export const fromMaker = (url) => {
  try {
    return MAKER_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
};
