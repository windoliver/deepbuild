// AC2 #2655: "A hub with no project member loads no `node:tls` on any thread, and a hub whose project gains a member
// opens its listener and serves a joined client as on the merge base."
//
// The world is #1338's, made here for any built checkout: the owner's hub on a home of its own, told where to listen by
// `hub.listen` in its config.json (a free port on 127.0.0.1), her clone of acme/shop, and a second home with a clone of
// the same repo that joins with `deep join <repo link> --invite <invite>` and reads with `deep status`. The forge is a
// stand-in on 127.0.0.1 that knows nothing, and `gh`, `claude` and `codex` are stand-ins that fail.
// - No member: the hub serves a session's first hooks, and tls-preload.mjs's list (a load hook on every thread, and each
//   thread's own list of loaded built-ins) names no thread that loaded node:tls, and nothing listens on the port.
//   So that a list that can't see TLS load doesn't pass, the same hub must show it loaded once it listens: else BLOCKED.
// - A member: the owner invites bob (person.invite on her control connection); the port must then accept a connection,
//   bob's machine must join, exit 0, and its `deep status` is compared, with the join's own output, with what the same
//   steps give on the merge base (temp folders, the port, the hub's key ID, the invite and clock times apart). The same
//   read with the hub stopped must say something else, so a read no hub served can't pass for a served one.
//   DEEP_2655_BASE=<built merge base> node --test tests/acceptance/2655/tls.test.mjs        (needs git on PATH)
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import net from 'node:net';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { control, exchange, HERE, hookLine, hubEnv, idOf, needBase, needChange, seqOf, sleep, startHub } from './lib.mjs';

