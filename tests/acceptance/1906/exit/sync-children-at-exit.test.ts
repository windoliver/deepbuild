// #1906 AC3, the synchronous class: every child the core thread starts is in children.ts's table at exit, for the
// children it starts with execFileSync, spawnSync and execSync, which hold the thread until the child has ended.
//
// Read as (README, and sync-children's part of it): the core's thread is this one, loading the built modules on
// core.ts's import graph and calling them on real git repositories and a real launcher program. A synchronous child
// can't be read while it runs, since the thread that owns the table is held. So it is read at Node's own boundary:
// node:child_process's three synchronous functions run as they are, and as each returns, before the caller has the
// answer back, children.ts's tables are read through the inspector (helpers.ts, `tables`). Nothing ran on this thread
// while the child lived, so those are the tables as they stood at its exit. A child is in the table when they then
// hold an entry they did not hold before the call, and no earlier child's. The asynchronous functions are read at
// the same boundary, at each child's exit event, so a call moved off the synchronous form is still judged.
import cp, { execFileSync as realExecFileSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { tables, type Reading } from './helpers.ts';

/** The recorded seed and the cases the local preflight runs (design: Universal rules are tested as properties). */
const SEED = 1906;
const RUNS = 1000;

const DIST = new URL('../../../../packages/', import.meta.url);
async function built<T>(file: string): Promise<T> {
  if (!existsSync(new URL(file, DIST))) throw Error(`BLOCKED: packages/${file} is missing; build first: npm run build --workspaces`);
  return (await import(new URL(file, DIST).href)) as T;
}
let children: typeof import('../../../../packages/hub/src/children.ts');
let box: typeof import('../../../../packages/hub/src/box.ts');
let service: typeof import('../../../../packages/hub/src/service.ts');
let gate: typeof import('../../../../packages/gate/src/index.ts');
let table: ReturnType<typeof tables>;

/** Two repositories whose folders are both named `repo`, each with a `sub` folder; the first has four commits. */
let dir: string;
let roots: [string, string];
let commits: string[];
/** The program that stands in for the service manager (service.ts's own seam, DEEP_HUB_LAUNCHER), and what it was handed. */
let launcher: string;
let handed: string;
const home = process.env.HOME;

beforeAll(async () => {
  children = await built('hub/dist/children.js');
  box = await built('hub/dist/box.js');
  service = await built('hub/dist/service.js');
  gate = await built('gate/dist/index.js');
  table = tables(children, new URL('hub/dist/children.js', DIST).pathname);
  dir = realpathSync(mkdtempSync(join(tmpdir(), 'dh1906s-')));
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));
  const made = ['one', 'two'].map((name) => {
    const repo = join(dir, name, 'repo');
    mkdirSync(join(repo, 'sub'), { recursive: true });
    const git = (...args: string[]) => realExecFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=T', '-c', 'user.email=t@example.test', ...args], { cwd: repo, encoding: 'utf8', env }).trim();
    git('init', '-q', '-b', 'main', repo);
    const shas = ['a', 'b', 'c', 'd'].map((n) => {
      writeFileSync(join(repo, 'sub', `${n}.js`), `${n}\n`);
      git('add', '-A');
      git('commit', '-q', '-m', `${n}`);
      return git('rev-parse', 'HEAD');
    });
    return { repo, shas };
  });
  roots = [made[0]!.repo, made[1]!.repo];
  commits = made[0]!.shas;
  launcher = join(dir, 'launcher');
  handed = join(dir, 'handed');
  writeFileSync(launcher, `#!/bin/sh\nprintf '%s\\n' "$1" >> '${handed}'\nprintf 'refused %s' "$DH1906_EXIT" >&2\nexit "$DH1906_EXIT"\n`, { mode: 0o755 });
}, 60_000);
afterAll(() => {
  table?.close();
  if (dir) rmSync(dir, { recursive: true, force: true });
});

/** One child this thread started, as Node's boundary saw it end. */
interface Seen {
  via: string;
  command: string;
  /** Its exit status; 0 where the function answers only with the child's output. */
  status: number | null;
  /** The tables as the child ended; undefined for an asynchronous child still running when the call answered. */
  at: Reading | undefined;
}
const SYNC = ['execFileSync', 'spawnSync', 'execSync'] as const;
const ASYNC = ['execFile', 'spawn', 'exec', 'fork'] as const;
type Fn = (...args: unknown[]) => unknown;
const words = (args: unknown[]): string => args.filter((a) => typeof a === 'string' || Array.isArray(a)).flat().join(' ');

