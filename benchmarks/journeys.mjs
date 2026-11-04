// A journey run for the perf lane's budgets (issue #37): node benchmarks/journeys.mjs run.
// It opens a record, the supervisor and an evidence store in a temp folder, and a folder whose .deepbuild/done.yaml
// names a small Node page as its stack with a three-step journey (a navigation, a click, an expect) and an end-state
// check; then runs the journey six times through the journey check kind, the first as a warm-up, and prints the
// medians as one JSON line: Playwright's own time, what the runner adds beyond it, that share, and the bytes of
// evidence one run stores. The issue's 20 MB and 10% stay in tests/acceptance/37/redraft-ac16/budgets.test.ts.
import { mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAsks } from '../packages/asks/dist/index.js';
import { runJourney } from '../packages/checks-journey/dist/index.js';
import { newRun } from '../packages/env-local/dist/index.js';
import { openEvidenceStore } from '../packages/evidence/dist/index.js';
import { openRecord } from '../packages/record/dist/index.js';
import { openSupervisor } from '../packages/supervisor/dist/index.js';

if (process.argv[2] !== 'run') throw Error('usage: node benchmarks/journeys.mjs run');
const ROUNDS = 5;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const bytesUnder = (dir) => readdirSync(dir, { withFileTypes: true }).reduce((sum, e) => sum + (e.isDirectory() ? bytesUnder(join(dir, e.name)) : statSync(join(dir, e.name)).size), 0);

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-journey-bench-')));
const app = join(dir, 'app');
mkdirSync(join(app, '.deepbuild', 'journeys'), { recursive: true });
writeFileSync(join(app, 'server.mjs'), [
  "import { createServer } from 'node:http';",
  "const page = '<!doctype html><title>Cart</title><main><h1>Cart</h1><button onclick=\"document.getElementById(\\'total\\').textContent = \\'$18.00\\'\">Add</button><p role=\"status\" aria-label=\"Total\" id=\"total\">$0.00</p></main>';",
  "createServer((q, s) => {",
  "  if (q.url === '/health') { s.writeHead(200); s.end(); return; }",
  "  if (q.url === '/cart') { s.writeHead(200, { 'content-type': 'text/html' }); s.end(page); return; }",
  "  s.writeHead(404); s.end();",
  "}).listen(Number(process.env.web), '127.0.0.1');",
  "process.on('SIGTERM', () => process.exit(0));",
  '',
].join('\n'));
writeFileSync(join(app, '.deepbuild', 'done.yaml'), `environment:\n  up: ${JSON.stringify(`${process.execPath} server.mjs`)}\n  ports: [web]\n  ready: { http: "http://127.0.0.1:\${web}/health", within: 20 }\n`);
writeFileSync(join(app, '.deepbuild', 'journeys', 'cart.yaml'), [
  'journey: cart',
  'steps:',
  '  - id: open',
  '    deadline: 15000',
  '    goto: /cart',
  '  - id: add',
  '    deadline: 5000',
  '    click: { role: button, name: Add }',
  '  - id: see-total',
  '    deadline: 5000',
  '    expect: { role: status, name: Total, text: "$18.00" }',
  'end_state:',
  '  - id: total-shown',
  '    oracle: code',
  '    locator: { role: status, name: Total }',
  '    text: "$18.00"',
  '',
].join('\n'));

const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
try {
  const own = [];
  const added = [];
  const evidence = [];
  for (let i = 0; i <= ROUNDS; i++) {
    const root = join(dir, `evidence-${i}`);
    const store = await openEvidenceStore({ root });
    const run = await runJourney({ host: sup, evidence: store, run: newRun(), checkout: app, journey: '.deepbuild/journeys/cart.yaml', trees: { checkout: app, worktree: '', others: [], digests: {} } });
    if (run.outcome !== 'passed') throw Error(`the journey ${run.outcome}: ${run.cause ?? JSON.stringify(run.failures)}`);
    // The first round warms the browser, the sandbox and the file cache; it isn't counted.
    if (i > 0) { own.push(run.timing.playwright); added.push(run.timing.total - run.timing.playwright); evidence.push(bytesUnder(root)); }
  }
  console.log(JSON.stringify({ playwrightMs: median(own), addedMs: median(added), addedPct: Math.round((median(added) / median(own)) * 1000) / 10, evidenceBytes: median(evidence) }));
} finally {
  await sup.close();
  await record.close();
  rmSync(dir, { recursive: true, force: true });
}
