// #315 AC12: when the hub refuses a request (one carrying the planted unknown field f_test, from #16's AC23
// build), or replies with a line that doesn't parse (a test hub), deep-hook acts as with the hub down: it denies
// `pkill -f node` (a fail_closed entry in rules.json), allows `ls`, prints none of the hub's bytes, and spools the
// request. The hub's bytes are read where they crossed: through a forwarded socket the address setting names, and
// from the test hub's own copy of what it wrote.
import { afterEach, describe, expect, it } from 'vitest';
import {
  bash, buildDeepHook, cleanup, decision, forwarder, hook, jsonLines, makeHome, newSession, readSpool, setAddress, shown, startHub,
  startTestHub, stopHub, tempDir, writeRules, type Ran,
} from './helpers.ts';

afterEach(cleanup, 60_000);

interface Call { how: string; command: string; ran: Ran; requestId: string | undefined; hubBytes: string[] }
interface Observed { calls: Call[]; spooledIds: string[] }

/** Both ways a hub can turn a request down, each with `ls` and `pkill -f node`. */
async function observe(refusing: string, garbling: string): Promise<Observed> {
  const home = makeHome();
  writeRules(home);
  const s = newSession(home);
  const calls: Call[] = [];

  // The real hub refuses a request carrying f_test, naming the field (#16 AC23).
  const hub = await startHub({ home });
  for (const command of ['ls', 'pkill -f node']) {
    const f = await forwarder(tempDir(), hub.socket);
    setAddress(home, `unix:${f.path}`);
    const ran = await hook(home, s, 'PreToolUse', bash(s, command), { binary: refusing, env: { DEEP_HOOK_FORCE_F_TEST: '1' } });
    const sent = jsonLines(f.upText()).find((l) => l.event === 'PreToolUse');
    const down = f.downText().split('\n').filter(Boolean);
    await f.close();
    if (!down.some((l) => l.includes('"error"'))) throw Error(`BLOCKED: the hub didn't refuse the request carrying f_test; it wrote ${JSON.stringify(down)}`);
    const tokens = down.flatMap((l) => { const j = JSON.parse(l) as { start?: string; error?: { remediation?: string } }; return [l, j.start, j.error?.remediation].filter((t): t is string => !!t); });
    calls.push({ how: 'the hub refused the request carrying f_test', command, ran, requestId: sent?.id as string | undefined, hubBytes: tokens });
  }
  await stopHub(hub);

  // A test hub acknowledges the request, then replies with a line that doesn't parse.
  for (const command of ['ls', 'pkill -f node']) {
    const nonce = `g${Date.now().toString(36)}${command.length}`;
    const t = await startTestHub('garbled-reply', nonce);
    setAddress(home, `unix:${t.socket}`);
    const ran = await hook(home, s, 'PreToolUse', bash(s, command), { binary: garbling });
    const sent = t.requests().find((l) => l.event === 'PreToolUse');
    calls.push({ how: 'the hub replied with a line that doesn\'t parse', command, ran, requestId: sent?.id as string | undefined, hubBytes: [...t.written(), `hub-bytes-${nonce}`, `test-hub-garbled-reply-${nonce}`] });
    await t.stop();
  }
  return { calls, spooledIds: readSpool(home).requests.map((r) => r.json.id as string) };
}

/** Throws at the first way the observation misses AC12. */
function judgeRefusal(o: Observed): void {
  for (const c of o.calls) {
    const where = `${c.how}, \`${c.command}\``;
    const printed = `${c.ran.stdout}\n${c.ran.stderr}`;
    const leaked = c.hubBytes.find((bytes) => printed.includes(bytes));
    if (leaked !== undefined) throw Error(`${where}: deep-hook printed the hub's bytes: ${JSON.stringify(leaked.slice(0, 200))}; it printed ${JSON.stringify(printed.slice(0, 400))}`);
  }
  for (const c of o.calls) {
    const where = `${c.how}, \`${c.command}\``;
    const want = c.command === 'ls' ? 'allow' : 'deny';
    if (decision(c.ran) !== want) throw Error(`${where}: deep-hook must ${want} it: ${shown(c.ran)}`);
    if (!c.requestId) throw Error(`${where}: no request reached the hub`);
    if (!o.spooledIds.includes(c.requestId)) throw Error(`${where}: request ${c.requestId} was not spooled`);
  }
}

describe('AC12 #315.9abdf3f5 a refused request or a reply that doesn\'t parse: pkill -f node denied, ls allowed, none of the hub\'s bytes printed, the request spooled', () => {
  it('AC12 the hub refuses a request carrying the planted field f_test; a test hub replies with a line that doesn\'t parse', async () => {
    const refusing = await buildDeepHook({ features: ['plant-f-test'] });
    const plain = await buildDeepHook();
    judgeRefusal(await observe(refusing, plain));
  }, 900_000);

  it('AC12 (wrong program) a deep-hook that prints the reply as it came fails this test', async () => {
    const planted = await buildDeepHook({ features: ['plant-f-test', 'plant-print-reply'] });
    const o = await observe(planted, planted);
    expect(() => judgeRefusal(o)).toThrow(/deep-hook printed the hub's bytes/);
  }, 900_000);
});
