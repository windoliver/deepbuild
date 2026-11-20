// AC1, AC2, AC3 and AC4 of #2402, read from one story told through two real hubs (README, The story).
//
// Hub A has four packages: acme/hang, whose tool.before handler never replies; deepbuild/done-gate, the same handler
// standing for the done gate's own, listed in the hub's release (RELEASE_ENV, chosen) so it loads in the hub;
// acme/deny, which denies in time every `./deploy.sh` call; and acme/flaky, which never replies to a command naming
// `flaky-hang` and replies in time to any other. Hub C, the control, is the same world with acme/deny and acme/flaky
// only: "a host with no such extension". The hanging handlers and acme/flaky append a note per call they are asked
// about (README, The packages).
//
// 1. Ten `./deploy.sh step-<n>` calls, calls 1 to 5 in session S1 and 6 to 10 in S2, each made on A and on C in turn
//    (the order alternating), each call's wait timed as deep-hook's run. (AC1, AC4's first sentence)
// 2. In a new session S3, acme/flaky's scene: two failures, a reply in time, two failures, then a call it answers in
//    time. (AC2)
// 3. `deep doctor --json`; the sessions' readings; acme/hang restarted (RESTART, chosen); `deep doctor` again; one more
//    call in S1. (AC3)
// 4. In a new session S4, a prompt opens a task whose definition is handed and locks; the agent reads and edits
//    src/auth.ts and stops saying it ran `pnpm e2e`, which it never ran. (AC4's second sentence)
//
// Each test judges its part of the record and the replies; a part the story couldn't tell is BLOCKED, and a reading
// load spoiled is INCONCLUSIVE (a skip that names it), never a pass.
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import {
  allEvents, askNamed, asked, BEHAVIOR, bash, built, cleanup, DEADLINE_MS, decision, DENIED, DENY, deniedBy, denyPackage, doctor, flakyPackage, flakyScene, FLAKY, GATE, HANG,
  hangPackage, HOLD_MS, Inconclusive, installAll, itemsNaming, judgeNothingSetAside, judgeWaits, late, loadReading, lockedFor, namesCall, notesOf, readingsOn, recordOf,
  RELEASE_ENV, restart, RESTART, said, session, settle, sleep, startHub, stopHub, stopWords, taskOf, toolBefore, verdict, waitOf, world,
  type Call, type Ev, type Hub, type Item, type Pair, type Session, type World,
} from './helpers.ts';

const AC1 = 'AC1 #2402.b0923c0d';
const AC2 = 'AC2 #2402.e40df126';
const AC3 = 'AC3 #2402.afc86da6';
const AC4 = 'AC4 #2402.43eeba91';
/** The whole story runs inside the first test that asks for it; a loaded Mac may take a long time over it. */
const STORY_MS = 1_800_000;

afterAll(cleanup, 180_000);

interface Story {
  hub: Hub; w: World; events: Ev[]; start: number; stderr: string; load: string[];
  s: Session[]; calls: Call[]; control: Call[]; controlEvents: Ev[];
  flaky?: Call[]; flakyError?: string;
  doctorBefore?: Item[]; restartPos?: number; restarted?: Awaited<ReturnType<typeof restart>>; doctorAfter?: Item[]; again?: Call; afterError?: string;
  claim?: { s: Session; ref: string; stop: { code: number | null; sentBack: boolean; words: string; stderr: string } }; claimError?: string;
}
let told: Promise<Story> | undefined;
const story = (): Promise<Story> => (told ??= tell());

