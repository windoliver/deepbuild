// AC4 (#1820): with no network a document using an unfetched asset is BLOCKED with one unblock ask, never PASS; no fetch
// starts without an answered ask or a standing rule; a hub that fetches under another pack's standing rule fails, naming the pack.
import { beforeAll, describe, expect, it } from 'vitest';
import { A, B, judgeOtherPack, PACK_A, PACK_A_VERSION, sha256 } from './pack.ts';
import { asks, blocked, doc, fetchA, fetchB, kinds, must, newAsks, readyWorld, show, sleep, stored, until, type PackWorld } from './helpers.ts';

let w: PackWorld;
beforeAll(async () => { w = await readyWorld(); }, 600_000);

describe('#1820.09114f60 with no network, a document that uses an unfetched asset is BLOCKED with one unblock ask, never PASS, and no fetch starts without an answered ask or a standing rule; a planted hub that fetches under another pack\'s standing rule fails, naming the pack', () => {
  it('no fetch starts without an answered ask: left unanswered, no request reaches the server', async () => {
    const before = (await asks(w)).length;
    const from = w.packs.log.length;
    const o = await kinds(w, fetchA(A.hold));
    expect(o.value.status, o.text).toBe('held');
    expect((await newAsks(w, before, 'authority')).length).toBe(1);
    await sleep(2500);
    expect(w.packs.since(from), 'a fetch started without your yes').toEqual([]);
    expect(await stored(w, sha256(A.hold.listed))).toBeUndefined();
  }, 300_000);

  it('a standing rule for one pack lets that pack fetch with no ask, and covers no other pack: the other holds on its own ask, naming it, with no request', async () => {
    const r = await must(w, 'pack.rule', { pack: PACK_A, licenses: ['CC0-1.0'] });
    expect(r.error).toBeUndefined();
    const before = (await asks(w)).length;
    const mark = w.packs.log.length;
    const own = await until(w, fetchA(A.kick));
    expect(own.value.status, `under its own rule: ${own.text}`).toBe('fetched');
    expect((await newAsks(w, before, 'authority')).length, 'the rule is honoured: no ask').toBe(0);
    expect(w.packs.since(mark, A.kick.path).length).toBeGreaterThan(0);

    const askedBefore = (await asks(w)).length;
    const other = w.packs.log.length;
    const o = await kinds(w, fetchB(B.voice));
    await sleep(1500);
    const raised = await newAsks(w, askedBefore, 'authority');
    const failures = judgeOtherPack(PACK_A, 'acme/voices', w.packs.since(other), raised.map((a) => a.text));
    expect(failures, `${o.text}`).toEqual([]);
    expect(o.value.status).toBe('held');
    expect(raised.length, 'one ask').toBe(1);
  }, 600_000);


  it('offline, a fetch of an unfetched asset is BLOCKED with exactly one unblock ask and no authority ask, and nothing is stored; a document that uses it is never PASS', async () => {
    await w.packs.close();
    const before = (await asks(w)).length;
    const first = await kinds(w, fetchA(A.away));
    const second = await kinds(w, fetchA(A.away));
    const raised = await newAsks(w, before);
    expect(blocked(first), first.text).toBe(true);
    expect(blocked(second), second.text).toBe(true);
    expect(raised.filter((a) => a.kind === 'unblock').length, JSON.stringify(raised.map((a) => a.text))).toBe(1);
    expect(raised.filter((a) => a.kind === 'authority').length, 'a fetch ask while offline').toBe(0);
    expect(await stored(w, sha256(A.away.listed))).toBeUndefined();
    const used = await show(w, doc('away', sha256(A.away.listed), `${PACK_A}@${PACK_A_VERSION}`));
    const text = JSON.stringify(used.reply);
    expect(used.reply?.outcome === 'refused' || text.includes('BLOCKED'), `an unfetched asset read as usable: ${text.slice(0, 500)}`).toBe(true);
    expect(text).not.toMatch(/"outcome":"(?:PASS|accepted)"/);
  }, 600_000);
});