/**
 * Runs one call of the core's with node:child_process read at its boundary: every function runs as it is, and the
 * tables are read as each synchronous one returns or throws, and at each asynchronous child's exit event.
 */
async function watched<T>(call: () => T | Promise<T>): Promise<{ result: T; before: Reading; seen: Seen[] }> {
  const real = cp as unknown as Record<string, Fn>;
  const kept = Object.fromEntries([...SYNC, ...ASYNC].map((name) => [name, real[name]!]));
  const seen: Seen[] = [];
  let inside = false;
  for (const name of SYNC) {
    real[name] = function (this: unknown, ...args: unknown[]) {
      if (inside) return kept[name]!.apply(this, args);
      inside = true;
      let status: number | null = 0;
      try {
        const out = kept[name]!.apply(this, args);
        if (name === 'spawnSync') status = (out as { status: number | null }).status;
        return out;
      } catch (error) {
        status = (error as { status?: number | null }).status ?? null;
        throw error;
      } finally {
        inside = false;
        seen.push({ via: name, command: words(args), status, at: table.read() });
      }
    };
  }
  for (const name of ASYNC) {
    real[name] = function (this: unknown, ...args: unknown[]) {
      const child = kept[name]!.apply(this, args) as ChildProcess;
      if (inside) return child;
      const one: Seen = { via: name, command: words(args), status: null, at: undefined };
      seen.push(one);
      child.prependListener('exit', (code) => { one.status = code; one.at = table.read(); });
      return child;
    };
  }
  syncBuiltinESMExports();
  const before = table.read();
  try {
    return { result: await call(), before, seen };
  } finally {
    Object.assign(real, kept);
    syncBuiltinESMExports();
  }
}
/** The entries of a reading that an earlier one did not hold. */
const fresh = (at: Reading, before: Reading): string[] => Object.entries(at).flatMap(([name, keys]) => keys.filter((k) => !before[name]?.includes(k)).map((k) => `${name}[${k}]`));
/** The children that ended in no table of children.ts, each in words; none is the criterion. */
function outside(before: Reading, seen: Seen[]): string[] {
  const taken = new Set<string>();
  const out: string[] = [];
  for (const c of seen) {
    if (!c.at) continue;
    const entry = fresh(c.at, before).find((k) => !taken.has(k));
    if (entry) taken.add(entry);
    else out.push(`${c.via} ${c.command.replaceAll(dir, '<dir>')} (status ${c.status}) ended, in no table of children.ts: ${JSON.stringify(c.at)}`);
  }
  return out;
}

const never = (what: string) => (): never => { throw Error(`${what} is not reached in this test`); };
/** One call that starts a child synchronously on the core's thread. */
type Call =
  // hub, directly (box.ts, execFileSync): your words about a repo are matched to the hub's folders by each one's `git rev-parse --show-toplevel`.
  | { call: 'box'; folders: number[] }
  // Through another package (packages/gate's head.ts, execFileSync): the commits of a head, by `git rev-list`.
  | { call: 'head'; base: number; head: number }
  // hub, directly (service.ts, spawnSync): the login service's definition handed to the service manager.
  | { call: 'service'; exit: number };

