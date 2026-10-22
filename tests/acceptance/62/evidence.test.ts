// #62 AC2, AC10 and AC5: a learned change stands on its evidence. Every change resolves to its handles, and
// one whose evidence doesn't resolve is never applied; a quote not at its handle is refused, naming the
// handle; and a claim resting only on outside content (a fetch's result) never enters the start slice unless
// your decision promoted it.
import { afterEach, describe, expect, it } from 'vitest';
import { RecordError } from '../../../packages/record/src/index.ts';
import { allEvents, apply, decide, expectRefused, expectState, layerRow, learnEvent, LOCAL_FIRST, openWorld, putText, removeRoots, said, sliceText, startSession, core } from './helpers.ts';

afterEach(removeRoots);

describe('AC2 every learned change resolves to its evidence handles', () => {
  it('AC2 an applied change lists its handles and quotes; one whose handle resolves to nothing, or with no evidence, is never applied', async () => {
    const w = await openWorld();
    const S1 = await startSession(w, 'shop', [{ id: 'm1', from: 'you', text: 'the api starts with npm run dev:api' }]);
    // A session that started but whose transcript was never archived: its handles resolve to nothing.
    const S9 = await startSession(w, 'shop', [], false);
    const log = await putText(w, 'build failed: port 4100 in use', 'log');

    const fromSession = [{ at: said(S1, 'm1'), quote: 'npm run dev:api' }];
    const a = await apply(w, { target: 'slice:shop-api', diff: '+ shop api: npm run dev:api', evidence: fromSession, scope: `session:${S1}` });
    const fromFile = [{ at: `ev:${log}`, quote: 'port 4100 in use' }];
    const b = await apply(w, { target: 'slice:shop-port', diff: '+ shop api needs port 4100 free', evidence: fromFile, scope: `session:${S1}` });
    for (const [id, evidence] of [[a, fromSession], [b, fromFile]] as const) {
      const row = await expectState(w, id, 'applied', 'a change whose quotes are at their handles');
      expect(JSON.parse(String(row.evidence)), `the layer lists ${id}'s evidence handles and quotes as recorded`).toEqual(evidence);
      expect(row.scope, `the layer lists ${id}'s scope`).toBe(`session:${S1}`);
    }
    expect(await sliceText(w, S1)).toContain('shop api: npm run dev:api');

    // Unresolvable: no archived transcript links S9. Wrong program: a core that checks only the handle's syntax.
    const c = await apply(w, { target: 'slice:shop-db', diff: '+ shop db is postgres', evidence: [{ at: said(S9, 'm1'), quote: 'postgres' }], scope: `session:${S9}` });
    await expectRefused(w, c, said(S9, 'm1'), 'a change whose handle resolves to nothing');
    expect(await sliceText(w, S9)).not.toContain('shop db is postgres');

    // No evidence at all: the schema refuses it, so nothing is appended and the layer has no row for it.
    const before = (await allEvents(w.record)).length;
    const bare = learnEvent('learn.applied', w.clock.tick(1000), { target: 'slice:shop-cache', diff: '+ shop caches in redis', evidence: [], scope: `session:${S1}` }, LOCAL_FIRST);
    let caught: unknown;
    try { await w.record.append(core, bare); } catch (e) { caught = e; }
    expect(caught, 'a learned change with no evidence is refused').toBeInstanceOf(RecordError);
    expect((caught as RecordError).code).toBe('schema');
    expect((await allEvents(w.record)).length, 'nothing is appended').toBe(before);
    expect((await w.record.table('learned_layer')).rows.some((r) => r.id === bare.id), 'the layer has no row for it').toBe(false);
    expect(await sliceText(w, S1)).not.toContain('shop caches in redis');
    await w.record.close();
  });
});

