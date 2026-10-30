// Guards on real pi: deep-hook, the one matcher, reads each call before it runs. A matched entry's call never runs and
// its name is on the record; with the hub away a fail-closed entry still holds; nothing else is touched.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs';
// `deep setup` runs for real on a temp home, as tests/acceptance/19 does.
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CLI, Client, NODE, Pi, REPO, childEnv, cleanup, run as sh, startHub, tempDir, waitFor, word, type Hub, type Line, type Step } from '../../../tests/acceptance/40/helpers.js';

const bash = (command: string): Step => ({ tools: [{ name: 'bash', arguments: { command } }] });

afterEach(cleanup);

/** A hub, `deep setup` for its home, and pi with the package. */
async function world(script: Step[] | ((home: string, cwd: string) => Step[])): Promise<{ hub: Hub; client: Client; pi: Pi; cwd: string; home: string }> {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const cwd = join(tmp, 'w');
  mkdirSync(home);
  mkdirSync(cwd);
  const steps = typeof script === 'function' ? script(home, cwd) : script;
  const hub = await startHub(home);
  const setup = await sh(NODE, [CLI, 'setup'], { env: childEnv(home), timeoutMs: 60_000 });
  if (setup.code !== 0) throw Error(`deep setup failed: ${setup.stderr}`);
  const client = await Client.open(hub);
  const pi = await Pi.start(home, cwd, { steps: [...steps, { text: 'Done.' }] });
  return { hub, client, pi, cwd, home };
}

async function run(pi: Pi): Promise<Line> {
  await pi.call({ type: 'prompt', message: 'Go.' });
  return pi.until('tool_execution_end', 1, 30_000);
}

const said = (end: Line): string => JSON.stringify(end.result);

async function before(client: Client, session: string): Promise<Line> {
  return waitFor(async () => (await client.events()).find((e) => e.kind === 'tool.before' && e.session === session), 15_000, 'tool.before');
}

