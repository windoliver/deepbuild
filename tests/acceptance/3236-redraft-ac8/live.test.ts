// AC8 #3236.b9b04201: "On the reference Mac, the live tree read through AppKit holds the node's value, and the walk's
// announcements equal the replica's. If the platform can't be read, this criterion is BLOCKED, naming where it stopped"
//
// The replica is `deep-show run`: the issue's 12-row scatter, one row missing y, presented on a small panel; Tab, then
// Right once for each of its 11 drawn rows; then `see`, whose scatter node's `value` and announcements are the only
// expected texts. They come first: a scatter refused, a node with no value or a walk no landing of which is announced
// fails here, before any window. The live side is `deep-show live` on the same calls, its real window read and heard
// from outside its process (client.swift), and judged only against the replica (helpers.ts, `judge`): the element whose
// AXIdentifier is the scatter's ID gives the same value, and the announcements the window asks for are the replica's,
// each as many times, in order. When the window speaks isn't assumed: the client takes announcements from before the
// window lists, and listens at least 45 s from then, until each came and none for 20 s, and never past 240 s.
//
// BLOCKED, naming where it stopped and never a pass: off macOS, off the reference Macs, no swiftc, no Accessibility
// trust, a locked screen or a sleeping display (before the build, before the window, at any sample while it's read, and
// after), a window that can't open, none AppKit lists within 30 s of the answer, one with no element identified as an
// item of the document.
import { beforeAll, describe, expect, it } from 'vitest';
import { BUILD_TIMEOUT, DOC, binOf, presented, runShow, scenario, seenOf, show, useTemp, type JsonObject } from '../539/helpers.ts';
import { AC, IDS, PAGE, SCATTER, blocked, judge, platformProblem, readWindow, screenNow, walk, type Replica } from './helpers.ts';

const temp = useTemp();
const D = DOC(3236);
let stopped: string | null = null;
beforeAll(async () => {
  stopped = await platformProblem({ reference: true });
  // The build takes many minutes; a platform that can't be read needs none. The test names a build that failed.
  if (stopped === null) try { binOf(); } catch { /* named there */ }
}, BUILD_TIMEOUT);

/** The codes by which `deep-show live` says it has no platform to show a window on. */
const NO_WINDOW = ['no_window', 'no_display', 'unsupported_platform'];

describe(`${AC} the live tree read through AppKit`, () => {
  it(`${AC} holds the node's value, and the walk's announcements equal the replica's`, async () => {
    if (stopped !== null) blocked(stopped);
    const bin = binOf();
    const { calls, see } = walk(D);
    const played = (): JsonObject => scenario(temp(), [D], calls, { rect: [0, 0, ...PAGE] });

    const r = runShow(bin, played(), "the replica's walk over the scatter");
    presented(r[0]!, 'the scatter with a missing row');
    const seen = seenOf(r[see]!, 'see after the walk');
    const node = seen.tree.find((n) => n['id'] === SCATTER);
    expect(node, `the replica's tree has the scatter's node: ${show(seen.tree)}`).toBeDefined();
    const value = node!['value'];
    expect(typeof value === 'string' && value.trim() !== '', `the replica's scatter node holds a value: ${show(node)}`).toBe(true);
    const replica: Replica = { id: SCATTER, value: String(value), said: seen.announcements.map((a) => a.text) };
    expect(replica.said.length, `the replica announces the walk's landings: ${show(seen.announcements)}`).toBeGreaterThan(0);
    console.log(`${AC} the replica: value ${show(replica.value)}; ${replica.said.length} announcements: ${show(replica.said, 2000)}`);

    const before = screenNow();
    if (before) blocked(`before the window opened, ${before}`);
    const run = await readWindow(bin, ['live'], `${JSON.stringify(played())}\n`, SCATTER, { expect: replica.said.length, least: 45, most: 240, quiet: 20 });
    const after = screenNow();
    if (after) blocked(`after the read, ${after}`);

    const code = String(run.answer?.['code'] ?? '');
    if (NO_WINDOW.includes(code)) blocked(`deep-show live could open no window here (${code})`);
    expect(run.answer?.['ok'], `deep-show live answers the same calls ok and opens its window: ${show(run.answer)}; ${run.ended ?? 'still running'}; stderr ${run.stderr.slice(-1500)}`).toBe(true);
    if (!run.live) return expect.fail(`deep-show live answered ok and ended (${run.ended}) before AppKit listed a window; stderr ${run.stderr.slice(-1500)}`);
    console.log(`${AC} the window: ${show(run.live, 4000)}`);
    const judged = judge(replica, run.live, IDS);
    if (judged.verdict === 'BLOCKED') blocked(judged.why.join('; '));
    expect(judged.why, `the live window against the replica:\n  ${judged.why.join('\n  ')}`).toEqual([]);
  }, 7_200_000);
});
