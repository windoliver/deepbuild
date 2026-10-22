// Hermetic runs: AC1, a check that passes only on a variable in your shell fails here; AC13, the run record shows
// which environment variables were allowed through; AC18, every hermetic run passes DO_NOT_TRACK=1, so a tool
// that honors it sends no usage data. Each run goes through the supervisor (#236) as host@1.
import { userInfo } from 'node:os';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { runCommandCheck, type CommandRun } from '../../../packages/checks-command/src/index.ts';
import { closeListeners, command, home, httpListener, lineAfter, NODE_TEST, openWorld, outputOf, project, recording, SET_BY_THE_RUN, VITEST, type World } from './helpers.ts';

let world: World;
beforeAll(async () => { world = await openWorld(); });
afterAll(async () => { await world?.close(); });
afterEach(closeListeners);

const envNames = (r: CommandRun): string[] => JSON.parse(lineAfter(r, 'ENV ')) as string[];

describe('AC1 #30.fc577857 a check that only passes because of a variable in your shell fails here', () => {
  it('AC1 a Vitest check that passes only with DH30_SHELL_FLAG=on, which the shell running these tests has, fails here on that test', async () => {
    expect(process.env.DH30_SHELL_FLAG, 'the shell running the tests has the variable').toBe('on');
    const r = await runCommandCheck(command(world.sup, project('shell-var'), VITEST));
    expect(r.outcome, outputOf(r)).toBe('failed');
    expect(r.testsRun).toBe(1);
    expect(r.failures.map((f) => f.test).join(' | ')).toMatch(/the feature flag is on/);
  }, 180_000);

  it('AC1 the same check given the variable for its run passes, so the failure is the missing variable and nothing else', async () => {
    const r = await runCommandCheck(command(world.sup, project('shell-var'), VITEST, { env: { DH30_SHELL_FLAG: 'on' } }));
    expect(r.outcome, outputOf(r)).toBe('passed');
    expect(r.testsRun).toBe(1);
  }, 180_000);

  it('AC1 each run gets a home of its own, neither yours nor the shell\'s, and its own process, through host@1', async () => {
    const { host, calls } = recording(world.sup);
    const [a, b] = await Promise.all([
      runCommandCheck(command(host, project('env-probe'), NODE_TEST)),
      runCommandCheck(command(host, project('env-probe'), NODE_TEST)),
    ]);
    const homes = [a, b].map((r) => lineAfter(r, 'HOME '));
    for (const shown of homes) {
      const [path, exists] = [JSON.parse(shown.slice(0, shown.lastIndexOf(' '))) as string | null, shown.slice(shown.lastIndexOf(' ') + 1)];
      expect(path, 'the run has a HOME').toBeTypeOf('string');
      expect(path, 'not the shell\'s HOME').not.toBe(home());
      expect(path, 'not your home folder').not.toBe(userInfo().homedir);
      expect(exists, `the run's home ${path} exists while it runs`).toBe('true');
    }
    expect(homes[0], 'two runs share no home').not.toBe(homes[1]);
    for (const r of [a, b]) expect(envNames(r), 'the shell\'s variable never reaches the run').not.toContain('DH30_SHELL_FLAG');
    const started = calls.filter((c) => c.call === 'start' && c.started?.status === 'started');
    for (const r of [a, b]) expect(started.some((c) => c.run === r.run), `${r.run} started its process through host@1`).toBe(true);
    const pids = started.filter((c) => c.run === a.run || c.run === b.run).map((c) => (c.started as { pid: number }).pid);
    expect(new Set(pids).size, 'no two runs share a process').toBe(pids.length);
  }, 180_000);
});

