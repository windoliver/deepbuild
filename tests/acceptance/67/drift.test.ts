// #67 AC6, AC7 (but for its schema half, in sources.test.ts) and AC11's second half on the real hub, read from one scenario. Two tasks in one workspace: T1's verdict
// reads the hosts web-1 and web-2, T2's only web-2. web-1 drifts: T1's verdict goes stale, T2's doesn't, and only the
// check that reads web-1 runs again. The second verdict on T1's claim sits on the same commit under a different key;
// then web-1 drifts so that the check fails, and the first PASS isn't reused. The last test runs the plant the criterion
// names, a key of only the commit, document revisions, check digests, environment and tools, and it fails the same judge.
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AC6, AC7, AC11, ASSERTS, allEvents, changed, CHECK, claimHandle, claimsOf, cleanup, decision, draft, fill, finishOf, hostLog, lastPos, listed, locked, makeWorld, must, newWorkspace, nodeCheck, replyText,
  req, runsAfter, Session, settle, startHub, taskOf, verdictsOf, workspace, type Ev, type Hub, type Session as Live, type Workspace, type World,
} from './hub.ts';

const T1 = 'keep both web hosts healthy';
const T2 = 'watch the certificate on the second web host';
const FILES = { ...nodeCheck('web-1', `state('web-1').port === 80`), ...nodeCheck('web-2', `state('web-2').tls === true`), ...nodeCheck('web-2-cert', `state('web-2').cert === 'current'`) };
const R = (id: string, name: string, touch: string) => req(id, `The check ${name} holds`, { check: CHECK(name), asserts: [ASSERTS(name)], reads: [touch] });
const DRAFTS = [draft(T1, [R('R1', 'web-1', 'web-1'), R('R2', 'web-2', 'web-2')]), draft(T2, [R('R1', 'web-2-cert', 'web-2')])];
interface Drift { drifted: string[]; stale: string[]; reran: string[] }
const newestPass = (all: Ev[], claim: Ev): Ev | undefined => verdictsOf(all, claimHandle(claim)).filter((v) => v.data.outcome === 'PASS').at(-1);

/** A workspace naming the two hosts, a session in it, and T1's task through to its PASS. */
async function setUp(w: World, hub: Hub): Promise<{ ws: Workspace; s: Live; web1: string; web2: string; claim: Ev; verdict: Ev }> {
  const web1 = hostLog(w, 'web-1', { workers: 4, port: 80 });
  const web2 = hostLog(w, 'web-2', { tls: true, cert: 'current' });
  const ws = await newWorkspace(w, 'Web fleet');
  fill(w, ws, FILES, [{ id: 'web-1', source: 'host', log: web1 }, { id: 'web-2', source: 'host', log: web2 }]);
  const s = new Session(w, ws.folder);
  await s.start();
  const { claim, verdict } = await pass(hub, s, T1, join(ws.folder, 'notes/fleet.md'));
  return { ws, s, web1, web2, claim, verdict };
}
/** A task through its definition, a written note and a stop, to the PASS on its claim. */
async function pass(hub: Hub, s: Live, ask: string, note: string): Promise<{ claim: Ev; verdict: Ev }> {
  await s.typed(ask);
  await settle(hub, (all) => locked(all, taskOf(all, s, ask)) !== undefined);
  await s.write(note, `${ask}\n`);
  const stop = await s.stop(`${ask}: done.`);
  const events = await settle(hub, (all) => { const c = claimsOf(all, taskOf(all, s, ask))[0]; return c !== undefined && newestPass(all, c) !== undefined; }, 60_000);
  const claim = claimsOf(events, taskOf(events, s, ask))[0];
  must(claim !== undefined, `the stop must make a claim for "${ask}": ${listed(events.slice(-8))}`);
  const verdict = newestPass(events, claim);
  must(verdict !== undefined, `"${ask}" must pass before anything drifts: ${decision(stop)} ${replyText(stop)} ${listed(verdictsOf(events, claimHandle(claim)))}`);
  return { claim, verdict };
}
/** Why two verdicts on one commit under different readings don't hold AC7's rule, or null when they do. */
function keyFinding(first: Ev | undefined, second: Ev | undefined): string | null {
  if (!first || !second) return `no second verdict on the commit: ${first ? 'its key let the first stand for it' : 'no first verdict'}`;
  if (first.data.commit !== second.data.commit) return `they sit on two commits, ${first.data.commit} and ${second.data.commit}`;
  if (JSON.stringify(first.data.key) === JSON.stringify(second.data.key)) return `both have one key: ${JSON.stringify(first.data.key)}`;
  return null;
}

