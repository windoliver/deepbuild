// Criterion 2: a held call's reason holds the ask's address (#1460: `ask/<ULID>`), and `deep open` on it lands on that
// ask's card. The held call is the fixture run's first: an agent's `git push origin main` in a thread whose prompts name
// no push, held by an authority ask. The reason is what the agent's PreToolUse got back. With the Scope's order (the
// ask's question leads, its ID goes last, as `deep inbox` prints it). The plant, in the same test so it can't pass
// alone: the same reason with the address cut back to the bare ID must fail the same judge, naming the ask. Then the
// real `deep-app` runs on the world's home, and `deep open <the address as the reason writes it>` must leave its window
// on the ask's page with its card: a node whose accessibilityIdentifier is `ask/<ULID>` and one that is `question-card`
// (#1460's README, Pinned 2), read from outside the app as an assistive client reads it (#1459's probe).
import { afterAll, describe, expect, it } from 'vitest';
import * as t83 from '../83/helpers.ts';
import { RealApp } from '../1459/helpers.ts';
import { appBinary } from '../1460/helpers.ts';
import { addressesIn, addressFailures, askFor, bash, idOnly, ID, lastPos, MIN, PUSH, reasonOf, session, world } from './helpers.ts';

let app: RealApp | undefined;
afterAll(async () => { await app?.stop(); await t83.cleanup(); }, 60_000);

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** The identifiers of every node of the real window. */
const identifiers = async (a: RealApp): Promise<string[]> => (await a.nodes()).map((n) => n.identifier).filter((i): i is string => !!i);
/** Polls until each of `ids` is some node's identifier, or 30 s pass; the ids still missing. */
async function missing(a: RealApp, ids: string[]): Promise<string[]> {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const have = await identifiers(a);
    const gone = ids.filter((id) => !have.includes(id));
    if (!gone.length || Date.now() > deadline) return gone.map((id) => `${id} (the window has ${JSON.stringify(have.filter((i) => /\/|card/.test(i))).slice(0, 300)})`);
    await sleep(500);
  }
}

describe(`AC2 ${ID.address} A held call's reason holds the ask's address, and \`deep open\` on it lands on that ask's card. A planted reason with only the ID fails, naming the ask`, () => {
  it(`AC2 ${ID.address} ${PUSH}'s held reason holds ask/<ULID> after the ask's question; the same reason with only ask:<ULID> fails naming the ask; deep open on the address lands the real app on that ask's page and card`, async () => {
    const w = await world();
    const { s, claude } = await session(w);
    const since = await lastPos(w.hub);
    const held = await bash(claude, s, PUSH);
    expect(held.denied, `\`${PUSH}\` is held in a thread whose prompts name no push: ${t83.firedShown(held.fired).slice(0, 600)}`).toBe(true);
    const reason = reasonOf(held.fired);
    const ask = await askFor(w.hub, PUSH, since);
    const handle = `ask:${ask.id}`;

    expect(addressFailures(reason, ask)).toEqual([]);
    const planted = addressFailures(idOnly(reason, ask), ask);
    expect(planted, 'the planted reason, with only the ID, fails the same judge').not.toEqual([]);
    expect(planted.join('\n'), 'the planted reason fails naming the ask').toContain(handle);

    // The address as the reason writes it, handed to `deep open` with the real app running on the world's home.
    const [address] = addressesIn(reason).filter((a) => a.endsWith(`ask/${ask.id}`));
    app = await RealApp.launch(w.h.home, await appBinary());
    const opened = await t83.deep(w.h, ['open', address!], {}, 60_000);
    expect(opened.code, `deep open ${address} exits 0 once the app has it open: ${t83.shown(opened)}`).toBe(0);
    expect(await missing(app, [`ask/${ask.id}`, 'question-card']), `after deep open ${address}, the window shows ${handle}'s page and its card`).toEqual([]);
    await claude.end();
  }, 30 * MIN);
});
