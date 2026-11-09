// #1359 AC6 (README): on a Node older than the CLI's engines field, every command exits 2 before anything runs, naming
// the Node needed and the one found, and sets nothing up. A real older Node (helpers: olderNode); none on this machine
// is BLOCKED, never a pass.
import { afterAll, describe, expect, it } from 'vitest';
import { SECOND, calls, changeLine, changes, cleanup, deep, enginesNode, help, listedCommands, needBuild, olderNode, snapshot, world } from './helpers.ts';

afterAll(cleanup, 60 * SECOND);

const ID = '#1359.5f083178';

describe(`${ID} deep on a Node older than its engines field`, () => {
  it(`${ID} every command exits 2 before anything runs, naming the Node needed and the one found, and sets nothing up`, async () => {
    needBuild();
    const old = olderNode();
    const needed = enginesNode();
    if (!old) throw Error(`BLOCKED: no Node older than ${needed} on this machine; name one with DEEP1359_OLD_NODE`);
    // Every command deep --help lists (read with this Node), bare, and deep itself with nothing, --help and --version.
    const commands = [[], ['--help'], ['--version'], ['help'], ...listedCommands(await help())];
    const w = world();
    const wrong: string[] = [];
    for (const args of commands) {
      const home = snapshot(w.home);
      const work = snapshot(w.work);
      const r = await deep(w, args, { node: old.node, timeoutMs: 30 * SECOND });
      const why = [
        r.code !== 2 ? `exited ${r.code}${r.timedOut ? ' (killed at the timeout)' : ''}` : '',
        !r.stderr.includes(needed) ? `named no Node ${needed}` : '',
        !r.stderr.includes(old.version) ? `named not the Node found, ${old.version}` : '',
        changeLine('wrote in the home', changes(home, snapshot(w.home))),
        changeLine('wrote in the working folder', changes(work, snapshot(w.work))),
      ].filter(Boolean);
      if (why.length) wrong.push(`deep ${args.join(' ')}: ${why.join('; ')}; stderr ${JSON.stringify(r.stderr.slice(0, 300))}`);
    }
    expect(calls(w), 'the login service or a service manager was called').toEqual([]);
    expect(wrong, `under Node ${old.version} (${old.node}), ${wrong.length} of ${commands.length} commands didn't stop first:\n${wrong.join('\n')}`).toEqual([]);
  }, 1800 * SECOND);
});