async function tell(): Promise<Story> {
  const missing = built();
  if (missing) throw Error(`BLOCKED: ${missing}`);
  const load = [`at the start: ${loadReading()}`];
  const wA = world();
  const wC = world();
  const dir = join(wA.tmp, 'test-packages');
  const hang = hangPackage(dir);
  const gate = hangPackage(dir, GATE);
  const deny = denyPackage(dir);
  const flaky = flakyPackage(dir);
  await Promise.all([installAll(wA, [hang, gate, deny, flaky], [gate]), installAll(wC, [deny, flaky])]);
  const [hub, control] = await Promise.all([startHub(wA, { release: [gate] }), startHub(wC)]);
  try {
    const [s1, k1] = await Promise.all([session(wA), session(wC)]);
    const start = (await allEvents(hub)).at(-1)?.log_pos ?? 0;
    // 1. Ten calls on A, each beside the control's call of the same number on C, the order alternating.
    const calls: Call[] = [];
    const controls: Call[] = [];
    const s = [s1];
    let [onA, onC] = [s1, k1];
    for (let n = 1; n <= 10; n++) {
      if (n === 6) {
        const [s2, k2] = await Promise.all([session(wA), session(wC)]);
        s.push(s2);
        [onA, onC] = [s2, k2];
      }
      const command = `${DENIED} step-${n}`;
      if (n % 2) {
        calls.push(await bash(onA, `call ${n}`, command));
        controls.push(await bash(onC, `control call ${n}`, command));
      } else {
        controls.push(await bash(onC, `control call ${n}`, command));
        calls.push(await bash(onA, `call ${n}`, command));
      }
    }
    load.push(`after the ten calls: ${loadReading()}`);
    const t: Story = { hub, w: wA, events: [], start, stderr: '', load, s, calls, control: controls, controlEvents: await allEvents(control) };
    await stopHub(control);

    // 2. acme/flaky's scene, in a session of its own.
    try {
      const s3 = await session(wA);
      s.push(s3);
      t.flaky = await flakyScene(s3);
    } catch (error) {
      t.flakyError = error instanceof Error ? error.message : String(error);
    }

    // 3. The doctor, the restart, the doctor again, and the next call.
    try {
      await sleep(3000);
      t.doctorBefore = await doctor(wA);
      t.restartPos = (await allEvents(hub)).at(-1)?.log_pos ?? 0;
      t.restarted = await restart(hub, HANG);
      // A restart that clears the item clears it within a few seconds: the doctor is read until it has, or 15 s pass.
      for (const end = Date.now() + 15_000; ;) {
        t.doctorAfter = await doctor(wA);
        if (!itemsNaming(t.doctorAfter, HANG).length || Date.now() > end) break;
        await sleep(1000);
      }
      t.again = await bash(s1, 'the call after the restart', 'cat notes.txt');
    } catch (error) {
      t.afterError = error instanceof Error ? error.message : String(error);
    }

    // 4. A claim citing a run the session never made, with the done gate's own handler set aside.
    try {
      const s4 = await session(wA);
      s.push(s4);
      await s4.typed(BEHAVIOR);
      const locked = await settle(hub, (e) => { const ref = taskOf(askNamed(e, s4, BEHAVIOR)); return ref !== undefined && lockedFor(e, ref).length > 0; }, 180_000).catch(() => undefined);
      const ref = locked ? taskOf(askNamed(locked, s4, BEHAVIOR)) : undefined;
      if (!locked || !ref) throw Error(`BLOCKED: the prompt "${BEHAVIOR}" must open a task whose handed definition locks before the claim; read at ${loadReading()}`);
      await s4.read('src/auth.ts');
      await s4.edit('src/auth.ts', 'token.exp > 0', 'token.exp > Date.now() / 1000');
      const r = await s4.stop('The middleware now rejects expired tokens. I ran `pnpm e2e` and it passed.');
      t.claim = { s: s4, ref, stop: { code: r.code, sentBack: decision(r) === 'deny', words: stopWords(r), stderr: r.stderr } };
    } catch (error) {
      t.claimError = error instanceof Error ? error.message : String(error);
    }
    load.push(`at the end: ${loadReading()}`);
    t.events = await allEvents(hub);
    t.stderr = hub.stderr();
    return t;
  } finally {
    await stopHub(hub);
    await stopHub(control);
  }
}

