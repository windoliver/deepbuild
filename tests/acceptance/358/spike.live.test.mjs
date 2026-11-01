// Live acceptance tests for issue #358: builds the release host and app through the record's command, hands them
// panels written by these tests, with numbers drawn per run, and judges what comes back, on a real headless render,
// real processes, codesign's own output and fresh timing. Minutes of build; macOS only.
// Run: node --test --test-concurrency=1 tests/acceptance/358/spike.live.test.mjs
import assert from 'node:assert/strict';
import { copyFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fingerprint } from '../../../scripts/benchmark.mjs';
import { burner, CASES, escapeArtist, focusPanel, gitManifest, greedyManifest, layout, panelSource, scratch, writePanel } from './panels.mjs';
import { bench, binaries, check, cpuSeconds, hostRun, jitControl, keep, processInfo, run, serve, sleep, upstreamSources } from './run.mjs';
import {
  benchmarkTreeProblems, benchShapeProblems, checkProblems, commandProblems, COST, decodePng, flatten, JIT, jitProblems, loadRecord, machineProblems, pixelProblems, RENDER, signatureProblems, signCommandProblems, UPDATES, RUNS, verdict,
} from './validate.mjs';

const holds = (problems) => assert.deepEqual(problems, [], `\n${problems.join('\n')}`);
function spike() {
  const record = loadRecord();
  holds(commandProblems(record));
  const bins = binaries(record);
  holds(bins.problems);
  return { record, bins };
}

// A listener on a real port that counts who reaches it, proven to count by connecting once itself.
async function listener() {
  let hits = 0;
  const server = createServer((socket) => { hits += 1; socket.destroy(); });
  await new Promise((resolve) => { server.listen(0, '127.0.0.1', resolve); });
  const { port } = server.address();
  await new Promise((resolve) => { const client = connect(port, '127.0.0.1', () => { client.destroy(); resolve(); }); });
  await sleep(50);
  assert.equal(hits, 1, 'the test\'s own listener counts no connection');
  hits = 0;
  return { port, hits: () => hits, close: () => new Promise((resolve) => { server.close(resolve); }) };
}

async function renderCase(id, record, bins, { signed } = {}) {
  const shape = layout();
  const dir = scratch();
  const out = join(dir, 'out.json'), png = join(dir, 'render.png');
  const panel = writePanel(panelSource(id, shape));
  const use = signed ?? bins;
  const options = { area: shape.area, card: shape.card, question: shape.question, updates: 3, out, png };
  const result = await check(record, use, panel, options);
  const want = { pass: CASES[id].pass, kinds: CASES[id].kinds, firstUpdate: CASES[id].firstUpdate, marker: shape.marker, area: shape.area, card: shape.card, question: shape.question, updates: 3, fill: shape.fill, escape: shape.escape };
  return { want, result, png, dir };
}

for (const id of Object.keys(CASES)) {
  test(`${RENDER} ${CASES[id].pass ? 'a panel inside its area, with the question card up, passes the headless render and is drawn where it belongs' : `a panel that draws ${id === 'over-card' ? 'over the question card' : `outside its area (${id})`} fails the headless render, and nothing it drew shows there`}`, async () => {
    const { record, bins } = spike();
    const { want, result, png } = await renderCase(id, record, bins);
    keep(`cases/${id}.json`, { want, status: result.status, output: result.output });
    const problems = checkProblems(id, want, result);
    holds(problems);
    assert.ok(existsSync(png), `${id}: the check wrote no render at --png`);
    holds(pixelProblems(id, want, decodePng(readFileSync(png))));
  });
}

test(`${JIT} a release-profile host runs gpui-shell's numeric kernel on the interpreter, while the switch's control enters native code on the same kernel`, async () => {
  const { record, bins } = spike();
  const dir = scratch();
  const panel = writePanel(upstreamSources().compute);
  const shippingOut = join(dir, 'shipping.json'), controlOut = join(dir, 'control.json');
  const shipping = await hostRun(record, bins, panel, { renders: 1000, out: shippingOut });
  assert.equal(shipping.status, 0, `the host's run failed: ${shipping.stderr}`);
  const control = await jitControl(record, panel, controlOut);
  assert.equal(control.status, 0, `the control failed: ${control.stderr}`);
  keep('jit.json', { shipping: shipping.output, control: control.output });
  holds(jitProblems(shipping.output, control.output));
});

