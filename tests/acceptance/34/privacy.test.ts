// #34 AC9: the control token never appears in logs or in the debug bundle. Logs are what the hub and the CLI
// print and what lands under <root>/logs/ (design: Everything lives under ~/.deepbuild/, logs/) or the user's
// Library/Logs; the bundle is `deep debug bundle`'s (#19). Every form #15 names for a held value is searched.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { afterEach, describe, expect, it } from 'vitest';
import {
  asApp, asCli, cleanup, Confirmer, confirmEnv, Conn, deep, fromHere, hookRequest, judgeToken, makeHome, newSession, sendHook, sleep,
  startHub, stopHub, tokenOf, walk, type Hub, type HubOptions,
} from './helpers.ts';

afterEach(cleanup, 60_000);
const FIXTURES = fileURLToPath(new URL('./fixtures/', import.meta.url));

/** A hub whose stdout and stderr are kept from its ready line on. */
async function watched(o: HubOptions): Promise<{ hub: Hub; out: () => string }> {
  const hub = await startHub(o);
  let out = '';
  hub.proc.child.stdout?.on('data', (d: string) => (out += d));
  return { hub, out: () => out };
}
/** Everything that could log a token: hellos right and wrong, a page's request, a malformed line and a hook carrying it. */
async function exercise(hub: Hub): Promise<void> {
  const token = tokenOf(hub.root);
  const app = await asApp(hub);
  await app.call('inbox.read', {});
  await app.call('ask.answer', { ask: 'ask:01K74FKZVK8Q2X5R7M3N9P4T6W', option: token });
  const cli = await asCli(hub);
  await cli.call('hub.health', {});
  for (const line of [
    `${JSON.stringify({ v: 1, hello: 'app', token: `${token}x` })}\n`,
    `${JSON.stringify({ v: 1, hello: 'app', token, origin: 'https://example.com' })}\n`,
    `GET / HTTP/1.1\r\nOrigin: https://example.com\r\nAuthorization: Bearer ${token}\r\n\r\n`,
    `{"v":1,"hello":"app","token":"${token}"\n`,
  ]) {
    const conn = await Conn.open(hub.socket);
    conn.write(line);
    await conn.closed(1000);
    conn.close();
  }
  const s = newSession(hub.home, 'claude-code');
  await sendHook(hub.socket, fromHere(hookRequest(s, 'PreToolUse', { tool_input: { command: `curl -H 'x-token: ${token}' localhost` } })));
  await sleep(300);
}
/** Each log file under the root and the user's Library/Logs, by path. */
function logFiles(home: string, root: string): Record<string, string> {
  const files: Record<string, string> = {};
  for (const file of [...walk(join(root, 'logs')), ...walk(join(home, 'Library', 'Logs'))]) files[file] = readFileSync(file, 'latin1');
  return files;
}

describe('AC9 #34.fe55a29c the token never appears in logs or in the debug bundle', () => {
  it('AC9 across two launches, neither launch\'s token appears in the hub\'s output, the CLI\'s, or any log file, in any form', async () => {
    const home = makeHome();
    const options = { home, env: confirmEnv(new Confirmer()) };
    const texts: Record<string, string> = {};
    const tokens: string[] = [];
    for (const launch of [1, 2]) {
      const { hub, out } = await watched(options);
      tokens.push(tokenOf(hub.root));
      await exercise(hub);
      const status = await deep(home, ['hub', 'status']);
      texts[`launch ${launch}: deep hub status`] = `${status.stdout}\n${status.stderr}`;
      await stopHub(hub);
      texts[`launch ${launch}: the hub's stdout`] = out();
      texts[`launch ${launch}: the hub's stderr`] = hub.proc.stderr();
    }
    Object.assign(texts, logFiles(home, join(home, '.deepbuild')));
    const hits = tokens.flatMap((token, i) => judgeToken(token, texts).map((hit) => `launch ${i + 1}'s token in ${hit}`));
    expect(hits, hits.join('\n')).toEqual([]);
  }, 120_000);

  it('AC9 (wrong program) a hub that logs its token as it writes control.token fails this test, naming where', async () => {
    const home = makeHome();
    const { hub, out } = await watched({ home, env: confirmEnv(new Confirmer()), preload: join(FIXTURES, 'leak-token.mjs') });
    const token = tokenOf(hub.root);
    await exercise(hub);
    await stopHub(hub);
    const hits = judgeToken(token, { 'the hub\'s stdout': out(), 'the hub\'s stderr': hub.proc.stderr(), ...logFiles(home, hub.root) });
    expect(hits, 'the planted hub\'s stderr holds the token, and the judge names it').toContain('the hub\'s stderr: raw');
  }, 60_000);

  it('AC9 the debug bundle `deep debug bundle` writes holds no form of the token', async () => {
    const home = makeHome();
    const { hub } = await watched({ home, env: confirmEnv(new Confirmer()) });
    await exercise(hub);
    const token = tokenOf(hub.root);
    const made = await deep(home, ['debug', 'bundle']);
    if (made.code !== 0 && /Unsupported command|unknown command/i.test(`${made.stdout}${made.stderr}`)) {
      throw Error(`BLOCKED: \`deep debug bundle\` is #19's (CLI basics: setup, status, doctor, off and on, debug bundle), open at this base; the CLI says: ${made.stderr.trim()}`);
    }
    expect(made.code, `deep debug bundle: ${made.stderr}`).toBe(0);
    const path = made.stdout.trim().split('\n').at(-1) ?? '';
    expect(existsSync(path), `deep debug bundle prints the bundle's path last: ${made.stdout}`).toBe(true);
    const bytes = readFileSync(path);
    const text = bytes.toString('latin1') + (bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString('latin1') : '');
    const hits = judgeToken(token, { [`the bundle ${path}`]: text, 'its output': `${made.stdout}\n${made.stderr}` });
    expect(hits, hits.join('\n')).toEqual([]);
    await stopHub(hub);
  }, 120_000);
});
