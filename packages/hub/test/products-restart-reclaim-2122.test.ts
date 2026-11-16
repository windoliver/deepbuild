// Supplemental #2122: the socket -> restarted Core -> Products path, not a direct hook() unit test.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { client, hookLine, recorded, reply, session, withHub } from './hub.js';
import { git, indexAt, productSpec, realGit } from './products-2122-fixture.js';

const preload = fileURLToPath(new URL('./products-2122-disk-boundary.mjs', import.meta.url));
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

it('after a hub restart an active PreToolUse protects its old product while low-disk reclaim removes an idle worktree product', async () => {
  const control = mkdtempSync('/tmp/products-restart-2122-');
  const released = join(control, 'released');
  const entered = join(control, 'entered');
  const lowSeen = join(control, 'low-seen');
  const env = { NODE_OPTIONS: `--import=${preload}`, DEEP_2122_DISK: control };
  try {
    await withHub(async (root, home, hub) => {
      const activeId = 'aaaaaaaa-2122-4000-8000-000000000001';
      const idleId = 'aaaaaaaa-2122-4000-8000-000000000002';
      const seedId = 'aaaaaaaa-2122-4000-8000-000000000003';
      const s = session(home, activeId);
      const repo = join(home, 'repo');
      const idle = join(home, 'idle');
      mkdirSync(join(repo, '.deepbuild'), { recursive: true });
      writeFileSync(join(repo, '.deepbuild/done.yaml'), productSpec);
      writeFileSync(join(repo, 'lock'), 'one\n');
      git(repo, 'init', '-q', '-b', 'main');
      git(repo, 'add', '.');
      git(repo, 'commit', '-qm', 'fixture');
      writeFileSync(join(home, '.claude.json'), JSON.stringify({ projects: Object.fromEntries([repo, s.work, idle].map(path => [path, { hasTrustDialogAccepted: true }])) }));
      let seq = 0;
      const hook = (id: string, cwd: string, event: string, extra: Record<string, unknown> = {}) => reply(join(root, 'hub.sock'), hookLine(
        `01K74FKZVK8Q2X5R7M3N9${String(++seq).padStart(5, '0')}`, event,
        s.payload(event, { session_id: id, cwd, ...extra }), { ppid: process.pid },
      ));
      expect((await hook(seedId, repo, 'SessionStart', { source: 'startup' })).exit).toBe(0);
      await expect.poll(() => existsSync(join(root, 'products.json')) && indexAt(root).entries.length === 1, { timeout: 30_000 }).toBe(true);
      // Created after the build, so real tracked-file mtimes permit warm placement.
      git(repo, 'worktree', 'add', '-q', '-b', 'active', s.work);
      git(repo, 'worktree', 'add', '-q', '-b', 'idle', idle);
      expect((await hook(activeId, s.work, 'SessionStart', { source: 'startup' })).exit).toBe(0);
      expect((await hook(idleId, idle, 'SessionStart', { source: 'startup' })).exit).toBe(0);
      for (const work of [s.work, idle]) expect(readFileSync(join(work, 'target/artifact'), 'utf8')).toBe('warm');
      expect((await hook(idleId, idle, 'SessionEnd', { reason: 'prompt_input_exit' })).exit).toBe(0);
      expect(await recorded(root, idleId, 'session.end', 1)).toBe(1);
      const placed = indexAt(root).placed;
      expect(placed.map(p => p.top).sort()).toEqual([s.work, idle].sort());
      expect(placed.find(p => p.top === s.work)!.at).toBeLessThan(placed.find(p => p.top === idle)!.at);

      const bin = join(home, 'bin');
      mkdirSync(bin);
      // This executable holds only the active worktree's external repo lookup.
      // Every invocation eventually execs real git with the original arguments.
      writeFileSync(join(bin, 'git'), `#!/bin/sh
if [ "$PWD" = '${s.work}' ]; then
  case "$*" in *--git-common-dir*)
    : > '${entered}'
    n=0
    while [ ! -f '${released}' ]; do
      sleep 0.02
      n=$((n + 1))
      [ "$n" -lt 1500 ] || exit 99
    done
    ;;
  esac
fi
exec '${realGit}' "$@"
`);
      chmodSync(join(bin, 'git'), 0o755);
      const restartedAt = Date.now() + 3 * 3_600_000;
      await hub.restart({ ...env, PATH: `${bin}:${process.env.PATH ?? ''}`, DEEP_HUB_TEST_CLOCK: String(restartedAt) });
      expect(placed.every(p => restartedAt - p.at > 2 * 3_600_000)).toBe(true);
      expect(indexAt(root).placed).toEqual(placed);
      // A new default-branch key requests room via the real build/reclaim path.
      writeFileSync(join(repo, 'lock'), 'two\n');
      git(repo, 'add', 'lock');
      git(repo, 'commit', '-qm', 'next key');
      writeFileSync(join(control, 'idle-target'), join(idle, 'target'));
      const rpc = await client(join(root, 'hub.sock'), readFileSync(join(root, 'control.token'), 'utf8').trim());
      expect((await hook(activeId, s.work, 'PreToolUse', { tool_name: 'Read', tool_input: { file_path: join(s.work, 'lock') }, tool_use_id: 'toolu_active_after_restart' })).exit).toBe(0);
      expect(await recorded(root, activeId, 'tool.before', 1)).toBe(1);
      // A socket reply and even a durable tool.before are not proof that async
      // product registration finished. A queued RPC must not overtake held git.
      let crossedWhileHeld = false;
      const barrier = rpc('events.read', { after: 0, limit: 1 }).then(() => { crossedWhileHeld = !existsSync(released); });
      writeFileSync(join(control, 'low'), 'under floor until the idle product is reclaimed');
      const building = hook(seedId, repo, 'SessionStart', { source: 'startup' });
      try {
        // On the base there is no lookup at all: continue to the actual reclaim
        // assertion, rather than failing on a missing gate or a timeout.
        await expect.poll(() => existsSync(entered) || existsSync(lowSeen), { timeout: 15_000 }).toBe(true);
        await sleep(500);
        if (existsSync(entered)) {
          expect.soft(crossedWhileHeld, 'Core must await product registration before later queued work').toBe(false);
          expect.soft(existsSync(lowSeen), 'reclaim must not start while the active lookup is held').toBe(false);
        }
      } finally {
        writeFileSync(released, 'continue real git');
      }
      await barrier;
      expect((await building).exit).toBe(0);
      await expect.poll(() => !existsSync(join(idle, 'target')), { timeout: 30_000 }).toBe(true);
      expect(existsSync(lowSeen), 'the hub really saw free space below its floor').toBe(true);
      expect(indexAt(root).placed.some(p => p.top === idle)).toBe(false);
      expect(readFileSync(join(idle, 'lock'), 'utf8')).toBe('one\n');
      expect(existsSync(join(s.work, 'target/artifact')), 'PreToolUse after restart must keep the active product; the idle twin was reclaimed').toBe(true);
      expect(readFileSync(join(s.work, 'target/artifact'), 'utf8')).toBe('warm');
      expect(indexAt(root).placed.some(p => p.top === s.work)).toBe(true);
      expect(await recorded(root, activeId, 'session.start', 1), 'no replacement SessionStart restored activity after restart').toBe(1);
    }, env);
  } finally {
    writeFileSync(released, 'cleanup releases only this job\'s git');
    rmSync(control, { recursive: true, force: true });
  }
}, 90_000);
