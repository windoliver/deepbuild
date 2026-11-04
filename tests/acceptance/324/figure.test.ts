// #324 AC5: a figure claim asked to relabel one axis, whose patches also recolor the series and move the legend,
// lists the series and the legend by ID as outside the plan, sends them back once, and then brings them to you as one
// taste call; the relabeled axis is never listed, and the verdict is never FAIL for them alone (design: Size and
// scope, "For a document, the reading lists by stable ID what its patches added, changed or removed that neither the
// brief, the plan nor a requirement's check names … and those go back once and then to you the same way"; Checks for
// work beyond code, Stable names; Patch; Provenance).
//
// The figure is a canvas document the hub minted (DEEP_HUB_TEST_SHOW). Before the task, the session draws it as it
// stands with its own `deep show` (a command its Bash tool runs, so the hub stamps the session's writer, #806, and the
// items are in the session's own layer, which a later revision may change): a title, the x axis, the y axis labelled
// "Revenue", two series (series-revenue, series-cost, both muted) and a legend at the top. The task you then type asks
// to relabel the y axis to "Revenue (USD)"; its definition's one requirement names the y axis, and its plan's scope
// names the one part, the item axis-y. In the task the agent draws the next revision the same way: the y axis
// relabeled, both series recolored (accent) and the legend moved to the bottom. Nothing else changes. The repo's code
// is already fixed at its base (`fixed`), so its spec's unit check passes and no code changes.
//
// Stop 1: the claim's record lists series-revenue, series-cost and legend by ID together, in a list without axis-y,
// and the stop is sent back naming the three. Stop 2, after the agent says why, is not sent back for them again; one
// taste call reaches you naming series-revenue and legend and never axis-y. Stop 3 raises no second one. No verdict
// on the task's claims is FAIL.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import {
  AC5, CLI, KIND, NODE, claimRecord, claimsOf, cleanup, decision, lastPos, listed, listsNaming, lockedTask, makeWorld, must, plan, replyText, req, said, Session, setShow,
  settle, shown, startHub, taskVerdicts, tasteCalls, trustRepo, type Draft, type Line,
} from './helpers.ts';

afterEach(cleanup, 60_000);

/** The document's ID, as the hub minted it (a ULID). */
const DOC = '01JB7D0000000000000000324F';
const ASK = 'relabel the y axis of the revenue figure to Revenue (USD)';
const OUTSIDE = ['series-revenue', 'series-cost', 'legend'] as const;
const AXIS = 'axis-y';

const rect = (id: string, name: string, box: number[], order: string, role: string): Line => ({ id, kind: 'rect@1', name, order, params: { box, paint: { fill: { role } } } });
const label = (id: string, name: string, text: string, pos: [number, number], order: string): Line =>
  ({ id, kind: 'text@1', name, order, params: { text, font: 'body', size: 13, box: { w: 160, h: 20 } }, at: { pos: [pos[0], pos[1], 0] } });
/** The figure at a revision: the y axis's words, the series' paint role and where the legend sits. */
const figure = (yAxis: string, seriesRole: string, legendAt: [number, number]): Line => ({
  format: 1, profile: 'board', title: 'Revenue by quarter', description: 'Revenue and cost by quarter.', size: [320, 200],
  items: Object.fromEntries([
    rect('back', 'Backdrop', [0, 0, 320, 200], 'a0', 'ground'),
    label('title', 'Title', 'Revenue by quarter', [16, 8], 'a1'),
    label('axis-x', 'X axis', 'Quarter', [120, 182], 'a2'),
    label(AXIS, 'Y axis', yAxis, [4, 90], 'a3'),
    rect('series-revenue', 'Revenue series', [60, 60, 40, 110], 'a4', seriesRole),
    rect('series-cost', 'Cost series', [120, 100, 40, 70], 'a5', seriesRole),
    label('legend', 'Legend', 'Revenue, Cost', legendAt, 'a6'),
  ].map((i) => [String(i.id), i])),
});
const REV0 = figure('Revenue', 'muted', [200, 30]);
const REV1 = figure('Revenue (USD)', 'accent', [200, 160]);

/** The agent's Bash call that runs its own `deep show` of `document`, a child of its process; BLOCKED unless presented. */
async function draw(s: Session, tmp: string, document: Line, what: string): Promise<void> {
  const file = join(tmp, `figure-${Date.now()}.json`);
  writeFileSync(file, `${JSON.stringify(document)}\n`);
  let drawn: Awaited<ReturnType<typeof s.exec>> | undefined;
  const call = await s.bash(`deep show --doc ${DOC} --document ${file} --json`, async () => {
    drawn = await s.exec(NODE, [CLI, 'show', '--doc', DOC, '--document', file, '--json']);
    return { stdout: drawn.stdout, stderr: drawn.stderr, interrupted: false, isImage: false };
  });
  must(call.allowed, `BLOCKED: ${AC5} the agent's deep show of ${what} must be allowed: ${shown(call.before)}`);
  must(drawn !== undefined && drawn.code === 0, `BLOCKED: ${AC5} the agent's deep show must present ${what}: ${drawn ? shown(drawn) : 'it never ran'}`);
}