let w: World, hub: Hub, ws: Workspace, web1: string;
let claim1: Ev, v1: Ev, v2: Ev, quiet: Drift, drift: Drift, after: Ev[], since: number, v1b: Ev | undefined, broke: Drift, failed: Ev | undefined, sinceBreak: number, late: Ev[];

beforeAll(async () => {
  w = makeWorld({ drafts: DRAFTS });
  hub = await startHub(w);
  const set = await setUp(w, hub);
  ({ ws, web1 } = set);
  claim1 = set.claim;
  v1 = set.verdict;
  v2 = (await pass(hub, set.s, T2, join(ws.folder, 'notes/cert.md'))).verdict;

  // Nothing changed: a read of the hosts drifts nothing.
  quiet = await workspace(w, 'drift', ws.id) as Drift;

  since = lastPos(await allEvents(hub));
  changed(web1, 'workers', 8);
  drift = await workspace(w, 'drift', ws.id) as Drift;
  after = await settle(hub, (all) => verdictsOf(all, claimHandle(claim1), since).some((v) => v.data.outcome !== undefined) && runsAfter(all, since).every((r) => finishOf(all, r)), 60_000);
  v1b = verdictsOf(after, claimHandle(claim1), since).at(-1);

  sinceBreak = lastPos(after);
  changed(web1, 'port', 8080);
  broke = await workspace(w, 'drift', ws.id) as Drift;
  late = await settle(hub, (all) => verdictsOf(all, claimHandle(claim1), sinceBreak).length > 0 && runsAfter(all, sinceBreak).every((r) => finishOf(all, r)), 60_000);
  failed = verdictsOf(late, claimHandle(claim1), sinceBreak).at(-1);
}, 300_000);
afterAll(cleanup, 60_000);

describe(`${AC6} a host's drift marks the verdicts that read it stale and re-runs only those checks`, () => {
  it(`${AC6} with nothing changed a read of the hosts marks nothing and runs nothing`, () => {
    expect(quiet, 'no drift').toEqual({ drifted: [], stale: [], reran: [] });
    expect(after.filter((e) => e.kind === 'verdict.stale' && e.log_pos <= since), 'nothing went stale before web-1 changed').toEqual([]);
  });
  it(`${AC6} web-1's drift marks the verdict that read it stale, and not the verdict that read only web-2`, () => {
    expect(drift.drifted, 'the host that drifted').toEqual(['web-1']);
    expect(drift.stale, 'the verdicts that read it').toEqual([v1.data.verdict]);
    const stale = after.filter((e) => e.kind === 'verdict.stale' && e.log_pos > since);
    expect(stale.map((e) => e.data.verdict), 'in the record, verdict.stale by the core for that one verdict').toEqual([v1.data.verdict]);
    expect(stale.map((e) => e.data.verdict), 'and never for the verdict on web-2').not.toContain(v2.data.verdict);
  });
  it(`${AC6} only the check whose input changed runs again; the claim's other check keeps its result`, () => {
    expect(drift.reran, 'what the drift says it runs').toEqual([CHECK('web-1')]);
    expect(runsAfter(after, since).map((r) => r.data.check), `the runs in the record: ${listed(runsAfter(after, since))}`).toEqual([CHECK('web-1')]);
    expect(v1b?.data.outcome, 'the claim passes again on the new reading, its other check\'s result carried').toBe('PASS');
    expect((v1b?.data.requirements as { check: string; outcome: string }[] | undefined)?.map((q) => [q.check, q.outcome]), 'both requirements').toEqual([[CHECK('web-1'), 'PASS'], [CHECK('web-2'), 'PASS']]);
  });
});

