// Composition's budgets (issue #103): node benchmarks/composition.mjs <wire | edge-read>.
// One process opens a record, the asks core, the supervisor and project trust in a temp folder and loads two
// providers in the hub (the release lists them), and then:
// - wire: installs 20 users, each with a use of both providers' readings, so each install wires two typed edges;
// - edge-read: one user reads a provider's reading through its edge 1,000 times, from inside the user.
// It prints how long the work took, as one JSON line. The issue's limits (100 ms to wire at install, 1 ms a reading
// across an edge) stay in tests/acceptance/103/budgets.test.ts.
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openAsks } from '../packages/asks/dist/index.js';
import { d1Digest } from '../packages/contracts/dist/index.js';
import { openExtensionHost, openTrust, packageDigest } from '../packages/extension-host/dist/index.js';
import { openRecord } from '../packages/record/dist/index.js';
import { openSupervisor } from '../packages/supervisor/dist/index.js';

const task = process.argv[2];
if (task !== 'wire' && task !== 'edge-read') throw Error('usage: node benchmarks/composition.mjs <wire | edge-read>');
const strict = (properties) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const SHAPES = { 'ext.prices.prices@1': strict({ cents: { type: 'integer' } }), 'ext.ci.status@1': strict({ state: { type: 'string' } }) };
const VALUES = { 'ext.prices.prices@1': { cents: 12345 }, 'ext.ci.status@1': { state: 'passed' } };
const PREVIEW = ['deep.provide', 'deep.use', 'deep.read', 'deep.registerAction'];

const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-compose-bench-')));
const release = [];
/** A package folder: its code and its manifest, whose digest the release lists. */
function pkg(id, code, rows) {
  const folder = join(dir, id.replace('/', '-'));
  mkdirSync(folder);
  writeFileSync(join(folder, 'index.ts'), code);
  const manifest = { id, version: '1.0.0', digest: '', requires: { preview: PREVIEW }, ...rows };
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  manifest.digest = packageDigest(folder);
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  release.push({ id, version: '1.0.0', digest: manifest.digest });
  return folder;
}
const providers = Object.keys(SHAPES).map((iface) => pkg(`bench/${iface.split('.')[1]}`,
  `export default async function (deep: any): Promise<void> { await deep.provide('${iface}', 'reading', ${JSON.stringify(SHAPES[iface])}, async () => (${JSON.stringify(VALUES[iface])})); }\n`,
  { provides: [{ interface: iface, kind: 'reading', minor: 0, schema: SHAPES[iface], digests: { 0: d1Digest(SHAPES[iface]) } }] }));
const user = (n) => pkg(`bench/user${n}`, `const strict = (properties: any) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
export default async function (deep: any): Promise<void> {
  for (const i of ${JSON.stringify(Object.keys(SHAPES))}) await deep.use(i);
  deep.registerAction('ext.user${n}.reads', { declares: 'read', input: strict({ n: { type: 'integer' } }), output: strict({ read: { type: 'integer' } }) },
    async (input: any) => { let read = 0; for (let i = 0; i < input.n; i++) if ((await deep.read('ext.prices.prices@1')).value) read++; return { read }; });
}
`, { actions: [`ext.user${n}.reads`], uses: Object.keys(SHAPES).map((iface) => ({ interface: iface, minor: 0, digest: d1Digest(SHAPES[iface]), schema: SHAPES[iface] })) });
const users = Array.from({ length: task === 'wire' ? 20 : 1 }, (_, n) => user(n));

const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 172_800_000 } } } });
const trust = await openTrust({ record, now: Date.now });
const home = join(dir, 'home');
mkdirSync(home);
const host = await openExtensionHost({ record, supervisor, trust, home, release, now: Date.now });
const admit = async (folder) => {
  const installed = await host.install({ from: folder, builtBy: null });
  if (!(await host.check(installed)).passed) throw Error(`${installed.id} failed conformance`);
  if ((await host.load(installed)).status !== 'loaded') throw Error(`${installed.id} did not load`);
};
try {
  await host.ready();
  for (const folder of providers) await admit(folder);
  let ms;
  if (task === 'wire') {
    const t0 = performance.now();
    for (const folder of users) await host.install({ from: folder, builtBy: null });
    ms = performance.now() - t0;
  } else {
    await admit(users[0]);
    const t0 = performance.now();
    const out = await host.callAction({ action: 'ext.user0.reads', target: { handle: 'ext:bench/user0', version: '1.0.0' }, input: { n: 1_000 }, caller: { writer: 'app', actor: 'you', scope: 'you' } });
    ms = performance.now() - t0;
    if (out.status !== 'done' || out.output.read !== 1_000) throw Error(`the reads: ${JSON.stringify(out)}`);
  }
  console.log(JSON.stringify({ task, ms }));
} finally {
  await host.close();
  await supervisor.close();
  await record.close();
  rmSync(dir, { recursive: true, force: true });
}
