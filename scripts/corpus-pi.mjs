// `node scripts/corpus.mjs record --agent pi --out <dir>` lands here (#40): pi's sets, recorded from real pi in RPC mode
// with the package and a real hub. Only the model is scripted. A tee on the hub's socket keeps each hook payload the
// package sends byte for byte; the transcript is pi's own session file. Like the other agents' sets a recording has no
// `expect`: those are written from the design's event shapes and reviewed. DEEP_PI_CLI names pi's dist/cli.js.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const FIXTURES = join(REPO, 'tests/acceptance/40/fixtures');
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const until = async (probe, what, ms = 60_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100)) { const got = await probe(); if (got) return got; }
  throw Error(`timed out waiting for ${what}`);
};

const SCENARIOS = {
  // An input an extension took, then a prompt that runs: nothing started a run for the first.
  handled: { handle: 'take-this', steps: [{ text: 'Ran.' }], drive: async (pi) => { await pi.call({ type: 'prompt', message: 'please take-this' }); await sleep(1000); await pi.call({ type: 'prompt', message: 'Run.' }); await pi.settled(1); } },
  // A recoverable error pi retries: two starts before one settle.
  retry: { steps: [{ error: '503 overloaded' }, { text: 'Recovered.' }], drive: async (pi) => { await pi.call({ type: 'prompt', message: 'Do the work.' }); await pi.settled(1); } },
  // pi's write and edit.
  edit: { steps: [{ tools: [{ name: 'write', arguments: { path: 'f.txt', content: 'a\n' } }] }, { tools: [{ name: 'edit', arguments: { path: 'f.txt', edits: [{ oldText: 'a', newText: 'b' }] } }] }, { text: 'Edited.' }], drive: async (pi) => { await pi.call({ type: 'prompt', message: 'Edit the file.' }); await pi.settled(1); } },
  // An ask open when /new replaces the session.
  replaced: { steps: [{ tools: [{ name: 'deep_ask', arguments: { kind: 'taste', recommended: 'a', question: 'Which door?', options: [{ id: 'a', label: 'Door A' }, { id: 'b', label: 'Door B' }] } }] }], drive: async (pi, hub) => { await pi.call({ type: 'prompt', message: 'Ask.' }); const ask = await until(() => hub.openAsk(), 'the open ask'); await pi.call({ type: 'new_session' }); return { ask }; } },
  // pi's own record of a tool's nested calls, past its limit of 8 KiB of arguments a call.
  nested: { steps: [{ tools: [{ name: 'nest', arguments: { count: 1, padding: 9000 } }] }, { text: 'Done.' }], drive: async (pi) => { await pi.call({ type: 'prompt', message: 'Nest.' }); await pi.settled(1); } },
};

/** The hub's socket with a tee: every hook request line the package sends, kept in order. */
function tee(listen, upstream, kept) {
  const server = net.createServer((down) => {
    const up = net.connect(upstream);
    let buffer = '';
    down.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        try { const line = JSON.parse(buffer.slice(0, i)); if (line.event && line.payload) kept.push(line.payload); } catch { /* not a request */ }
        buffer = buffer.slice(i + 1);
      }
      up.write(chunk);
    });
    up.pipe(down);
    for (const [a, b] of [[up, down], [down, up]]) { a.on('error', () => b.destroy()); a.on('close', () => b.destroy()); }
  });
  return new Promise((resolve) => server.listen(listen, () => resolve(server)));
}

