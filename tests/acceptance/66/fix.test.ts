// AC1: "Fix LIN-42" starts work from a Linear issue, with its acceptance criteria in what done means.
// AC5: a Linear comment from someone outside the project that says to skip a requirement leaves it in the definition,
// and the definition waits for your one answer.
// Two halves each. On the extension host, the shipped Linear source (packages/sources/linear) over the recorded
// Linear fixture: "Fix <id>" reads the issue by its ID, though it was made before the source was switched on, and the
// task carries its criteria and its readings. On the real hub, those readings are the work source's (the test work
// source, DEEP_HUB_TEST_WORK), and `deep fix <id>` opens the task, in a workspace since it has no repo, and locks
// what done means from them. AC5's drafting job hands the kernel R1 to R3 from the criteria and olu's waiver of R2
// (DEEP_HUB_TEST_DRAFTS), as #322's suites hand it.
import { afterAll, describe, expect, it } from 'vitest';
import { AC1, AC5, at, YOU } from './helpers.ts';
import { allEvents, cleanup, deep, makeWorld, req, settle, shown, startHub, type Ev } from './hub.ts';
import { LIN42_CRITERIA, LIN43_CRITERIA } from './providers.ts';
import { linearWorld } from './worlds.ts';

afterAll(cleanup, 60_000);
const BASE = at('2026-11-02T09:00');
const lockOf = (events: Ev[], task: string) => events.filter((e) => e.kind === 'definition.locked' && e.data.task_ref === task);
async function fix(w: ReturnType<typeof makeWorld>, id: string): Promise<{ task: string; link: string }> {
  const r = await deep(w, ['fix', id]);
  expect(r.code, `deep fix ${id} exits 0: ${shown(r)}`).toBe(0);
  const line = JSON.parse(r.stdout.trim().split('\n').at(-1) ?? '{}') as { task?: string; link?: string };
  expect(typeof line.task, `deep fix ${id} prints {"task","link"}: ${shown(r)}`).toBe('string');
  return line as { task: string; link: string };
}

describe(`${AC1} "Fix LIN-42" starts work from a Linear issue, with its acceptance criteria in what done means`, () => {
  it('AC1 Fix LIN-42 reads the Linear issue, made before the switch-on, and its three criteria are what done means', async () => {
    const { h } = await linearWorld(BASE);
    const task = await h.fix(YOU, 'LIN-42');
    expect(task.id).toBe('LIN-42');
    expect(task.link, 'the task links back to the Linear issue').toContain('linear.app/acme/issue/LIN-42');
    expect(task.criteria, 'its acceptance criteria, in order').toEqual(LIN42_CRITERIA);
    const readings = (await h.workEvents(task.task_ref)).map((e) => e.reading);
    expect(readings.find((r) => r.source_id === 'LIN-42')?.criteria).toEqual(LIN42_CRITERIA);

    const w = makeWorld({ readings });
    const hub = await startHub(w);
    const started = await fix(w, 'LIN-42');
    expect(started.link).toBe(task.link);
    const events = await settle(hub, (all) => lockOf(all, started.task).length > 0, 60_000);
    expect(events.some((e) => e.kind === 'task.created' && e.data.task_ref === started.task), 'the task is opened').toBe(true);
    const [lock] = lockOf(events, started.task);
    expect(lock, 'what done means locks with no question: the issue is yours').toBeDefined();
    expect((lock!.data.requirements as { text: string }[]).map((r) => r.text)).toEqual(LIN42_CRITERIA);
  }, 600_000);
});

describe(`${AC5} A Linear comment from someone outside the project that says to skip a requirement leaves it in the definition, and the definition waits for your one answer`, () => {
  it('AC5 olu\'s "skip the second criterion" leaves R2 in; the definition waits for one ask and locks on your answer with R2', async () => {
    const { h } = await linearWorld(BASE);
    const task = await h.fix(YOU, 'LIN-43');
    const readings = (await h.workEvents(task.task_ref)).map((e) => e.reading);
    const olu = readings.find((r) => r.authors.some((a) => a.handle === 'olu'));
    expect(olu?.authors.find((a) => a.handle === 'olu')?.role, 'olu\'s comment is read as outside').toBe('outside');
    const requirements = LIN43_CRITERIA.map((text, i) => req(`R${i + 1}`, text, `LIN-43#L${i + 4}`));
    const w = makeWorld({ readings, drafts: [{ issue: 'LIN-43', requirements, deliverables: [], budget: null, waives: [{ id: 'R2', source_line: `${olu!.source_id}#L1` }] }] });
    const hub = await startHub(w);
    const started = await fix(w, 'LIN-43');
    let events = await settle(hub, (all) => all.some((e) => e.kind === 'ask.created'), 60_000);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    events = await allEvents(hub);
    expect(lockOf(events, started.task), 'the definition waits: it doesn\'t lock on outside text').toEqual([]);
    const asks = events.filter((e) => e.kind === 'ask.created');
    expect(asks.length, `one ask: ${JSON.stringify(asks.map((a) => a.data))}`).toBe(1);
    const options = (asks[0]!.data.options ?? []) as { id: string; label?: string }[];
    const keep = options.find((o) => /keep|lock|include|accept|yes/i.test(`${o.id} ${o.label ?? ''}`)) ?? options[0];
    const answered = await deep(w, ['inbox', 'answer', `ask:${asks[0]!.id}`, keep!.id]);
    expect(answered.code, `your one answer counts: ${shown(answered)}`).toBe(0);
    events = await settle(hub, (all) => lockOf(all, started.task).length > 0, 60_000);
    const [lock] = lockOf(events, started.task);
    expect(lock, 'it locks on your answer').toBeDefined();
    expect((lock!.data.requirements as { id: string; text: string }[]).map((r) => r.text), 'R2 stays').toEqual(LIN43_CRITERIA);
    expect(events.filter((e) => e.kind === 'ask.created').length, 'never asked twice').toBe(1);
  }, 600_000);
});
