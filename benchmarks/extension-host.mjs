// The extension host's budgets (issue #348): node benchmarks/extension-host.mjs. One process opens a record, the
// asks core, the supervisor and project trust in a temp folder, then, for a package in the hub (one the release
// lists) and one in the platform sandbox:
// - loadMs: the median time of host.load for 10 TypeScript packages, each its own files, checked and the hub ready
//   first, so the load runs the package's code;
// - eventMs: what the host adds per event per subscribed package: the median time to deliver a batch of 2,000
//   session.start events with 4 packages subscribed, minus the median for the same batch with none, over
//   (2,000 x 4); a difference over a large batch, never a ratio.
// It prints the four readings as one JSON line. The issue's limits (100 ms, 0.5 ms) stay in
// tests/acceptance/348/budgets.test.ts.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAsks } from '../packages/asks/dist/index.js';
import { openExtensionHost, openTrust, packageDigest } from '../packages/extension-host/dist/index.js';
import { openRecord } from '../packages/record/dist/index.js';
import { openSupervisor } from '../packages/supervisor/dist/index.js';

const LOADS = 10;
const SUBSCRIBED = 4;
const EVENTS = 2000;
const BATCHES = 5;
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const CODE = `let seen = 0;
export default function (deep: any): void {
  deep.on('session.start', () => { seen++; });
}
`;

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-ext-bench-')));
const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 172_800_000 } } } });
const trust = await openTrust({ record, now: Date.now });
let made = 0;
let homes = 0;
/** A package of its own: a fresh id and files, its digest stamped. */
function pkg() {
  const n = ++made;
  const folder = join(dir, `pkg${n}`);
  mkdirSync(folder);
  writeFileSync(join(folder, 'index.ts'), CODE);
  const manifest = { id: `bench/sub${n}`, version: '1.0.0', digest: '', access: { words: ['record'] } };
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  manifest.digest = packageDigest(folder);
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  return { folder, entry: { id: manifest.id, version: manifest.version, digest: manifest.digest } };
}
/** A ready host on a home of its own, its release listing `count` new packages when in the hub, each installed and checked. */
async function hostWith(place, count) {
  const made = Array.from({ length: count }, pkg);
  const home = join(dir, `home${++homes}`);
  mkdirSync(home);
  const host = await openExtensionHost({ record, supervisor, trust, home, release: place === 'hub' ? made.map((p) => p.entry) : [], now: Date.now });
  await host.ready();
  const installed = [];
  for (const p of made) {
    const i = await host.install({ from: p.folder, builtBy: null, grant: { record: ['session.start'] } });
    const c = await host.check(i);
    if (!c.passed) throw Error(`${i.id} failed conformance: ${c.reasons.join('; ')}`);
    installed.push(i);
  }
  return { host, installed };
}
const events = Array.from({ length: EVENTS }, (_, i) => ({
  v: 1, id: `01K74FKZVK8Q2X5R7M3N9P${String(i).padStart(4, '0')}`, kind: 'session.start', writer: 'hook', actor: 'you', scope: 'you', ts: Date.now(), log_pos: i + 1,
  data: { agent: 'claude-code', worktree: '~/src/shop', branch: 'main', thread: '01K74G1Z3X5V7T9R1P3N5M7K9H' }, evidence: [],
}));
async function deliverMs(host) {
  const times = [];
  for (let i = 0; i < BATCHES; i++) {
    const t0 = performance.now();
    await host.deliver(events);
    times.push(performance.now() - t0);
  }
  return median(times);
}

const readings = { loadMs: {}, eventMs: {} };
try {
  for (const place of ['hub', 'sandbox']) {
    const { host, installed } = await hostWith(place, LOADS);
    const times = [];
    for (const i of installed) {
      const t0 = performance.now();
      const load = await host.load(i);
      times.push(performance.now() - t0);
      if (load.status !== 'loaded' || load.place !== place) throw Error(`${i.id} loaded ${JSON.stringify(load)}, not in the ${place}`);
    }
    await host.close();
    readings.loadMs[place] = median(times);

    const subscribed = await hostWith(place, SUBSCRIBED);
    for (const i of subscribed.installed) await subscribed.host.load(i);
    const none = await hostWith(place, 0);
    const withMs = await deliverMs(subscribed.host);
    const withoutMs = await deliverMs(none.host);
    readings.eventMs[place] = (withMs - withoutMs) / (EVENTS * SUBSCRIBED);
    await subscribed.host.close();
    await none.host.close();
  }
  console.log(JSON.stringify(readings));
} finally {
  await supervisor.close();
  await record.close();
  rmSync(dir, { recursive: true, force: true });
}
