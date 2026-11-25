// AC5 (#1121.301969cb): env-local's port kind, which the environment's resources are leased through, finds a free port
// on Linux. The real packages, built here from their sources, run the system's real lsof on real sockets.
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { CHECKOUT, elsewhere, MINUTES, PLATFORM, run } from './helpers.mjs';

/** The workspace packages `name` needs built, itself last: each after the ones it depends on. */
function closure(name) {
  const folders = new Map(readdirSync(join(CHECKOUT, 'packages'))
    .map((folder) => join(CHECKOUT, 'packages', folder, 'package.json')).filter((file) => existsSync(file))
    .map((file) => JSON.parse(readFileSync(file, 'utf8'))).map((manifest) => [manifest.name, manifest]));
  const order = [];
  const visit = (one) => {
    if (order.includes(one) || !folders.has(one)) return;
    for (const dependency of Object.keys(folders.get(one).dependencies ?? {})) visit(dependency);
    order.push(one);
  };
  visit(name);
  return order.filter((one) => folders.get(one).scripts?.build);
}

// What the supervisor does for a port lease: the kind's keys in turn, each asked whether it is free. Beside it, what
// lsof itself says of a port this process listens on and of the one found, so a failure names what lsof couldn't do.
const PROBE = `import net from 'node:net';
const [supervisor, envLocal] = process.argv.slice(2);
const { listening } = await import(supervisor);
const { portKind } = await import(envLocal);
const say = (promise) => promise.then((value) => ({ value }), (error) => ({ error: error.message }));
const server = net.createServer();
await new Promise((done) => server.listen({ port: 0, host: '127.0.0.1' }, done));
const taken = server.address().port;
const kind = portKind();
let found = null;
for (const key of kind.keys) if (await kind.free(key).catch(() => false)) { found = Number(key); break; }
const out = { pid: process.pid, taken, keys: kind.keys.length, first: Number(kind.keys[0]), found, ofTaken: await say(listening(taken)), freeTaken: await say(kind.free(String(taken))), ofFirst: await say(listening(Number(kind.keys[0]))) };
if (found !== null) {
  out.ofFound = await say(listening(found));
  out.binds = await new Promise((done) => { const s = net.createServer(); s.once('error', (error) => done(error.code)); s.listen({ port: found, host: '127.0.0.1' }, () => s.close(() => done(true))); });
}
server.close();
console.log(JSON.stringify(out));
`;

test('#1121.301969cb env-local finds a free port on Linux, by an lsof that is there', MINUTES, async (t) => {
  if (process.platform !== 'linux') return t.skip(elsewhere('Linux'));
  assert.ok(existsSync(join(CHECKOUT, 'node_modules/typescript')), 'BLOCKED: this checkout has no node_modules; run npm ci first');
  for (const name of closure('@deepbuild/env-local')) {
    const { status, stdout, stderr } = await run(['npm', 'run', 'build', '-w', name], { merge: true });
    assert.equal(status, 0, `${name} builds on ${PLATFORM}:\n${(stdout + stderr).slice(-3000)}`);
  }
  const entry = (folder) => pathToFileURL(join(CHECKOUT, 'packages', folder, 'dist/index.js')).href;
  const folder = mkdtempSync(join(tmpdir(), 'deep-1121-'));
  t.after(() => rmSync(folder, { recursive: true, force: true }));
  writeFileSync(join(folder, 'probe.mjs'), PROBE);
  const { status, stdout, stderr } = await run([process.execPath, join(folder, 'probe.mjs'), entry('supervisor'), entry('env-local')]);
  assert.equal(status, 0, `the built packages load and answer:\n${stderr}`);
  const out = JSON.parse(stdout.trim().split('\n').at(-1));

  // lsof really reads this machine's sockets: it names this probe as the listener on the port the probe took.
  assert.ok(out.ofTaken.value?.pids.includes(out.pid) && out.ofTaken.value.empty === false, `lsof on ${PLATFORM} names the process that listens on port ${out.taken}: ${JSON.stringify(out.ofTaken)}`);
  assert.equal(out.freeTaken.value, false, `a port a process listens on is never free: ${JSON.stringify(out.freeTaken)}`);
  assert.notEqual(out.found, null, `env-local found no free port among its ${out.keys} on ${PLATFORM}; of port ${out.first}, lsof says: ${JSON.stringify(out.ofFirst)}`);
  assert.deepEqual(out.ofFound, { value: { pids: [], empty: true } }, `lsof shows no listener on the port it found, ${out.found}`);
  assert.equal(out.binds, true, `and the port it found, ${out.found}, takes a listener`);
});
