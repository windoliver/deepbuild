// Hand e2e for #1907: a real journey check through check.kind@1 (journeyCheckKind), the slot a hub fills, run with the
// packages built in ROOT (argv[2]): the cart journey that passes, and one whose end state expects the wrong total.
// Prints each CheckResult with run-to-run noise (temp paths, hashes, ports, times) normalized, so two ROOTs diff.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = process.argv[2];
const im = (p) => import(pathToFileURL(join(ROOT, p)).href);
const { journeyCheckKind } = await im('packages/checks-journey/dist/index.js');
const { openAsks } = await im('packages/asks/dist/index.js');
const { openRecord } = await im('packages/record/dist/index.js');
const { openSupervisor } = await im('packages/supervisor/dist/index.js');

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'e2e-1907-')));
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
const journey = (id, total) => [
  `journey: ${id}`, 'steps:',
  '  - id: open', '    deadline: 15000', '    goto: /cart',
  '  - id: add', '    deadline: 5000', '    click: { role: button, name: Add }',
  '  - id: see-total', '    deadline: 5000', '    expect: { role: status, name: Total, text: "$18.00" }',
  'end_state:', '  - id: total-shown', '    oracle: code', '    locator: { role: status, name: Total }', `    text: "${total}"`, '',
].join('\n');
writeFileSync(join(app, '.deepbuild', 'journeys', 'cart.yaml'), journey('cart', '$18.00'));
writeFileSync(join(app, '.deepbuild', 'journeys', 'cart-wrong.yaml'), journey('cart-wrong', '$19.00'));

const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
const sup = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 86_400_000 } } } });
const ids = new Map();
const norm = (s) => s
  .replaceAll(dir, '<tmp>').replaceAll(ROOT, '<root>')
  .replace(/\b[0-9a-f]{64}\b/g, (h) => { if (!ids.has(h)) ids.set(h, `<sha#${ids.size + 1}>`); return ids.get(h); })
  .replace(/127\.0\.0\.1:\d+/g, '127.0.0.1:<port>');
try {
  const kind = journeyCheckKind(sup);
  for (const runner of ['.deepbuild/journeys/cart.yaml', '.deepbuild/journeys/cart-wrong.yaml']) {
    const r = await kind.run({ kind: 'journey', runner, inputs: [] }, { checkout: app, deadline: 120_000 });
    console.log(`== ${runner}: outcome ${r.outcome}, testsRun ${r.testsRun}, failures ${r.failures.length}, evidence ${r.evidence.length}`);
    console.log(norm(JSON.stringify(r, null, 1)));
  }
} finally {
  await sup.close();
  await record.close();
  rmSync(dir, { recursive: true, force: true });
}
