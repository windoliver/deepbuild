// Guards on real pi: deep-hook, the one matcher, reads each call before it runs. A matched entry's call never runs and
// its name is on the record; with the hub away a fail-closed entry still holds; nothing else is touched.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
// `deep setup` runs for real on a temp home, as tests/acceptance/19 does.
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { CLI, Client, NODE, Pi, childEnv, cleanup, run as sh, startHub, tempDir, waitFor, word, type Hub, type Line, type Step } from '../../../tests/acceptance/40/helpers.js';

const bash = (command: string): Step => ({ tools: [{ name: 'bash', arguments: { command } }] });

afterEach(cleanup);

/** A hub, `deep setup` for its home, and pi with the package. */
async function world(steps: Step[]): Promise<{ hub: Hub; client: Client; pi: Pi; cwd: string; home: string }> {
  const tmp = tempDir();
  const home = join(tmp, 'h');
  const cwd = join(tmp, 'w');
  mkdirSync(home);
  mkdirSync(cwd);
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
