// AC4 #1773.260e61bd: with `deep-actions` registered in ~/.claude.json beside `deepbuild`, as `deep setup` writes it,
// `toolLists` neither starts that server nor returns a list for it.
//
// A fixture HOME whose ~/.claude.json has the two entries `deep setup` writes (packages/hub/src/setup.ts):
// `deepbuild: {type: 'stdio', command: <deep>, args: ['mcp']}` and `'deep-actions': {type: 'stdio', command:
// <deep-hook>, args: ['mcp', 'actions']}`, and a third-party stdio server `notes` beside them. Each command is a
// small real MCP server (server.mjs) behind a wrapper named as the real program, which writes a marker file when it
// starts, so "never started" is observable. `toolLists(cwd)` is called directly with HOME set to the fixture.
// The third-party server must be started and listed, or the judgment proves nothing (BLOCKED).
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';
import { toolLists } from '../../../packages/hub/src/mcp-servers.ts';

const SERVER = fileURLToPath(new URL('./server.mjs', import.meta.url));
const root = mkdtempSync(join(tmpdir(), 'dh1773-'));
const savedHome = process.env.HOME;
afterAll(() => {
  if (savedHome === undefined) delete process.env.HOME;
  else process.env.HOME = savedHome;
  rmSync(root, { recursive: true, force: true });
});

/** An executable named `program` that runs the fixture MCP server as `name`, passing on the config's args. */
function wrapper(bin: string, program: string, name: string, markers: string): string {
  const file = join(bin, program);
  writeFileSync(file, `#!/bin/sh\nexec '${process.execPath}' '${SERVER}' '${name}' '${markers}' "$@"\n`);
  chmodSync(file, 0o755);
  return file;
}

describe('#1773.260e61bd With `deep-actions` registered in `~/.claude.json` beside `deepbuild`, as `deep setup` writes it, `toolLists` neither starts that server nor returns a list for it. The merge base lists `deep-actions`', () => {
  it('AC4 #1773.260e61bd toolLists neither starts nor lists deep-actions, while the third-party server beside it is started and listed', async () => {
    const home = join(root, 'home');
    const bin = join(root, 'bin');
    const markers = join(root, 'markers');
    const cwd = join(root, 'repo');
    for (const d of [home, bin, markers, cwd]) mkdirSync(d, { recursive: true });
    const deep = wrapper(bin, 'deep', 'deepbuild', markers);
    const hook = wrapper(bin, 'deep-hook', 'deep-actions', markers);
    const notes = wrapper(bin, 'notes-mcp', 'notes', markers);
    writeFileSync(join(home, '.claude.json'), JSON.stringify({
      mcpServers: {
        notes: { type: 'stdio', command: notes, args: [] },
        deepbuild: { type: 'stdio', command: deep, args: ['mcp'] },
        'deep-actions': { type: 'stdio', command: hook, args: ['mcp', 'actions'] },
      },
    }, null, 2));

    process.env.HOME = home;
    const lists = await toolLists(cwd);
    const servers = lists.map((l) => l.server);

    // The third-party server must be read, or a toolLists that lists nothing would pass.
    if (!existsSync(join(markers, 'notes.started')) || !servers.includes('notes')) {
      throw Error(`BLOCKED: toolLists didn't start and list the third-party stdio server notes (started: ${existsSync(join(markers, 'notes.started'))}; listed: ${JSON.stringify(servers)})`);
    }
    expect(lists.find((l) => l.server === 'notes')?.tools.map((t) => t.name)).toEqual(['notes_tool']);

    const started = existsSync(join(markers, 'deep-actions.started'));
    expect.soft(started, 'toolLists started deep-actions (deep-hook mcp actions), DeepBuild\'s own server').toBe(false);
    expect.soft(lists.filter((l) => l.server === 'deep-actions'), 'toolLists returned a list for deep-actions').toEqual([]);
  }, 60_000);
});
