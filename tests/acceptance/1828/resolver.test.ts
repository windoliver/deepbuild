import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import {
  AC2, allEvents, ANSWERER, answer, answererPackage, beginAsk, built, cleanup, installAll, loadReading, logOf, makeHome, makeRepo, msOf, question, said, setup, shown, startHub, stopHub, tag, verdict,
} from './helpers.ts';

afterAll(cleanup, 180_000);

test(`${AC2} a release package's resolver registered with deep.registerResolver answers the repeated question from your saved decision before it shows`, async (ctx) => verdict(ctx, async () => {
  const missing = built();
  if (missing) throw Error(`BLOCKED: ${missing}`);
  const w = makeHome();
  const rule = join(w.tmp, 'answers-rule.json');
  const log = join(w.tmp, 'answers-log.jsonl');
  const answers = answererPackage(join(w.tmp, 'test-packages'), rule, log);
  await installAll(w, [answers], [answers]);
  const hub = await startHub(w, { release: [answers] });
  try {
    await setup(w);
    const repo = makeRepo(w.home);
    const q = question({ point: `req:R1828${tag(4)}` });

    const first = await (await beginAsk(hub, w.home, { cwd: repo.dir, q })).finish();
    const yours = await answer(w, first.handle, 'green');
    if (yours.code !== 0) throw Error(`BLOCKED: deep inbox answer ${first.handle} green must exit 0: ${shown(yours)}`);
    await first.claude.end();
    let events = await allEvents(hub);
    const asked = events.find((e) => e.kind === 'ask.created' && e.id === first.id);
    const saved = events.find((e) => e.kind === 'decision.created' && e.data?.ask === first.handle);
    if (!asked || !saved) throw Error(`BLOCKED: your answer to ${first.handle} must be saved as a decision for the repo (deep inbox answer: ${shown(yours)}); the record holds ${saved ? 'it' : 'no decision.created for it'}`);
    writeFileSync(rule, JSON.stringify({ key: asked.data.key, answer: 'green', decision: `decision:${saved.id}` }));

    const second = await (await beginAsk(hub, w.home, { cwd: repo.dir, q })).finish();
    await second.claude.end();
    events = await allEvents(hub);
    const notes = logOf(log).filter((n) => n.pid === hub.pid);
    const consulted = notes.filter((n) => n.consulted === second.handle);
    const applied = events.filter((e) => e.kind === 'decision.applied' && e.data?.ask === second.handle);
    const batched = events.filter((e) => e.kind === 'ask.batched' && JSON.stringify(e.data ?? {}).includes(second.id));
    console.log(`${AC2} ${second.handle}: acme/answers's notes in the hub ${JSON.stringify(notes).slice(0, 1200)}; decision.applied ${applied.map(said).join('; ') || 'none'}; batches naming it ${batched.length}; ${loadReading()}`);

    const registered = notes.find((n) => n.registered || n.register_refused);
    expect(registered?.registered, `${AC2} ${ANSWERER}, loaded in the hub (pid ${hub.pid}), registers its resolver with deep.registerResolver: ${registered ? `it heard: ${String(registered.register_refused)}` : `it noted nothing in the hub (all its notes: ${JSON.stringify(logOf(log)).slice(0, 800)}; hub stderr: ${hub.output().slice(-800)})`}`).toBe(true);
    expect(consulted.map((n) => n.answered), `${AC2} the hub asks ${ANSWERER}'s resolver about ${second.handle}, the repeated question, and it answers green naming decision:${saved.id}`).toEqual([{ answer: 'green', because: `decision:${saved.id}` }]);
    expect(applied.map((e) => e.data?.decision), `${AC2} ${second.handle} closes as decided for you, citing decision:${saved.id}`).toEqual([`decision:${saved.id}`]);
    expect(consulted[0]!.at, `${AC2} ${ANSWERER}'s answer was in hand before ${second.handle} closed`).toBeLessThanOrEqual(msOf(applied[0]!.ts));
    expect(batched.map(said), `${AC2} the matching ask is answered before it shows: no batch ever names ${second.handle}`).toEqual([]);
  } finally {
    await stopHub(hub);
  }
}), 900_000);
