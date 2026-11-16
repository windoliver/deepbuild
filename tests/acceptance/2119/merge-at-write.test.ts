// #2119 acceptance (README.md), the first criterion: setup merges its entries into ~/.claude.json as the file is at the
// write. Written first and blind, from the issue, the design and the base commit. `deep setup` runs as a child process
// of the built CLI in a home of its own, with a stand-in deep-hook that npm's install path finds; setup asks it for
// --help once it has planned the file and before it writes it, and the stand-in, as a Claude Code session would, writes
// the file again with one key more. A failure on a wrong program is the expect below; a test that can't set that up
// throws BLOCKED, and never passes or skips.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import { calls, child, cleanup, deep, homeIn, needs, plain, standInHook, tempFolder } from './helpers.ts';

afterAll(cleanup);

test("#2119.92207f0e setup merges its entries into ~/.claude.json as it is at the write: a key a session wrote there while setup ran deep-hook's --help, between its plan and its write, is still there beside DeepBuild's two servers", async () => {
  needs();
  const folder = tempFolder();
  const home = homeIn(folder);
  const file = join(home, '.claude.json');
  const yours = { numStartups: 7, autoUpdates: false };
  writeFileSync(file, `${JSON.stringify(yours, null, 2)}\n`);
  // What the session writes: the file as it read it, with one key more, a trust answer for a folder.
  const trust = { [join(folder, 'work')]: { hasTrustDialogAccepted: true } };
  const wrote = join(folder, 'session-wrote.json');
  writeFileSync(wrote, `${JSON.stringify({ ...yours, projects: trust }, null, 2)}\n`);
  const hook = standInHook(folder, `cat '${wrote}' > '${file}'`);

  const r = await deep(child(folder, home, { nodePath: hook.nodePath }), 'setup');

  // Given: setup ran the stand-in's --help, its hook step, which at the base comes after the plan and before the write.
  if (!calls(hook.program).includes('--help')) throw Error(`BLOCKED: setup never ran the stand-in deep-hook's --help, so nothing wrote ${file} between setup's plan and its write\n${r.shown}`);
  const text = readFileSync(file, 'utf8');
  let after: Record<string, unknown> = {};
  try { after = JSON.parse(text) as Record<string, unknown>; } catch { /* shown below */ }
  const servers = typeof after.mcpServers === 'object' && after.mcpServers !== null ? Object.keys(after.mcpServers).filter((name) => name === 'deepbuild' || name === 'deep-actions').sort() : [];
  expect({ projects: after.projects, servers }, `${file} after setup ended, which a session wrote "projects" into while setup ran deep-hook's --help:\n${plain(text)}\n${r.shown}\n(end of the run)`).toEqual({ projects: trust, servers: ['deep-actions', 'deepbuild'] });
}, 600_000);
