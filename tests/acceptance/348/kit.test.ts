// AC11: the extension host's kit loads a planted first-party extension in the hub that calls `deep.record.append`
// with `verdict.made` and with `decision.created`: both are refused at the record, naming the kind, and nothing is
// appended; a host that lets first-party extensions append every kind passes conformance without the planted
// extension and fails this test.
//
// Two views of the same rule. The kit's (README, The surface under test: `hostKit`, `runHostKit`): its case
// `first-party-decision-kinds` is a planted first-party extension, and the kit passes the real host and fails the
// twin, while the kit without that case passes the twin. And this suite's own planted first-party package
// (fixtures/decider, listed in the test's release so it loads in the hub), whose report shows each append's error
// and whose record shows nothing appended.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { hostKit, runHostKit, type ExtensionHost, type HostKit, type Plant, type ReleaseEntry } from '../../../packages/extension-host/src/index.ts';
import { eventInput, openHost, openWorld, pkg, releaseEntry, report, type World } from './helpers.ts';

const opened: ExtensionHost[] = [];
afterAll(async () => { for (const h of opened.splice(0)) await h.close(); });

const KINDS = ['verdict.made', 'decision.created'];
const CASE = 'first-party-decision-kinds';

/** The kit's `open`: a fresh world and a host on it whose release lists what the kit plants. */
function opener(worlds: World[], plant?: Plant) {
  return async (release: ReleaseEntry[]) => {
    const w = await openWorld();
    worlds.push(w);
    const host = await openHost(w, { release, ...(plant ? { plant } : {}) });
    opened.push(host);
    await host.ready();
    return { host, record: w.record };
  };
}
const without = (kit: HostKit, id: string): HostKit => ({ ...kit, cases: kit.cases.filter((c) => c.id !== id) });
async function appended(worlds: World[]): Promise<string[]> {
  const kinds: string[] = [];
  for (const w of worlds) for (const e of await w.events()) if (KINDS.includes(e.kind)) kinds.push(e.kind);
  return kinds;
}

interface Seen { pid: number; seen: Record<string, { appended: boolean; error: string | null }> }
/** This suite's planted first-party package, loaded in the hub of a host (the real one, or the twin). */
async function decider(plant?: Plant): Promise<{ w: World; seen: Seen }> {
  const w = await openWorld();
  const dir = await pkg('decider', { files: { 'events.json': JSON.stringify(KINDS.map(eventInput)) } });
  const h = await openHost(w, { release: [await releaseEntry(dir)], ...(plant ? { plant } : {}) });
  opened.push(h);
  await h.ready();
  const p = await h.install({ from: dir, builtBy: null });
  await h.check(p);
  const load = await h.load(p);
  expect(load.status === 'loaded' && load.place, `the planted first-party package loads in the hub: ${JSON.stringify(load)}`).toBe('hub');
  return { w, seen: await report<Seen>(h, 'ext.decider.report') };
}
/** The criterion's assertion: each kind refused, naming the kind, and nothing of either kind in the record. */
async function refusedAtTheRecord(w: World, seen: Seen): Promise<void> {
  for (const kind of KINDS) {
    expect(seen.seen[kind]?.appended, `the record took ${kind} from a first-party extension`).toBe(false);
    expect(seen.seen[kind]?.error ?? '', `the refusal of ${kind} names the kind`).toContain(kind);
  }
  const kinds = (await w.events()).map((e) => e.kind).filter((k) => KINDS.includes(k));
  expect(kinds, 'nothing of either kind was appended').toEqual([]);
}

describe('AC11 #348.379b1e4d the host\'s kit loads a planted first-party extension in the hub that appends verdict.made and decision.created: both refused at the record naming the kind, nothing appended; a host letting first-party extensions append every kind passes without it and fails this test', () => {
  it(`AC11 the kit holds the planted first-party case ${CASE}, and passes the real host with nothing of either kind appended`, async () => {
    const kit = hostKit();
    const planted = kit.cases.find((c) => c.id === CASE);
    expect(planted, `the kit has the case ${CASE}`).toBeDefined();
    expect(planted!.firstParty).toBe(true);
    expect(JSON.parse(readFileSync(join(planted!.extension, 'deepbuild.json'), 'utf8')), 'the case\'s extension is a package').toMatchObject({ id: expect.any(String), version: expect.any(String) });
    const worlds: World[] = [];
    const r = await runHostKit(kit, opener(worlds));
    expect(r.cases.find((c) => c.id === CASE), JSON.stringify(r)).toMatchObject({ outcome: 'PASS' });
    expect(r.verdict, JSON.stringify(r)).toBe('PASS');
    expect(await appended(worlds), 'the kit\'s planted extension appended a decision kind').toEqual([]);
  }, 120_000);

  it('AC11 a planted first-party package in the hub appending verdict.made and decision.created: each is refused at the record, naming the kind, and nothing is appended', async () => {
    const { w, seen } = await decider();
    expect(seen.pid, 'it ran in the hub\'s own process').toBe(process.pid);
    await refusedAtTheRecord(w, seen);
  }, 60_000);

  it('AC11 (wrong program) a host that lets first-party extensions append every kind passes the kit without the planted extension, and fails it with the planted extension', async () => {
    const kit = hostKit();
    const passing = await runHostKit(without(kit, CASE), opener([], 'first-party-appends-every-kind'));
    expect(passing.verdict, `without ${CASE} the kit can't tell: ${JSON.stringify(passing)}`).toBe('PASS');
    const worlds: World[] = [];
    const failing = await runHostKit(kit, opener(worlds, 'first-party-appends-every-kind'));
    expect(failing.verdict, JSON.stringify(failing)).toBe('FAIL');
    expect(failing.cases.find((c) => c.id === CASE)).toMatchObject({ outcome: 'FAIL' });
  }, 180_000);

  it('AC11 (wrong program) on that host, the planted first-party package\'s appends go through, and this test fails', async () => {
    const { w, seen } = await decider('first-party-appends-every-kind');
    await expect(refusedAtTheRecord(w, seen)).rejects.toThrow(/verdict\.made|decision\.created/);
  }, 60_000);
});
