#!/usr/bin/env node
// #3222: builds record.json's readings from the harness's kept output in out/, and prints the README's tables.
//
//   node docs/spikes/3222/analyze.mjs           rewrites record.json's `runs` and `planted` from out/, keeping the rest
//   node docs/spikes/3222/analyze.mjs tables    prints the tables README.md holds, from record.json and out/
//
// A call's wait is startedMs - arrivedMs and its service repliedMs - startedMs (harness.mjs). Percentiles are by
// nearest rank: the smallest value with at least p of the values at or below it.
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const RECORD = join(HERE, 'record.json');
const HEAVY = 'tests/acceptance/671/fixtures/scene.json';
const KINDS = ['revision', 'patch', 'check', 'render_back_2d', 'render_back_3d'];

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const percentile = (values, p) => { const s = [...values].sort((a, b) => a - b); return s[Math.max(0, Math.ceil(p * s.length) - 1)]; };
const waitOf = (c) => c.startedMs - c.arrivedMs;
const serviceOf = (c) => c.repliedMs - c.startedMs;
const stat = (rows, of) => ({ p50: percentile(rows.map(of), 0.5), p95: percentile(rows.map(of), 0.95) });

/** A kept output, by its path relative to this folder: the run as the record names it, and the parsed output. */
function kept(out, args) {
  const text = readFileSync(join(HERE, out), 'utf8');
  return { run: { command: `node docs/spikes/3222/harness.mjs ${args} --home <tmp>/h --out docs/spikes/3222/${out}`, out, sha256: sha256(text) }, output: JSON.parse(text) };
}

/** How service grows over a run: the first call's, and the median of the first 20 and of the last 20, in the order the core started them. */
function growth(calls) {
  const s = [...calls].sort((a, b) => a.startedMs - b.startedMs).map(serviceOf);
  return { first_call_ms: s[0], first_20_p50: percentile(s.slice(0, 20), 0.5), last_20_p50: percentile(s.slice(-20), 0.5), held_last: Math.max(...calls.map((c) => c.held)) };
}

function readings() {
  const runs = {};
  for (const n of [1, 4, 16]) {
    const { run, output } = kept(`out/sessions-${n}.json`, `--sessions ${n}`);
    const kinds = {};
    for (const kind of [...new Set(output.calls.map((c) => c.kind))].sort()) {
      const rows = output.calls.filter((c) => c.kind === kind);
      kinds[kind] = { calls: rows.length, wait: stat(rows, waitOf), service: stat(rows, serviceOf) };
    }
    runs[String(n)] = {
      ...run, date: output.date, load: output.load, kinds,
      all: { calls: output.calls.length, wait: stat(output.calls, waitOf), service: stat(output.calls, serviceOf), behind: stat(output.calls, (c) => c.parts.behind) },
      service_growth: growth(output.calls),
    };
  }
  const without = kept('out/patches-15.json', '--sessions 15 --patches');
  const slow = kept('out/patches-15-slow.json', '--sessions 15 --patches --slow');
  const patchesOf = (o) => new Map(o.calls.filter((c) => c.kind === 'patch' && !c.planted).map((c) => [`${c.session} ${c.doc}`, c]));
  const a = patchesOf(slow.output), b = patchesOf(without.output);
  const planted = slow.output.calls.find((c) => c.planted);
  const patches = [...a.entries()].sort(([, x], [, y]) => x.arrivedMs - y.arrivedMs).map(([k, s]) => {
    const w = b.get(k);
    return { session: s.session, doc: s.doc, slow: waitOf(s), without: waitOf(w), service_slow: serviceOf(s), service_without: serviceOf(w) };
  });
  return {
    runs,
    planted: {
      fixture: { path: HEAVY, sha256: sha256(readFileSync(join(REPO, HEAVY))), size: [640, 480] },
      slow: { ...slow.run, date: slow.output.date, load: slow.output.load, call: { wait: waitOf(planted), service: serviceOf(planted) } },
      without: { ...without.run, date: without.output.date, load: without.output.load },
      patches,
    },
  };
}

const record = JSON.parse(readFileSync(RECORD, 'utf8'));
if (process.argv[2] === 'tables') {
  const ms = (x) => (x >= 10_000 ? `${(x / 1000).toFixed(1)} s` : `${Math.round(x)} ms`);
  const out = [];
  out.push('| Sessions | Kind | Calls | Wait p50 | Wait p95 | Service p50 | Service p95 |', '|---|---|---|---|---|---|---|');
  for (const n of ['1', '4', '16']) {
    const run = record.runs[n];
    for (const kind of KINDS) { const k = run.kinds[kind]; out.push(`| ${n} | ${kind} | ${k.calls} | ${ms(k.wait.p50)} | ${ms(k.wait.p95)} | ${ms(k.service.p50)} | ${ms(k.service.p95)} |`); }
    const a = run.all;
    out.push(`| ${n} | every call | ${a.calls} | ${ms(a.wait.p50)} | ${ms(a.wait.p95)} | ${ms(a.service.p50)} | ${ms(a.service.p95)} |`);
  }
  out.push('', '| Sessions | Run taken (UTC) | Load at start (1, 5, 15 min) | Load at end | First call\'s service | Service p50, first 20 calls | Service p50, last 20 calls | Calls held at the end |', '|---|---|---|---|---|---|---|---|');
  for (const n of ['1', '4', '16']) {
    const r = record.runs[n]; const g = r.service_growth;
    out.push(`| ${n} | ${r.date.slice(0, 19).replace('T', ' ')} | ${r.load.start.join(', ')} | ${r.load.end.join(', ')} | ${ms(g.first_call_ms)} | ${ms(g.first_20_p50)} | ${ms(g.last_20_p50)} | ${g.held_last} |`);
  }
  out.push('', '| Patch (in arrival order with the slow call) | Wait, slow call in flight | Wait, no slow call | Service, slow call in flight | Service, no slow call |', '|---|---|---|---|---|');
  record.planted.patches.forEach((p, i) => out.push(`| ${i + 1}: session ${p.session.slice(0, 8)} on ${p.doc} | ${ms(p.slow)} | ${ms(p.without)} | ${ms(p.service_slow)} | ${ms(p.service_without)} |`));
  process.stdout.write(`${out.join('\n')}\n`);
} else {
  const { runs, planted } = readings();
  writeFileSync(RECORD, `${JSON.stringify({ ...record, runs, planted }, null, 1)}\n`);
}
