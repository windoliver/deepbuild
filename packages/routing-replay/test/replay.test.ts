// #1980: a routed ask stands only while its jobs fail. Once the recorded history shows every job it was raised for
// building again, the router withdraws it, so it never reaches its default; one whose jobs still fail at its 14-day
// deadline takes its default there. The report's count of asks that reached their fallback or default rests on this.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { openEvidenceStore } from '@deepbuild/evidence';
import { openRecord } from '@deepbuild/record';
import type { Event, RecordStore } from '@deepbuild/record';
import { replay, SNAPSHOT } from '../src/index.ts';

const WAIT = 14 * 86_400_000;
interface Failure { job: string; merge: { commit: string } | null }
interface Evaluation { id: number; at: number; failures: Failure[]; fixed: string[] }
const snapshot = JSON.parse(gunzipSync(readFileSync(new URL(`../snapshot/${SNAPSHOT}.json.gz`, import.meta.url))).toString('utf8')) as { evaluations: Evaluation[] };

/** Each merge's jobs, and whether the history shows them all building again within 14 days of the evaluation. */
function causes(): { commit: string; fixedInTime: boolean }[] {
  const out = [];
  for (const [i, ev] of snapshot.evaluations.entries()) {
    const byMerge = new Map<string, Set<string>>();
    for (const f of ev.failures) if (f.merge) (byMerge.get(f.merge.commit) ?? byMerge.set(f.merge.commit, new Set()).get(f.merge.commit)!).add(f.job);
    for (const [commit, jobs] of byMerge) {
      const left = new Set(jobs);
      for (const later of snapshot.evaluations.slice(i + 1)) {
        if (later.at >= ev.at + WAIT) break;
        for (const job of later.fixed) left.delete(job);
      }
      out.push({ commit, fixedInTime: left.size === 0 });
    }
  }
  return out;
}

let dir: string, record: RecordStore, events: Event[];
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'routing-replay-'));
  let now = 0;
  const clock = { now: () => now, set: (ms: number) => { now = ms; } };
  const evidence = await openEvidenceStore({ root: join(dir, 'evidence'), now: clock.now });
  record = await openRecord({ path: join(dir, 'record.db'), now: clock.now, evidence });
  await replay({ record, evidence, clock });
  events = [];
  for (let after = 0; ;) {
    const page = await record.read({ after, limit: 1000 });
    events.push(...page);
    if (page.length < 1000) break;
    after = page.at(-1)!.log_pos;
  }
}, 600_000);
afterAll(async () => { await record?.close(); rmSync(dir, { recursive: true, force: true }); });

const closeOf = (commit: string): { ask: Event; close: Event } => {
  const ask = events.find((e) => e.kind === 'ask.created' && (e.data as { pinned_to: { ref: string } }).pinned_to.ref === commit)!;
  const close = events.find((e) => e.subject === `ask:${ask.id}` && /^ask\.(defaulted|escalated|cancelled|answered|moot|superseded)$/.test(e.kind))!;
  return { ask, close };
};

it('an ask whose jobs all build again before its deadline is withdrawn; one whose jobs still fail takes its default at its deadline', () => {
  const all = causes();
  const fixed = all.filter((c) => c.fixedInTime);
  const failing = all.filter((c) => !c.fixedInTime);
  expect(fixed.length, 'the history holds merges whose jobs all built again within 14 days').toBeGreaterThan(0);
  expect(failing.length, 'and merges whose jobs did not').toBeGreaterThan(0);
  for (const { commit } of fixed) {
    const { ask, close } = closeOf(commit);
    expect(close.kind, `merge ${commit}: its jobs built again, so its ask is withdrawn`).toBe('ask.cancelled');
    expect(close.ts, `merge ${commit}: withdrawn before its deadline`).toBeLessThan(ask.ts + WAIT);
  }
  for (const { commit } of failing) {
    const { ask, close } = closeOf(commit);
    expect(close.kind, `merge ${commit}: its jobs still fail, so its ask takes its default`).toBe('ask.defaulted');
    expect(close.ts, `merge ${commit}: at its deadline`).toBe(ask.ts + WAIT);
  }
}, 600_000);
