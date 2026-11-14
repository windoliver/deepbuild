// #1773 AC2: with `deepbuild` registered in ~/.claude.json as `deep setup` writes it (packages/hub/src/setup.ts: type
// stdio, the command `node <cli> mcp`), `toolLists` neither starts that server nor returns a list for it, while a
// third-party stdio server beside it (`forge`) is still listed. The `deepbuild` entry's command is a copy of the fixture
// server, which leaves a mark when anything starts it and would answer a tool list if asked; the merge base starts it
// and lists it.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { toolLists } from '../../../packages/hub/src/mcp-servers.ts';
import { claudeJson, everStarted, installServer, tempDir, withHome } from './helpers.ts';

describe("#1773.6dc4e7a9 With `deepbuild` registered in `~/.claude.json` as `deep setup` writes it, `toolLists` neither starts that server nor returns a list for it, while a third-party stdio server beside it is still listed. The merge base lists `deepbuild`", () => {
  it('lists forge alone, and never starts the deepbuild server', async () => {
    const home = tempDir();
    const work = join(home, 'work');
    mkdirSync(work, { recursive: true });
    // As `deep setup` writes it: `deepbuild: { type: 'stdio', command: <node>, args: [<cli>, 'mcp'] }`.
    const deepbuild = installServer(home, 'deepbuild/packages/cli/dist', 'main.js', 'deepbuild', ['deep_claim', 'deep_ask', 'deep_wait'], ['mcp']);
    const forge = installServer(home, 'forge', 'server.mjs', 'forge', ['list_issues', 'get_issue']);
    claudeJson(home, { deepbuild: deepbuild.config, forge: forge.config });

    const lists = await withHome(home, () => toolLists(work));

    expect(lists.map((l) => l.server), 'toolLists returns a list for forge and none for deepbuild').toEqual(['forge']);
    expect(lists[0], 'forge, the third-party server, is listed from your user config with its tools').toMatchObject({ server: 'forge', scope: 'user', version: '1.0.0' });
    expect(lists[0]!.tools.map((t) => t.name)).toEqual(['list_issues', 'get_issue']);
    expect(everStarted(forge), 'forge was started to read its list').toBe(true);
    expect(everStarted(deepbuild), 'the deepbuild server is never started').toBe(false);
  }, 60_000);
});
