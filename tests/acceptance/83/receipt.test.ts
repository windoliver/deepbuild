// AC7 #83.28c3309c: each ask the receipt shows, its queue included, carries its PR or MR state (open, checks
// running, merged, and released once a release is recorded) and its link.
// AC8 #83.89bfa3a4: the receipt links what the ask produced: the PR or MR, the files it wrote, and the pages or
// deploys the record saw.
// AC9 #83.e8038389: when an ask passes, the receipt names the next unblocked issue in its epic, by dependency order.
//
// The session works in a repo whose origin is on the forge stand-in (README: The forge), opens its PR with `gh pr
// create` through its hooks (the design: that stop is delivery, and the chat line carries the link), and claims. The
// receipt is `changes.read` for the claim (README: Defined here, the receipt).
import { afterAll, describe, expect, it } from 'vitest';
import {
  AC7, AC8, AC9, begin, claim, cleanup, edits, headOf, hubWithSetup, issueBody, issueUrl, makeHome, newSession, plant, prUrl, receipt, receiptShown, req, startForge, stop, waitFor,
  type Claimed, type Claude, type Forge, type ForgeSpec, type Hub, type Home, type Receipt, type Session,
} from './helpers.ts';

afterAll(cleanup, 60_000);

const OWNER = 'acme';
const REPO_NAME = 'widgets';
const REMOTE = `https://github.com/${OWNER}/${REPO_NAME}.git`;
const ISSUE = 41;
const PR = 7;

/** The forge: PR #7 for issue #41, open with its checks running; issues #41, #42 (depends on #41), #43 (depends on #99, open) in epic #3. */
function spec(headSha: string): ForgeSpec {
  return {
    owner: OWNER, repo: REPO_NAME,
    pulls: [{ number: PR, state: 'open', merged: false, head_sha: headSha, body: `Fix the cart total.\n\nCloses #${ISSUE}`, checks: 'running' }],
    issues: [
      { number: 3, title: 'Epic: the cart', state: 'open', body: 'The epic.' },
      { number: ISSUE, title: 'Cart total', state: 'open', body: issueBody(3, []) },
      { number: 42, title: 'Cart receipt', state: 'open', body: issueBody(3, [ISSUE]) },
      { number: 43, title: 'Cart export', state: 'open', body: issueBody(3, [99]) },
      { number: 99, title: 'Export format', state: 'open', body: issueBody(5, []) },
    ],
    releases: [],
  };
}

interface Opened { h: Home; hub: Hub; forge: Forge; s: Session; claude: Claude; c: Claimed }
/** A session that edited total.ts, opened PR #7 and claimed, its stop judged. */
async function opened(): Promise<Opened> {
  const h = makeHome();
  const s = newSession(h, { remote: REMOTE });
  const forge = await startForge(spec(headOf(h, s.cwd)));
  const hub = await hubWithSetup(h, { forge: forge.url });
  const claude = await begin(h, s, `Fix the cart total (#${ISSUE}) and open the PR.`);
  await edits(claude, s);
  const url = prUrl(forge.spec, PR);
  await claude.tool(s, 'Bash', { command: `gh pr create --title "Fix the cart total" --body "Closes #${ISSUE}"` }, { stdout: `${url}\n`, stderr: '', interrupted: false, isImage: false });
  const c = await claim(claude, s);
  await stop(claude, s, `Opened ${url}.`);
  return { h, hub, forge, s, claude, c };
}
const prOf = (r: Receipt) => (r.asks ?? []).map((a) => a.pr).find((p) => p !== null && p !== undefined) ?? null;
/** The receipt once its PR state reads `state`, within 15 s (the forge is read on each read of the receipt). */
const stateOf = (hub: Hub, c: Claimed, state: string) => waitFor(async () => { const r = await receipt(hub, c); return prOf(r)?.state === state ? r : undefined; }, 15_000, `the receipt's PR state reading ${state}`, 500);