/** The ten calls beside the control's, each with whether acme/hang was asked about it and whether either may never have been decided. */
function pairs(t: Story): Pair[] {
  return t.calls.map((call, i) => ({ n: i + 1, call, control: t.control[i]!, asked: asked(t.events, HANG, call), late: late(t.events, call) || late(t.controlEvents, t.control[i]!) }));
}
/** The scene every later criterion stands on: acme/hang was asked about calls 1 to 3 and about none of calls 4 to 10. */
function setAside(t: Story, who: string): void {
  const before = t.calls.slice(0, 3).filter((c) => !asked(t.events, HANG, c)).map((c) => c.label);
  if (before.length) throw Error(`BLOCKED: ${who} ${HANG}'s handler must be asked about calls 1 to 3, the failures that set it aside; it wasn't asked about ${before.join(', ')}`);
  const after = t.calls.slice(3).filter((c) => asked(t.events, HANG, c)).map((c) => c.label);
  if (after.length) throw Error(`BLOCKED: ${who} ${HANG}'s handler must be set aside after its third failure, which this reads; it was asked about ${after.join(', ')}, so the scene never happened (AC1)`);
}

test(`${AC1} a test extension whose tool.before handler never replies: its first three tool calls each wait the deadline and are recorded as failed; the fourth to the tenth are answered with no wait for it, within 20 ms of a host with no such extension; the record holds the three failures and the set-aside`, async (ctx) => verdict(ctx, async () => {
  const t = await story();
  const waits = judgeWaits(pairs(t));
  console.log(`${AC1} waits: ${waits.table}; ${t.load.join('; ')}`);
  const problems = [...(waits.status === 'FAIL' ? waits.problems : [])];
  // The record: each of the first three calls failed, naming the extension, its hook kind and the call; and the set-aside.
  // Read up to the restart (AC3), whose own events and the failures after it are another story.
  const named = recordOf(t.events, HANG, t.start).filter((e) => e.log_pos <= (t.restartPos ?? Infinity));
  for (const c of t.calls.slice(0, 3)) {
    if (!named.some((e) => namesCall(e, t.events, c))) problems.push(`the record holds no failure of ${c.label} (${c.id}, its tool.before ${toolBefore(t.events, c)?.id ?? 'unrecorded'}) naming ${HANG} and tool.before`);
  }
  // Each call's failure is the first event naming it; the set-aside is any event beside those three, or one that says "aside".
  const failures = new Set(t.calls.slice(0, 3).flatMap((c) => named.find((e) => namesCall(e, t.events, c))?.id ?? []));
  const aside = named.filter((e) => !failures.has(e.id) || /aside/i.test(JSON.stringify({ kind: e.kind, data: e.data })));
  if (!aside.length) problems.push(`the record holds no set-aside of ${HANG}'s tool.before handler: no event names it beside its failures${named.length ? ` (${named.map(said).join('; ')})` : ''}`);
  if (problems.length) expect.fail(`${AC1} ${problems.join('; ')}. The waits: ${waits.table}. Read at ${t.load.join('; ')}`);
  if (waits.status === 'INCONCLUSIVE') throw new Inconclusive(`${AC1} ${waits.problems.join('; ')}. The waits: ${waits.table}. Read at ${t.load.join('; ')}`);
}), STORY_MS);

test(`${AC2} two failures, a reply in time, then two more failures set nothing aside: acme/flaky is asked about each of those calls and the one after`, async (ctx) => verdict(ctx, async () => {
  const t = await story();
  if (!t.flaky) throw Error(`BLOCKED: ${AC2} acme/flaky's scene didn't run: ${t.flakyError}`);
  const [first] = t.flaky;
  if (!first || !asked(t.events, FLAKY, first)) throw Error(`BLOCKED: ${AC2} ${FLAKY} must be loaded and asked about its first call; it wasn't (hub stderr: ${t.stderr.slice(-600)})`);
  if (waitOf(first) < DEADLINE_MS) throw Error(`BLOCKED: ${AC2} c1, which ${FLAKY} never answers, must wait its ${DEADLINE_MS} ms deadline: it took ${waitOf(first).toFixed(0)} ms`);
  const problems = judgeNothingSetAside(t.events, t.flaky, t.start);
  expect(problems, `${AC2} ${problems.join('; ')}; the scene's waits: ${t.flaky.map((c) => `${c.label} ${waitOf(c).toFixed(0)} ms`).join(', ')}`).toEqual([]);
}), STORY_MS);