/** Makes the call on real components, checks its answer against the children's real output and status, and gives what was seen. */
async function make(c: Call): Promise<string[]> {
  if (c.call === 'box') {
    // Folder n is repository n % 2, its top for n < 2 and its `sub` folder otherwise.
    const folders = c.folders.map((n) => (n < 2 ? roots[n % 2]! : join(roots[n % 2]!, 'sub')));
    const said = new box.Box({ root: join(dir, 'root'), plant: undefined, now: Date.now, raise: never('an ask'), folders: async () => folders, lessons: never('a lesson'), forget: never('a lesson'), learn: never('the wiki') } as unknown as ConstructorParameters<typeof box.Box>[0]);
    const { result, before, seen } = await watched(() => said.say('stop checking tests in repo'));
    const named = [...new Set(c.folders.map((n) => roots[n % 2]!))];
    expect(result, 'both repositories are named repo, each by its top folder as git answers it').toEqual({ unread: `2 repos are named repo: ${named.join(', ')}; nothing was drafted.` });
    expect(seen.length, 'the box asked git for each folder').toBeGreaterThanOrEqual(1);
    return outside(before, seen);
  }
  if (c.call === 'head') {
    const [base, head] = [Math.min(c.base, c.head), Math.max(c.base, c.head)];
    const { result, before, seen } = await watched(() => gate.headTrust({ repo: roots[0], base: commits[base]!, head: commits[head]!, recorded: [], yours: [], provider: [] }));
    expect(result.commits.map((x) => x.commit), `the commits after ${base} up to ${head}`).toEqual(commits.slice(base + 1, head + 1));
    expect(seen.length, 'the head was read with git').toBeGreaterThanOrEqual(1);
    return outside(before, seen);
  }
  process.env.HOME = join(dir, 'home');
  process.env.DEEP_HUB_LAUNCHER = launcher;
  process.env.DH1906_EXIT = String(c.exit);
  try {
    const file = service.serviceFile();
    if (!file.startsWith(dir)) throw Error(`BLOCKED: the service's definition would be written outside the test's folder: ${file}`);
    rmSync(handed, { force: true });
    const { result, before, seen } = await watched(() => service.startService(['/bin/echo', 'hub'], join(dir, 'logs')));
    expect(result, `the launcher's status ${c.exit} and what it wrote`).toBe(c.exit === 0 ? undefined : `${launcher} exited ${c.exit}: refused ${c.exit}`);
    expect(readFileSync(handed, 'utf8'), 'the launcher ran once, handed the definition').toBe(`${file}\n`);
    expect(seen.length, 'the launcher was started').toBeGreaterThanOrEqual(1);
    return outside(before, seen);
  } finally {
    if (home === undefined) delete process.env.HOME; else process.env.HOME = home;
    delete process.env.DEEP_HUB_LAUNCHER;
    delete process.env.DH1906_EXIT;
  }
}

/** The reading is live before a child is judged by it: while children.ts runs a child for the core, its entry is in the table. */
async function reads(): Promise<void> {
  const before = table.read();
  const running = children.startOf(process.pid);
  const during = table.read();
  expect(await running, 'this process has a start time').toMatch(/\d{4}/);
  expect(fresh(during, before).length, 'the child children.ts is running has an entry').toBe(1);
}

describe('#1906 AC3 every child the core thread starts synchronously is in children.ts\'s table at exit', () => {
  it('execFileSync in the hub: each `git rev-parse` box.ts starts is in the table as it ends', async () => {
    await reads();
    expect(await make({ call: 'box', folders: [2, 1] })).toEqual([]);
  }, 60_000);

  it('execFileSync through another package: each `git` packages/gate\'s headTrust starts is in the table as it ends', async () => {
    await reads();
    expect(await make({ call: 'head', base: 0, head: 3 })).toEqual([]);
  }, 60_000);

  it('spawnSync in the hub: the launcher service.ts starts is in the table as it ends, whatever its status', async () => {
    await reads();
    expect([...await make({ call: 'service', exit: 0 }), ...await make({ call: 'service', exit: 3 })]).toEqual([]);
  }, 60_000);

  it(`for ${RUNS} seeded runs of the core's synchronous calls, every child started is in the table as it ends (generator: calls, seed ${SEED})`, async () => {
    const call: fc.Arbitrary<Call> = fc.oneof(
      // At least one folder of each repository, in any order, tops and `sub` folders.
      fc.record({ call: fc.constant('box' as const), folders: fc.shuffledSubarray([0, 1, 2, 3], { minLength: 2 }).filter((f) => new Set(f.map((n) => n % 2)).size === 2) }),
      fc.record({ call: fc.constant('head' as const), base: fc.integer({ min: 0, max: 3 }), head: fc.integer({ min: 0, max: 3 }) }).filter((c) => c.base !== c.head),
      fc.record({ call: fc.constant('service' as const), exit: fc.integer({ min: 0, max: 9 }) }),
    );
    await fc.assert(fc.asyncProperty(fc.array(call, { minLength: 1, maxLength: 3 }), async (calls) => {
      const out: string[] = [];
      for (const c of calls) out.push(...await make(c));
      expect(out, `calls ${JSON.stringify(calls)}`).toEqual([]);
    }), { seed: SEED, numRuns: RUNS });
  }, 1_800_000);
});
