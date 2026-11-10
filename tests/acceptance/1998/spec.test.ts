// AC3 #1998.376621f1 A proposed change to a repo's spec, approved after that spec's file changed at the branch head,
// applies nothing and comes back redrafted on the new revision, naming the commit that moved it; two proposals drafted
// on one revision and approved in turn leave the second refused, naming the first.
//
// One home, set up by `deep setup`, holds two repos, `shop` and `cart`, each with `.deepbuild/done.yaml` committed on
// main: lint, typecheck and unit, all three in the `done` claim.
// - Moved at the head: "stop checking lint in shop" goes to the box; then a commit on shop's main adds an e2e check to
//   the spec. You approve the proposal. Nothing is applied (the spec in the checkout is that commit's, the head is that
//   commit), and a new open ask comes back (raised once the proposal was drafted) whose question names that commit by its SHA (at least its first 7 hex
//   digits). Approving that redraft leaves lint out of every claim's checks, and keeps the commit's e2e check, typecheck
//   and unit: it was drafted on the new revision.
// - Two on one revision: "stop checking lint in cart" and "stop checking typecheck in cart" go to the box, both before
//   either is approved. You approve the first: lint leaves cart's claims (the control). You approve the second: it
//   applies nothing (typecheck is still checked) and the refusal names the first by its ask handle, in what
//   `deep inbox answer` printed or in the question of an ask raised since the two were drafted.
// The wrong programs: the base, which has no box; and DEEP_HUB_PLANT=box-ignores-revision, a box that applies what it
// drafted whatever moved since (README, Pinned 7).

import { readFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { answer, cleanup, ID, inbox, isOpen, makeHome, makeRepo, say, setup, shown, sleep, waitFor, type Home, type Line, type Ran, type Repo } from './helpers.ts';

afterAll(cleanup, 60_000);

const SPEC = `claims:
  done:
    checks: [lint, typecheck, unit]
checks:
  lint:      { type: command, run: "npm run lint" }
  typecheck: { type: command, run: "npm run typecheck" }
  unit:      { type: command, run: "npm test", min_tests: 1 }
`;
/** The commit that moves shop's spec at the head: an e2e check, in the done claim. */
const MOVED = `claims:
  done:
    checks: [lint, typecheck, unit, e2e]
checks:
  lint:      { type: command, run: "npm run lint" }
  typecheck: { type: command, run: "npm run typecheck" }
  unit:      { type: command, run: "npm test", min_tests: 1 }
  e2e:       { type: command, run: "npm run e2e" }
`;

/** Every check any claim of a done.yaml names; null when the text isn't a spec. */
function claimed(text: string | null): Set<string> | null {
  if (text === null) return null;
  let doc: Line;
  try { doc = parse(text) as Line; } catch { return null; }
  const claims = doc && typeof doc === 'object' ? (doc.claims as Line | undefined) : undefined;
  if (!claims || typeof claims !== 'object') return null;
  return new Set(Object.values(claims).flatMap((c: Line) => (Array.isArray(c?.checks) ? c.checks.map(String) : [])));
}

interface Moved {
  ask: string; commit: string; answered: Ran;
  /** shop's head and spec once the approval was handled. */
  head: string; spec: string | null;
  /** The open asks raised since the proposal was drafted, with their questions; the redraft is the one naming the commit. */
  raised: { ask: string; question: string }[];
  /** The spec once the redraft, if there was one, was approved. */
  redrafted: string | null;
}
interface Two {
  first: string; second: string; afterFirst: string | null; answered: Ran;
  afterSecond: string | null; raised: { ask: string; question: string }[];
}
interface SpecRun { moved: Moved; two: Two }

/** What the criterion says is wrong, one line each; none when it holds. */
function specProblems(r: SpecRun): string[] {
  const out: string[] = [];
  const m = r.moved;
  const prefix = m.commit.slice(0, 7);
  if (m.head !== m.commit) out.push(`AC3 approving the stale proposal ${m.ask} moved shop's head from ${m.commit} to ${m.head}; it must apply nothing`);
  if (m.spec !== MOVED) out.push(`AC3 approving ${m.ask} after commit ${prefix} changed shop's spec must apply nothing, yet the spec is now ${JSON.stringify(m.spec)}`);
  const redraft = m.raised.find((a) => a.question.includes(prefix));
  if (!redraft) out.push(`AC3 approving ${m.ask} after commit ${prefix} changed shop's spec must come back redrafted, naming that commit; the asks raised after it: ${JSON.stringify(m.raised).slice(0, 1200)}`);
  else {
    const checks = claimed(m.redrafted);
    if (!checks || checks.has('lint') || !['typecheck', 'unit', 'e2e'].every((c) => checks.has(c))) {
      out.push(`AC3 the redraft ${redraft.ask} must be drafted on the new revision (${prefix}): approved, shop's claims must check typecheck, unit and e2e and no longer lint, but the spec is ${JSON.stringify(m.redrafted)}`);
    }
  }
  const t = r.two;
  const first = claimed(t.afterFirst);
  if (!first || first.has('lint')) out.push(`AC3 approving the first proposal ${t.first} ("stop checking lint in cart") must apply it (the control); cart's spec is ${JSON.stringify(t.afterFirst)}`);
  const second = claimed(t.afterSecond);
  if (!second || !second.has('typecheck') || t.afterSecond !== t.afterFirst) out.push(`AC3 the second proposal ${t.second}, drafted on the same revision as ${t.first} and approved after it, must be refused and apply nothing; cart's spec went from ${JSON.stringify(t.afterFirst)} to ${JSON.stringify(t.afterSecond)}`);
  const said = `${t.answered.stdout}\n${t.answered.stderr}\n${t.raised.map((a) => a.question).join('\n')}`;
  if (!said.includes(t.first)) out.push(`AC3 the refusal of ${t.second} must name the first proposal, ${t.first}; deep inbox answer said ${JSON.stringify(`${t.answered.stdout}${t.answered.stderr}`.slice(0, 600))} and the asks raised after it ${JSON.stringify(t.raised).slice(0, 600)}`);
  return out;
}

const read = (repo: Repo): string | null => { try { return readFileSync(repo.spec, 'utf8'); } catch { return null; } };
/** Open asks the hub holds now that `known` didn't. */
async function raisedSince(h: Home, known: Set<string>): Promise<{ ask: string; question: string }[]> {
  return (await inbox(h)).filter((row) => isOpen(row) && !known.has(row.ask)).map((row) => ({ ask: row.ask, question: row.question }));
}
const asksNow = async (h: Home): Promise<Set<string>> => new Set((await inbox(h)).map((row) => row.ask));

async function specRun(plant?: string): Promise<SpecRun> {
  const h = makeHome();
  const shop = makeRepo(h, 'shop', SPEC);
  const cart = makeRepo(h, 'cart', SPEC);
  await setup(h, plant);

  // Moved at the head.
  // Asks raised from here on count, P1's own aside, whether the hub redrafts when the head moves or when you approve.
  const ask = await say(h, 'stop checking lint in shop', shop.dir);
  let known = await asksNow(h);
  const commit = shop.commit(MOVED, 'Add an e2e check to the spec');
  const answered = await answer(h, ask);
  await waitFor(async () => { const r = await raisedSince(h, known); return r.length ? r : undefined; }, 30_000);
  await sleep(3000);
  const moved: Moved = { ask, commit, answered, head: shop.head(), spec: read(shop), raised: await raisedSince(h, known), redrafted: null };
  const redraft = moved.raised.find((a) => a.question.includes(commit.slice(0, 7)));
  if (redraft) {
    await answer(h, redraft.ask);
    moved.redrafted = (await waitFor(() => { const s = read(shop); return s !== MOVED ? s : undefined; }, 30_000)) ?? read(shop);
  }

  // Two on one revision.
  const first = await say(h, 'stop checking lint in cart', cart.dir);
  const second = await say(h, 'stop checking typecheck in cart', cart.dir);
  known = await asksNow(h);
  await answer(h, first);
  const afterFirst = (await waitFor(() => { const s = read(cart); return s !== SPEC ? s : undefined; }, 30_000)) ?? read(cart);
  const secondAnswered = await answer(h, second);
  await waitFor(async () => { const r = await raisedSince(h, known); return r.length ? r : undefined; }, 10_000);
  await sleep(3000);
  const two: Two = { first, second, afterFirst, answered: secondAnswered, afterSecond: read(cart), raised: await raisedSince(h, known) };
  return { moved, two };
}

describe(`${ID.ac3} A proposed change to a repo's spec, approved after that spec's file changed at the branch head, applies nothing and comes back redrafted on the new revision, naming the commit that moved it; two proposals drafted on one revision and approved in turn leave the second refused, naming the first`, () => {
  it(`${ID.ac3} a stale approval applies nothing and its redraft names the moving commit and applies on it; of two proposals on one revision, the second is refused naming the first`, async () => {
    const r = await specRun();
    expect(specProblems(r), `the stale approval: ${shown(r.moved.answered)}; the second approval: ${shown(r.two.answered)}`).toEqual([]);
  }, 600_000);

  it(`${ID.ac3} (wrong program) a box that applies what it drafted whatever moved since (box-ignores-revision) fails, naming both stale approvals`, async () => {
    const problems = specProblems(await specRun('box-ignores-revision'));
    expect(problems.some((p) => /must apply nothing/.test(p) && /after commit [0-9a-f]{7} changed shop's spec|moved shop's head/.test(p)), JSON.stringify(problems)).toBe(true);
    expect(problems.some((p) => /the second proposal ask:\S+, drafted on the same revision/.test(p)), JSON.stringify(problems)).toBe(true);
  }, 600_000);
});