test(`${JIT} the app and panel host, signed by the record's command with the hardened runtime, carry no allow-jit, as codesign reads them, and render a panel signed that way`, async () => {
  const { record, bins } = spike();
  holds(signCommandProblems(record));
  const dir = scratch();
  const signed = { app: join(dir, 'app'), host: join(dir, 'host') };
  const signatures = {};
  for (const [name, source] of [['app', bins.app], ['host', bins.host]]) {
    copyFileSync(source, signed[name]);
    const signing = await run(record.sign.command.map((part) => part.replace('{binary}', signed[name])));
    assert.equal(signing.status, 0, `signing the ${name} failed: ${signing.stderr}`);
    signatures[name] = readSignature(signed[name]);
  }
  keep('signatures.json', signatures);
  holds([...signatureProblems('the app', signatures.app), ...signatureProblems('the panel host', signatures.host)]);
  const { want, result } = await renderCase('in-bounds', record, bins, { signed });
  holds(checkProblems('signed in-bounds', want, result));
  const { want: refused, result: answer } = await renderCase('over-card', record, bins, { signed });
  holds(checkProblems('signed over-card', refused, answer));
});

function readSignature(path) {
  const entitlements = spawnSync('codesign', ['-d', '--entitlements', '-', '--xml', path], { encoding: 'utf8' });
  const details = spawnSync('codesign', ['-d', '--verbose=4', path], { encoding: 'utf8' });
  const verified = spawnSync('codesign', ['--verify', '--strict', path], { encoding: 'utf8' });
  return { entitlements: entitlements.stdout, details: details.stderr, verified: verified.status === 0 };
}

test(`${COST} the panel host's fresh run of gpui-shell's own benchmark source is 443 nodes, across a process with the JIT off, and lands on the same side of 4 ms as the record`, async () => {
  const { record, bins } = spike();
  const dir = scratch();
  const out = join(dir, 'bench.json');
  const panel = writePanel(upstreamSources().panel);
  const fresh = await bench(record, bins, panel, { runs: RUNS, updates: UPDATES, out });
  assert.equal(fresh.status, 0, `the bench failed: ${fresh.stderr}`);
  holds([...benchShapeProblems('the fresh run', fresh.output), ...benchmarkTreeProblems('the fresh run', fresh.output.tree)]);
  const total = fresh.output.runs.reduce((sum, each) => sum + each.totalNs.reduce((a, b) => a + b, 0), 0) / 1e6;
  assert.ok(total <= fresh.wallMs, `the bench reports ${total} ms of updates in a ${fresh.wallMs} ms run: its numbers aren't this run's`);
  keep('bench.json', fresh.output);
  const here = machineProblems(fingerprint());
  if (here.length || loadavg()[0] >= 8) assert.fail(`INCONCLUSIVE: the verdict can't be compared here (load ${loadavg()[0].toFixed(1)}): ${here.join('; ')}`);
  assert.equal(verdict(fresh.output.runs).fits, verdict(record.cost.runs).fits, `the fresh worst P99 of ${verdict(fresh.output.runs).worstP99Ms} ms disagrees with the record's ${verdict(record.cost.runs).worstP99Ms} ms about the 4 ms`);
});

test(`${COST} the cost measures the script: a panel that burns its update reports over 4 ms and doesn't fit, and a one-node panel costs less than the 443-node one`, async () => {
  const { record, bins } = spike();
  const dir = scratch();
  const slow = await bench(record, bins, writePanel(burner({ a: 7, b: 9, iterations: 2_000_000 })), { runs: 1, updates: 20, out: join(dir, 'slow.json') });
  assert.equal(slow.status, 0, `the slow bench failed: ${slow.stderr}`);
  holds(benchShapeProblems('the slow panel', slow.output, { runs: 1, updates: 20 }));
  const answer = verdict(slow.output.runs);
  assert.equal(answer.fits, false, `a panel looping 2,000,000 times an update reports ${answer.worstP99Ms} ms: the bench isn't timing the script`);
  const small = await bench(record, bins, writePanel(burner({ a: 7, b: 9, iterations: 0 })), { runs: 1, updates: 200, out: join(dir, 'small.json') });
  const large = await bench(record, bins, writePanel(upstreamSources().panel), { runs: 1, updates: 200, out: join(dir, 'large.json') });
  assert.equal(small.status, 0, `the small bench failed: ${small.stderr}`);
  assert.equal(large.status, 0, `the large bench failed: ${large.stderr}`);
  const mid = (result) => [...result.output.runs[0].totalNs].sort((a, b) => a - b)[100];
  assert.ok(mid(large) > mid(small), `443 nodes cost ${mid(large)} ns and a few cost ${mid(small)} ns: the cost doesn't move with the tree`);
});

