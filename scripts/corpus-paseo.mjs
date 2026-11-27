// `node scripts/corpus.mjs record --agent paseo --out <dir>` lands here (#3136): paseo's set, recorded from a real paseo
// daemon with DeepBuild's plugin (packages/paseo) and a stand-in for the agent and its model
// (scripts/corpus-paseo-provider), as #55's real-paseo tests run it. A socket where the plugin finds the hub keeps each
// hook request the plugin sends, byte for byte, and answers none, so the permission stays paseo's to settle: it is
// allowed through paseo's own `paseo permit allow`. The transcript is paseo's own record of the agent (`paseo inspect`).
// A second session, self-approved-call (#3429), is a scripted ACP agent (scripts/corpus-paseo-acp.mjs) that paseo's own
// Copilot provider runs in place of Copilot's CLI: one turn in paseo's mode allow-all, in which the agent approves its
// own call and asks nothing. Whether paseo fired agent.permission.before for that call is what the set holds.
// Like the other sets a recording has no `expect`. DEEP_PASEO_CLI names the paseo command of @getpaseo/cli.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const PROVIDER = join(REPO, 'scripts/corpus-paseo-provider');
const PLUGIN = join(REPO, 'packages/paseo');
const ACP = join(REPO, 'scripts/corpus-paseo-acp.mjs');
const PROMPT = 'Run the shell command: echo corpus-probe';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));
const until = async (probe, what, ms = 60_000) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(250)) { const got = await probe(); if (got) return got; }
  throw Error(`timed out waiting for ${what}`);
};
const jsonIn = (text) => JSON.parse(text.slice(Math.min(...['{', '['].map((c) => text.indexOf(c)).filter((i) => i >= 0))));

/** Where the plugin finds the hub: each hook request it sends is kept, acknowledged and answered with nothing. */
function standIn(socket, kept) {
  const server = net.createServer((sock) => {
    let buffer = '';
    sock.on('error', () => sock.destroy());
    sock.setEncoding('utf8').on('data', (chunk) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        let line;
        try { line = JSON.parse(buffer.slice(0, i)); } catch { line = undefined; }
        buffer = buffer.slice(i + 1);
        if (line?.event && line.payload) {
          kept.push(line.payload);
          sock.write(`${JSON.stringify({ v: 1, ack: line.id })}\n${JSON.stringify({ v: 1, exit: 0, stdout: '', stderr: '' })}\n`);
        }
      }
    });
    sock.write(`${JSON.stringify({ v: 1, hub: 'corpus' })}\n`);
  });
  return new Promise((resolve) => server.listen(socket, () => resolve(server)));
}

const freePort = () => new Promise((resolve, reject) => {
  const s = net.createServer();
  s.once('error', reject);
  s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); });
});

