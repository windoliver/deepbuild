// Replacing and removing providers (README, Criteria): AC9, a replacement rewires its users by type; AC10, removing the
// provider of a required use asks once, and an optional use with no provider reads missing; AC13, a failed replacement
// leaves the version in use wired, and a call the old version finishes after its replacement is active is refused at
// its edge.
import { describe, expect, it } from 'vitest';
import type { ExtensionHost } from '../../../packages/extension-host/src/index.ts';
import {
  admit, admitted, answer, asksNaming, edgesOf, ID, loadedVersion, openHost, openWorld, piece, provides, readThrough, reopenCounts, runOnce, settledWithin,
  shape, sleep, uses, waitUntil, type Json, type World,
} from './helpers.ts';

const P1 = 'ext.stocks.prices@1';
const PRICE = shape({ symbol: { type: 'string' }, cents: { type: 'integer' } });
const BRIEF = 'acme/brief';
async function scene(plant?: string): Promise<{ w: World; h: ExtensionHost }> {
  const w = await openWorld();
  return { w, h: await openHost(w, plant ? { plant } : {}) };
}
/** A source `acme/<p>` of prices@1, its reading `value`. */
const source = (id: string, value: Json, o: { version?: string; replaces?: string[]; delayMs?: number; failStart?: boolean } = {}) => piece({
  id, ...(o.version ? { version: o.version } : {}),
  spec: { outputs: [{ interface: P1, kind: 'reading', schema: PRICE, value, ...(o.delayMs ? { delayMs: o.delayMs } : {}) }], ...(o.failStart ? { failStart: true } : {}) },
  manifest: { provides: [provides(P1, [PRICE])], ...(o.replaces ? { replaces: o.replaces } : {}) },
});

// ---- AC9
const STOCKS_PRICE = { symbol: 'ACME', cents: 11111 };
const QUOTES_PRICE = { symbol: 'ACME', cents: 22222 };
/** The brief, using prices@1 and preferring the stocks source; its weekly run reads it. */
const weeklyBrief = () => piece({ id: BRIEF, spec: { uses: [P1], read: true, schedule: { reads: [P1] } }, manifest: { uses: [uses(P1, 0, PRICE, { from: 'acme/stocks' })] } });

/** The second source, declaring it replaces the stocks source, installs: the brief's next run reads it, and its claims reopen once. Throws, naming the use, when the brief reads nothing. */
async function keepsWorking(plant?: string): Promise<void> {
  const { w, h } = await scene(plant);
  await admitted(h, await source('acme/stocks', STOCKS_PRICE), 'the stocks source');
  await admitted(h, await weeklyBrief(), 'the weekly brief');
  expect((await runOnce(h, BRIEF))[P1]?.value, 'the brief\'s run reads the stocks source').toEqual(STOCKS_PRICE);

  // It keeps the stocks plug-in's interface name, which its `replaces` lets it (What a minor may change).
  await admitted(h, await source('acme/quotes', QUOTES_PRICE, { replaces: ['acme/stocks', P1] }), 'the quotes source, which replaces the stocks source');
  expect((await h.loaded()).map((l) => l.id), 'the stocks source is removed').not.toContain('acme/stocks');
  expect((await h.installed()).map((p) => p.id), 'and no longer installed').not.toContain('acme/stocks');
  const read = (await runOnce(h, BRIEF))[P1];
  if (!read || !('value' in read)) throw Error(`${BRIEF} uses ${P1} read nothing after the replacement: ${JSON.stringify(read)}`);
  expect(read.value, 'the brief\'s next run reads the new source\'s reading').toEqual(QUOTES_PRICE);
  expect((await edgesOf(h)).filter((e) => e.user === BRIEF), 'its use is wired to the new source').toEqual([{ user: BRIEF, uses: P1, interface: P1, provider: 'acme/quotes' }]);
  expect(await reopenCounts(w, 'acme/quotes', '1.0.0'), 'the brief\'s claims reopen once').toEqual({ [BRIEF]: 1 });
}

describe(`${ID.ac9} a weekly brief that uses prices@1 from a stocks source keeps working when a second source that provides prices@1 and replaces the first is installed`, () => {
  it('AC9 the brief\'s next run reads the new source\'s readings, and its claims reopen once', async () => {
    await keepsWorking();
  }, 180_000);

  it('AC9 (wrong program) a hub that keeps the brief wired to the removed piece by name leaves it reading nothing and fails, naming the use', async () => {
    await expect(keepsWorking('wires-by-name')).rejects.toThrow(/acme\/brief uses ext\.stocks\.prices@1 read nothing after the replacement/);
  }, 180_000);
});

