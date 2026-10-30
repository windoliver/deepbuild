// #356.e1fe5789 ten new sessions appended after setup are read from each source's read position, with no older message
// read again; a contradicted claim reads superseded, with both quotes kept.
import { afterAll, describe, expect, it } from 'vitest';
import { msg, sessionId, tagOf, writeSession, type Sess } from './history.ts';
import { claimsQuoting, cleanup, control, onMac, setupWithWindows, shown, world, type World } from './helpers.ts';

afterAll(cleanup);
const NEW_FACT = 'api starts with `make dev`, not `npm run dev` any more';

/** What the fake agent was sent and read in the runner jobs that started after `before`. */
async function deliveredSince(w: World, before: Set<string>): Promise<string> {
  return control(w.h.home, async (c) => {
    let t = '';
    for (const j of (await c.call('job.list')).jobs as { job: string }[]) if (!before.has(j.job)) t += String((await c.call('job.output', { job: j.job })).stdout ?? '');
    return t;
  });
}
const jobIds = (w: World): Promise<Set<string>> => control(w.h.home, async (c) => new Set(((await c.call('job.list')).jobs as { job: string }[]).map((j) => j.job)));

function tenNew(w: World, firstId: number): Sess[] {
  const repos = [w.fx.repos.api, w.fx.repos.web, w.fx.repos.shopNew];
  return Array.from({ length: 10 }, (_, i) => {
    const agent: Sess['agent'] = i < 7 ? 'claude' : 'codex';
    const fact = i === 0 ? NEW_FACT : `new note ${i} for ${agent}`;
    return { agent, id: sessionId(firstId + i), cwd: repos[i % 3]!, day: 10 + i, messages: [msg('user', `remember: ${fact}.`), msg('assistant', `Noted ${i}.`)] };
  });
}

async function scenario(env?: Record<string, string>): Promise<string[]> {
  onMac();
  const w = world();
  const first = await setupWithWindows(w, { env });
  expect(first.run.code, `deep setup exits 0: ${shown(first.run)}`).toBe(0);
  const oldTags = w.fx.sessions.flatMap((s) => s.messages.map(tagOf));
  const p: string[] = [];
  const firstText = await deliveredSince(w, new Set());
  for (const t of oldTags.filter((_, i) => i % 3 === 0)) if (!firstText.includes(t)) p.push(`the first setup never read ${t} (the check would be vacuous)`);
  const old = await jobIds(w);
  const fresh = tenNew(w, 100);
  for (const s of fresh) writeSession(w.h.home, s);
  const second = await setupWithWindows(w, { env });
  expect(second.run.code, `the second deep setup exits 0: ${shown(second.run)}`).toBe(0);
  const text = await deliveredSince(w, old);
  for (const t of oldTags) if (text.includes(t)) p.push(`an older message ${t} was read again`);
  for (const s of fresh) for (const m of s.messages.filter((x) => x.role === 'user')) if (!text.includes(tagOf(m))) p.push(`new message ${tagOf(m)} was never read`);
  // The contradicted claim: still on its page, reads superseded, both quotes kept; the new claim is not superseded.
  const oldClaim = claimsQuoting(w.wiki, w.fx.facts.apiStart!.fact)[0];
  const newClaim = claimsQuoting(w.wiki, NEW_FACT)[0];
  if (!oldClaim) p.push('the contradicted claim was deleted, not marked superseded');
  else {
    const shownLine = `${oldClaim.line}`;
    if (!/superseded/i.test(shownLine)) p.push(`the old claim doesn't read superseded: ${shownLine.slice(0, 160)}`);
    if (!shownLine.includes(w.fx.facts.apiStart!.fact)) p.push("the old claim's quote is gone");
    if (!shownLine.includes(NEW_FACT)) p.push("the new claim's quote isn't kept with the superseded one");
  }
  if (!newClaim) p.push('no claim for the new start command');
  else if (/superseded/i.test(newClaim.line)) p.push('the new claim reads superseded');
  return p;
}

describe('#356.e1fe5789 read positions and superseded claims', () => {
  it('#356.e1fe5789 ten new sessions (7 Claude Code, 3 Codex) are read, no older message again; the contradicted claim reads superseded with both quotes', async () => {
    const problems = await scenario();
    expect(problems, problems.join('; ')).toEqual([]);
  }, 1_800_000);

  it('#356.e1fe5789 (wrong program) re-reading everything, or deleting the contradicted claim, is caught', async () => {
    for (const plant of ['rereads-all', 'deletes-contradicted']) {
      const problems = await scenario({ DEEP_HUB_PLANT: plant });
      expect(problems.length, `plant ${plant} is caught: ${problems.join('; ')}`).toBeGreaterThan(0);
    }
  }, 3_600_000);
});
