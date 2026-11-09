// AC5: "Offline, a search answers from cached thumbnails with a `stale` flag and the cache's age, and a fetch is BLOCKED
// with one unblock ask, as the pack fetch is."
//
// asserts: an online search's library rows are not stale and each thumbnail is in the store by its hash; with the
// library's server closed (its host unreachable, as with no network), the same search returns the same rows in the
// same order with the same thumbnail hashes, each `stale: true` with `age_ms` no less than the time since the online
// answer came and no more than the time since it was asked; two fetches of oak-chair are each BLOCKED and raise
// exactly one ask, an unblock ask, with nothing stored.
import { describe, expect, it } from 'vitest';
import { asks, blocked, fetchArgs, kinds, libraryRows, onWorld, proof, search, sleep, stored } from './helpers.ts';
import { fileHash } from './library.ts';

describe('#1731.19849fe1 Offline, a search answers from cached thumbnails with a `stale` flag and the cache\'s age, and a fetch is BLOCKED with one unblock ask, as the pack fetch is.', () => {
  it('offline, the search answers from its cache, stale with its age, and a fetch is BLOCKED with one unblock ask', async () => {
    const w = await onWorld();
    const asked = Date.now();
    const online = libraryRows((await search(w)).rows);
    const answered = Date.now();
    expect(online.length, 'online, the search has the library\'s rows').toBeGreaterThan(0);
    for (const r of online) {
      expect(r.stale, `online row ${String(r.id)} isn't stale`).not.toBe(true);
      expect(await stored(w, String(r.thumbnail)), `row ${String(r.id)}'s thumbnail ${String(r.thumbnail)} is in the store by its hash`).toBeDefined();
    }

    await sleep(1500);
    await w.library.close();
    const offlineAsked = Date.now();
    const offline = libraryRows((await search(w)).rows);
    const offlineAnswered = Date.now();
    proof('ac5-offline-search.json', { online, offline });
    expect(offline.map((r) => [r.id, r.thumbnail]), 'offline, the same rows with the same thumbnails, from the cache').toEqual(online.map((r) => [r.id, r.thumbnail]));
    for (const r of offline) {
      expect(r.stale, `offline row ${String(r.id)} is stale`).toBe(true);
      expect(typeof r.age_ms, `offline row ${String(r.id)} gives the cache's age`).toBe('number');
      expect(r.age_ms, `row ${String(r.id)}'s age is at least the time since the cached answer came`).toBeGreaterThanOrEqual(offlineAsked - answered);
      expect(r.age_ms, `row ${String(r.id)}'s age is at most the time since it was asked`).toBeLessThanOrEqual(offlineAnswered - asked);
    }

    const before = (await asks(w)).length;
    const first = await kinds(w, fetchArgs('oak-chair'));
    const second = await kinds(w, fetchArgs('oak-chair'));
    const raised = (await asks(w)).slice(before);
    proof('ac5-offline-fetch.json', { first: first.value, second: second.value, raised });
    expect(blocked(first) && blocked(second), `offline, the fetch is BLOCKED: ${first.text.slice(0, 800)}`).toBe(true);
    expect(raised.map((a) => a.kind), 'two offline fetches raised one ask, an unblock ask').toEqual(['unblock']);
    expect(await stored(w, fileHash('oak-chair')), 'nothing was stored offline').toBeUndefined();
  }, 900_000);
});