const DRAFT: Draft = {
  ask: ASK, kind: KIND, plan: plan({ parts: [AXIS] }), deliverables: [], budget: null,
  requirements: [req('R1', 'The revenue figure\'s y axis (axis-y) reads "Revenue (USD)"', { depth: 'unit' })],
};

describe(`${AC5} a figure claim's extra changes are listed by ID, sent back once, then one taste call; the asked-for axis never listed`, () => {
  it(`${AC5} relabeling ${AXIS} while recoloring both series and moving the legend: ${OUTSIDE.join(', ')} listed and sent back at stop 1, one taste call at stop 2, ${AXIS} never listed, no FAIL`, async () => {
    const show = { panels: { main: { rect: [0, 0, 800, 600] } }, docs: { [DOC]: { panel: 'main' } } };
    const w = makeWorld({ drafts: [DRAFT], show, fixed: true });
    await trustRepo(w);
    const hub = await startHub(w);
    const s = new Session(w);
    setShow(w, { ...show, names: { [s.id]: 'Claude Code: revenue figure' } });
    await s.start();
    // The figure as it stands, drawn by this session before the task (so its items are in the session's own layer).
    await draw(s, w.tmp, REV0, 'the figure as it stands');
    await s.typed(ASK);
    const ref = await lockedTask(hub, s, ASK, AC5);
    const since = await lastPos(hub);

    // The agent draws the changed figure with its own deep show.
    await draw(s, w.tmp, REV1, 'the changed figure');
    let events = await settle(hub, (all) => all.some((e) => e.kind === 'doc.patched' && e.log_pos > since), 30_000);
    must(events.some((e) => e.kind === 'doc.patched' && e.log_pos > since && e.data.writer === 'agent'), `BLOCKED: ${AC5} the changed figure must be recorded as the agent's patch: ${listed(events.filter((e) => e.kind === 'doc.patched'))}`);

    const stop1 = await s.stop('The y axis now reads Revenue (USD); I also recolored the series and moved the legend to the bottom.');
    events = await settle(hub, (all) => claimsOf(all, ref, since).length > 0 && all.some((e) => e.kind === 'verdict.made' && e.log_pos > since), 60_000);
    must(claimsOf(events, ref, since).length > 0, `BLOCKED: ${AC5} the stop must make a claim for ${ref}: none after it`);
    const record = claimRecord(events, ref, since);
    const lists = listsNaming(record.map((e) => e.data), 'series-revenue');
    const byId = lists.filter((l) => OUTSIDE.every((id) => l.some((x) => x.includes(id))) && !l.some((x) => x.includes(AXIS)));
    must(byId.length > 0, `${AC5} the claim must list ${OUTSIDE.join(', ')} by ID as outside the plan, together and without ${AXIS}; lists naming series-revenue: ${JSON.stringify(lists).slice(0, 600)}; the claim's record is ${listed(record)}`);
    const reply1 = replyText(stop1);
    must(decision(stop1) === 'deny' && OUTSIDE.every((id) => reply1.includes(id)), `${AC5} the stop is sent back once naming ${OUTSIDE.join(', ')}: ${decision(stop1) === 'deny' ? 'sent back' : 'let through'} with ${reply1.slice(0, 500) || 'no reason'}`);

    const at2 = await lastPos(hub);
    const stop2 = await s.stop('The new colors and the legend at the bottom make the relabeled axis easier to read.');
    events = await settle(hub, (all) => tasteCalls(all, since).length > 0, 60_000);
    must(!(decision(stop2) === 'deny' && OUTSIDE.some((id) => replyText(stop2).includes(id))), `${AC5} the series and legend are sent back once; stop 2 was sent back for them again: ${replyText(stop2).slice(0, 500)}`);
    let taste = tasteCalls(events, since);
    must(taste.length === 1, `${AC5} still there after the send-back, they come to you as one taste call: ${taste.length} (${listed(events.filter((e) => e.kind === 'ask.created' && e.log_pos > at2))})`);
    const text = JSON.stringify(taste[0]!.data);
    must(text.includes('series-revenue') && text.includes('legend'), `${AC5} the taste call names the series and the legend by ID: ${said(taste[0])}`);
    must(!text.includes(AXIS), `${AC5} the relabeled axis is never listed, and the taste call names ${AXIS}: ${said(taste[0])}`);

    const at3 = await lastPos(hub);
    const stop3 = await s.stop('Waiting on your call about the colors and the legend.');
    events = await settle(hub, (all) => all.some((e) => e.kind === 'agent.stop' && e.log_pos > at3), 30_000);
    events = await settle(hub, () => false, 3_000);
    must(!(decision(stop3) === 'deny' && OUTSIDE.some((id) => replyText(stop3).includes(id))), `${AC5} sent back once; stop 3 was sent back for them again: ${replyText(stop3).slice(0, 500)}`);
    taste = tasteCalls(events, since);
    must(taste.length === 1, `${AC5} one taste call, never the same question twice: ${taste.length} after stop 3 (${listed(taste)})`);
    const fail = taskVerdicts(events, ref, since).filter((v) => v.data.outcome === 'FAIL');
    must(fail.length === 0, `${AC5} the extra changes never turn the verdict to FAIL: ${listed(fail)}`);
  }, 480_000);
});
