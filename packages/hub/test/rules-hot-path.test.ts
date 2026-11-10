// The hot path at a tool call that names a path (design: Numbers version 0 has to hold, Hot path): the hub's event loop
// scans no folder for the rules the path meets (#344). #16's AC14 sends only Bash calls, which name no path. The
// main-thread preload is #16's own; the scoped rule still rides the call's reply, so the read happened somewhere.
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, expect, it } from 'vitest';
import { hookLine, reply, send, session, withHub } from './hub.js';

const PRELOAD = fileURLToPath(new URL('../../../tests/acceptance/16/fixtures/preload.mjs', import.meta.url));
const RULE = 'Keep React components under 200 lines';
const dir = mkdtempSync(join(tmpdir(), 'deep-rules-hot-path-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

it("a Read inside a nested rule file's scope carries the rule, and the hub's main thread reads no folder for it", async () => {
  const log = join(dir, 'preload.jsonl');
  await withHub(async (root, home) => {
    const lines = () => readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as { loaded?: boolean; pid?: number; call?: string; args?: string[]; stack?: string });
    // Every process the preload loaded in records to the one log: only the hub may have, or a call is nobody's.
    expect(lines().filter((l) => l.loaded).length, 'the preload loaded in the hub alone').toBe(1);

    const id = 'aaaaaaaa-0344-4000-8000-00000000f300';
    const s = session(home, id);
    mkdirSync(join(s.work, 'packages/app/src'), { recursive: true });
    writeFileSync(join(s.work, 'packages/app/AGENTS.md'), `# App\n\n- ${RULE}\n`);
    writeFileSync(join(s.work, 'packages/app/src/x.ts'), 'export const x = 1;\n');
    execFileSync('git', ['init', '-q', s.work], { stdio: 'pipe' });

    const socket = join(root, 'hub.sock');
    await send(socket, hookLine('01K74FKZVK8Q2X5R7M3N9PF300', 'SessionStart', s.payload('SessionStart', { source: 'startup' })));
    const from = lines().length;
    const read = { tool_name: 'Read', tool_input: { file_path: join(s.work, 'packages/app/src/x.ts') }, tool_use_id: 'toolu_01ReadF3' };
    const got = await reply(socket, hookLine('01K74FKZVK8Q2X5R7M3N9PF301', 'PreToolUse', s.payload('PreToolUse', read)));
    expect(got.stdout, 'the nested file was read: its rule rides the reply').toContain(`DeepBuild: a rule you wrote for packages/app/** (packages/app/AGENTS.md): ${RULE}`);

    const after = lines().slice(from);
    expect(after.filter((l) => l.loaded).length, 'no other process recorded to the log').toBe(0);
    const reads = after.filter((l) => /^fs(\/promises)?\.(readdir|opendir)/.test(l.call ?? ''));
    expect(reads.length, `directory reads on the hub's main thread at a Read's PreToolUse:\n  ${reads.map((l) => `${l.call}(${(l.args ?? []).join(', ')}) ${l.stack}`).join('\n  ')}\n`).toBe(0);
  }, { NODE_OPTIONS: `--import=${PRELOAD}`, DEEP_TEST_PRELOAD_LOG: log });
}, 60_000);