export async function recordPaseo(out, redact) {
  const cli = process.env.DEEP_PASEO_CLI;
  if (!cli || !existsSync(cli)) throw Error('DEEP_PASEO_CLI names the paseo command of @getpaseo/cli: nothing was recorded');
  const base = { PATH: `${dirname(process.execPath)}:/usr/bin:/bin:/usr/sbin:/sbin`, TMPDIR: tmpdir(), LC_ALL: 'C' };
  const version = spawnSync(cli, ['--version'], { encoding: 'utf8', env: { ...base, HOME: tmpdir() } }).stdout.trim().replace(/^v/, '');
  // A short folder: the plugin's socket path must fit a Unix socket's.
  const dir = realpathSync(mkdtempSync(process.platform === 'darwin' ? '/private/tmp/deep-paseo-' : '/tmp/deep-paseo-'));
  const home = join(dir, 'h'), root = join(home, '.paseo'), cwd = join(dir, 'w');
  for (const path of [join(home, '.deepbuild'), root, cwd]) mkdirSync(path, { recursive: true });
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ version: 1, daemon: { listen: `127.0.0.1:${await freePort()}`, relay: { enabled: false } }, pluginsEnabled: true, agents: { providers: { copilot: { command: [process.execPath, ACP] } } } }, null, 2)}\n`);
  const env = { ...base, HOME: home, PASEO_DICTATION_ENABLED: 'false', PASEO_VOICE_MODE_ENABLED: 'false' };
  const paseo = (args, ms = 120_000) => spawnSync(cli, ['--home', root, ...args], { cwd: dir, env, encoding: 'utf8', timeout: ms });
  const kept = [];
  const server = await standIn(join(home, '.deepbuild', 'hub.sock'), kept);
  let output = '';
  const daemon = spawn(cli, ['daemon', 'run', '--home', root], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  for (const stream of [daemon.stdout, daemon.stderr]) stream.setEncoding('utf8').on('data', (d) => { output = (output + d).slice(-20_000); });
  let run;
  try {
    await until(() => /Listening on/.test(output) || daemon.exitCode !== null, "paseo's daemon to listen", 120_000);
    if (daemon.exitCode !== null) throw Error(`paseo's daemon exited ${daemon.exitCode}: ${output.slice(-2000)}`);
    for (const [plugin, id] of [[PROVIDER, 'corpus-paseo'], [PLUGIN, 'deepbuild']]) {
      const installed = paseo(['plugin', 'install', plugin]);
      if (installed.status !== 0) throw Error(`paseo plugin install ${plugin} exited ${installed.status}: ${installed.stdout} ${installed.stderr}`);
      await until(() => { const ls = paseo(['plugin', 'ls', '--json']); const got = ls.status === 0 ? jsonIn(ls.stdout) : []; return (Array.isArray(got) ? got : got.plugins ?? []).some((p) => (p.id ?? p.plugin) === id && p.status === 'running'); }, `paseo plugin ${id} running; daemon output ${output.slice(-1500)}`);
    }
    const scrub = (text) => redact(text).replaceAll(dir, '/work');
    /** A session's set: the payloads the plugin sent for it, and paseo's own record of its agent. */
    const keep = (scenario, agent, payloads, ran) => {
      const inspected = paseo(['inspect', agent, '--json']);
      const target = join(out, 'paseo', version, scenario);
      mkdirSync(target, { recursive: true });
      writeFileSync(join(target, 'session.json'), `${JSON.stringify({ schema: 'corpus.session@1', agent: 'paseo', version, surface: 'daemon', recorded: new Date().toISOString().slice(0, 10), scenario }, null, 2)}\n`);
      writeFileSync(join(target, 'events.jsonl'), payloads.map((payload) => `${scrub(JSON.stringify({ payload }))}\n`).join(''));
      const entries = inspected.status === 0 ? [jsonIn(inspected.stdout)] : [];
      writeFileSync(join(target, 'transcript.jsonl'), entries.map((entry) => `${scrub(JSON.stringify(entry))}\n`).join(''));
      console.log(JSON.stringify({ type: 'session', scenario, version, payloads: payloads.length, hooks: payloads.map((p) => p.hook_event_name), transcriptEntries: entries.length, run: ran.slice(0, 200) }));
    };
    // One turn: the stand-in asks for a shell call's permission, allowed in paseo, then ends its turn.
    run = spawn(cli, ['--home', root, 'run', '--provider', 'corpus-paseo', '--cwd', cwd, '--json', PROMPT], { cwd: dir, env, stdio: ['ignore', 'pipe', 'pipe'] });
    let ran = '';
    run.stdout.setEncoding('utf8').on('data', (d) => { ran += d; });
    const pending = await until(() => { const ls = paseo(['permit', 'ls', '--json']); const got = ls.status === 0 ? jsonIn(ls.stdout) : []; return (Array.isArray(got) ? got : got.permissions ?? [])[0]; }, `the stand-in's permission request; daemon output ${output.slice(-1500)}`);
    const agent = pending.agentId ?? pending.agent?.id ?? pending.agent;
    const allowed = paseo(['permit', 'allow', String(agent), String(pending.id ?? pending.requestId ?? pending.request?.id)]);
    if (allowed.status !== 0) throw Error(`paseo permit allow exited ${allowed.status}: ${allowed.stdout} ${allowed.stderr} (pending ${JSON.stringify(pending)})`);
    await until(() => run.exitCode !== null, 'paseo run to end', 120_000);
    await until(() => kept.some((p) => p.hook_event_name === 'agent.turn.after'), 'the turn end to reach the hub', 30_000);
    keep('permission-allowed', String(agent), kept.slice(0), ran);
    // The scripted ACP agent (#3429), run by paseo's Copilot provider in its mode allow-all: one turn, in which the agent
    // approves its own shell call and runs it. The set is that session's hooks alone, from the turn's start to its end.
    const from = kept.length;
    const own = paseo(['run', '--provider', 'copilot', '--mode', 'allow-all', '--cwd', cwd, '--json', PROMPT]);
    if (own.status !== 0) throw Error(`paseo run of the scripted ACP agent in allow-all exited ${own.status}: ${own.stdout} ${own.stderr}; daemon output ${output.slice(-1500)}`);
    await until(() => kept.slice(from).some((p) => p.hook_event_name === 'agent.turn.after'), "the self-approved turn's end to reach the hub", 30_000);
    keep('self-approved-call', String(kept[from].paseo_agent), kept.slice(from), own.stdout);
    return join(out, 'paseo', version);
  } finally {
    run?.kill();
    // The daemon and what it started, by the process group this recording made.
    try { process.kill(-daemon.pid, 'SIGTERM'); } catch { /* gone */ }
    await Promise.race([new Promise((done) => daemon.once('exit', done)), sleep(10_000)]);
    try { process.kill(-daemon.pid, 'SIGKILL'); } catch { /* gone */ }
    server.close();
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
}