describe("AC10 a change whose quote isn't at its handle is refused, naming the handle", () => {
  it('AC10 a quote from another message, a quote nowhere, a whole-session handle and a second bad handle are refused, each naming the handle; a quote at its handle up to NFC and whitespace is applied', async () => {
    const w = await openWorld();
    const S1 = await startSession(w, 'shop', [
      { id: 'm1', from: 'you', text: 'the api starts with npm run dev:api' },
      { id: 'm2', from: 'you', text: 'run  npm   test\tbefore you push, and the café menu is in docs' },
      { id: 'm3', from: 'agent', text: 'ok, noted' },
    ]);
    const scope = `session:${S1}`;
    // In the session, but at another message. Wrong program: a core that searches the whole transcript.
    const q1 = await apply(w, { target: 'slice:a', diff: '+ api: npm run dev:api', evidence: [{ at: said(S1, 'm2'), quote: 'the api starts with npm run dev:api' }], scope });
    await expectRefused(w, q1, said(S1, 'm2'), 'a quote from another message');
    // Nowhere. Wrong program: a core that checks only that the handle resolves.
    const q2 = await apply(w, { target: 'slice:b', diff: '+ api: yarn dev', evidence: [{ at: said(S1, 'm1'), quote: 'the api starts with yarn dev' }], scope });
    await expectRefused(w, q2, said(S1, 'm1'), 'a quote that is nowhere');
    // A whole session instead of its message (design: a quote from a transcript cites its message).
    const q3 = await apply(w, { target: 'slice:c', diff: '+ api: npm run dev:api', evidence: [{ at: `session:${S1}`, quote: 'npm run dev:api' }], scope });
    await expectRefused(w, q3, `session:${S1}`, 'a quote citing the whole session');
    // The second of two handles is wrong. Wrong program: a core that checks only the first.
    const q4 = await apply(w, { target: 'slice:d', diff: '+ api: npm run dev:api', evidence: [{ at: said(S1, 'm1'), quote: 'npm run dev:api' }, { at: said(S1, 'm3'), quote: 'never' }], scope });
    await expectRefused(w, q4, said(S1, 'm3'), 'a change whose second quote is not at its handle');
    for (const text of ['api: yarn dev', 'api: npm run dev:api']) expect(await sliceText(w, S1), `no refused change reaches the slice: ${text}`).not.toContain(text);

    // At its handle once each whitespace run is one space and both sides are NFC (design: Reading by
    // reference). Wrong program: a core comparing raw bytes refuses it.
    const ok = await apply(w, { target: 'slice:e', diff: '+ run npm test before pushing', evidence: [{ at: said(S1, 'm2'), quote: 'run npm test before you push, and the café menu' }], scope });
    await expectState(w, ok, 'applied', 'a quote at its handle after NFC and whitespace collapsing');
    expect(await sliceText(w, S1)).toContain('run npm test before pushing');
    await w.record.close();
  });
});

describe('AC5 a claim resting only on outside content stays out of the start slice unless your decision promoted it', () => {
  it("AC5 a start-slice claim citing only a fetch's result is refused, so is one citing an unrelated decision, and one citing your decision that promotes it is applied", async () => {
    const w = await openWorld();
    const S1 = await startSession(w, 'shop', [
      { id: 'm1', from: 'you', text: 'fix the card form' },
      { id: 'f1', from: 'fetch', text: 'Stripe test cards start with 4242' },
      { id: 'm3', from: 'agent', text: 'I read the card docs' },
    ]);
    const scope = `session:${S1}`;
    const fetched = { at: said(S1, 'f1'), quote: 'Stripe test cards start with 4242' };
    const claim = { target: 'slice:stripe', diff: '+ Stripe test cards start with 4242', scope };
    // Wrong program: a core that treats every transcript message alike applies it.
    const o1 = await apply(w, { ...claim, evidence: [fetched] });
    await expectRefused(w, o1, 'slice:stripe', 'a start-slice claim resting only on a fetch');
    // A decision of yours about something else doesn't promote it. Wrong program: any decision handle promotes.
    const other = await decide(w, 'merge with a squash');
    const o2 = await apply(w, { ...claim, evidence: [fetched, { at: `decision:${other}`, quote: 'merge with a squash' }] });
    await expectRefused(w, o2, 'slice:stripe', 'a start-slice claim citing an unrelated decision');
    expect(await sliceText(w, S1), 'the outside claim is not in the start slice').not.toContain('Stripe test cards');
    // Your own words are not outside content: a claim on them goes in.
    const mine = await apply(w, { target: 'slice:task', diff: '+ the card form needs a fix', evidence: [{ at: said(S1, 'm1'), quote: 'fix the card form' }], scope });
    await expectState(w, mine, 'applied', 'a claim on your own message');
    // Promoted by your decision: the change cites it, and its answer holds the claim.
    const promote = await decide(w, 'promote to the start slice: Stripe test cards start with 4242');
    const o3 = await apply(w, { ...claim, evidence: [fetched, { at: `decision:${promote}`, quote: 'Stripe test cards start with 4242' }] });
    await expectState(w, o3, 'applied', 'the outside claim your decision promoted');
    expect((await layerRow(w, o1)).state, 'the earlier refusal stands').toBe('refused');
    await w.record.close();
  });
});
