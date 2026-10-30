// #332 AC1: a stack started by `deep env up` gets its credentials without the agent seeing a value or a path. The
// environment names the credential by variable and source (`credentials: { SHOP_API_KEY: { dotfile: ... } }`, README);
// env-local loads the value into the stack's process alone. The stack proves it got the value by its digest
// (fixtures/server.mjs, GET /env); "the agent seeing" is read on everything an agent can read of the run: what
// `deep env up` and `deep env down` print, the record (the hub's events, which deep mcp serves), the worktree's
// files, and every file under the hub's root (the record's own files, evidence and logs). None of them may hold
// the value (raw or base64) or the dotfile's path. The server prints the value once at start, as a careless app
// logs its config, so a value that reached its output and wasn't scrubbed shows up there.
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cleanup, Client, deep, filesHolding, given, home, makeRepo, mustBeReady, READY, serverUp, sha256, startHub, stopHub, sub, tempDir, waitFor, get,
} from './helpers.ts';

afterEach(cleanup, 60_000);

/** A clearly fake value: no service takes it. */
const FAKE_KEY = 'dh332-FAKE-shop-api-key-not-a-secret-7Qx2';

describe('AC1 #332.17008cc5 a stack started by `deep env up` gets its credentials without the agent seeing a value or a path', () => {
  it('AC1 the stack\'s process gets SHOP_API_KEY from its dotfile, and neither the value nor the dotfile\'s path is in what deep env up prints, the record, the worktree or the hub\'s files', async () => {
    // The credential's source: a dotfile in the (temp) home, as `shop login` would leave it.
    const dotfileDir = join(home(), '.shop');
    mkdirSync(dotfileDir, { recursive: true });
    const dotfile = join(dotfileDir, 'test.env');
    writeFileSync(dotfile, `SHOP_REGION=test\nSHOP_API_KEY=${FAKE_KEY}\n`, { mode: 0o600 });

    const t = makeRepo({ up: serverUp(), ports: ['web'], ready: READY, within: 20, credentials: { SHOP_API_KEY: { dotfile: '~/.shop/test.env' } } });
    const wt = t.worktree('wt-a');
    const hub = await startHub(sub(tempDir(), 'root'));
    const client = await Client.open(hub);
    try {
      const up = await deep(['env', 'up', '--root', hub.root, '--json'], { cwd: wt });
      const out = mustBeReady(up, wt);
      const port = out.ports.web as number;

      // The stack got the value.
      const env = await given(port, 'the stack');
      expect(env.credential?.set, `the stack's process was given SHOP_API_KEY (${JSON.stringify(env.credential)})`).toBe(true);
      expect(env.credential?.sha256, 'the value it was given is the dotfile\'s').toBe(sha256(FAKE_KEY));

      // What the agent sees of it: nothing.
      const printed = `${up.stdout}\n${up.stderr}`;
      expect(printed.includes(FAKE_KEY), 'deep env up prints the credential\'s value').toBe(false);
      expect(printed.includes(dotfile), 'deep env up prints the dotfile\'s path').toBe(false);
      const down = await deep(['env', 'down', '--root', hub.root, '--json'], { cwd: wt });
      expect(down.code, `deep env down exits 0 (${down.stdout} ${down.stderr})`).toBe(0);
      await waitFor(async () => (await get(port, '/health')).status === null, 10_000, `the stack on ${port} to be gone`);
      const shown = `${down.stdout}\n${down.stderr}`;
      expect(shown.includes(FAKE_KEY) || shown.includes(dotfile), 'deep env down prints the value or the path').toBe(false);

      const record = JSON.stringify(await client.events());
      expect(record.includes(FAKE_KEY), 'the record holds the credential\'s value').toBe(false);
      expect(record.includes(Buffer.from(FAKE_KEY).toString('base64').replace(/=+$/, '')), 'the record holds the value in base64').toBe(false);
      expect(record.includes(dotfile), 'the record holds the dotfile\'s path').toBe(false);
      expect(filesHolding(wt, FAKE_KEY), 'files in the worktree hold the value').toEqual([]);
      expect(filesHolding(hub.root, FAKE_KEY), 'files under the hub\'s root (record, evidence, logs) hold the value').toEqual([]);
    } finally {
      client.close();
      await stopHub(hub);
    }
  }, 180_000);
});
