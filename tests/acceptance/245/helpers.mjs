// Shared by the #245 acceptance tests. The spike is reached only through what it leaves in the
// repo: its record at spikes/245/record.json and its rule at spikes/245/rule.mjs (README.md has
// the shapes). Nothing here times anything or builds anything.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const root = realpathSync(fileURLToPath(new URL('../../../', import.meta.url)));
export const RECORD = 'spikes/245/record.json';
export const RULE = 'spikes/245/rule.mjs';
export const FORMS = ['one_instance', 'copy_on_write'];

// The issue's parameters and thresholds (Scope), and the design's reference Macs and run conditions
// (Budgets: "The reference Macs"; a timing counts only on mains power, Low Power Mode off, thermal nominal).
export const AGENTS = 8000;
export const RATE_HZ = 60;
export const BLOCKS = 8;
export const THREADS = { one_instance: 1, copy_on_write: 4 };
export const MAX_RATIO = 0.5; // copy_on_write's step wall time at most half one_instance's
export const MAX_OVERHEAD_MS = 0.3; // mapping and page-fault overhead strictly under 0.3 ms a step
export const MIN_STEPS = 300; // a timing's p95 is over every step of the run, at least 300 (design: Budgets)
export const REFERENCE_MACS = ['Mac15,7', 'Mac15,12', 'Mac17,10'];

export function loadRecord() {
  const path = join(root, RECORD);
  if (!existsSync(path)) throw new Error(`BLOCKED: the spike left no record at ${RECORD}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new Error(`INVALID: ${RECORD} is not JSON: ${e.message}`);
  }
}

export async function loadRule() {
  const path = join(root, RULE);
  if (!existsSync(path)) throw new Error(`BLOCKED: the spike left no rule module at ${RULE}`);
  const mod = await import(pathToFileURL(path).href);
  if (typeof mod.verdict !== 'function') throw new Error(`INVALID: ${RULE} exports no function verdict(record)`);
  return mod.verdict;
}

const finite = (x) => typeof x === 'number' && Number.isFinite(x);
const obj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);

// The test's own copy of the rule, written from the issue alone, so a wrong rule module and a wrong
// stored verdict that agree with each other still fail. Anything missing, malformed, off the
// reference Mac or off the issue's parameters is one_instance (invariant 2).
export function expectedVerdict(r) {
  if (!obj(r) || !obj(r.host) || !obj(r.fixture) || !obj(r.forms)) return 'one_instance';
  const h = r.host;
  if (!REFERENCE_MACS.includes(h.model) || h.os !== 'macOS') return 'one_instance';
  if (typeof h.os_build !== 'string' || h.os_build.trim() === '') return 'one_instance';
  if (h.power !== 'ac' || h.low_power_mode !== false || h.thermal !== 'nominal') return 'one_instance';
  const f = r.fixture;
  if (f.agents !== AGENTS || f.rate_hz !== RATE_HZ || f.blocks !== BLOCKS) return 'one_instance';
  for (const name of FORMS) {
    const m = r.forms[name];
    if (!obj(m) || m.threads !== THREADS[name]) return 'one_instance';
    if (!Number.isInteger(m.steps) || m.steps < MIN_STEPS) return 'one_instance';
    if (!obj(m.wall_ms) || !obj(m.overhead_ms)) return 'one_instance';
    const { p50: w50, p95: w95 } = m.wall_ms;
    const { p50: o50, p95: o95 } = m.overhead_ms;
    if (![w50, w95, o50, o95].every(finite)) return 'one_instance';
    if (!(w50 > 0) || w50 > w95 || o50 < 0 || o50 > o95) return 'one_instance';
  }
  const one = r.forms.one_instance;
  const cow = r.forms.copy_on_write;
  if (cow.wall_ms.p50 > MAX_RATIO * one.wall_ms.p50) return 'one_instance';
  if (cow.wall_ms.p95 > MAX_RATIO * one.wall_ms.p95) return 'one_instance';
  if (!(cow.overhead_ms.p95 < MAX_OVERHEAD_MS)) return 'one_instance';
  return 'copy_on_write';
}

// Nearest-rank percentile: the ceil(q·n)-th smallest sample.
export function nearestRank(samples, q) {
  const s = [...samples].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(q * s.length) - 1)];
}

export const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

// A repo-relative path that stays inside the checkout, or null.
export function inRepo(p) {
  if (typeof p !== 'string' || p === '' || isAbsolute(p)) return null;
  const abs = join(root, p);
  const rel = relative(root, abs);
  if (rel.startsWith('..') || rel.split(sep).includes('..')) return null;
  return abs;
}

// A planted record on the reference Mac with the issue's parameters. one_instance takes 10 ms at
// p50 and 12 ms at p95; copy_on_write takes `ratio` of that, with `overhead` ms at p50 and p95.
export function planted({ ratio, overhead, ratio95 = ratio, overhead50 = overhead, verdict } = {}) {
  const r = {
    issue: 245,
    host: { model: 'Mac17,10', os: 'macOS', os_build: '26.1 (25B78)', power: 'ac', low_power_mode: false, thermal: 'nominal' },
    fixture: { path: 'spikes/245/planted.wat', sha256: '0'.repeat(64), agents: AGENTS, rate_hz: RATE_HZ, blocks: BLOCKS },
    forms: {
      one_instance: { threads: 1, steps: 600, wall_ms: { p50: 10, p95: 12 }, overhead_ms: { p50: 0.05, p95: 0.08 } },
      copy_on_write: {
        threads: 4,
        steps: 600,
        wall_ms: { p50: +(10 * ratio).toFixed(6), p95: +(12 * ratio95).toFixed(6) },
        overhead_ms: { p50: overhead50, p95: overhead },
      },
    },
  };
  if (verdict !== undefined) r.verdict = verdict;
  return r;
}

export const clone = (x) => structuredClone(x);
