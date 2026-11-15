// #1606 AC2, AC3 and AC4: the hub's channel tests in a test home. A real hub on a temp home whose channels.json names
// #65's chat provider stand-in with a bot token in plain text, the chat channel installed with `deep install`, and the
// OS secret store stood in for by DEEP_HUB_TEST_SECRETS, a file beside the home (README, Surfaces). The provider answers
// 401 to any call that doesn't carry `authorization: Bearer <token>`, so a call it answered 200 carried the token in its
// header. AC4's wrong program is the hub planted to log each provider call's headers (DEEP_HUB_PLANT=logs-channel-header).
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AC, agentEnvironment, carried, channelWorld, cleanup, connect, eventsOf, filesHolding, formsIn, HANDLE, MINUTE, octal, sleep, statuses,
  STORE_KEY, TOKEN, within, type ChannelWorld, type Line,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const readJson = (file: string): Line | undefined => { try { return JSON.parse(readFileSync(file, 'utf8')) as Line; } catch { return undefined; } };

/** AC2: what's wrong once the hub started on the file: the token still in it, no handle, not in the store, no call carrying it. */
function movedFailures(w: ChannelWorld, movedAt: number): string[] {
  const out: string[] = [];
  const text = readFileSync(w.file, 'utf8');
  for (const form of formsIn(text, TOKEN)) out.push(`${w.file} still holds the token (${form})`);
  const entry = (readJson(w.file)?.channels as Line | undefined)?.chat as Line | undefined;
  if (entry?.secret !== HANDLE) out.push(`${w.file} names the chat channel's token by ${JSON.stringify(entry?.secret)}, not the handle ${HANDLE}: its entry is ${JSON.stringify(entry).slice(0, 200)}`);
  if (entry && 'token' in entry) out.push(`${w.file} still has the chat channel's token field: ${JSON.stringify(entry.token).slice(0, 80)}`);
  const stored = readJson(w.store)?.[STORE_KEY];
  if (stored !== TOKEN) out.push(`the secret store (DEEP_HUB_TEST_SECRETS) holds ${stored === undefined ? 'nothing' : 'another value'} under ${STORE_KEY}`);
  if (!carried(w, movedAt).length) out.push(`no call to the chat provider after the move carried the token in its header (its last calls: ${statuses(w)})`);
  return out;
}

/** AC3: what's wrong with a file readable by group or others: the hub used it, or its log doesn't name it and its mode. */
function refusedFailures(w: ChannelWorld, mode: number): string[] {
  const out: string[] = [];
  const used = carried(w);
  if (used.length) out.push(`the hub used ${w.file}, mode ${octal(mode)}: ${used.length} calls to the chat provider carried its token`);
  const named = w.hub.proc.stderr().split('\n').some((line) => line.includes(w.file) && new RegExp(`(^|[^0-7])0?${mode.toString(8)}([^0-7]|$)`).test(line.replaceAll(w.file, '')));
  if (!named) out.push(`the hub's log (deep hub run's standard error) has no line naming ${w.file} and its mode ${octal(mode)}: ${JSON.stringify(w.hub.proc.stderr().slice(-1200))}`);
  return out;
}

/** AC4: every place the token was found after a channel send: the record, the logs (every file under the home, and the hub's own log), an agent's environment. */
async function leakFailures(w: ChannelWorld): Promise<string[]> {
  const out: string[] = [];
  for (const e of await eventsOf(await connect(w))) for (const form of formsIn(JSON.stringify(e), TOKEN)) out.push(`the record holds the token (${form}) in ${String(e.kind)}@${String(e.log_pos)}`);
  for (const form of formsIn(w.hub.proc.stderr(), TOKEN)) out.push(`the hub's log (deep hub run's standard error) holds the token (${form})`);
  out.push(...filesHolding(w.home, TOKEN));
  for (const form of formsIn(await agentEnvironment(w.home), TOKEN)) out.push(`an agent's environment holds the token (${form})`);
  return out;
}
/** A channel send: the routed ask's card accepted by the chat provider. */
async function sent(w: ChannelWorld): Promise<void> {
  const ok = await within(MINUTE, () => w.provider.posts.some((p) => p.status === 200));
  if (!ok) throw Error(`no channel send: the chat provider accepted no card within a minute (its last calls: ${statuses(w)})`);
}

describe(`${AC[2]} After the hub starts on that file, the file holds a handle and no token, the store holds the value, and a provider call carries it in its header`, () => {
  it(`${AC[2]} after the hub starts on channels.json holding the chat channel's token, the file names it by handle, the store holds it, and a provider call carries it in its header`, async () => {
    const w = await channelWorld();
    await within(MINUTE, () => readJson(w.file)?.channels?.chat?.secret === HANDLE);
    const movedAt = Date.now();
    await within(30_000, () => carried(w, movedAt).length > 0);
    expect(movedFailures(w, movedAt)).toEqual([]);
  }, 600_000);
});

describe(`${AC[3]} A channels file readable by group or others is refused, naming the file and its mode`, () => {
  it(`${AC[3]} a channels.json readable by its group (0640), and one readable by others (0604), are each refused, naming the file and its mode`, async () => {
    const out: string[] = [];
    for (const mode of [0o640, 0o604]) {
      const w = await channelWorld({ mode });
      // The channel loaded: the hub calls its receive() at least once a second, so ten seconds is ten chances to use the file.
      await sleep(10_000);
      out.push(...refusedFailures(w, mode));
      await cleanup();
    }
    expect(out).toEqual([]);
  }, 900_000);
});

describe(`${AC[4]} After a channel send, a scan of the record, the logs and an agent's environment finds no token; a planted hub that logs the header fails, naming where`, () => {
  it(`${AC[4]} after a channel send, the record, the logs and an agent's environment hold no form of the token`, async () => {
    const w = await channelWorld({ send: true });
    await sent(w);
    expect(await leakFailures(w)).toEqual([]);
  }, 600_000);

  it(`${AC[4]} wrong program: a hub that logs the header (logs-channel-header) fails, naming where`, async () => {
    const w = await channelWorld({ send: true, plant: 'logs-channel-header' });
    await sent(w);
    const said = (await leakFailures(w)).join('\n');
    expect(said, 'the planted hub fails the scan, naming the hub\'s log').toContain('the hub\'s log (deep hub run\'s standard error) holds the token');
  }, 600_000);
});
