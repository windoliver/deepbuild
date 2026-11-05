// AC5: two sessions on the same issue produce exactly one "keep which?" ask, except a lead's own child sessions and
// races you started. A session's issue is read from its branch (README SURFACE: `issue-<n>`); a lead's child session
// is one whose agent process the lead's own agent process started (the base records it as session.child_started); a
// race is one you start from your terminal with `deep race <issue>` (README SURFACE).
import { afterAll, describe, it } from 'vitest';
import {
  AC5, ClaudeSession, CodexSession, allEvents, asksRaised, cleanup, deep, lastPos, lettersOf, listed, makeWorld, must, names,
  settle, shown, sleep, startHub, trust, worktree, type Ev, type Hub, type Session,
} from './helpers.ts';

afterAll(cleanup, 60_000);

/** An ask that reads as "keep which?" between the two sessions: its question or options say keep, or it names both. */
const keepAsks = (events: readonly Ev[], since: number, x: Session, y: Session): Ev[] =>
  asksRaised(events, since).filter((e) => { const t = JSON.stringify(e.data); return /\bkeep\b/i.test(`${String(e.data.question)} ${JSON.stringify(e.data.options ?? [])}`) || (names(t, x.id) && names(t, y.id)); });

/** Each session starts, takes a prompt and reads; then, once the hub has had time, each works on: two more calls and a stop. */
async function work(sessions: Session[], hub: Hub, since: number, x: Session, y: Session): Promise<Ev[]> {
  for (const s of sessions) {
    await s.start();
    await s.typed('Make the cart total round each line to cents.');
    if (s instanceof ClaudeSession) await s.read('src/cart.js'); else await s.bash('cat src/cart.js', { stdout: 'module.exports = {};' });
  }
  await settle(hub, (all) => keepAsks(all, since, x, y).length > 0, 30_000);
  for (const s of sessions) {
    if (s instanceof ClaudeSession) { await s.read('package.json'); await s.bash('node --test tests/unit.test.js'); } else { await s.bash('cat package.json'); await s.bash('node --test tests/unit.test.js'); }
    await s.stop('Still working.');
  }
  await sleep(10_000);
  return allEvents(hub);
}

describe(`${AC5} two sessions on one issue make exactly one "keep which?" ask`, () => {
  it(`${AC5} a Claude Code session on claude/issue-77-cart and a Codex session on codex/issue-77-total make exactly one "keep which?" ask, naming both and #77`, async () => {
    const w = makeWorld();
    const wa = worktree(w, 'wa', 'claude/issue-77-cart');
    const wb = worktree(w, 'wb', 'codex/issue-77-total');
    await trust(w, [wa, wb]);
    const hub = await startHub(w);
    const since = await lastPos(hub);
    const a = ClaudeSession.open(w, wa);
    const b = CodexSession.open(w, wb);
    const events = await work([a, b], hub, since, a, b);
    const asks = keepAsks(events, since, a, b);
    must(asks.length === 1, `${AC5} sessions ${a.id} and ${b.id} are both on issue #77, so exactly one "keep which?" ask must be raised: ${asks.length} were: ${listed(asks)}`);
    const t = JSON.stringify(asks[0]!.data);
    must(names(t, a.id) && names(t, b.id), `${AC5} the ask must name both sessions, ${a.id} and ${b.id}: ${listed(asks)}`);
    must(/#?77\b/.test(t), `${AC5} the ask must name issue #77: ${listed(asks)}`);
    must(Array.isArray(asks[0]!.data.options) && asks[0]!.data.options.length >= 2, `${AC5} the ask must let you keep either session: its options are ${JSON.stringify(asks[0]!.data.options)}`);
  }, 600_000);

  it(`${AC5} a lead on claude/issue-78-lead and the child session its own process started on claude/issue-78-part make no "keep which?" ask`, async () => {
    const w = makeWorld();
    const wl = worktree(w, 'wl', 'claude/issue-78-lead');
    const wc = worktree(w, 'wc', 'claude/issue-78-part');
    await trust(w, [wl, wc]);
    const hub = await startHub(w);
    const since = await lastPos(hub);
    const lead = ClaudeSession.open(w, wl);
    const child = await lead.child(wc);
    const events = await work([lead, child], hub, since, lead, child);
    const linked = events.find((e) => e.kind === 'session.child_started' && e.data.parent === `session:${lettersOf(lead.id)}` && e.data.child === `session:${lettersOf(child.id)}`);
    must(linked !== undefined, `BLOCKED: ${AC5} the hub must link session ${child.id} as the child of ${lead.id}, whose process started it: ${listed(events.filter((e) => e.kind === 'session.child_started'))}`);
    const asks = keepAsks(events, since, lead, child);
    must(asks.length === 0, `${AC5} session ${child.id} is lead ${lead.id}'s own child session, so no "keep which?" ask may be raised for issue #78: ${listed(asks)}`);
  }, 600_000);

  it(`${AC5} two sessions on issue #79 after you start a race on it (\`deep race 79\`) make no "keep which?" ask`, async () => {
    const w = makeWorld();
    const wa = worktree(w, 'wa', 'claude/issue-79-a');
    const wb = worktree(w, 'wb', 'codex/issue-79-b');
    await trust(w, [wa, wb]);
    const hub = await startHub(w);
    const raced = await deep(w, ['race', '79']);
    must(raced.code === 0, `BLOCKED: ${AC5} \`deep race 79\` from your terminal must start a race on issue #79: ${shown(raced)}`);
    const since = await lastPos(hub);
    const a = ClaudeSession.open(w, wa);
    const b = CodexSession.open(w, wb);
    const events = await work([a, b], hub, since, a, b);
    const asks = keepAsks(events, since, a, b);
    must(asks.length === 0, `${AC5} you started a race on issue #79, so sessions ${a.id} and ${b.id} race and no "keep which?" ask may be raised: ${listed(asks)}`);
  }, 600_000);
});