describe(`${AC7} a workspace verdict's key holds state_digests; two verdicts on one commit whose host readings differ get different keys`, () => {
  it(`${AC7} the key holds one digest for each touch its checks read, a SHA-256`, () => {
    expect(v1.data.key.state_digests, 'T1 read two hosts').toHaveLength(2);
    expect(v2.data.key.state_digests, 'T2 read one').toHaveLength(1);
    for (const d of [...v1.data.key.state_digests, ...v2.data.key.state_digests] as string[]) expect(d).toMatch(/^[0-9a-f]{64}$/);
    expect(v1.data.key.state_digests, 'T2\'s one reading, of web-2, is one of T1\'s').toEqual(expect.arrayContaining(v2.data.key.state_digests as string[]));
  });
  it(`${AC7} two verdicts on one commit whose host readings differ have different keys, differing only in state_digests`, () => {
    expect(keyFinding(v1, v1b)).toBeNull();
    const { state_digests: first, ...rest } = v1.data.key as Record<string, unknown>;
    const { state_digests: second, ...others } = (v1b?.data.key ?? {}) as Record<string, unknown>;
    expect(others, 'the commit, document revisions, check digests, environment and tools are one').toEqual(rest);
    expect(second, 'the digests of what the checks read are not').not.toEqual(first);
  });
  it(`${AC7} the first is never reused for the second: when the new reading fails the check, the claim's verdict is FAIL on the same commit`, () => {
    expect(broke.reran, 'the check runs again').toEqual([CHECK('web-1')]);
    expect(keyFinding(v1b, failed)).toBeNull();
    expect(failed?.data.outcome, 'a reused PASS would stand here').toBe('FAIL');
  });
  it(`${AC7} a key of only the commit, document revisions, check digests, environment and tools gives both one key and fails this test`, async () => {
    const world = makeWorld({ drafts: DRAFTS });
    const planted = await startHub(world, { plant: 'state-left-out-of-key' });
    const set = await setUp(world, planted);
    const from = lastPos(await allEvents(planted));
    changed(set.web1, 'workers', 8);
    await workspace(world, 'drift', set.ws.id);
    const events = await settle(planted, (all) => verdictsOf(all, claimHandle(set.claim), from).length > 0, 15_000);
    const second = verdictsOf(events, claimHandle(set.claim), from).at(-1);
    expect(keyFinding(set.verdict, second), 'the planted key fails the judge the real one passes').not.toBeNull();
  }, 180_000);
});

describe(`${AC11} a verdict pinned to the real source goes stale on the change a planted source can't see`, () => {
  it(`${AC11} the fixture setting changes through the shipped host source, and the verdict pinned to its reading goes stale, naming what it read`, () => {
    const stale = after.find((e) => e.kind === 'verdict.stale' && e.data.verdict === v1.data.verdict);
    expect(stale, `verdict.stale for the verdict pinned to web-1's reading: ${listed(after.slice(-8))}`).toBeDefined();
    expect(stale!.writer, 'only the core marks a verdict stale').toBe('core');
    const drifted = (v1.data.key.state_digests as string[]).filter((d) => !(v1b?.data.key.state_digests as string[] | undefined)?.includes(d));
    expect(drifted, 'one of its two digests moved').toHaveLength(1);
    must(String(stale!.data.because).includes(drifted[0]!) || String(stale!.data.because).includes('web-1'), `the staleness names what moved: ${String(stale!.data.because)}`);
  });
});