describe('guards on a pi call', () => {
  it('a shell call a guard entry matches never runs, and the record names the entry', async () => {
    const w = await world([bash(`pkill -f deepbuild-no-such-${word()}; touch ran.txt`)]);
    const end = await run(w.pi);
    expect(end.isError, said(end)).toBe(true);
    expect(said(end)).toContain('DeepBuild blocked this');
    expect(existsSync(join(w.cwd, 'ran.txt')), 'the blocked command ran').toBe(false);
    expect((await before(w.client, w.pi.session)).data.matched).toContain('no-kill-by-name');
  }, 90_000);

  it('a write tool\'s relative path is read as the file it names', async () => {
    const w = await world([{ tools: [{ name: 'write', arguments: { path: '.deepbuild/spec.md', content: 'x' } }] }]);
    const end = await run(w.pi);
    expect(end.isError, said(end)).toBe(true);
    expect(existsSync(join(w.cwd, '.deepbuild/spec.md')), 'the blocked write ran').toBe(false);
    expect((await before(w.client, w.pi.session)).data.matched).toContain('no-deepbuild-spec-write');
  }, 90_000);

  it('a path pi opens without its leading @ is read as pi opens it', async () => {
    const w = await world([{ tools: [{ name: 'write', arguments: { path: '@.deepbuild/spec.md', content: 'x' } }] }]);
    const end = await run(w.pi);
    expect(end.isError, said(end)).toBe(true);
    expect(existsSync(join(w.cwd, '.deepbuild/spec.md')), 'the blocked write ran').toBe(false);
    expect((await before(w.client, w.pi.session)).data.matched).toContain('no-deepbuild-spec-write');
  }, 90_000);

  it('an edit of a guarded file is held too', async () => {
    const w = await world([{ tools: [{ name: 'edit', arguments: { path: '.deepbuild/spec.md', edits: [{ oldText: 'a', newText: 'b' }] } }] }]);
    mkdirSync(join(w.cwd, '.deepbuild'));
    writeFileSync(join(w.cwd, '.deepbuild/spec.md'), 'a\n');
    const end = await run(w.pi);
    expect(end.isError, said(end)).toBe(true);
    expect(readFileSync(join(w.cwd, '.deepbuild/spec.md'), 'utf8')).toBe('a\n');
  }, 90_000);

  it('a read of the control token is held', async () => {
    const w = await world([{ tools: [{ name: 'read', arguments: { path: '~/.deepbuild/control.token' } }] }]);
    const end = await run(w.pi);
    expect(end.isError, said(end)).toBe(true);
    expect((await before(w.client, w.pi.session)).data.matched).toContain('no-control-token-read');
  }, 90_000);

  it('a home path with a doubled slash stays in home', async () => {
    const w = await world([{ tools: [{ name: 'read', arguments: { path: '~//.deepbuild/control.token' } }] }]);
    const end = await run(w.pi);
    expect(end.isError, said(end)).toBe(true);
    expect((await before(w.client, w.pi.session)).data.matched).toContain('no-control-token-read');
  }, 90_000);

  it('with the hub up and deep-hook gone, a call is held rather than read as matching nothing', async () => {
    const w = await world([bash('touch ran.txt')]);
    const file = join(w.home, '.deepbuild/config.json');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')) as Line, hook: { binary: join(w.home, 'no-such-deep-hook') } }));
    const end = await run(w.pi);
    expect(end.isError, said(end)).toBe(true);
    expect(said(end)).toContain('deep setup');
    expect(existsSync(join(w.cwd, 'ran.txt'))).toBe(false);
  }, 90_000);

  it('with rules installed and no deep-hook recorded, a call is held', async () => {
    const w = await world([bash('touch ran.txt')]);
    const file = join(w.home, '.deepbuild/config.json');
    const { hook: _, ...rest } = JSON.parse(readFileSync(file, 'utf8')) as Line;
    writeFileSync(file, JSON.stringify(rest));
    const end = await run(w.pi);
    expect(end.isError, said(end)).toBe(true);
    expect(existsSync(join(w.cwd, 'ran.txt'))).toBe(false);
  }, 90_000);

  it('a line deep-hook can\'t read is unread, never a call that matched nothing', () => {
    const out = execFileSync(join(REPO, 'target/debug/deep-hook'), ['match'], { input: '{"tool_name":"bash","tool_input":{"command":"pkill -f x; echo \\ud800"}}\n' });
    expect(JSON.parse(out.toString('utf8'))).toMatchObject({ unread: true });
  });

  it('a file:// URL is read as the file pi opens: the control token, and an encoded write', async () => {
    const read = await world((home) => [{ tools: [{ name: 'read', arguments: { path: `file://${home}/.deepbuild/control.token` } }] }]);
    const held = await run(read.pi);
    expect(held.isError, said(held)).toBe(true);
    expect((await before(read.client, read.pi.session)).data.matched).toContain('no-control-token-read');
    const write = await world((_, cwd) => [{ tools: [{ name: 'write', arguments: { path: `file://localhost${cwd}/%2Edeepbuild/spec.md?x#y`, content: 'x' } }] }]);
    const end = await run(write.pi);
    expect(end.isError, said(end)).toBe(true);
    expect(existsSync(join(write.cwd, '.deepbuild/spec.md')), 'the blocked write ran').toBe(false);
    expect((await before(write.client, write.pi.session)).data.matched).toContain('no-deepbuild-spec-write');
  }, 120_000);

  it('pi\'s own settings are guarded, so no agent can take the package out', async () => {
    const w = await world([{ tools: [{ name: 'write', arguments: { path: '.pi/settings.json', content: '{}' } }] }]);
    const end = await run(w.pi);
    expect(end.isError, said(end)).toBe(true);
    expect(existsSync(join(w.cwd, '.pi/settings.json'))).toBe(false);
    expect((await before(w.client, w.pi.session)).data.matched).toContain('no-pi-config-write');
  }, 90_000);

  it('an unread call\'s end is recorded, failed, so the hub doesn\'t keep it as running', async () => {
    const w = await world([bash('touch ran.txt')]);
    const file = join(w.home, '.deepbuild/config.json');
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')) as Line, hook: { binary: join(w.home, 'no-such-deep-hook') } }));
    await run(w.pi);
    const closed = await waitFor(async () => (await w.client.events()).find((e) => e.kind === 'tool.after' && e.session === w.pi.session), 15_000, 'tool.after');
    expect(closed.data.outcome).toBe('failed');
  }, 90_000);

  it('a deep-hook that died between calls costs no block: the call is read on a fresh one', async () => {
    const w = await world([bash(`pkill -f deepbuild-no-such-${word()}; touch ran.txt`)]);
    const file = join(w.home, '.deepbuild/config.json');
    const config = JSON.parse(readFileSync(file, 'utf8')) as Line;
    const once = join(w.home, 'died');
    const script = join(w.home, 'first-dies');
    writeFileSync(script, `#!/bin/sh\n[ -e ${once} ] || { : > ${once}; exit 1; }\nexec ${String(config.hook.binary)} "$@"\n`, { mode: 0o755 });
    writeFileSync(file, JSON.stringify({ ...config, hook: { binary: script } }));
    const end = await run(w.pi);
    expect(said(end)).toContain('DeepBuild blocked this');
    expect((await before(w.client, w.pi.session)).data.matched).toContain('no-kill-by-name');
  }, 90_000);

  it('a deep-hook that prints what isn\'t JSON holds the call and leaves pi running', async () => {
    const w = await world([bash('touch ran.txt')]);
    const file = join(w.home, '.deepbuild/config.json');
    const script = join(w.home, 'garbled');
    writeFileSync(script, '#!/bin/sh\nwhile read -r _; do echo nonsense; done\n', { mode: 0o755 });
    writeFileSync(file, JSON.stringify({ ...JSON.parse(readFileSync(file, 'utf8')) as Line, hook: { binary: script } }));
    const end = await run(w.pi);
    expect(end.isError, said(end)).toBe(true);
    expect(existsSync(join(w.cwd, 'ran.txt'))).toBe(false);
    expect((await w.pi.call({ type: 'get_state' })).success).toBe(true);
  }, 90_000);

  it('a rebuilt deep-hook replaces the running one', async () => {
    const w = await world([bash('touch first.txt'), { ...bash('touch second.txt'), holdMs: 1500 }]);
    const file = join(w.home, '.deepbuild/config.json');
    const config = JSON.parse(readFileSync(file, 'utf8')) as Line;
    const script = join(w.home, 'rebuilt');
    writeFileSync(script, `#!/bin/sh\nexec ${String(config.hook.binary)} "$@"\n`, { mode: 0o755 });
    writeFileSync(file, JSON.stringify({ ...config, hook: { binary: script } }));
    await w.pi.call({ type: 'prompt', message: 'Go.' });
    await w.pi.until('tool_execution_end', 1, 30_000);
    // The new build reads the second call and refuses it, which the old one wouldn't.
    writeFileSync(script, '#!/bin/sh\nwhile read -r _; do echo nonsense; done\n', { mode: 0o755 });
    utimesSync(script, new Date(), new Date(Date.now() + 5000));
    const end = await w.pi.until('tool_execution_end', 2, 30_000);
    expect(end.isError, said(end)).toBe(true);
    expect(existsSync(join(w.cwd, 'second.txt'))).toBe(false);
  }, 90_000);

  it('a call no entry matches runs, and names none', async () => {
    const w = await world([bash('touch ran.txt')]);
    const end = await run(w.pi);
    expect(end.isError, said(end)).toBe(false);
    expect(existsSync(join(w.cwd, 'ran.txt'))).toBe(true);
    expect((await before(w.client, w.pi.session)).data.matched).toBeUndefined();
  }, 90_000);

  it('an entry added to rules.json mid-session holds the next call', async () => {
    // The model takes a second over its second call, so the entry is there before it.
    const w = await world([bash('touch first.txt'), { ...bash('sometool --go; touch second.txt'), holdMs: 1500 }]);
    await w.pi.call({ type: 'prompt', message: 'Go.' });
    await w.pi.until('tool_execution_start', 1, 30_000);
    const file = join(w.home, '.deepbuild/rules.json');
    const rules = JSON.parse(readFileSync(file, 'utf8')) as Line;
    rules.entries['no-sometool'] = { ...rules.entries['no-kill-by-name'], match: 'run:sometool', reason: 'sometool is out.' };
    writeFileSync(file, JSON.stringify(rules));
    const end = await w.pi.until('tool_execution_end', 2, 30_000);
    expect(end.isError, said(end)).toBe(true);
    expect(existsSync(join(w.cwd, 'second.txt'))).toBe(false);
  }, 90_000);

  it('with the hub away a fail-closed entry still holds, in its own words', async () => {
    const w = await world([bash(`pkill -f deepbuild-no-such-${word()}; touch ran.txt`)]);
    w.hub.child.kill();
    await new Promise((done) => w.hub.child.once('exit', done));
    const end = await run(w.pi);
    expect(end.isError, said(end)).toBe(true);
    expect(said(end)).toContain('no-kill-by-name');
    expect(existsSync(join(w.cwd, 'ran.txt'))).toBe(false);
  }, 90_000);

  it('with the hub away a call no entry matches runs', async () => {
    const w = await world([bash('touch ran.txt')]);
    w.hub.child.kill();
    await new Promise((done) => w.hub.child.once('exit', done));
    const end = await run(w.pi);
    expect(end.isError, said(end)).toBe(false);
    expect(existsSync(join(w.cwd, 'ran.txt'))).toBe(true);
  }, 90_000);
});
