// A loaded host spools hooks, so an edit's PostToolUse can reach the hub before its PreToolUse (#352): the edit's
// lines still count, and the late PreToolUse is no new change to tell the other session of.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { Siblings } from '../src/siblings.js';
import type { Draft, HookMeta } from '../src/wire.js';

const dir = mkdtempSync(join(tmpdir(), 'deep-siblings-order-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args], { cwd, stdio: 'pipe' });

it("counts an edit whose PostToolUse came before its PreToolUse, and tells the other session of it once", async () => {
  const repo = join(dir, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  writeFileSync(join(repo, 'src/cart.js'), 'a\nb\n// end\n');
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '.');
  git(repo, 'commit', '-q', '-m', 'base');
  git(repo, 'worktree', 'add', '-q', '-b', 'a/cart', join(dir, 'wa'));
  git(repo, 'worktree', 'add', '-q', '-b', 'b/cart', join(dir, 'wb'));

  const siblings = new Siblings({
    raw: async () => [], append: async () => undefined, ask: async () => 'ask', wake: async () => false,
    acking: () => undefined, queue: (work) => void work(), now: () => Date.now(),
  });
  let n = 0;
  const meta = (session: string, cwd: string, event: string, toolUse: string, extra: Partial<HookMeta> = {}): HookMeta =>
    ({ id: `hook-${++n}`, agent: 'claude-code', event, session, cwd, transcript: '', pid: 1, ppid: 1, toolUse, ...extra }) as HookMeta;
  const before: Draft[] = [{ kind: 'tool.before', v: 1, id: 'd', ts: 0, data: { kind: 'edit', paths: ['src/cart.js'] } }];
  // Session `b`'s k-th edit puts a line above the marker, at line k + 2.
  const post = (session: string, cwd: string, use: string, k: number) => siblings.hook([], meta(session, cwd, 'PostToolUse', use, {
    hunks: [{ oldStart: k + 2, oldLines: 1, newLines: 2, changed: [k + 2] }],
    call: { mode: 'default', tool: 'Edit', input: { file_path: join(cwd, 'src/cart.js') }, suggestions: [] },
  }));
  const pre = (session: string, cwd: string, use: string) => siblings.hook(before, meta(session, cwd, 'PreToolUse', use));
  const wa = join(dir, 'wa');
  const wb = join(dir, 'wb');

  await pre('a', wa, 'a1');
  await post('a', wa, 'a1', 1);
  await pre('b', wb, 'b1');
  await post('b', wb, 'b1', 1);
  await post('b', wb, 'b2', 2);
  const until = () => Date.now() + 60_000;
  expect(siblings.row('b')?.files).toEqual([{ path: 'src/cart.js', lines: '3-4' }]);
  expect(await siblings.deliver(meta('a', wa, 'PreToolUse', 'a2'), until())).toContain('lines 3-4');

  await pre('b', wb, 'b2');
  expect(await siblings.deliver(meta('a', wa, 'PreToolUse', 'a3'), until())).toBeUndefined();

  await pre('b', wb, 'b3');
  await post('b', wb, 'b3', 3);
  expect(siblings.row('b')?.files).toEqual([{ path: 'src/cart.js', lines: '3-5' }]);
  expect(await siblings.deliver(meta('a', wa, 'PreToolUse', 'a4'), until())).toContain('lines 3-5');
  siblings.stop();
});