test(`${AC3} with acme/hang set aside, deep doctor shows one item naming it, tool.before and the last failure, and each session it would have judged holds one reading that says so; restarting it clears the item, and its next call is asked again`, async (ctx) => verdict(ctx, async () => {
  const t = await story();
  setAside(t, AC3);
  if (!t.doctorBefore) throw Error(`BLOCKED: ${AC3} the doctor and restart step didn't run: ${t.afterError}`);
  // One doctor item, naming the extension, the hook kind and the last failure.
  const items = itemsNaming(t.doctorBefore, HANG);
  expect(items, `${AC3} deep doctor shows one item for ${HANG}'s set-aside handler (an item at a level other than ok naming it): ${JSON.stringify(items)}`).toHaveLength(1);
  const item = JSON.stringify(items[0]);
  expect(item, `${AC3} the doctor's item names the hook kind`).toContain('tool.before');
  const last = t.calls[2]!;
  const lastIds = [last.id, toolBefore(t.events, last)?.id].filter((x): x is string => typeof x === 'string');
  expect(lastIds.some((id) => item.includes(id)) || /deadline/i.test(item), `${AC3} the doctor's item names the last failure: call 3 (${lastIds.join(' or ')}) or its missed deadline: ${item}`).toBe(true);
  // One reading on each session whose calls it would have judged.
  const upTo = t.restartPos ?? Infinity;
  const on = (s: Session) => readingsOn(t.events, s).filter((e) => e.log_pos <= upTo && JSON.stringify(e.data).includes(HANG));
  const [s1, s2, s3] = t.s;
  expect(on(s1!).length, `${AC3} S1, whose calls 4 and 5 ${HANG} would have judged, holds a reading that says so: ${readingsOn(t.events, s1!).map(said).join('; ') || 'none'}`).toBeGreaterThanOrEqual(1);
  expect(on(s2!), `${AC3} S2, whose calls 6 to 10 ${HANG} would have judged, holds one reading that says so: ${readingsOn(t.events, s2!).map(said).join('; ') || 'none'}`).toHaveLength(1);
  if (s3) expect(on(s3), `${AC3} S3, whose six calls ${HANG} would have judged, holds one reading that says so: ${readingsOn(t.events, s3).map(said).join('; ') || 'none'}`).toHaveLength(1);
  // Restarting the extension clears the item, and its next call is asked again.
  expect(t.restarted?.ok, `${AC3} restarting ${HANG} through the socket's ${RESTART} { id } must be taken: ${JSON.stringify(t.restarted)}`).toBe(true);
  expect(itemsNaming(t.doctorAfter ?? [], HANG), `${AC3} once ${HANG} is restarted, deep doctor shows no item for it`).toEqual([]);
  if (!t.again) throw Error(`BLOCKED: ${AC3} the call after the restart wasn't made: ${t.afterError}`);
  if (late(t.events, t.again)) throw new Inconclusive(`${AC3} the call after the restart may never have reached the hub; read at ${t.load.join('; ')}`);
  expect(asked(t.events, HANG, t.again), `${AC3} ${HANG}'s handler is asked again about the next call after its restart (${t.again.id}), which waited ${waitOf(t.again).toFixed(0)} ms`).toBe(true);
}), STORY_MS);