const REPO_LINK = 'https://github.com/acme/shop';
const SESSION = '6f1c2b9e-1111-4222-8333-444455552655';
const GIT_ENV = { PATH: process.env.PATH, HOME: '/nonexistent', LC_ALL: 'C', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid', GIT_COMMITTER_NAME: 'Fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' };
const git = (cwd, ...args) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd, env: GIT_ENV, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

/** A TCP port on 127.0.0.1 nothing listens on now. */
const freePort = () => new Promise((done, fail) => { const s = net.createServer(); s.once('error', fail); s.listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => done(port)); }); });
/** Whether something accepts a TCP connection on the port. */
const accepts = (port) => new Promise((done) => { const s = net.connect(port, '127.0.0.1'); s.once('connect', () => { s.destroy(); done(true); }); s.once('error', () => done(false)); });
/** `deep <args>` of `checkout`, as the person whose home is `home` runs it in `cwd`. */
function deep(checkout, home, cwd, path, args) {
  return new Promise((done) => {
    const child = spawn(process.execPath, [join(checkout, 'packages/cli/dist/main.js'), ...args], { cwd, env: hubEnv(home, { PATH: path, XDG_CONFIG_HOME: join(home, '.config'), XDG_CACHE_HOME: join(home, '.cache') }), stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.setEncoding('utf8').on('data', (d) => (stdout += d));
    child.stderr.setEncoding('utf8').on('data', (d) => (stderr += d));
    const timer = setTimeout(() => child.kill('SIGKILL'), 120_000);
    child.on('close', (code, signal) => { clearTimeout(timer); done({ code: code ?? signal, stdout, stderr }); });
  });
}
/** The threads the list names as having loaded node:tls, each with how it was seen. */
function tlsRows(log) {
  if (!existsSync(log)) throw Error(`BLOCKED: tls-preload.mjs wrote no list at ${log}, so no thread's built-ins can be read`);
  const rows = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => ({ thread: l.slice(0, l.indexOf(' ')), how: l.slice(l.indexOf(' ') + 1) }));
  if (!rows.some((r) => r.how === 'armed')) throw Error('BLOCKED: no thread of the hub armed the list, so it shows nothing');
  return { threads: [...new Set(rows.map((r) => r.thread))].length, loaded: rows.filter((r) => r.how !== 'armed').map((r) => `thread ${r.thread}: ${r.how}`) };
}

/** The steps on a hub of `checkout`: what it loads and listens on with no member, and how it serves a client that joins. */
async function steps(checkout) {
  const dir = realpathSync(mkdtempSync('/tmp/d2655w-'));
  const forge = createServer((_req, res) => { res.writeHead(404, { 'content-type': 'application/json' }).end('{"message":"Not Found"}'); });
  let hub;
  try {
    await new Promise((done) => forge.listen(0, '127.0.0.1', done));
    const maya = join(dir, 'm');
    mkdirSync(join(maya, '.deepbuild'), { recursive: true, mode: 0o700 });
    mkdirSync(join(maya, 'work'), { recursive: true });
    const rules = readFileSync(join(checkout, 'crates/deep-hook/default-rules.json'), 'utf8');
    writeFileSync(join(maya, '.deepbuild', 'rules.json'), rules);
    const port = await freePort();
    writeFileSync(join(maya, '.deepbuild', 'config.json'), `${JSON.stringify({ hub: { listen: `127.0.0.1:${port}` } })}\n`);
    mkdirSync(join(dir, 'bin'));
    const stub = (name, body) => { writeFileSync(join(dir, 'bin', name), `#!/bin/sh\n${body}`); chmodSync(join(dir, 'bin', name), 0o755); };
    stub('gh', 'echo "gh: not signed in (test stand-in)" >&2\nexit 1\n');
    for (const agent of ['claude', 'codex']) stub(agent, `[ "$1 $2 $3" = "plugin list --json" ] && { echo '[]'; exit 0; }\necho "${agent}: test stand-in" >&2\nexit 1\n`);
    writeFileSync(join(dir, 'confirm'), 'confirmed\n');
    const path = `${join(dir, 'bin')}:${dirname(process.execPath)}:${process.env.PATH ?? '/usr/bin:/bin'}`;
    const origin = join(dir, 'o', 'shop');
    mkdirSync(origin, { recursive: true });
    git(origin, 'init', '-q');
    writeFileSync(join(origin, 'README.md'), '# shop\n');
    git(origin, 'add', '-A');
    git(origin, 'commit', '-q', '-m', 'Start');
    const bare = join(dir, 'o', 'shop.git');
    git(dirname(origin), 'clone', '-q', '--bare', origin, bare);
    const clone = (to) => { mkdirSync(dirname(to), { recursive: true }); git(dirname(to), 'clone', '-q', bare, to); git(to, 'remote', 'set-url', 'origin', `${REPO_LINK}.git`); return to; };
    const shop = clone(join(maya, 'src', 'shop'));

    const log = join(dir, 'tls.log');
    hub = await startHub(checkout, { home: maya, env: { PATH: path, DEEP_HUB_TEST_FORGE: `http://127.0.0.1:${forge.address().port}`, DEEP_HUB_TEST_CONFIRM: join(dir, 'confirm'), NODE_OPTIONS: `--import=${join(HERE, 'tls-preload.mjs')}`, DEEP_2655_TLS: log } });
    const payload = (event, more) => ({ session_id: SESSION, transcript_path: join(maya, '.claude', 'projects', 'shop', `${SESSION}.jsonl`), cwd: shop, hook_event_name: event, ...more });
    for (const [n, [event, more]] of [['SessionStart', { source: 'startup' }], ['UserPromptSubmit', { prompt: 'list the source folder' }], ['PreToolUse', { tool_name: 'Bash', tool_input: { command: 'ls src' }, tool_use_id: 'call_2655_tls' }]].entries()) {
      const got = await exchange(hub.socket, hookLine({ id: idOf(n + 1), seq: seqOf(n + 1), event, payload: payload(event, more) }));
      if (!got.reply || got.reply.exit !== 0) throw Error(`BLOCKED: the hub didn't serve the owner's ${event}: ${JSON.stringify(got.lines).slice(0, 300)}`);
    }
    await sleep(1500);
    const alone = { ...tlsRows(log), listens: await accepts(port) };

    const owner = await control(hub);
    let invite;
    try {
      invite = (await owner.call('person.invite', { person: 'bob', repo: shop, address: `127.0.0.1:${port}` }).catch((error) => { throw Error(`BLOCKED: the hub issues no invite (person.invite on the owner's control connection): ${error.message}`); })).invite;
    } finally { owner.close(); }
    if (typeof invite !== 'string' || !invite) throw Error('BLOCKED: person.invite answered no invite string');
    let opened = false;
    for (const deadline = Date.now() + 15_000; !(opened = await accepts(port)) && Date.now() < deadline;) await sleep(100);
    await sleep(300);
    const member = { ...tlsRows(log), listens: opened };

    const bob = join(dir, 'bob');
    mkdirSync(join(bob, '.deepbuild'), { recursive: true, mode: 0o700 });
    writeFileSync(join(bob, '.deepbuild', 'rules.json'), rules);
    const theirs = clone(join(bob, 'code', 'shop'));
    const joined = await deep(checkout, bob, theirs, path, ['join', REPO_LINK, '--invite', invite]);
    const status = await deep(checkout, bob, theirs, path, ['status']);
    // What differs from run to run by construction: the temp folder, the port, the invite, the hub's key ID, and clock times.
    const hubId = /hub ([0-9a-f]{16})/.exec(joined.stdout)?.[1];
    const same = (text) => {
      let out = text.split(dir).join('<dir>').split(invite).join('<invite>').split(String(port)).join('<port>');
      if (hubId) out = out.split(hubId).join('<hub>');
      return out.replace(/\b\d+(\.\d+)? ?(ms|s|min|h)\b( ago)?/g, '<time>').replace(/\b\d{1,2}:\d{2}(:\d{2})?\b/g, '<clock>');
    };
    const shown = (r) => ({ code: r.code, stdout: same(r.stdout), stderr: same(r.stderr) });
    // The same read with the hub stopped: a read that says the same either way doesn't show the hub serving it.
    await hub.stop();
    hub = undefined;
    const unserved = await deep(checkout, bob, theirs, path, ['status']);
    return { alone, member, served: { join: shown(joined), status: shown(status) }, unserved: shown(unserved) };
  } finally {
    await hub?.stop();
    await new Promise((done) => { forge.close(() => done()); forge.closeAllConnections(); });
    rmSync(dir, { recursive: true, force: true });
  }
}

const runs = {};
const run = (side, checkout) => (runs[side] ??= steps(checkout).then((r) => ({ r }), (error) => ({ error })));

test('AC2 #2655 a hub with no project member loads no node:tls on any thread', { timeout: 600_000 }, async (t) => {
  const { r, error } = await run('change', needChange());
  if (error) throw error;
  t.diagnostic(`no member: ${r.alone.threads} threads listed; loaded node:tls: [${r.alone.loaded.join('; ')}]; listening: ${r.alone.listens}`);
  t.diagnostic(`a member invited: loaded node:tls: [${r.member.loaded.join('; ')}]; listening: ${r.member.listens}`);
  assert.deepEqual(r.alone.loaded, [], `a hub with no project member loaded node:tls: ${r.alone.loaded.join('; ')}`);
  assert.equal(r.alone.listens, false, 'a hub with no project member listens on the port its config names');
  if (!r.member.listens) throw Error('BLOCKED: the hub opens no listener even once a person is invited, so "no TLS without a member" proves nothing yet');
  if (!r.member.loaded.length) throw Error('BLOCKED: the hub listens for its member and the list names no thread that loaded node:tls, so the list can\'t see it load');
});

test('AC2 #2655 a hub whose project gains a member opens its listener and serves a joined client as on the merge base', { timeout: 600_000 }, async (t) => {
  const [change, base] = [needChange(), needBase()];
  const there = await run('base', base);
  if (there.error) throw Error(`BLOCKED: the steps failed on the merge base, so there is nothing to compare with: ${there.error.message}`);
  t.diagnostic(`merge base: listening ${there.r.member.listens}; join ${JSON.stringify(there.r.served.join)}; status ${JSON.stringify(there.r.served.status)}`);
  if (!there.r.member.listens || there.r.served.join.code !== 0 || there.r.served.status.code !== 0) throw Error(`BLOCKED: the merge base didn't serve a joined client here, so there is nothing to compare with: ${JSON.stringify(there.r.served).slice(0, 900)}`);
  t.diagnostic(`merge base, the same read with the hub stopped: ${JSON.stringify(there.r.unserved)}`);
  if (JSON.stringify(there.r.unserved) === JSON.stringify(there.r.served.status)) throw Error(`BLOCKED: on the merge base the joined client's read says the same with its hub stopped, so it doesn't show the hub serving it: ${JSON.stringify(there.r.unserved).slice(0, 600)}`);
  const here = await run('change', change);
  if (here.error) throw here.error;
  t.diagnostic(`change: listening ${here.r.member.listens}; join ${JSON.stringify(here.r.served.join)}; status ${JSON.stringify(here.r.served.status)}`);
  assert.equal(here.r.member.listens, true, 'once a person is invited the hub opens the listener `hub.listen` names');
  assert.deepEqual(here.r.served, there.r.served, "the joined client isn't served as on the merge base");
  assert.notDeepEqual(here.r.served.status, here.r.unserved, "the joined client's read says the same with its hub stopped: the hub didn't serve it");
});
