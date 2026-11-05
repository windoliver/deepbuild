// The criteria's assertions that a wrong program must fail, as judges: each returns the problems it found, every one
// naming what its criterion says the failure names (the kind, the call), and an empty list on a sound host. A test runs
// the scenario on the real host and expects no problem, and runs the same scenario on the planted twin the criterion
// names (the host's `plant` option, README, Wrong programs) and expects the problem.
import type { Event } from '../../../packages/record/src/index.ts';

/** What the reader plug-in's query action returns: what crossed into the sandbox, or the refusal's message. */
export interface QueryOutput { rows: string | null; count: number; refusal: string | null }

/**
 * AC3: a query of another plug-in's store kind is refused, the refusal naming the kind, the plug-in that declares it
 * and the use to declare instead, and no row of the kind (nor any of its values) crossed into the sandbox.
 */
export function judgeForeignQuery(out: QueryOutput, kind: string, owner: string, planted: string): string[] {
  const problems: string[] = [];
  const crossed = out.rows ?? '';
  if (out.count > 0 || crossed.includes(kind) || crossed.includes(planted)) problems.push(`the query of ${kind} returned ${out.count} rows into the sandbox: ${crossed.slice(0, 600)}`);
  if (typeof out.refusal !== 'string' || !out.refusal) {
    problems.push(`the query of ${kind} wasn't refused`);
    return problems;
  }
  if (!out.refusal.includes(kind)) problems.push(`the refusal doesn't name the kind ${kind}: ${out.refusal}`);
  if (!out.refusal.includes(owner)) problems.push(`the refusal of ${kind} doesn't name its plug-in ${owner}: ${out.refusal}`);
  if (!/\buses?\b/i.test(out.refusal)) problems.push(`the refusal of ${kind} doesn't name the use to declare instead: ${out.refusal}`);
  return problems;
}

/** What a call's record must hold (AC8): `changed` empty, or one item naming the store item; and its `verified`. */
export interface Expected { changed: 'none' | { item: string; event: string }; verified?: 'true' | 'false' | 'unverified' }
/**
 * AC8: the call with request ID `request` recorded one action.entered and then one action.reported for the same call,
 * whose `changed` is what the record shows the hub made for it and whose `verified` is the one expected. Every problem
 * names the call.
 */
export function judgeCall(all: Event[], request: string, expected: Expected): string[] {
  const entered = all.filter((e) => e.kind === 'action.entered' && (e.data as { request?: unknown }).request === request);
  if (entered.length !== 1) return [`the call with request ${request} recorded ${entered.length} action.entered, not one`];
  const call = String((entered[0]!.data as { call?: unknown }).call);
  const named = `call ${call} (request ${request})`;
  const reported = all.filter((e) => e.kind === 'action.reported' && (e.data as { call?: unknown }).call === call);
  if (reported.length !== 1) return [`${named} recorded ${reported.length} action.reported, not one`];
  const problems: string[] = [];
  const r = reported[0]!;
  if (r.log_pos <= entered[0]!.log_pos) problems.push(`${named}'s action.reported (log ${r.log_pos}) isn't after its action.entered (log ${entered[0]!.log_pos})`);
  const data = r.data as { changed?: unknown; verified?: unknown };
  const changed = data.changed;
  if (!Array.isArray(changed)) problems.push(`${named}'s action.reported holds no changed list: ${JSON.stringify(r.data)}`);
  else if (expected.changed === 'none' && changed.length) problems.push(`${named} wrote nothing, yet its action.reported says changed ${JSON.stringify(changed)}`);
  else if (expected.changed !== 'none') {
    const { item, event } = expected.changed;
    if (changed.length !== 1) problems.push(`${named} wrote one store item, ${item}, yet its action.reported says changed ${JSON.stringify(changed)}`);
    else if (!String(changed[0]).includes(item) && !String(changed[0]).includes(event)) problems.push(`${named}'s changed entry ${JSON.stringify(changed[0])} names neither the store item ${item} nor its event ${event}`);
  }
  if (expected.verified !== undefined && data.verified !== expected.verified) problems.push(`${named}'s action.reported says verified ${JSON.stringify(data.verified)}, not ${expected.verified}`);
  return problems;
}