describe('AC13 #30.e9d732fa the run record shows which environment variables were allowed through', () => {
  it('AC13 the record lists, by name and never by value, every variable the run\'s process got: PATH, HOME, DO_NOT_TRACK and those passed in, and none from the shell', async () => {
    const r = await runCommandCheck(command(world.sup, project('env-probe'), NODE_TEST, { env: { NODE_ENV: 'test', CART_REGION: 'eu-west' } }));
    expect(Array.isArray(r.env)).toBe(true);
    for (const name of ['PATH', 'HOME', 'DO_NOT_TRACK', 'NODE_ENV', 'CART_REGION']) expect(r.env, `the record lists ${name}`).toContain(name);
    expect(r.env, 'a variable only the shell has wasn\'t allowed through').not.toContain('DH30_SHELL_FLAG');
    for (const name of r.env) expect(name, 'names only, never NAME=value').toMatch(/^[A-Za-z_][A-Za-z0-9_]*$/);
    expect(JSON.stringify(r.env)).not.toContain('eu-west');
    const seen = envNames(r).filter((name) => !SET_BY_THE_RUN.has(name));
    const unlisted = seen.filter((name) => !r.env.includes(name));
    expect(unlisted, `variables the run's process got that the record doesn't show (record: ${r.env.join(', ')})`).toEqual([]);
  }, 180_000);
});

describe('AC18 #30.69c42fdf every hermetic run passes DO_NOT_TRACK=1, listed in the run record, so a tool that honors it sends no usage data', () => {
  /** The fixture tool runs before the suite; it posts to the listener unless DO_NOT_TRACK=1 (or TELEMETRY_FORCE=1). */
  const telemetryCheck = (port: number, plant?: 'no-do-not-track', force = false) => command(world.sup, project('telemetry'), `node tools/lint.mjs && ${VITEST}`, {
    env: { TELEMETRY_PORT: String(port), ...(force ? { TELEMETRY_FORCE: '1' } : {}) },
    hosts: [`127.0.0.1:${port}`],
    ...(plant ? { plant } : {}),
  });

  /** The criterion's assertion, applied to one run: DO_NOT_TRACK=1 reached it and is listed, and nothing was posted. */
  function sendsNothing(r: CommandRun, posted: number): void {
    expect(r.env, 'DO_NOT_TRACK is listed with the other variables').toContain('DO_NOT_TRACK');
    expect(posted, `the tool posted usage data during its check (${outputOf(r).match(/usage \w+/)?.[0] ?? 'no word from the tool'})`).toBe(0);
    expect(outputOf(r)).toMatch(/usage off/);
  }

  it('AC18 the run\'s process sees DO_NOT_TRACK=1 and the record lists it', async () => {
    const r = await runCommandCheck(command(world.sup, project('env-probe'), NODE_TEST));
    expect(JSON.parse(lineAfter(r, 'DO_NOT_TRACK ')), 'the value the run\'s process got').toBe('1');
    expect(r.env).toContain('DO_NOT_TRACK');
  }, 180_000);

  it('AC18 a fixture tool that posts to a local listener unless DO_NOT_TRACK=1 makes no request during its check, though the listener is reachable from it', async () => {
    const listener = await httpListener();
    // The control: the same check with the tool told to post anyway reaches the listener, so the silence below is
    // DO_NOT_TRACK's doing, not a sandbox that refused the connection.
    const control = await runCommandCheck(telemetryCheck(listener.port, undefined, true));
    if (listener.connections() === 0) throw Error(`BLOCKED: the check can't reach its listener 127.0.0.1:${listener.port}, so its silence would prove nothing (${outputOf(control).match(/usage [^\n]*/)?.[0] ?? outputOf(control).slice(0, 500)})`);
    const before = listener.connections();
    const r = await runCommandCheck(telemetryCheck(listener.port));
    expect(r.outcome, outputOf(r)).toBe('passed');
    sendsNothing(r, listener.connections() - before);
  }, 240_000);

  it('AC18 (wrong program) a runner that clears the environment without setting DO_NOT_TRACK lets the tool post, and fails this test', async () => {
    const listener = await httpListener();
    const r = await runCommandCheck(telemetryCheck(listener.port, 'no-do-not-track'));
    if (listener.connections() === 0) throw Error(`BLOCKED: the planted runner's tool never reached the listener, so the wrong program wasn't shown (${outputOf(r).slice(0, 500)})`);
    expect(() => sendsNothing(r, listener.connections())).toThrow(/posted usage data during its check|DO_NOT_TRACK/);
  }, 240_000);
});
