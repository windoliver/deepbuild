// #2651's probe: one action in a process of its own, loading one checkout's packages through their public entries
// (dist/index.js), so the change and the merge base each run their own code. It prints one JSON line.
//   node probe.mjs seed-jobs <checkout> '{"ledger": <path>, "count": <n>, "folders": <dir>}'
//     AC2: appends <n> ended jobs to the record at <ledger> as the runner writes them (job.recorded@1, then
//     job.ended@2 finished, with a session ID, a process and a run), before the hub's start. Prints { appended }.
//   node probe.mjs deliver <checkout> '{"mode": "count" | "isolation", "plant"?: <name>}'
//     AC4: opens a record, the asks core, the supervisor, project trust and an extension host (as
//     benchmarks/extension-host.mjs does), installs, checks and loads eight sandboxed packages whose record grant
//     reaches tool.before (mode isolation adds two release packages in the hub: a writer and a reader), appends one
//     hook's tool.before to the record, reads it back and hands it to host.deliver once. Prints { serialized, received }:
//     `serialized` counts the JSON.stringify calls made while deliver ran whose value is that event itself (an object
//     whose `id` is the event's ULID and `kind` is tool.before), in this process; `received` is each package's id and
//     what it was handed, as it reports it through its read action afterwards.
// Every folder is under /tmp/dh2651-probe-*, removed at the end; the host is closed, which stops the sandboxed
// packages it started.
import { cpSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const [action, checkout, rawInput] = process.argv.slice(2);
const input = JSON.parse(rawInput ?? '{}');
const entry = (name) => import(pathToFileURL(join(checkout, `packages/${name}/dist/index.js`)).href);
const HERE = fileURLToPath(new URL('.', import.meta.url));
const ulidOf = (ms, n) => {
  const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
  let text = '', value = (BigInt(ms) << 80n) | BigInt(n);
  for (let i = 0; i < 26; i++) { text = CROCKFORD[Number(value & 31n)] + text; value >>= 5n; }
  return text;
};

async function seedJobs() {
  const { openRecord } = await entry('record');
  const { createHash } = await import('node:crypto');
  const record = await openRecord({ path: input.ledger, now: Date.now });
  const core = { writer: 'core', actor: 'you', scope: 'you' };
  const start = Date.now() - 86_400_000;
  try {
    for (let i = 0; i < input.count; i++) {
      const ts = start + i * 5;
      const id = ulidOf(ts, 2 * i + 1);
      const job = `run:${id}`;
      const session = `0b0b0b0b-${String(i).padStart(4, '0').slice(-4)}-4000-8000-${String(i).padStart(12, '0')}`;
      await record.append(core, { v: 1, id: ulidOf(ts, 2 * i + 2), kind: 'job.recorded', ts, subject: job, data: {
        job, kind: 'read', agent: 'claude-code', account: null, folder: join(input.folders, id), prompt: createHash('sha256').update(`job ${i}`).digest('hex'), waiting: [] } });
      await record.append(core, { v: 2, id: ulidOf(ts + 3, 2 * i + 2), kind: 'job.ended', ts: ts + 3, subject: job, data: {
        job, state: 'finished', session, from: ts + 1, to: ts + 2, pid: 70000 + (i % 1000), pgid: 70000 + (i % 1000), result: `done ${i}`, model: 'claude-haiku-4-5' } });
    }
    await record.sync?.();
  } finally {
    await record.close();
  }
  return { appended: input.count };
}

/** A test package: fixtures/packages/<template> copied with its manifest's id, action and digest made its own. */
async function pkg(dir, template, name, packageDigest) {
  const folder = join(dir, `pkg-${name}`);
  cpSync(join(HERE, 'fixtures/packages', template), folder, { recursive: true });
  const code = readFileSync(join(folder, 'index.ts.fixture'), 'utf8').replaceAll('__NAME__', name);
  rmSync(join(folder, 'index.ts.fixture'));
  writeFileSync(join(folder, 'index.ts'), code);
  const manifest = JSON.parse(readFileSync(join(folder, 'deepbuild.json'), 'utf8').replaceAll('__NAME__', name));
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  manifest.digest = packageDigest(folder);
  writeFileSync(join(folder, 'deepbuild.json'), JSON.stringify(manifest));
  return { folder, entry: { id: manifest.id, version: manifest.version, digest: manifest.digest } };
}

async function deliver() {
  const dir = realpathSync(mkdtempSync('/tmp/dh2651-probe-'));
  const [{ openRecord }, { openAsks }, { openSupervisor }, host] = await Promise.all([entry('record'), entry('asks'), entry('supervisor'), entry('extension-host')]);
  const record = await openRecord({ path: join(dir, 'ledger.db'), now: Date.now });
  const asks = await openAsks({ record, now: Date.now, deliver: () => undefined });
  const supervisor = await openSupervisor({ record, asks, now: Date.now, settings: { asks: { unblock: { deadline_ms: 172_800_000 } } } });
  const trust = await host.openTrust({ record, now: Date.now });
  let h;
  try {
    const watchers = [];
    for (let i = 1; i <= 8; i++) watchers.push(await pkg(dir, 'watch', `watch${i}`, host.packageDigest));
    const inHub = input.mode === 'isolation' ? [await pkg(dir, 'writer', 'writer', host.packageDigest), await pkg(dir, 'watch', 'reader', host.packageDigest)] : [];
    const home = join(dir, 'home');
    mkdirSync(home);
    h = await host.openExtensionHost({ record, supervisor, trust, home, release: inHub.map((p) => p.entry), now: Date.now, ...(input.plant ? { plant: input.plant } : {}) });
    await h.ready();
    const places = {};
    // The hub's two first, so the writer's handler runs before any other package is handed the event.
    for (const p of [...inHub, ...watchers]) {
      const installed = await h.install({ from: p.folder, builtBy: null, grant: { record: ['tool.before'] } });
      const checked = await h.check(installed);
      if (!checked.passed) throw Error(`BLOCKED: ${installed.id} failed conformance: ${checked.reasons.join('; ')}`);
      const load = await h.load(installed);
      if (load.status !== 'loaded') throw Error(`BLOCKED: ${installed.id} didn't load: ${JSON.stringify(load)}`);
      places[installed.id] = load.place;
    }
    // One hook's event, as the hub appends it and reads it back.
    // Fixed, so the change and the merge base hand their packages the same event.
    const ts = 1763600000000;
    const id = ulidOf(ts, 2651);
    const session = '2651d0d0-0000-4000-8000-000000002651';
    await record.append({ writer: 'hook', actor: 'you', scope: 'you', session, agent: 'claude-code' }, {
      v: 4, id, kind: 'tool.before', ts, seq: `${BigInt(ts) * 1_000_000n + 2651n}`,
      data: { kind: 'shell', paths: [], command: 'ls -la /tmp', late: false, matched: [], call: 'toolu_dh2651ac4' },
    });
    await record.sync?.();
    const [event] = (await record.read({ after: 0, limit: 100, kinds: ['tool.before'] })).filter((e) => e.id === id);
    if (!event) throw Error('BLOCKED: the record never gave back the tool.before it was handed');
    // Count serializations of the event itself while deliver runs.
    const stringify = JSON.stringify;
    let serialized = 0, counting = false;
    JSON.stringify = function (value, ...rest) {
      if (counting && value !== null && typeof value === 'object' && value.id === id && value.kind === 'tool.before') serialized++;
      return stringify.call(this, value, ...rest);
    };
    try {
      counting = true;
      await h.deliver([event]);
    } finally {
      counting = false;
      JSON.stringify = stringify;
    }
    const received = {};
    let n = 0;
    for (const p of [...inHub, ...watchers]) {
      const name = p.entry.id.slice(p.entry.id.indexOf('/') + 1);
      const r = await h.callAction({ action: `ext.${name}.seen`, input: {}, caller: { writer: `mcp:${session}`, actor: 'you', scope: 'you', session, agent: 'claude-code' }, request: `req-dh2651-${++n}`, target: { handle: `ext:${p.entry.id}`, version: '1.0.0' } });
      if (r.status !== 'done') throw Error(`BLOCKED: ${p.entry.id}'s seen action answered ${JSON.stringify(r).slice(0, 500)}`);
      received[p.entry.id] = JSON.parse(r.output.seen);
    }
    return { event: id, logPos: event.log_pos, serialized, places, received };
  } finally {
    await h?.close().catch(() => undefined);
    await supervisor.close().catch(() => undefined);
    await record.close().catch(() => undefined);
    rmSync(dir, { recursive: true, force: true });
  }
}

try {
  const out = action === 'seed-jobs' ? await seedJobs() : action === 'deliver' ? await deliver() : (() => { throw Error(`no action ${action}`); })();
  process.stdout.write(`${JSON.stringify(out)}\n`);
  process.exit(0);
} catch (error) {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exit(1);
}
