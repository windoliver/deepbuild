// AC5 #154.87a31a62: "With no network, a score whose library isn't fetched is BLOCKED with one unblock ask, and no
// fetch starts without an answered ask or a standing rule"
//
// One hub with deepbuild/score and two installed libraries whose takes it hasn't fetched. Online, a score on the first
// library plans BLOCKED, naming the library, and planning makes no request; the hub's fetch of its take (#1820's
// `deep_kinds` fetch, the path the plan's BLOCKED points to) holds on one authority ask and makes no request until you
// answer it; after your yes the take is fetched and the score plans. Then the take server goes away: a score on the
// second library plans BLOCKED, naming it; its fetch, made twice, is BLOCKED with exactly one unblock ask in the record
// and no authority ask; nothing is stored, and the plan stays BLOCKED. The merge base is the wrong program (no score
// kind and no score_plan).
import { describe, expect, it } from 'vitest';
import {
  AC, asks, fetchTake, holds, installLibrary, installScore, isBlocked, library, once, openWorld, planOf, planReply, ref, sampled, scoreDoc, sha256, show,
  sleep, TIMEOUT, tone, useShow, yes, type Library, type Outcome, type World,
} from './helpers.ts';

const bin = useShow();
const NEAR = library('testlib/near', 'tone', 69, [tone(440, 0.3)]);
const FAR = library('testlib/far', 'tone', 69, [tone(440, 0.3)]);
const doc = (lib: Library) => scoreDoc({
  id: 'unfetched', instruments: { lead: sampled(lib, 'lead') }, span: '4s', packs: [lib],
  events: { e1: { at: '0.5s', inst: 'lead', pitch: 69, dur: '0.25s', vel: 0.8, attack: 0, release: 0.01 } },
});
const world = once(async () => {
  const w = await openWorld();
  await installScore(w);
  const near = await installLibrary(w, NEAR);
  const far = await installLibrary(w, FAR);
  return { w, near: { lib: NEAR, dir: near }, far: { lib: FAR, dir: far } };
});
const named = (reply: unknown, lib: Library) => JSON.stringify(reply).includes(lib.id);
async function untilNotHeld(w: World, lib: Library, path: string, ms = 120_000): Promise<Outcome> {
  const deadline = Date.now() + ms;
  for (;;) {
    const o = await fetchTake(w, lib, path);
    if ((o.value.status !== 'held' && o.value.status !== 'pending') || Date.now() > deadline) return o;
    await sleep(500);
  }
}

describe(`${AC[5]} offline, a score whose library isn't fetched is BLOCKED with one unblock ask, and no fetch starts without an answered ask or a standing rule`, () => {
  it(`${AC[5]} online: the score plans BLOCKED naming its unfetched library with no request; the take's fetch holds on one authority ask with no request until your yes, then the score plans`, async () => {
    const { w, near } = await world();
    const from = w.takes.log.length;
    const blockedPlan = planReply(bin(), w.evidence, doc(NEAR), [near], 'a score on an unfetched library');
    expect(isBlocked(blockedPlan) && named(blockedPlan, NEAR), `the plan is BLOCKED, naming ${ref(NEAR)}: ${show(blockedPlan)}`).toBe(true);
    expect(w.takes.since(from), 'planning the score fetched nothing').toEqual([]);

    const before = (await asks(w)).length;
    const take = NEAR.takes[0]!;
    const held = await fetchTake(w, NEAR, take.path);
    expect(held.value.status, `the take's fetch holds on your answer: ${held.text.slice(0, 600)}`).toBe('held');
    const raised = (await asks(w)).slice(before);
    const authority = raised.filter((a) => a.kind === 'authority');
    expect(authority.length, `one authority ask: ${show(raised.map((a) => a.text))}`).toBe(1);
    await sleep(2500);
    expect(w.takes.since(from), 'no fetch starts before the ask is answered').toEqual([]);
    expect(holds(w, sha256(take.bytes)), 'nothing is stored before your yes').toBe(false);

    const answered = await yes(w, authority[0]!);
    expect(answered.code, `your yes is taken: ${answered.stderr.slice(-400)}`).toBe(0);
    const fetched = await untilNotHeld(w, NEAR, take.path);
    expect(fetched.value.status, `after your yes the take is fetched: ${fetched.text.slice(0, 600)}`).toBe('fetched');
    expect(w.takes.since(from).some((r) => r.path.endsWith(take.path)), 'the fetch reached the take server').toBe(true);
    expect(holds(w, sha256(take.bytes)), 'the take is in the evidence store by its sha256').toBe(true);
    planOf(planReply(bin(), w.evidence, doc(NEAR), [near], 'the score once its library is fetched'), 'the score once its library is fetched');
  }, TIMEOUT);

  it(`${AC[5]} with no network: a score on an unfetched library is BLOCKED naming it; its fetch is BLOCKED twice with exactly one unblock ask and no authority ask, nothing stored, and the score stays BLOCKED`, async () => {
    const { w, far } = await world();
    await w.takes.close();
    const before = (await asks(w)).length;
    const first = planReply(bin(), w.evidence, doc(FAR), [far], 'offline: a score on an unfetched library');
    expect(isBlocked(first) && named(first, FAR), `the plan is BLOCKED, naming ${ref(FAR)}: ${show(first)}`).toBe(true);
    const take = FAR.takes[0]!;
    const a = await fetchTake(w, FAR, take.path);
    const b = await fetchTake(w, FAR, take.path);
    for (const o of [a, b]) expect(o.value.status === 'BLOCKED' || /\bBLOCKED\b/.test(o.text), `offline, the fetch is BLOCKED: ${o.text.slice(0, 600)}`).toBe(true);
    const raised = (await asks(w)).slice(before);
    expect(raised.filter((q) => q.kind === 'unblock').length, `exactly one unblock ask: ${show(raised.map((q) => q.text))}`).toBe(1);
    expect(raised.filter((q) => q.kind === 'authority').length, 'no authority ask while offline').toBe(0);
    expect(holds(w, sha256(take.bytes)), 'nothing is stored').toBe(false);
    const again = planReply(bin(), w.evidence, doc(FAR), [far], 'offline: the score again');
    expect(isBlocked(again) && named(again, FAR), `the score stays BLOCKED, never planned: ${show(again)}`).toBe(true);
    expect((await asks(w)).slice(before).filter((q) => q.kind === 'unblock').length, 'still one unblock ask').toBe(1);
  }, TIMEOUT);
});
