// AC5 #154.87a31a62: "With no network, a score whose library isn't fetched is BLOCKED with one unblock ask, and no fetch
// starts without an answered ask or a standing rule"
//
// asserts: (1) offline (the shelf serving test/organ closed), the hymn's plan is BLOCKED naming test/organ@1.0.0; the
// hub's fetch of each of its takes, made twice, is BLOCKED; the plan stays BLOCKED; the record gains exactly one
// unblock ask, naming test/organ, and no authority ask; nothing is stored. (2) Online, with test/choir and test/brass
// installed and no rule: the anthem's plan is BLOCKED; a fetch of a choir take is held on one authority ask, twice,
// and no request for it reaches the shelf until your yes, after which it is fetched with one request; the other choir
// take is held on its own ask with no request; your standing rule for test/brass (`pack.rule`) fetches each brass take
// with one request and no new ask, and doesn't reach test/choir; once every take is fetched the plan answers its
// stems, each take by hash.
import { describe, expect, it } from 'vitest';
import {
  AC, CC0, CC_BY, TIMEOUT, asks, fetchTake, fetchUntil, film, isBlocked, lastPos, must, mustAddLibrary, openWorld, packDirs, planOf, planReply, plainLibrary,
  proof, ref, sampled, scoreItem, sha256, stored, takePath, takesOf, tempo, useShow, yes, type Ev, type JsonObject, type Library, type World,
} from './helpers.ts';

const showBin = useShow();

function score(item: string, parts: { lib: Library; preset: string; stem: string }[]): JsonObject {
  const instruments = Object.fromEntries(parts.map((p) => [p.stem, sampled(ref(p.lib), p.preset, p.stem)]));
  const events: Record<string, Ev> = {};
  parts.forEach((p, i) => [1, 2, 3, 4].forEach((beat) => { events[`${p.stem}${beat}`] = { at: `${i + 1}:${beat}`, inst: p.stem, pitch: 60, dur: '0.25s', vel: 0.6 }; }));
  return film([scoreItem(item, instruments, events)], { tempo: tempo(90), packs: parts.map((p) => ref(p.lib)), span: '8s' });
}
const requestsFor = (w: World, lib: Library, from: number) => w.shelves['main']!.log.slice(from).filter((q) => takesOf(lib).some((t) => q.path === takePath(lib, t)));
const blockedReply = (status: unknown, text: string): boolean => status === 'BLOCKED' || /\bBLOCKED\b/.test(text);

