// The doors that reach the running app: `deep open` (AC1's fifth door, AC7) and the record an open must leave alone
// (AC3's record half). One world, #83's: a real hub on a temp home with `deep setup` run, a Claude Code stand-in whose
// session made a claim and got a PASS verdict (planted through `test.verdict`, as #83's goldens are), and a second session
// that asked through deep_ask and left the ask open. The real `deep-app` runs on that home and is read from outside its
// process by #1459's probe, as an assistive client reads it: a page's address is its node's accessibilityIdentifier
// (README, Pinned 2). `deep open` is the checkout's built CLI with HOME the world's (README, Pinned 4).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as t83 from '../83/helpers.ts';
import { cleanup as cleanup16 } from '../16/helpers.ts';
import { RealApp } from '../1459/helpers.ts';
import { appBinary, claimAt, hookBinary, ID, MIN, receiptFailures, receiptOf, sessionAt } from './helpers.ts';

afterAll(async () => { await t83.cleanup(); await cleanup16(); }, 60_000);

interface World { h: t83.Home; hub: t83.Hub; session: string; claim: string; line: string; ask: string; app: RealApp }
let world: World;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Repeats `judge` until it finds nothing wrong or `ms` pass: the app draws a moment after it opens something. */
async function settled(judge: () => Promise<string[]>, ms = 30_000): Promise<string[]> {
  const deadline = Date.now() + ms;
  for (;;) {
    const failures = await judge();
    if (!failures.length || Date.now() > deadline) return failures;
    await sleep(500);
  }
}
const identifiers = async (app: RealApp): Promise<string[]> => (await app.nodes()).map((n) => n.identifier).filter((i): i is string => !!i);
/** `deep open <address>` against the world's running app: what's wrong with its run. */
async function open(address: string): Promise<string[]> {
  const ran = await t83.deep(world.h, ['open', address], {}, 60_000);
  return ran.code === 0 ? [] : [`deep open ${address} ${t83.shown(ran)}`];
}
/** What's wrong with the window once `deep open <address>` ran: each of `ids` must be some node's identifier. */
async function shows(ids: string[], what: string): Promise<string[]> {
  return settled(async () => {
    const have = await identifiers(world.app);
    return ids.filter((id) => !have.includes(id)).map((id) => `${what}: no node of the real window has the accessibilityIdentifier ${id}; it has ${JSON.stringify(have.filter((i) => /\//.test(i) || i === 'question-card')).slice(0, 300)}`);
  });
}

beforeAll(async () => {
  await hookBinary();
  const h = t83.makeHome();
  const hub = await t83.hubWithSetup(h);
  const s = t83.newSession(h);
  const claude = await t83.begin(h, s);
  await t83.edits(claude, s);
  const c = await t83.claim(claude, s);
  await t83.plant(hub, { session: s.id, claim: c.claim, outcome: 'PASS', requirements: [t83.req(1, 'PASS'), t83.req(2, 'PASS', 'typecheck'), t83.req(3, 'PASS', 'journey:checkout'), t83.req(4, 'PASS', 'journey:receipt')], ran: [{ check: 'unit', outcome: 'passed' }, { check: 'typecheck', outcome: 'passed' }, { check: 'journey:checkout', outcome: 'passed' }, { check: 'journey:receipt', outcome: 'passed' }] });
  const fired = await t83.stop(claude, s);
  const line = t83.lineOf(fired);
  if (!line) throw Error(`BLOCKED: the PASS stop carries no verdict line (#83): ${t83.firedShown(fired)}`);
  // A second session's ask, left open (#83's status.test.ts does the same).
  const s2 = t83.newSession(h);
  const asker = await t83.begin(h, s2, 'Pick a header colour.');
  const question = `Which header colour for ${Date.now()}?`;
  void asker.deepTool(s2, 'deep_ask', { kind: 'choice', question, options: [{ id: 'blue', label: 'Blue' }, { id: 'green', label: 'Green' }], recommended: 'blue', steps: null, where: null, why: null, check: null }, 600_000).catch(() => undefined);
  const asked = await t83.waitFor(async () => (await t83.allEvents(hub)).find((e) => e.kind === 'ask.created' && e.session === s2.id && e.data?.question === question), 60_000, `the deep_ask "${question}" filed`);
  const app = await RealApp.launch(h.home, await appBinary());
  world = { h, hub, session: s.id, claim: c.claim, line, ask: `ask:${asked.id}`, app };
  // The app has read the record once the session's row is in its tree.
  const ready = await settled(async () => ((await identifiers(app)).includes(`session:${s.id}`) ? [] : ['no row']), 120_000);
  if (ready.length) throw Error(`BLOCKED: the real app never showed session ${s.id}'s row: ${app.stderr().slice(-600)}`);
}, 30 * MIN);

describe(`AC1 ${ID.doors} On a fixture, a row click, ⌘K, a notification click, \`deep open\` and a \`deepbuild://\` link for one session each land on one page with the same address. A planted route that opens a page without \`open\` fails, naming the caller`, () => {
  it(`AC1 ${ID.doors} deep open session/<id> lands the running app on that session's page, the address a row click gives`, async () => {
    const address = sessionAt(world.session);
    const ran = await open(address);
    expect(ran).toEqual([]);
    expect(await shows([address], `after deep open ${address}`)).toEqual([]);
  }, 10 * MIN);
});

describe(`AC7 ${ID.receipt} The receipt part of a PASS line, passed to \`deep open\`, lands on that claim's page. A planted line that ends in a bare word fails, naming it`, () => {
  it(`AC7 ${ID.receipt} the PASS line's receipt part is session/<session's first 8>/<claim ID>, within 80 columns, and deep open with it lands on the claim's page, session/<session ID>/<claim ID>, the claim's node on it`, async () => {
    const { line, session, claim } = world;
    expect([...line].length, `the line fits 80 columns (#83 AC11): ${JSON.stringify(line)}`).toBeLessThanOrEqual(80);
    expect(receiptFailures(line, session, claim)).toEqual([]);
    const receipt = receiptOf(session, claim);
    expect(await open(receipt)).toEqual([]);
    expect(await shows([claimAt(session, claim), claim], `after deep open ${receipt}, the receipt of ${claim}`)).toEqual([]);
  }, 10 * MIN);

  it(`AC7 ${ID.receipt} (wrong program) the planted line "PASS 4/4 · next: you · receipt", ending in a bare word, fails, naming the word`, () => {
    const failures = receiptFailures('PASS 4/4 · next: you · receipt', world.session, world.claim);
    expect(failures, 'the planted line fails the receipt check').not.toEqual([]);
    expect(failures.join('\n'), 'the failure names the bare word').toContain('bare word "receipt"');
  });
});

// AC3's record half, both its tests, is in redraft-ac3/ac3.test.ts, swapped in with the owner's approval: no app call
// writes an event without answering the ask or the OS confirming you, so this file's planted open could not be built,
// and the redraft's judge counts every event an open's window gains (its README, The dispute).
