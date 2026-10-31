// One replica workload per run, for the perf lane's budgets (issue #124): node benchmarks/replica.mjs <mode>.
// Each starts `target/debug/deep-drive --out <temp>` on a temp home, drives it over stdin with #124's fixture
// panels, prints its readings as one JSON line, then ends the replica's stdin and waits for it to exit.
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const DRIVE = join(REPO, 'target', 'debug', 'deep-drive');
const FIXTURES = join(REPO, 'tests', 'acceptance', '124', 'fixtures');
const PANEL = { form: join(FIXTURES, 'panels', 'save-form'), many: join(FIXTURES, 'panels', 'many-nodes') };

/** A deep-drive process: `call` sends one line and resolves with its reply and the milliseconds it took. */
async function start(home) {
  const child = spawn(DRIVE, ['--out', join(home, 'out')], { env: { ...process.env, HOME: home }, stdio: ['pipe', 'pipe', 'inherit'] });
  const waiting = [];
  createInterface({ input: child.stdout }).on('line', (line) => waiting.shift()?.(JSON.parse(line)));
  const exited = new Promise((done) => child.once('exit', done));
  const next = () => new Promise((resolve) => waiting.push(resolve));
  const ready = await next();
  if (ready.ready !== true) throw Error(`deep-drive did not say it was ready: ${JSON.stringify(ready)}`);
  return {
    async call(line) {
      const t0 = performance.now();
      const reply = next();
      child.stdin.write(`${JSON.stringify(line)}\n`);
      const value = await reply;
      if (value.ok !== true) throw Error(`deep-drive refused ${line.call}: ${JSON.stringify(value).slice(0, 400)}`);
      return { reply: value, ms: performance.now() - t0 };
    },
    async end() {
      child.stdin.end();
      await exited;
    },
  };
}
const launch = async (drive, panel) => (await drive.call({ call: 'launch', launch: { from: 'fixture', panel, clock: 'virtual' } })).reply.replica;

const modes = {
  // From spawning deep-drive to launch's answer on the fixture panel.
  async launch(home) {
    const t0 = performance.now();
    const drive = await start(home);
    await launch(drive, PANEL.form);
    const launchMs = performance.now() - t0;
    await drive.end();
    return { launchMs };
  },
  // 100 clicks on a field already visible, enabled and still: each round trip less the wait it reports.
  async action(home) {
    const drive = await start(home);
    const replica = await launch(drive, PANEL.form);
    const click = { call: 'act', replica, locator: { label: 'Email' }, act: { kind: 'click' } };
    await drive.call(click);
    let total = 0;
    for (let i = 0; i < 100; i++) {
      const { reply, ms } = await drive.call(click);
      total += ms - reply.waited_ms;
    }
    await drive.end();
    return { actionMs: total / 100 };
  },
  // 100 snapshots of the 2,000-node panel.
  async 'snapshot-2000'(home) {
    const drive = await start(home);
    const replica = await launch(drive, PANEL.many);
    const see = { call: 'see', replica, see: { scope: 'window', include: ['roles', 'names', 'values', 'bounds'] } };
    await drive.call(see);
    let total = 0;
    for (let i = 0; i < 100; i++) total += (await drive.call(see)).ms;
    await drive.end();
    return { snapshotMs: total / 100 };
  },
  // The recorded Claude Code run replayed on the fixture panel; /usr/bin/time reads the replica's peak memory.
  async memory(home) {
    const drive = await start(home);
    const { calls } = JSON.parse(readFileSync(join(FIXTURES, 'runs', 'claude-code.run.json'), 'utf8'));
    let replica;
    for (const call of calls) {
      if (call.call === 'launch') replica = await launch(drive, PANEL.form);
      else await drive.call({ ...call, replica });
    }
    await drive.end();
    return { calls: calls.length };
  },
};

const mode = process.argv[2];
if (!modes[mode]) throw Error(`Unknown mode ${mode}; one of: ${Object.keys(modes).join(', ')}`);
const home = realpathSync(mkdtempSync('/tmp/deep-replica-bench-'));
try {
  console.log(JSON.stringify({ bench: 'replica', mode, ...(await modes[mode](home)) }));
} finally {
  rmSync(home, { recursive: true, force: true });
}
