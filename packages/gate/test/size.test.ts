// Size and scope's measure (#324): a change read from git with no model, on a real repository. What the acceptance
// suite (tests/acceptance/324) doesn't reach: a committed range, a binary file, a nested manifest's dev dependency,
// a median over an even count, a document's items compared by value rather than key order, a session in a subfolder,
// the services and cloud resources a change adds, and the lines it adds in duplicated blocks.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { itemChanges, measure, over, usualOf } from '../src/index.ts';

const made: string[] = [];
afterEach(() => { for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function repo(files: Record<string, string | Buffer>): { dir: string; base: string; put(path: string, bytes: string | Buffer): void; commit(): string } {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'size324-')));
  made.push(dir);
  const git = (...args: string[]) => execFileSync('git', ['-c', 'commit.gpgsign=false', '-c', 'user.name=T', '-c', 'user.email=t@example.test', ...args], { cwd: dir, encoding: 'utf8' }).trim();
  const put = (path: string, bytes: string | Buffer) => { mkdirSync(dirname(join(dir, path)), { recursive: true }); writeFileSync(join(dir, path), bytes); };
  git('init', '-q', '-b', 'main');
  for (const [path, bytes] of Object.entries(files)) put(path, bytes);
  const commit = () => { git('add', '-A'); git('commit', '-q', '-m', 'c'); return git('rev-parse', 'HEAD'); };
  return { dir, base: commit(), put, commit };
}

describe('#324 measure', () => {
  it('reads a committed range: lines per file, a binary file as none, and what a nested manifest and a new folder bring', async () => {
    const r = repo({ 'src/a.js': 'one\ntwo\n', 'pkg/package.json': '{"dependencies":{"dayjs":"1"}}\n' });
    const base = r.base;
    r.put('src/a.js', 'one\n2\nthree\n');
    r.put('pkg/package.json', '{"dependencies":{"dayjs":"1"},"devDependencies":{"left-pad":"1"}}\n');
    r.put('assets/logo.bin', Buffer.from([0, 1, 2, 0, 3]));
    const head = r.commit();
    // The working tree moves on after the commit: a range reads the commit, never the folder.
    r.put('src/later.js', 'x\n');
    const m = await measure(r.dir, base, head);
    expect(m.files).toEqual([{ path: 'assets/logo.bin', added: 0, removed: 0 }, { path: 'pkg/package.json', added: 1, removed: 1 }, { path: 'src/a.js', added: 2, removed: 1 }]);
    expect([m.added, m.removed]).toEqual([3, 2]);
    expect(m.dependencies).toEqual([{ name: 'left-pad', from: 'pkg/package.json' }]);
    expect(m.folders).toEqual([{ name: 'assets', from: 'assets/logo.bin' }]);
  });
  it('reads the working tree with its untracked files, and a file in an existing folder brings no folder', async () => {
    const r = repo({ 'src/a.js': 'one\n' });
    r.put('src/b.js', 'b1\nb2\nb3');
    const m = await measure(r.dir, r.base);
    expect(m.files).toEqual([{ path: 'src/b.js', added: 3, removed: 0 }]);
    expect(m.folders).toEqual([]);
  });
  it('reads from the repository root when the session works in a subfolder, and a link counts as no lines', async () => {
    const r = repo({ 'app/src/a.js': 'one\n', 'app/package.json': '{"dependencies":{}}\n' });
    r.put('app/src/a.js', 'one\ntwo\n');
    r.put('app/src/new.js', 'n\n');
    r.put('app/package.json', '{"dependencies":{"dayjs":"1"}}\n');
    symlinkSync('/dev/zero', join(r.dir, 'app/zero'));
    const m = await measure(join(r.dir, 'app'), r.base);
    expect(m.files).toEqual([{ path: 'app/package.json', added: 1, removed: 1 }, { path: 'app/src/a.js', added: 1, removed: 0 }, { path: 'app/src/new.js', added: 1, removed: 0 }, { path: 'app/zero', added: 0, removed: 0 }]);
    expect(m.dependencies).toEqual([{ name: 'dayjs', from: 'app/package.json' }]);
    expect(m.folders).toEqual([]);
  });
});

describe('#324 services, cloud resources and duplicated blocks', () => {
  const block = (tag: string) => Array.from({ length: 6 }, (_, i) => `const ${tag}${i} = compute(${i});`).join('\n');
  it('lists a compose service and a Terraform resource the change adds, with the file each came from', async () => {
    const r = repo({ 'compose.yaml': 'services:\n  api:\n    image: api\n', 'infra/main.tf': 'resource "aws_s3_bucket" "logs" {}\n' });
    r.put('compose.yaml', 'services:\n  api:\n    image: api\n  cache:\n    image: redis\n');
    r.put('infra/main.tf', 'resource "aws_s3_bucket" "logs" {}\nresource "aws_sqs_queue" "jobs" {}\n');
    expect((await measure(r.dir, r.base)).resources).toEqual([{ name: 'service cache', from: 'compose.yaml' }, { name: 'aws_sqs_queue.jobs', from: 'infra/main.tf' }]);
  });
  it('counts the added lines of a block copied from a changed file, and none for a block that only moved', async () => {
    const r = repo({ 'src/a.js': `${block('a')}\n`, 'src/b.js': `${block('b')}\n` });
    r.put('src/c.js', `${block('a')}\nconst other = 1;\n`);
    r.put('src/a.js', `// moved below\n${block('a')}\n`);
    r.put('src/b.js', `const first = 0;\n${block('b')}\n`.replace(block('b'), `${block('b').split('\n').slice(3).join('\n')}\n${block('b').split('\n').slice(0, 3).join('\n')}`));
    // c.js copies a's block (6 added lines in a duplicate); a.js gains a comment; b.js only reorders its own lines.
    expect((await measure(r.dir, r.base)).duplicated).toBe(6);
  });
});

describe('#324 the usual size', () => {
  it('is the median of the last 20, the middle two averaged on an even count, and over is past twice it', () => {
    const old = Array.from({ length: 5 }, () => ({ lines: 1000, files: 50 }));
    const last = [10, 20, 30, 40].flatMap((lines) => Array.from({ length: 5 }, () => ({ lines, files: 2 })));
    expect(usualOf([...old, ...last])).toEqual({ lines: 25, files: 2, n: 20 });
    expect(usualOf([])).toBeNull();
    const usual = { lines: 25, files: 2, n: 20 };
    expect(over({ lines: 50, files: 4 }, usual)).toBe(false);
    expect(over({ lines: 51, files: 1 }, usual)).toBe(true);
    expect(over({ lines: 1, files: 5 }, usual)).toBe(true);
    expect(over({ lines: 10_000, files: 100 }, null)).toBe(false);
  });
});

describe('#324 a document\'s items by stable ID', () => {
  it('lists what was added, changed and removed, and never an item whose keys only moved', () => {
    const before = { items: { a: { kind: 'rect@1', params: { fill: 'muted', box: [0, 0] } }, b: { kind: 'text@1' }, c: { kind: 'text@1' } } };
    const after = { items: { a: { params: { box: [0, 0], fill: 'muted' }, kind: 'rect@1' }, b: { kind: 'text@1', name: 'B' }, d: { kind: 'rect@1' } } };
    expect(itemChanges(before, after)).toEqual([{ id: 'b', change: 'changed' }, { id: 'd', change: 'added' }, { id: 'c', change: 'removed' }]);
    expect(itemChanges(undefined, { items: [{ id: 'x' }] })).toEqual([{ id: 'x', change: 'added' }]);
  });
});
