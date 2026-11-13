// `deep person invite | revoke`: the commands that send person.invite and person.revoke, which the hub takes only from
// your own terminal (#1338). Before them `deep join` had no invite to take. #1338's world is reused by path: maya's hub
// and clone, and a link another machine reaches the hub through.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, expect, it } from 'vitest';
import { cleanup, deepOn, machine, readOn, REPO_LINK, shown, sleep, world } from '../../../tests/acceptance/1338/helpers.ts';
import { deep } from './hub.js';

afterAll(cleanup, 60_000);

it("deep person invite prints an invite deep join takes, and deep person revoke ends that person's reads within 5 s", async () => {
  const w = await world();
  const invited = await deepOn(w.me, ['person', 'invite', 'bob', '--address', `127.0.0.1:${w.link.port}`]);
  expect(invited.code, shown(invited)).toBe(0);
  const invite = invited.stdout.trim().split('\n').at(-1)!;

  const bob = machine(w, 'bob');
  const joined = await deepOn(bob, ['join', REPO_LINK, '--invite', invite], 120_000);
  expect(joined.code, `deep join with the printed invite: ${shown(joined)}`).toBe(0);
  const before = await readOn(bob);
  expect(before.code, `bob's machine reads the project: ${shown(before)}`).toBe(0);

  const revoked = await deepOn(w.me, ['person', 'revoke', 'bob']);
  expect(revoked.code, shown(revoked)).toBe(0);
  await sleep(5000);
  const after = await readOn(bob);
  expect(after.code, `5 s after the revoke bob's read is refused: ${shown(after)}`).not.toBe(0);
}, 600_000);

it('deep person with arguments it cannot read prints its usage, exits 2 and reaches no hub', async () => {
  const home = mkdtempSync(join(tmpdir(), 'deep-person-'));
  try {
    for (const args of [[], ['invite'], ['invite', 'bob'], ['invite', 'bob', '--address'], ['invite', 'bob', '--to', 'host:1'], ['revoke'], ['revoke', '--all'], ['add', 'bob']]) {
      const ran = await deep(home, home, ['person', ...args]);
      expect(ran.code, `deep person ${args.join(' ')}: ${ran.stderr}`).toBe(2);
      expect(ran.stderr).toContain('Usage: deep person invite <login> --address <host>:<port>');
    }
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}, 120_000);