// ---- AC10
const CI = 'ext.ci.status@1';
const CI_SHAPE = shape({ checks: { type: 'array', items: shape({ name: { type: 'string' }, state: { type: 'string' } }) } });
const CHECKS = { checks: [{ name: 'build', state: 'passed' }] };
const USE = `${BRIEF} uses ${CI}`;
async function ciScene(optional: boolean, plant?: string): Promise<{ w: World; h: ExtensionHost }> {
  const s = await scene(plant);
  await admitted(s.h, await piece({ id: 'acme/ci', spec: { outputs: [{ interface: CI, kind: 'reading', schema: CI_SHAPE, value: CHECKS }] }, manifest: { provides: [provides(CI, [CI_SHAPE])] } }), 'the CI plug-in');
  await admitted(s.h, await piece({ id: BRIEF, spec: { uses: [CI], read: true, schedule: { reads: [CI] } }, manifest: { uses: [uses(CI, 0, CI_SHAPE, optional ? { optional: true } : {})] } }), `the brief, its use of ${CI} ${optional ? 'optional' : 'required'}`);
  expect((await runOnce(s.h, BRIEF))[CI]?.value, 'the brief\'s run reads the CI status').toEqual(CHECKS);
  return s;
}

/** Removing the CI plug-in raises one ask naming the brief, and nothing is detached before your yes. Throws, naming the use, when it detaches with no ask. */
async function asksBeforeDetaching(plant?: string): Promise<void> {
  const { w, h } = await ciScene(false, plant);
  const removing = h.disable('acme/ci');
  removing.catch(() => undefined);
  const first = await waitUntil(async () => {
    const asked = await asksNaming(w, BRIEF);
    if (asked.length) return { asked, state: 'asked' };
    const state = await settledWithin(removing, 1);
    return state === 'waiting' ? undefined : { asked, state };
  }, 30_000, `an ask naming ${BRIEF}, or the removal ending`);
  if (!first.asked.length) throw Error(`${USE} was detached with no ask: the removal ${first.state} and asked nothing`);
  await sleep(1_000);
  const asked = await asksNaming(w, BRIEF);
  expect(asked, 'one ask, naming the brief').toHaveLength(1);
  expect(asked[0]!.card, 'it names the interface the brief would lose').toContain(CI);
  expect(await settledWithin(removing, 100), 'the removal waits for your answer').toBe('waiting');
  expect((await edgesOf(h)).filter((e) => e.user === BRIEF), 'nothing is detached before your answer').toEqual([{ user: BRIEF, uses: CI, interface: CI, provider: 'acme/ci' }]);
  expect((await runOnce(h, BRIEF))[CI]?.value, 'the brief still reads the CI status').toEqual(CHECKS);
  await answer(w, asked[0]!.ask, 'allow');
  expect(await settledWithin(removing, 30_000), 'your yes lets the removal finish').toBe('done');
  expect((await h.loaded()).map((l) => l.id), 'the CI plug-in is removed').not.toContain('acme/ci');
  expect((await edgesOf(h)).filter((e) => e.user === BRIEF), 'and the brief\'s use detached').toEqual([]);
  expect((await runOnce(h, BRIEF))[CI], 'the brief then reads it as missing').toEqual({ missing: true });
}

/** With the use optional, the CI plug-in is removed and the brief's next run reads missing. Throws, naming the use, when it reads anything else. */
async function readsMissing(plant?: string): Promise<void> {
  const { w, h } = await ciScene(true, plant);
  expect(await settledWithin(h.disable('acme/ci'), 30_000), 'removing the provider of an optional use goes through').toBe('done');
  expect(await asksNaming(w, BRIEF), 'with no ask').toEqual([]);
  const read = (await runOnce(h, BRIEF))[CI];
  if (!read || Object.hasOwn(read, 'value') || read.missing !== true) throw Error(`${USE}, optional, read ${JSON.stringify(read)} with no provider, not missing`);
  expect(read, 'missing, never an empty list or zero').toEqual({ missing: true });
}