test('scope: the host is another process of another program, the extra work of a panel\'s script lands on it and not on the app, and killing it ends the panel while the app answers', async () => {
  const { record, bins } = spike();
  const dir = scratch();
  const open = async (iterations) => {
    const shape = layout();
    const panel = writePanel(burner({ a: shape.a, b: shape.b, iterations }));
    const session = serve(record, bins, panel, { area: shape.area, updates: 1, out: join(dir, `serve-${iterations}.json`) });
    const ready = await session.next(60_000);
    assert.ok(ready?.ready === true, `the served check never said it was ready: ${JSON.stringify(ready)}`);
    return { session, ready, shape };
  };
  const work = async ({ session, ready }) => {
    const before = [cpuSeconds(ready.hostPid), cpuSeconds(ready.appPid)];
    const started = performance.now();
    for (let n = 0; n < 60; n++) {
      const reply = await session.send({ cmd: 'invalidate' }, 60_000);
      assert.ok(reply?.tree, `update ${n} brought no tree: ${JSON.stringify(reply)}`);
    }
    const wall = performance.now() - started;
    return { host: cpuSeconds(ready.hostPid) - before[0], app: cpuSeconds(ready.appPid) - before[1], wall: wall / 1000 };
  };
  const light = await open(0);
  try {
    assert.equal(light.ready.appPid, light.session.child.pid, 'the app the test started isn\'t the one reporting');
    assert.notEqual(light.ready.hostPid, light.ready.appPid, 'the panel runs in the app\'s own process');
    const info = processInfo(light.ready.hostPid);
    assert.ok(info, `no process ${light.ready.hostPid} is running`);
    assert.equal(info.ppid, light.ready.appPid, 'the host isn\'t the app\'s child');
    assert.ok(info.comm.endsWith(record.host.bin), `process ${light.ready.hostPid} is ${info.comm}, not ${record.host.bin}`);
    const quiet = await work(light);

    const heavy = await open(800_000);
    try {
      const busy = await work(heavy);
      const extraWall = busy.wall - quiet.wall, extraHost = busy.host - quiet.host, extraApp = busy.app - quiet.app;
      assert.ok(extraWall > 0.5, `the burning panel added only ${extraWall} s: nothing to attribute`);
      assert.ok(extraHost >= extraWall * 0.5, `the script's extra ${extraWall.toFixed(2)} s put only ${extraHost.toFixed(2)} s on the host`);
      assert.ok(extraApp < extraHost / 2, `the script's extra work put ${extraApp.toFixed(2)} s on the app against ${extraHost.toFixed(2)} s on the host: it runs on the app's side`);
    } finally { await heavy.session.close(); }

    const first = await light.session.send({ cmd: 'ping', seq: 1 }, 2000);
    assert.equal(first?.pong, 1, `the app didn't answer a ping: ${JSON.stringify(first)}`);
    process.kill(light.ready.hostPid, 'SIGKILL');
    await sleep(300);
    const alive = await light.session.send({ cmd: 'ping', seq: 2 }, 2000);
    assert.equal(alive?.pong, 2, `the app died with its panel host: ${JSON.stringify(alive)}`);
    const orphan = await light.session.send({ cmd: 'invalidate' }, 5000);
    assert.equal(orphan?.error, 'host_gone', `with the host dead, an update gave ${JSON.stringify(orphan).slice(0, 200)}: the panel wasn't in the host`);
  } finally { await light.session.close(); }
});

