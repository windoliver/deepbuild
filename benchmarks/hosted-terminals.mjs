// Hosted terminals' budgets (issue #104): node benchmarks/hosted-terminals.mjs <60hz|ten>. One process opens a record,
// the asks core, the supervisor and project trust in a temp folder, installs a package that asks for run-as-you,
// approves it on the trusted path and loads it, then:
// - 60hz: one hosted terminal whose program writes 120 numbered lines, one every 1/60 s; it fails unless every line
//   is in the terminal's output, in order, 250 ms after the last is written;
// - ten: 10 hosted terminals whose programs each write 10,000 lines of scrollback; it fails unless each holds them all.
// Then it revokes run-as-you, which stops them. The issue's limits (under 5% of a core at 60 updates a second, 10
// terminals under 300 MB) stay in tests/acceptance/104/budgets.test.ts.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAsks } from '../packages/asks/dist/index.js';
import { openExtensionHost, openTrust, packageDigest } from '../packages/extension-host/dist/index.js';
import { openRecord } from '../packages/record/dist/index.js';
import { openSupervisor } from '../packages/supervisor/dist/index.js';

const CASES = { '60hz': { terminals: 1, lines: 120, rate: 60 }, ten: { terminals: 10, lines: 10_000, rate: 0 } };
const which = CASES[process.argv[2]];
if (!which) throw Error('usage: node benchmarks/hosted-terminals.mjs <60hz|ten>');
const YOU = { writer: 'app', actor: 'you', scope: 'you' };
const ID = 'bench/terminals';
const CODE = `export default function (deep: any): void {
  deep.registerAction('ext.terminals.open', { declares: 'change', input: { type: 'object' } }, (i: any) => deep.terminal.open({ argv: i.argv, cwd: i.cwd, cols: 120, rows: 36, title: i.title }));
  deep.registerAction('ext.terminals.read', { declares: 'read', input: { type: 'object' } }, (i: any) => deep.terminal.read(i.terminal, i.from));
}
`;
// Line k at start + (k - 1)/rate s, or as fast as the terminal takes them with rate 0; then it idles.
const PROGRAM = `
const [count, rate] = process.argv.slice(2).map(Number);
const start = Date.now() + 100;
const wait = (ms) => { if (ms > 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
for (let k = 1; k <= count; k++) {
  if (rate) wait(start + ((k - 1) * 1000) / rate - Date.now());
  process.stdout.write('L' + String(k).padStart(8, '0') + ' a line of a hosted terminal\\n');
}
setInterval(() => {}, 1000);
`;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-term-bench-')));
const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 172_800_000 } } } });
const trust = await openTrust({ record, now: Date.now });
const home = join(dir, 'home');
mkdirSync(home);
const host = await openExtensionHost({ record, supervisor, trust, home, release: [], now: Date.now });
try {
  await host.ready();
  const folder = join(dir, 'pkg');
  mkdirSync(folder);
  writeFileSync(join(folder, 'index.ts'), CODE);
  writeFileSync(join(dir, 'program.cjs'), PROGRAM);
  const manifest = {
    id: ID, version: '1.0.0', digest: '', access: { words: ['run_as_you'] }, host: { runs: 'terminals', lives: 'past_app', owns: ['terminals'] },
    actions: ['ext.terminals.open', 'ext.terminals.read'],
  };
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  manifest.digest = packageDigest(folder);
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  const pkg = await host.install({ from: folder, builtBy: null });
  const checked = await host.check(pkg);
  if (!checked.passed) throw Error(`${ID} failed conformance: ${checked.reasons.join('; ')}`);
  await host.approve(YOU, ID, 'run_as_you');
  const load = await host.load(pkg);
  if (load.status !== 'loaded') throw Error(`${ID} didn't load: ${load.reason}`);
  const call = async (action, input) => {
    const r = await host.callAction({ action, target: { handle: `ext:${ID}`, version: '1.0.0' }, input, caller: YOU });
    if (r.status !== 'done') throw Error(`${action}: ${r.reason}`);
    return r.output;
  };
  const argv = [process.execPath, join(dir, 'program.cjs'), String(which.lines), String(which.rate)];
  const opened = [];
  for (let i = 0; i < which.terminals; i++) opened.push(await call('ext.terminals.open', { argv, cwd: dir, title: `t${i}` }));
  const lines = async (terminal) => {
    let text = '';
    for (let from = 0; ;) {
      const r = await call('ext.terminals.read', { terminal, from });
      text += r.text;
      if (r.next === from) return text.match(/^L\d{8} /gm) ?? [];
      from = r.next;
    }
  };
  const until = Date.now() + 100 + (which.rate ? (which.lines * 1000) / which.rate : 0) + 250;
  for (const t of opened) {
    for (;;) {
      const seen = await lines(t.terminal);
      if (seen.length === which.lines && seen.every((l, k) => l === `L${String(k + 1).padStart(8, '0')} `)) break;
      if (Date.now() > until + (which.rate ? 0 : 30_000)) throw Error(`${t.terminal} holds ${seen.length} of ${which.lines} lines in order`);
      await sleep(20);
    }
  }
  await host.revoke(YOU, ID, 'run_as_you');
} finally {
  await host.close();
  await supervisor.close();
  await record.close();
  rmSync(dir, { recursive: true, force: true });
}