describe(`${AC[5]} a library not fetched: BLOCKED offline, and no fetch without your answer or rule`, () => {
  it(`${AC[5]} offline, the score whose library isn't fetched is BLOCKED with one unblock ask, and nothing is fetched`, async () => {
    const w = await openWorld();
    const organ = plainLibrary('test/organ', CC0, 2, 'organ');
    await mustAddLibrary(w, organ);
    const doc = score('hymn', [{ lib: organ, preset: 'organ', stem: 'organ' }]);
    await w.shelves['main']!.close();
    const pos = await lastPos(w);
    const first = planReply(showBin(), w.evidence, doc, 'hymn', packDirs(w), 'the hymn, offline');
    const fetches = [];
    for (const round of [1, 2]) for (const t of takesOf(organ)) { const o = await fetchTake(w, organ, t); fetches.push({ round, take: t.path, status: o.value.status, text: o.text.slice(0, 400) }); }
    const second = planReply(showBin(), w.evidence, doc, 'hymn', packDirs(w), 'the hymn, offline, again');
    const raised = await asks(w, pos);
    const kept = await Promise.all(takesOf(organ).map(async (t) => (await stored(w, sha256(t.bytes))) !== undefined));
    proof('ac5-offline.json', { first, fetches, second, asks: raised.map((a) => ({ handle: a.handle, kind: a.kind, data: a.data })) });
    expect(isBlocked(first), `the plan is BLOCKED while test/organ's takes aren't in the evidence store: ${JSON.stringify(first).slice(0, 600)}`).toBe(true);
    expect(JSON.stringify(first).includes(ref(organ)), `the BLOCKED plan names the library ${ref(organ)}: ${JSON.stringify(first).slice(0, 600)}`).toBe(true);
    expect(fetches.every((f) => blockedReply(f.status, f.text)), `each fetch of a take, offline, is BLOCKED: ${JSON.stringify(fetches).slice(0, 900)}`).toBe(true);
    expect(isBlocked(second), 'the plan is still BLOCKED').toBe(true);
    const unblock = raised.filter((a) => a.kind === 'unblock');
    expect(unblock.length, `one unblock ask for the hymn's library, however many fetches: ${raised.map((a) => `${a.kind} ${a.text.slice(0, 160)}`).join(' | ')}`).toBe(1);
    expect(unblock[0]!.text.includes(organ.id), `the unblock ask names ${organ.id}: ${unblock[0]!.text.slice(0, 400)}`).toBe(true);
    expect(raised.filter((a) => a.kind === 'authority').length, 'offline, no authority ask is raised').toBe(0);
    expect(kept, 'no take of test/organ is stored').toEqual([false, false]);
  }, TIMEOUT);

  it(`${AC[5]} no take is fetched before your answer to its ask or your standing rule, and the plan answers once every take is in`, async () => {
    const w = await openWorld();
    const choir = plainLibrary('test/choir', CC0, 2, 'choir');
    const brass = plainLibrary('test/brass', CC_BY, 2, 'brass');
    await mustAddLibrary(w, choir);
    await mustAddLibrary(w, brass);
    const doc = score('anthem', [{ lib: choir, preset: 'choir', stem: 'voices' }, { lib: brass, preset: 'brass', stem: 'horns' }]);
    const blockedPlan = planReply(showBin(), w.evidence, doc, 'anthem', packDirs(w), 'the anthem, nothing fetched');
    expect(isBlocked(blockedPlan), `the plan is BLOCKED before any take is fetched: ${JSON.stringify(blockedPlan).slice(0, 600)}`).toBe(true);
    expect([ref(choir), ref(brass)].some((r) => JSON.stringify(blockedPlan).includes(r)), 'the BLOCKED plan names a library it waits on').toBe(true);

    const c1 = takesOf(choir)[0]!;
    const c2 = takesOf(choir)[1]!;
    const pos = await lastPos(w);
    const from = w.shelves['main']!.log.length;
    const held = [await fetchTake(w, choir, c1), await fetchTake(w, choir, c1)];
    const raised = (await asks(w, pos)).filter((a) => a.kind === 'authority');
    expect(held.map((o) => o.value.status), `a fetch of ${c1.path} with no answer and no rule is held: ${held[0]!.text.slice(0, 400)}`).toEqual(['held', 'held']);
    expect(raised.length, 'one authority ask for it, asked once').toBe(1);
    expect(raised[0]!.text.includes(choir.id), `the ask names ${choir.id}: ${raised[0]!.text.slice(0, 400)}`).toBe(true);
    expect(requestsFor(w, choir, from), `no request for ${choir.id}'s takes before your answer`).toEqual([]);
    expect(isBlocked(planReply(showBin(), w.evidence, doc, 'anthem', packDirs(w), 'the anthem, held')), 'the plan is still BLOCKED').toBe(true);

    const answered = await yes(w, raised[0]!);
    expect(answered.code, 'your yes is taken').toBe(0);
    const got = await fetchUntil(w, choir, c1);
    expect(got.value.status, `after your yes ${c1.path} is fetched: ${got.text.slice(0, 400)}`).toBe('fetched');
    expect(requestsFor(w, choir, from).map((q) => q.path), `exactly one request, for ${c1.path}`).toEqual([takePath(choir, c1)]);

    const pos2 = await lastPos(w);
    const from2 = w.shelves['main']!.log.length;
    const other = await fetchTake(w, choir, c2);
    expect(other.value.status, `${c2.path} waits on its own answer: ${other.text.slice(0, 400)}`).toBe('held');
    await must(w, 'pack.rule', { pack: brass.id, licenses: [CC_BY.id] });
    for (const t of takesOf(brass)) {
      const o = await fetchUntil(w, brass, t);
      expect(o.value.status, `under your standing rule for ${brass.id}, ${t.path} is fetched: ${o.text.slice(0, 400)}`).toBe('fetched');
    }
    const ruleAsks = (await asks(w, pos2)).filter((a) => a.kind === 'authority' && a.text.includes(brass.id));
    expect(ruleAsks.length, `the rule for ${brass.id} fetches with no ask`).toBe(0);
    expect(requestsFor(w, brass, from2).length, `one request per brass take`).toBe(takesOf(brass).length);
    const still = await fetchTake(w, choir, c2);
    expect(still.value.status, `the rule for ${brass.id} doesn't reach ${choir.id}: ${c2.path} is still held`).toBe('held');
    expect(requestsFor(w, choir, from2), `no request for ${c2.path} before your answer`).toEqual([]);

    const ask2 = (await asks(w, pos2)).find((a) => a.kind === 'authority' && a.text.includes(choir.id));
    expect(ask2, `${c2.path}'s ask is in the record`).toBeDefined();
    expect((await yes(w, ask2!)).code, 'your yes is taken').toBe(0);
    expect((await fetchUntil(w, choir, c2)).value.status, `after your yes ${c2.path} is fetched`).toBe('fetched');
    const plan = planOf(planReply(showBin(), w.evidence, doc, 'anthem', packDirs(w), 'the anthem, every take fetched'), 'the anthem, every take fetched');
    const wanted = (lib: Library) => takesOf(lib).map((t) => sha256(t.bytes)).sort();
    proof('ac5-fetch-plan.json', { asks: [raised[0]!.data, ask2!.data], plan: { stems: Object.fromEntries(Object.entries(plan.stems).map(([n, s]) => [n, s.inputs])) } });
    expect(plan.stems['voices']!.inputs.map((i) => i.sha256).sort(), 'the choir stem takes test/choir\'s takes by hash').toEqual(wanted(choir));
    expect(plan.stems['horns']!.inputs.map((i) => i.sha256).sort(), 'the brass stem takes test/brass\'s takes by hash').toEqual(wanted(brass));
  }, TIMEOUT);
});
