// AC1 (#1820): a pack asset fetched on first use, after its one ask, lands in the store by its sha256, a second use
// fetches nothing; a fetched file whose bytes don't match its listed sha256 is refused and removed, naming the asset.
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { A, judgeNotKept, PACK_A, PACK_A_VERSION, sha256, urlOf } from './pack.ts';
import { asks, blocked, doc, fetchA, kinds, newAsks, readyWorld, show, sleep, stored, until, yes, type PackWorld } from './helpers.ts';

let w: PackWorld;
beforeAll(async () => { w = await readyWorld(); }, 600_000);

describe('#1820.34edde87 a pack asset fetched on first use, after its one ask, lands in the store by its sha256, and a second use fetches nothing; a fetched file whose bytes don\'t match its listed sha256 is refused and removed, naming the asset, and a planted fetch that keeps it fails', () => {
  it('holds on one authority ask with the plan, fetches nothing before the yes, lands by sha256, and a second use fetches nothing', async () => {
    const asksBefore = (await asks(w)).length;
    const from = w.packs.log.length;
    const first = await kinds(w, fetchA(A.pad));
    expect(first.value.status, first.text).toBe('held');
    await sleep(1500);
    expect(w.packs.since(from), 'a byte was requested with no answered ask').toEqual([]);
    // Calling again is the same one ask.
    expect((await kinds(w, fetchA(A.pad))).value.status).toBe('held');
    const raised = await newAsks(w, asksBefore);
    expect(raised.map((a) => a.kind), JSON.stringify(raised.map((a) => a.text))).toEqual(['authority']);
    // The plan: its size, its source and its license.
    const plan = raised[0]!.text;
    expect(plan, 'the ask names the asset size').toMatch(new RegExp(`(^|[^0-9])${A.pad.size}([^0-9]|$)`));
    expect(plan, 'the ask names the source').toContain(new URL(urlOf(w.packs.host, PACK_A, A.pad)).host);
    expect(plan, 'the ask names the license').toMatch(/CC[- ]BY[- ]4\.0/i);
    expect(plan, 'the ask names the pack').toContain(PACK_A);

    expect((await yes(w, raised[0]!)).code).toBe(0);
    const done = await until(w, fetchA(A.pad));
    expect(done.value.status, done.text).toBe('fetched');
    expect(done.value.asset?.sha256, 'the asset is keyed by its listed sha256').toBe(sha256(A.pad.listed));
    const entry = await stored(w, sha256(A.pad.listed));
    expect(entry, 'the store holds the file by its sha256').toBeDefined();
    expect(JSON.stringify(entry)).toMatch(/CC-BY-4\.0/);
    const requested = w.packs.since(from, A.pad.path);
    expect(requested.length, `requests: ${JSON.stringify(requested)}`).toBe(1);

    // A second use: the cache hit. No request, no new ask, the same hash.
    const mark = w.packs.log.length;
    const asksAfter = (await asks(w)).length;
    const second = await kinds(w, fetchA(A.pad));
    expect(second.value.status, second.text).toBe('fetched');
    expect(second.value.asset?.sha256).toBe(sha256(A.pad.listed));
    expect(w.packs.since(mark), 'the second use fetched').toEqual([]);
    expect((await asks(w)).length, 'the second use asked again').toBe(asksAfter);

    // The document that names the pack and the hash uses the stored bytes, with the license they were kept with.
    const used = await show(w, doc('pad', sha256(A.pad.listed), `${PACK_A}@${PACK_A_VERSION}`));
    expect(used.reply?.outcome, JSON.stringify(used.reply).slice(0, 600)).not.toBe('refused');
    expect(JSON.stringify(used.reply?.assets)).toContain('CC-BY-4.0');
  }, 600_000);

  it('refuses a file whose bytes don\'t match its listed sha256, removes it, and names the asset', async () => {
    const asksBefore = (await asks(w)).length;
    const first = await kinds(w, fetchA(A.corrupt));
    let outcome = first;
    if (first.value.status === 'held') {
      const raised = await newAsks(w, asksBefore, 'authority');
      expect(raised.length, 'one ask').toBe(1);
      expect((await yes(w, raised[0]!)).code).toBe(0);
      outcome = await until(w, fetchA(A.corrupt));
    }
    expect(outcome.isError || outcome.value.status === 'refused', outcome.text).toBe(true);
    expect(outcome.text, 'the refusal names the asset').toContain(A.corrupt.path);
    expect(outcome.value.status).not.toBe('fetched');
    // Removed: the served bytes are in no file under the hub's folder, and the store holds neither hash.
    const failures = judgeNotKept(join(w.home), A.corrupt.served, !!(await stored(w, sha256(A.corrupt.served))), A.corrupt.path);
    expect(failures).toEqual([]);
    expect(await stored(w, sha256(A.corrupt.listed)), 'the store holds an asset under the listed hash that its bytes did not match').toBeUndefined();
    // And it never reads as usable.
    const used = await show(w, doc('bad', sha256(A.corrupt.listed), `${PACK_A}@${PACK_A_VERSION}`));
    expect(used.reply?.outcome === 'refused' || JSON.stringify(used.reply).includes('BLOCKED') || used.ran.code !== 0, JSON.stringify(used.reply).slice(0, 600)).toBe(true);
    expect(blocked(outcome) || outcome.value.status === 'refused' || outcome.isError).toBe(true);
  }, 600_000);
});