describe(`${ID.ac10} removing the CI plug-in while the brief's use of ci.status@1 is required raises one ask naming the brief, nothing detached before your answer; optional, the brief reads it as missing`, () => {
  it('AC10 required: one ask naming the brief; nothing is detached before your answer; your yes removes it', async () => {
    await asksBeforeDetaching();
  }, 180_000);

  it('AC10 required: your no keeps the CI plug-in and the brief\'s edge', async () => {
    const { w, h } = await ciScene(false);
    const removing = h.disable('acme/ci');
    removing.catch(() => undefined);
    const asked = await waitUntil(async () => { const a = await asksNaming(w, BRIEF); return a.length ? a : undefined; }, 30_000, `an ask naming ${BRIEF}`);
    await answer(w, asked[0]!.ask, 'deny');
    expect(await settledWithin(removing, 30_000), 'your no refuses the removal').toMatch(/^refused/);
    expect((await h.loaded()).map((l) => l.id), 'the CI plug-in stays').toContain('acme/ci');
    expect((await runOnce(h, BRIEF))[CI]?.value, 'and the brief reads it').toEqual(CHECKS);
  }, 180_000);

  it('AC10 optional: the brief\'s next run reads the CI value as missing, never as an empty list or zero', async () => {
    await readsMissing();
  }, 180_000);

  it('AC10 (wrong program) a hub that detaches silently fails, naming the use', async () => {
    await expect(asksBeforeDetaching('detaches-silently')).rejects.toThrow(/acme\/brief uses ext\.ci\.status@1 was detached with no ask/);
  }, 180_000);

  it('AC10 (wrong program) a hub that reads the optional use as empty fails, naming the use', async () => {
    await expect(readsMissing('optional-reads-empty')).rejects.toThrow(/acme\/brief uses ext\.ci\.status@1, optional, read .* with no provider, not missing/);
  }, 180_000);
});

// ---- AC13
const V1 = { symbol: 'ACME', cents: 11111 };
const V2 = { symbol: 'ACME', cents: 22222 };
const reader = (id: string) => piece({ id, spec: { uses: [P1], read: true }, manifest: { uses: [uses(P1, 0, PRICE)] } });
/** How long the old version takes to answer the read under way: past its replacement's start, inside a call's 10 s. */
const SLOW_MS = 6_000;

describe(`${ID.ac13} replacing a provider whose new version fails to start leaves the version in use wired to every user, and a call the old version began before its removal that finishes after the new one is active is refused at its edge`, () => {
  it('AC13 a new version that fails to start leaves 1.0.0 in use and wired to both users, each still reading it', async () => {
    const { h } = await scene();
    await admitted(h, await source('acme/stocks', V1), 'stocks 1.0.0');
    await admitted(h, await reader(BRIEF), 'the brief');
    await admitted(h, await reader('acme/watch'), 'the watchlist');
    const got = await admit(h, await source('acme/stocks', V2, { version: '2.0.0', failStart: true }));
    expect(got.ok, 'the version that fails to start isn\'t admitted').toBe(false);
    expect(await loadedVersion(h, 'acme/stocks'), 'the version in use stays').toBe('1.0.0');
    expect((await edgesOf(h)).filter((e) => e.interface === P1), 'wired to every user').toEqual([
      { user: BRIEF, uses: P1, interface: P1, provider: 'acme/stocks' },
      { user: 'acme/watch', uses: P1, interface: P1, provider: 'acme/stocks' },
    ]);
    for (const user of [BRIEF, 'acme/watch']) expect((await readThrough(h, user, P1))?.value, `${user} still reads 1.0.0`).toEqual(V1);
  }, 180_000);

  it('AC13 a read the old version began before its removal and finished after the new one was active is refused at its edge; the next read is the new version\'s', async () => {
    const { h } = await scene();
    await admitted(h, await source('acme/stocks', V1, { delayMs: SLOW_MS }), 'stocks 1.0.0, which answers a read after 6 s');
    await admitted(h, await reader(BRIEF), 'the brief');
    let settledAt = 0;
    const pending = readThrough(h, BRIEF, P1).then((r) => { settledAt = Date.now(); return r; });
    await sleep(300);
    await admitted(h, await source('acme/stocks', V2, { version: '2.0.0' }), 'stocks 2.0.0');
    const activeAt = Date.now();
    expect(await loadedVersion(h, 'acme/stocks'), 'the new version is active').toBe('2.0.0');
    const got = await pending;
    // A hub that held the replacement until the old read finished delivers 1.0.0's answer before 2.0.0 is active: the
    // case the criterion names never arises, and this fails here, saying so.
    const when = settledAt < activeAt ? `${activeAt - settledAt} ms before 2.0.0 was active` : `${settledAt - activeAt} ms after 2.0.0 was active`;
    expect(got?.value, `the old version's answer isn't delivered through the edge (the read ended ${when}): ${JSON.stringify(got)}`).toBeUndefined();
    expect(String(got?.error), 'the read is refused at its edge, naming it').toContain(`${BRIEF} uses ${P1}`);
    expect((await readThrough(h, BRIEF, P1))?.value, 'the next read is 2.0.0\'s').toEqual(V2);
  }, 180_000);
});