describe(`${AC7} Each ask the receipt shows carries its PR state (open, checks running, merged, released) and its link`, () => {
  it(`${AC7} the receipt's ask carries PR #${PR}'s link and its state as the forge shows it: checks running, then open, then merged, then released once a release is recorded`, async () => {
    const { hub, forge, c, claude } = await opened();
    const first = await receipt(hub, c);
    expect(first.asks?.length ?? 0, `the receipt shows the claim's ask: ${receiptShown(first)}`).toBeGreaterThan(0);
    const pr = prOf(first);
    expect(pr, `the ask carries its PR: ${receiptShown(first)}`).not.toBeNull();
    expect(pr!.url, 'with its link').toBe(prUrl(forge.spec, PR));
    expect(pr!.state, `its checks are running on the forge: ${receiptShown(first)}`).toBe('checks running');
    forge.spec.pulls[0]!.checks = 'done';
    expect(prOf(await stateOf(hub, c, 'open'))!.state, 'checks done, still open: open').toBe('open');
    Object.assign(forge.spec.pulls[0]!, { state: 'closed', merged: true, merge_sha: 'b'.repeat(40) });
    expect(prOf(await stateOf(hub, c, 'merged'))!.state, 'merged on the forge: merged').toBe('merged');
    forge.spec.releases.push({ tag: 'v1.2.0', sha: 'b'.repeat(40) });
    expect(prOf(await stateOf(hub, c, 'released'))!.state, 'a release recorded with the merge: released').toBe('released');
    for (const a of (await receipt(hub, c)).asks ?? []) if (a.pr) expect(a.pr.url, 'every ask with a PR carries its link').toMatch(/^https:\/\/github\.com\//);
    await claude.end();
  }, 240_000);
});

describe(`${AC8} The receipt links what the ask produced: the PR, the files it wrote, and the pages or deploys the record saw`, () => {
  it(`${AC8} the receipt's produced block links PR #${PR} and lists total.ts, the file the session wrote`, async () => {
    const { hub, forge, c, claude } = await opened();
    const r = await receipt(hub, c);
    expect(r.produced, `the receipt has what the ask produced: ${receiptShown(r)}`).toBeDefined();
    expect(r.produced?.pr, 'it links the PR').toBe(prUrl(forge.spec, PR));
    expect((r.produced?.files ?? []).some((f) => f === 'total.ts' || f.endsWith('/total.ts')), `it lists the file the session wrote, total.ts: ${receiptShown(r)}`).toBe(true);
    expect(Array.isArray(r.produced?.pages), 'it has a place for the pages or deploys the record saw (none here; README: Open questions)').toBe(true);
    await claude.end();
  }, 240_000);
});

describe(`${AC9} When an ask passes, the receipt names the next unblocked issue in its epic, by dependency order`, () => {
  it(`${AC9} before a PASS the receipt names no next issue; once the claim's verdict is PASS it names #42, the issue in epic #3 that #${ISSUE} unblocks, not #43 (blocked by #99) nor #99 (another epic)`, async () => {
    const { hub, forge, s, c, claude } = await opened();
    const before = await receipt(hub, c);
    expect(before.next_issue ?? null, `no PASS yet, so no next issue: ${receiptShown(before)}`).toBeNull();
    await plant(hub, { session: s.id, claim: c.claim, outcome: 'PASS', requirements: [req(1, 'PASS'), req(2, 'PASS', 'journey:checkout')], ran: [{ check: 'unit', outcome: 'passed' }, { check: 'journey:checkout', outcome: 'passed' }] });
    const after = await waitFor(async () => { const r = await receipt(hub, c); return r.next_issue ? r : undefined; }, 15_000, 'the receipt naming the next issue', 500).catch(async () => receipt(hub, c));
    expect(after.next_issue, `the receipt names the next unblocked issue in the epic: ${receiptShown(after)}`).not.toBeNull();
    expect(after.next_issue?.number, 'it is #42, which depended only on the issue that passed').toBe(42);
    expect(after.next_issue?.url, 'with its link').toBe(issueUrl(forge.spec, 42));
    await claude.end();
  }, 240_000);

  it(`${AC9} (wrong program) a receipt that names the lowest open issue of the epic regardless of dependencies would name #42 here too, so the order is tested where they differ: with #42 depending on #43 as well, the next unblocked issue is none of them`, async () => {
    const { hub, forge, s, c, claude } = await opened();
    forge.spec.issues.find((i) => i.number === 42)!.body = issueBody(3, [ISSUE, 43]);
    await plant(hub, { session: s.id, claim: c.claim, outcome: 'PASS', requirements: [req(1, 'PASS')], ran: [{ check: 'unit', outcome: 'passed' }] });
    const r = await receipt(hub, c);
    expect(r.next_issue ?? null, `#42 waits on #43, #43 on #99, #99 is another epic's: nothing in epic #3 is unblocked, so the receipt names none: ${receiptShown(r)}`).toBeNull();
    await claude.end();
  }, 240_000);
});