async function record(name, scenario, cli, out) {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-pi-corpus-')));
  const [hubHome, piHome, cwd, sessions] = ['h', 'p', 'w', 's'].map((part) => join(dir, part));
  for (const path of [hubHome, join(piHome, '.deepbuild'), cwd, sessions]) mkdirSync(path, { recursive: true });
  writeFileSync(join(cwd, 'nested.txt'), 'nested\n');
  mkdirSync(join(hubHome, '.deepbuild'));
  writeFileSync(join(hubHome, '.deepbuild', 'config.json'), JSON.stringify({ asks: { deadline: { taste: '3d' }, default: { taste: 'recommended' } } }));
  writeFileSync(join(dir, 'script.json'), JSON.stringify(scenario.steps));
  const proxy = join(dir, 't.sock');
  writeFileSync(join(piHome, '.deepbuild', 'config.json'), JSON.stringify({ hub: { address: `unix:${proxy}` } }));
  const base = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, TMPDIR: tmpdir(), LC_ALL: 'C' };
  const hub = spawn(process.execPath, [join(REPO, 'packages/cli/dist/main.js'), 'hub', 'run'], { cwd: REPO, env: { ...base, HOME: hubHome }, stdio: ['ignore', 'pipe', 'inherit'] });
  const kept = [];
  let server, pi;
  try {
    await new Promise((resolve, reject) => { hub.stdout.once('data', resolve); hub.once('exit', () => reject(Error('the hub did not start'))); });
    server = await tee(proxy, join(hubHome, '.deepbuild', 'hub.sock'), kept);
    pi = spawn(process.execPath, [cli, '--mode', 'rpc', '--offline', '--no-approve', '-e', join(FIXTURES, 'scripted-provider.ts'), '-e', join(REPO, 'packages/pi'), '-e', join(FIXTURES, 'lifecycle.ts'), '--provider', 'scripted', '--model', 'scripted-1', '--session-dir', sessions], {
      cwd, env: { ...base, HOME: piHome, PI_OFFLINE: '1', PI_TELEMETRY: '0', DEEP_PI_SCRIPT: join(dir, 'script.json'), ...(scenario.handle ? { DEEP_PI_HANDLE: scenario.handle } : {}) }, stdio: ['pipe', 'pipe', 'inherit'],
    });
    const answers = new Map();
    let settled = 0, id = 0;
    createInterface({ input: pi.stdout }).on('line', (text) => {
      let e;
      try { e = JSON.parse(text); } catch { return; }
      if (e.type === 'response') answers.get(e.id)?.(e);
      if (e.type === 'agent_settled') settled += 1;
    });
    const driver = {
      call: (command) => new Promise((resolve) => { const key = `c${++id}`; answers.set(key, resolve); pi.stdin.write(`${JSON.stringify({ ...command, id: key })}\n`); }),
      settled: (n) => until(() => settled >= n, 'pi to settle'),
    };
    const session = (await driver.call({ type: 'get_state' })).data.sessionId;
    const asks = { openAsk: () => kept.find((p) => p.hook_event_name === 'tool_call' && p.tool_name === 'mcp__deep__deep_ask') && openAsk(hubHome) };
    const facts = (await scenario.drive(driver, asks)) ?? {};
    await sleep(500);
    pi.stdin.end();
    await Promise.race([new Promise((done) => pi.once('exit', done)), sleep(10_000)]);
    if (pi.exitCode === null) pi.kill();
    await sleep(300);
    const transcripts = readdirSync(sessions).filter((file) => file.includes(session)).map((file) => join(sessions, file));
    // pi's system prompt names where it is installed and where its extensions load from.
    const scrub = (text) => redact(text).replaceAll(dir, '/work').replaceAll(realpathSync(tmpdir()), '/tmp').replace(/\/(Users|home)\/[^/"\\\s]+/g, '/Users/user').replace(/\/(private\/)?tmp\/claude-[^"\\\s]*?(\/node_modules\/)/g, '/opt/pi$2');
    const target = join(out, 'pi', version, name);
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, 'session.json'), `${JSON.stringify({ schema: 'corpus.session@1', agent: 'pi', version, surface: 'rpc', recorded: new Date().toISOString().slice(0, 10), scenario: name }, null, 2)}\n`);
    writeFileSync(join(target, 'events.jsonl'), kept.map((payload) => `${scrub(JSON.stringify({ payload, ...(facts.ask && payload.parent ? { pending: { ask: facts.ask, session: payload.parent, outcome: 'replaced' } } : {}) }))}\n`).join(''));
    writeFileSync(join(target, 'transcript.jsonl'), scrub(transcripts.filter(existsSync).map((file) => readFileSync(file, 'utf8')).join('')));
  } finally {
    pi?.kill();
    server?.close();
    hub.removeAllListeners('exit');
    hub.kill();
    await sleep(200);
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}

/** The open ask, as `deep inbox` lists it to you on the hub's side. */
function openAsk(hubHome) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(REPO, 'packages/cli/dist/main.js'), 'inbox'], { env: { PATH: `${dirname(process.execPath)}:/usr/bin:/bin`, HOME: hubHome, LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk; });
    child.on('exit', () => resolve(/ask:[0-9A-Z]{26}/.exec(out)?.[0]));
  });
}

let version = '';
let redact = (text) => text;
export async function recordPi(out, redactor) {
  redact = redactor;
  const cli = process.env.DEEP_PI_CLI;
  if (!cli || !existsSync(cli)) throw Error("DEEP_PI_CLI names pi's dist/cli.js: nothing was recorded");
  version = spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).stdout.trim();
  for (const [name, scenario] of Object.entries(SCENARIOS)) await record(name, scenario, cli, out);
}