test(`${AC4} acme/deny's deny on the same call stands on every one of the ten calls acme/hang failed or was set aside on`, async (ctx) => verdict(ctx, async () => {
  const t = await story();
  setAside(t, AC4);
  const unclear: string[] = [];
  const lost: string[] = [];
  for (const c of t.calls) {
    if (deniedBy(c, DENY)) continue;
    // A reply the hub never decided, or wrote at its hold, says nothing of the extensions' replies.
    if (late(t.events, c) || waitOf(c) >= HOLD_MS - 50) unclear.push(`${c.label} (${waitOf(c).toFixed(0)} ms)`);
    else lost.push(`${c.label}: ${c.ran.code === 2 ? '' : `exit ${c.ran.code}, `}${JSON.stringify((c.ran.stderr || c.ran.stdout).slice(0, 300))} after ${waitOf(c).toFixed(0)} ms`);
  }
  expect(lost, `${AC4} ${DENY}'s deny, given in time, stands on every call acme/hang failed or was set aside on; it was missing from: ${lost.join('; ')}`).toEqual([]);
  if (unclear.length) throw new Inconclusive(`${AC4} the hub may not have decided ${unclear.join(', ')}; read at ${t.load.join('; ')}`);
}), STORY_MS);

test(`${AC4} with the done gate's own handler set aside, a claim citing a run the session never made still goes back, as in safe mode`, async (ctx) => verdict(ctx, async () => {
  const t = await story();
  // The done gate's own handler: deepbuild/done-gate, in the release the hub loads, ran in the hub and was set aside.
  const notes = notesOf(t.events, GATE);
  const elsewhere = [...new Set(notes.filter((n) => n.pid !== t.hub.pid).map((n) => n.pid))];
  if (!notes.length || elsewhere.length) throw Error(`BLOCKED: ${AC4} ${GATE}, listed in the hub's release through ${RELEASE_ENV}, must run in the hub (pid ${t.hub.pid}) as the done gate's own handler: ${notes.length ? `it ran in process ${elsewhere.join(', ')}` : 'it was never asked'}`);
  if (!t.claim) throw Error(`BLOCKED: ${AC4} the claim wasn't made: ${t.claimError}`);
  const firstThree = t.calls.slice(0, 3);
  // Every later call: calls 4 to 10, acme/flaky's scene, the call after the restart, and the claim's own read and edit.
  const claimCalls = t.events.filter((e) => e.kind === 'tool.before' && e.session === t.claim!.s.id).map((e) => String(e.data?.call));
  const later = [...[...t.calls.slice(3), ...(t.flaky ?? []), ...(t.again ? [t.again] : [])].map((c) => ({ label: c.label, id: c.id })), ...claimCalls.map((id) => ({ label: `the claim's call ${id}`, id }))];
  const unasked = firstThree.filter((c) => !notes.some((n) => n.call === c.id)).map((c) => c.label);
  const stillAsked = later.filter((c) => notes.some((n) => n.call === c.id)).map((c) => c.label);
  if (unasked.length || stillAsked.length) throw Error(`BLOCKED: ${AC4} ${GATE}'s handler must fail calls 1 to 3 and be set aside before the claim: ${unasked.length ? `it wasn't asked about ${unasked.join(', ')}` : `it was still asked about ${stillAsked.join(', ')}`}`);
  const { stop } = t.claim;
  if (/deep-hook: (spooled|could not spool)|while the hub doesn't answer/.test(stop.stderr)) throw new Inconclusive(`${AC4} the Stop never reached the hub (${stop.stderr.slice(0, 300)}); read at ${t.load.join('; ')}`);
  const claimed = t.events.filter((e) => e.kind === 'claim.made' && e.data?.task_ref === t.claim!.ref);
  if (!claimed.length) throw Error(`BLOCKED: ${AC4} the stop after the edit must make a claim on ${t.claim.ref}: the record holds none`);
  expect(stop.sentBack, `${AC4} the Stop's reply sends the claim back: exit ${stop.code}, ${JSON.stringify(stop.words.slice(0, 400))}`).toBe(true);
  expect(stop.words, `${AC4} the claim citing \`pnpm e2e\`, a run the session never made, goes back naming it (exit ${stop.code})`).toContain('pnpm e2e');
}), STORY_MS);