test('scope: a panel that tries the network and a program, even with a manifest asking for them, reaches neither', async () => {
  const { record, bins } = spike();
  const dir = scratch();
  const shape = layout();
  const net = await listener();
  try {
    for (const [name, manifest] of [['no manifest', null], ['a manifest asking', greedyManifest(net.port)]]) {
      const canary = join(dir, `canary-${name.replace(' ', '-')}`);
      const panel = writePanel(escapeArtist({ a: shape.a, b: shape.b, port: net.port, canary }), manifest);
      const out = join(dir, `net-${name.replace(/ /g, '-')}.json`);
      const result = await check(record, bins, panel, { area: shape.area, updates: 2, out });
      await sleep(500);
      assert.equal(net.hits(), 0, `with ${name}, the panel reached the test's listener`);
      assert.equal(existsSync(canary), false, `with ${name}, the panel ran a program`);
      if (manifest === null) {
        assert.equal(result.status, 0, `the check refused a panel whose ways out all failed, so its attempts are unproven: ${result.stderr}`);
        const texts = flatten(result.output.trees.at(-1)).map((node) => node.text);
        assert.ok(texts.includes(shape.marker) && texts.includes('tried:8'), `the panel didn't get past its attempts: ${JSON.stringify(texts)}`);
      }
      rmSync(canary, { force: true });
    }
  } finally { await net.close(); }
});

test('scope: a panel\'s git dependency is refused before anything is fetched', async () => {
  const { record, bins } = spike();
  const dir = scratch();
  const shape = layout();
  const net = await listener();
  try {
    const panel = writePanel(panelSource('in-bounds', shape), gitManifest(net.port));
    const out = join(dir, 'git.json');
    const result = await check(record, bins, panel, { area: shape.area, updates: 1, out });
    await sleep(500);
    assert.equal(net.hits(), 0, 'the panel\'s git dependency was fetched');
    assert.equal(result.status, 1, `a panel with a git dependency exited ${result.status}, not 1`);
    assert.ok(result.output?.violations?.some((each) => each.kind === 'git_dependency'), `the check doesn't name a git_dependency: ${JSON.stringify(result.output?.violations ?? null)}`);
  } finally { await net.close(); }
});

test('scope: a panel moves focus only on a fresh gesture serial: not from a timer, and not twice on one press', async () => {
  const { record, bins } = spike();
  const dir = scratch();
  const shape = layout();
  const session = serve(record, bins, writePanel(focusPanel(shape)), { area: shape.area, updates: 1, out: join(dir, 'focus.json') });
  try {
    const ready = await session.next(60_000);
    assert.ok(ready?.ready === true, `the served check never said it was ready: ${JSON.stringify(ready)}`);
    await sleep(400);
    let owner = await session.send({ cmd: 'focus_owner' });
    assert.notEqual(owner?.owner, 'panel', 'a timer no gesture started moved focus to the panel');
    let log = await session.send({ cmd: 'focus_log' });
    assert.ok(log?.moves?.some((each) => each.result === 'refused' && each.serial === null), `the timer's move isn't logged as refused for having no serial: ${JSON.stringify(log)}`);

    const first = await session.send({ cmd: 'press', id: 'go' });
    assert.ok(Number.isInteger(first?.serial), `a press on the panel's button gave no serial: ${JSON.stringify(first)}`);
    owner = await session.send({ cmd: 'focus_owner' });
    assert.equal(owner?.owner, 'panel', 'a move on a fresh gesture was refused: a panel refusing every move proves nothing');

    await session.send({ cmd: 'blur' });
    owner = await session.send({ cmd: 'focus_owner' });
    assert.notEqual(owner?.owner, 'panel', 'blur didn\'t take focus from the panel');
    await sleep(800); // the press's second, delayed move fires here
    owner = await session.send({ cmd: 'focus_owner' });
    assert.notEqual(owner?.owner, 'panel', 'the panel moved focus again on a spent serial');
    log = await session.send({ cmd: 'focus_log' });
    assert.ok(log?.moves?.some((each) => each.result === 'refused' && each.serial === first.serial), `the delayed move on serial ${first.serial} isn't logged as refused: ${JSON.stringify(log)}`);

    const second = await session.send({ cmd: 'press', id: 'go' });
    assert.ok(second?.serial > first.serial, `the next press's serial ${second?.serial} isn't fresh after ${first.serial}`);
    owner = await session.send({ cmd: 'focus_owner' });
    assert.equal(owner?.owner, 'panel', 'a move on the next fresh gesture was refused');
  } finally { await session.close(); }
});
