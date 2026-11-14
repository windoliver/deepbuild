// #1906 AC3: "Every child the core thread starts is in `children.ts`'s table at exit: a test fails on the merge base
// for the two forks" (`open-items.ts:57-60` and `scope.ts:82`, which "go through `children.ts`").
//
// children.ts starts each child from a thread of its own and holds it in its table until the child exits; the table
// has no reader outside the module. What the modules the issue names do show is where a child was started: Node
// announces every child process on the thread that starts it (the `child_process` diagnostics channel), so a child
// started through children.ts is never announced on the thread that asked for it. Each test below stands where the
// core thread stands: it calls the built module (packages/hub/dist, typed by packages/hub/src) on this thread, with
// real git in a real repository, reads the module's answer to know its git ran, and lists the children this thread
// started meanwhile.
import { execFile, execFileSync, type ChildProcess } from 'node:child_process';
import { subscribe, unsubscribe } from 'node:diagnostics_channel';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

type Children = typeof import('../../../packages/hub/src/children.ts');
type OpenItemsModule = typeof import('../../../packages/hub/src/open-items.ts');
type ScopeModule = typeof import('../../../packages/hub/src/scope.ts');

const built = async <T>(name: string): Promise<T> => {
  const url = new URL(`../../../packages/hub/dist/${name}.js`, import.meta.url);
  if (!existsSync(url)) throw Error(`BLOCKED: packages/hub/dist/${name}.js is missing; build the packages first: npm run build --workspaces`);
  return await import(url.href) as T;
};

/** Runs the work and names each child process this thread started while it ran, as its command line. */
async function onThisThread<T>(work: () => Promise<T>): Promise<{ value: T; started: string[] }> {
  const children: ChildProcess[] = [];
  const note = (message: unknown): void => { children.push((message as { process: ChildProcess }).process); };
  subscribe('child_process', note);
  try {
    const value = await work();
    return { value, started: children.map((c) => (c.spawnargs ?? [c.spawnfile]).join(' ')) };
  } finally {
    unsubscribe('child_process', note);
  }
}

const dirs: string[] = [];
const GIT_ENV = { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_'))), GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
const git = (cwd: string, ...args: string[]): string =>
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd, env: GIT_ENV, encoding: 'utf8' }).trim();
/** A repository with one commit, in a folder of its own. */
function repo(): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'deep-1906-')));
  dirs.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  mkdirSync(join(dir, 'src'));
  writeFileSync(join(dir, 'src', 'a.js'), 'export const a = 1;\n');
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '-m', 'chore: start');
  return dir;
}
const unused = (what: string) => (): never => { throw Error(`${what} is not part of this reading`); };

let children: Children;
let openItems: OpenItemsModule;
let scope: ScopeModule;
beforeAll(async () => {
  children = await built<Children>('children');
  openItems = await built<OpenItemsModule>('open-items');
  scope = await built<ScopeModule>('scope');
});
afterAll(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }); });

describe('#1906 AC3: every child the core thread starts goes through children.ts', () => {
  it('the watch tells the two apart: a child this thread forks is seen, one children.ts runs is not', async () => {
    const forked = await onThisThread(() => new Promise<string>((resolve) => execFile('git', ['--version'], (_error, out) => resolve(out))));
    expect(forked.value).toMatch(/^git version /);
    expect(forked.started).toEqual(['git --version']);
    const through = await onThisThread(() => children.run('git', ['--version']));
    expect(through.value.error).toBeNull();
    expect(through.value.stdout).toMatch(/^git version /);
    expect(through.started).toEqual([]);
  });

  it('open items: reading what a claim\'s change added starts no child on the core thread (open-items.ts:57-60)', async () => {
    const cwd = repo();
    const base = git(cwd, 'rev-parse', 'HEAD');
    // One placeholder in a tracked file's diff and one in a file the change created: the two git reads of a claim.
    writeFileSync(join(cwd, 'src', 'a.js'), 'export const a = 1;\n// TODO: handle the empty list\n');
    writeFileSync(join(cwd, 'src', 'b.js'), '// FIXME: the retry is not wired\n');
    const opened: string[] = [];
    const items = new openItems.OpenItems({
      raw: async () => [],
      append: async (_connection, input) => { if (input.kind === 'open_item.opened') opened.push(String((input.data as { text: unknown }).text)); },
      connection: () => ({ writer: 'core', actor: 'core', scope: 'core' }),
      asks: unused('an ask'), pin: unused('a pin'), github: unused('GitHub'),
      now: () => Date.now(),
      taskList: () => undefined,
    });
    const read = await onThisThread(() => items.atClaim({ session: 's-1906', agent: 'claude-code', task: 'task-1906', cwd, base, message: 'Done.', transcript: undefined, pr: undefined }));
    // Its git ran: both placeholders came back as open items, one per file.
    expect(opened.filter((text) => text.includes('src/a.js')), 'the diff against the base was read').toHaveLength(1);
    expect(opened.filter((text) => text.includes('src/b.js')), 'the files the change created were listed').toHaveLength(1);
    expect(read.started, 'no child of the claim\'s reading is started on the core thread').toEqual([]);
  }, 60_000);

  it('size and scope: reading the repo\'s accepted changes starts no git log on the core thread (scope.ts:82)', async () => {
    const cwd = repo();
    // Three accepted fixes of 2, 4 and 10 changed lines in 1, 2 and 3 files: the usual fix is 4 lines in 2 files.
    const fixes: [string, number][][] = [[['src/a.js', 2]], [['src/a.js', 2], ['src/b.js', 2]], [['src/a.js', 4], ['src/b.js', 3], ['src/c.js', 3]]];
    fixes.forEach((files, i) => {
      for (const [path, lines] of files) writeFileSync(join(cwd, path), Array.from({ length: lines }, (_, n) => `// fix ${i + 1} line ${n + 1}\n`).join(''), { flag: 'a' });
      git(cwd, 'add', '-A');
      git(cwd, 'commit', '-q', '-m', `fix: number ${i + 1}`);
    });
    const head = git(cwd, 'rev-parse', 'HEAD');
    const sizing = new scope.SizeScope({
      raw: unused('the record'), append: unused('an event'), connection: unused('a connection'), asks: unused('an ask'), pin: unused('a pin'), keep: unused('evidence'), scopeOf: unused('a plan'),
      now: () => Date.now(), evidence: join(cwd, 'evidence'), accepted: undefined,
    });
    const read = await onThisThread(() => sizing.usual(cwd, 'fix', head));
    // Its git log ran: the usual size is the median of the three fixes the history names.
    expect(read.value).toEqual({ lines: 4, files: 2, n: 3 });
    expect(read.started.filter((command) => / log( |$)/.test(command)), 'the history of accepted changes is not read by a child of the core thread').toEqual([]);
  }, 60_000);
});
