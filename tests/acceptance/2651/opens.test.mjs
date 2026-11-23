// #2651 AC1 (#2651.251a1058): "A forwarded PreToolUse opens `~/.deepbuild/config.json` once, and a forwarded
// PostToolUse at most once. On the merge base a PreToolUse opens it twice, and the test fails, naming the count"
//   node --test tests/acceptance/2651/opens.test.mjs          # under a minute; macOS (cc), the checkout built
// Asserts: the count of opens of ~/.deepbuild/config.json by one deep-hook process forwarding a PreToolUse is exactly 1,
// and by one forwarding a PostToolUse at most 1; each hook is shown forwarded (the hub recorded it). The failure names
// the count. The count is every open() and openat() of that path, read by opens.c injected into the binary
// (DYLD_INSERT_LIBRARIES); deep-hook is `target/debug/deep-hook`, run as Claude Code runs it: `deep-hook claude-code
// <event>` with the hook's JSON on stdin, its HOME the hub's, whose config.json names the hub's address, as
// `deep setup` leaves a set-up machine with the file there.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { AC, CHANGE, cBuild, childEnv, client, events, hookBinary, machine, removeDir, startHub, stopHub, tempDir, unbuilt, until, uuid } from './lib.mjs';

const RULES = {
  v: 1,
  entries: {
    'no-kill-by-name': { match: 'shell:pkill *', scope: 'all_repos', mode: 'block', reason: 'Never kill processes by name.', next_step: 'Stop the process by its PID.', fail_closed: true },
    'listing-noted': { match: 'shell:ls*', scope: 'all_repos', mode: 'watch', reason: 'Listing is noted.', next_step: 'Nothing to do.', fail_closed: false },
  },
};

/** One deep-hook run under opens.c: its exit and the times it opened `config`. */
function run(hook, lib, home, cwd, event, payload, config) {
  const log = join(home, `opens-${event}-${uuid()}.log`);
  const r = spawnSync(hook, ['claude-code', event], { cwd, input: JSON.stringify(payload), encoding: 'utf8', timeout: 30_000, env: childEnv(home, { DYLD_INSERT_LIBRARIES: lib, OPENS_LOG: log }) });
  const lines = existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean) : [];
  return { status: r.status, stderr: String(r.stderr ?? '').slice(0, 500), lines, opens: lines.filter((path) => path === config).length };
}

describe(`${AC[1]} deep-hook opens ~/.deepbuild/config.json once for a forwarded PreToolUse, at most once for a PostToolUse`, () => {
  it(`${AC[1]} a forwarded PreToolUse opens config.json once and a forwarded PostToolUse at most once`, { timeout: 600_000 }, async () => {
    const blocked = unbuilt(CHANGE, ['packages/cli/dist/main.js', 'packages/hub/dist/index.js', 'target/debug/deep-hook']);
    if (blocked) assert.fail(blocked);
    const shim = cBuild('opens');
    if (shim.blocked) assert.fail(shim.blocked);
    const home = tempDir('ac1');
    const root = join(home, '.deepbuild');
    mkdirSync(root, { recursive: true });
    writeFileSync(join(root, 'rules.json'), JSON.stringify(RULES));
    const hub = await startHub(CHANGE, home);
    const c = await client(hub);
    try {
      const config = join(root, 'config.json');
      // As setup leaves it: the file is there, naming the hub's address (the one address setting deep-hook reads).
      const settings = existsSync(config) ? JSON.parse(readFileSync(config, 'utf8')) : {};
      writeFileSync(config, JSON.stringify({ ...settings, hub: { ...(settings.hub ?? {}), address: `unix:${hub.socket}` } }));
      const cwd = join(home, 'work');
      mkdirSync(cwd, { recursive: true });
      const session = uuid();
      const base = { session_id: session, transcript_path: join(home, '.claude', 'projects', 'work', `${session}.jsonl`), cwd, permission_mode: 'default' };
      const hookBin = hookBinary(CHANGE);
      // The session's start first, so the call below is an ordinary call of a known session.
      run(hookBin, shim.lib, home, cwd, 'SessionStart', { ...base, hook_event_name: 'SessionStart', source: 'startup', model: 'claude-haiku-4-5' }, config);
      const readings = [];
      for (let round = 1; round <= 3; round++) {
        const call = `toolu_dh2651ac1${round}`;
        const pre = run(hookBin, shim.lib, home, cwd, 'PreToolUse', { ...base, hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_use_id: call }, config);
        const post = run(hookBin, shim.lib, home, cwd, 'PostToolUse', { ...base, hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_input: { command: 'ls' }, tool_response: { stdout: '', stderr: '', interrupted: false }, tool_use_id: call }, config);
        for (const [event, r] of [['PreToolUse', pre], ['PostToolUse', post]]) {
          if (r.status !== 0) assert.fail(`BLOCKED: deep-hook claude-code ${event} exited ${r.status}: ${r.stderr}`);
          if (!r.lines.length) assert.fail(`INCONCLUSIVE: opens.c recorded no open at all in deep-hook's ${event}, so nothing was counted (is DYLD_INSERT_LIBRARIES honoured for ${hookBin}?)`);
        }
        // Forwarded: the hub recorded both of the call's events, so neither hook acted as it does with the hub down.
        await until(async () => {
          const got = await events(c, ['tool.before', 'tool.after']);
          return ['tool.before', 'tool.after'].every((kind) => got.some((e) => e.kind === kind && JSON.stringify(e.data).includes(call)));
        }, 30_000, `BLOCKED: the hub never recorded the tool.before and tool.after of ${call}: the hooks were not forwarded`);
        readings.push({ pre: pre.opens, post: post.opens });
      }
      console.log(`AC1 opens of ${config} per forwarded hook, three rounds: ${JSON.stringify(readings)} (${machine()})`);
      for (const [i, { pre, post }] of readings.entries()) {
        assert.equal(pre, 1, `a forwarded PreToolUse opened ~/.deepbuild/config.json ${pre} times (round ${i + 1}); once is required`);
        assert.ok(post <= 1, `a forwarded PostToolUse opened ~/.deepbuild/config.json ${post} times (round ${i + 1}); at most once is required`);
      }
    } finally {
      c.close();
      await stopHub(hub);
      removeDir(home);
    }
  });
});
