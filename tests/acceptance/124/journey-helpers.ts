// Test-side tools for criterion 9 and its Scope line (README: Criterion 9): the UI check over a journey, audited at
// every step. The journey is a list of `deep_drive` calls, a launch first; `ui_check.journey` takes it, the check
// replays it in a fresh replica and audits the screen after each step. Nothing here stands in for the replica: every
// reply, snapshot and finding comes from the `deep-drive` binary, and every judgment is checked against the step's own
// snapshot.
import { expect } from 'vitest';
import { nodesOf, type Box, type Node, type Obj } from './helpers.ts';
import { uiCheck } from './ui-helpers.ts';

/** The criterion, as `ID` in helpers.ts. */
export const AC9 = '#124.f1263f80';

/** The audits criterion 9's Scope line adds. */
export const UNDER = { sibling: 'under_sibling', bar: 'under_system_bar', keyboard: 'under_keyboard' } as const;

/** The number of steps a journey has: every call after its launch, before its close. */
export const stepsIn = (journey: Obj[]): number => journey.filter((c) => c.call !== 'launch' && c.call !== 'close').length;

/** `{call: "ui_check", ui_check: {journey}}` in a fresh process; its reply, failing the test with the binary's words when it didn't answer. */
export async function journeyCheck(journey: Obj[], plant?: string): Promise<Obj> {
  const reply = await uiCheck({ journey }, plant);
  expect(reply.ok, `ui_check answers a journey: ${JSON.stringify(reply).slice(0, 800)}`).toBe(true);
  return reply;
}

/** The overlap of two boxes, or null. */
export function overlap(a: Box, b: Box): Box | null {
  const x0 = Math.max(a[0], b[0]), y0 = Math.max(a[1], b[1]);
  const x1 = Math.min(a[0] + a[2], b[0] + b[2]), y1 = Math.min(a[1] + a[3], b[1] + b[3]);
  return x1 > x0 && y1 > y0 ? [x0, y0, x1 - x0, y1 - y0] : null;
}

/** Step `k`'s audit (1-based), or undefined. */
export const stepOf = (reply: Obj, k: number): Obj | undefined => (reply.steps as Obj[] | undefined)?.find((s) => s.step === k);

/** The node of a role and name in a step's own snapshot, or null. */
export function nodeIn(step: Obj | undefined, role: string, name: string): Node | null {
  if (!step?.snapshot?.tree) return null;
  const found = nodesOf(step.snapshot).filter((n) => n.role === role && n.name === name);
  return found.length === 1 ? found[0]! : null;
}

/**
 * Every way a check's answer on a journey of `n` steps breaks "the UI check runs at every journey step": each step
 * audited once, in order, with its id as the journey names it and its own snapshot; every finding on a step that
 * exists and listed under that step; and no PASS when any of that is missing. None for an answer that holds.
 */
export function everyStep(reply: Obj, n: number): string[] {
  const problems: string[] = [];
  const steps = reply.steps as Obj[] | undefined;
  if (!Array.isArray(steps)) problems.push(`the check lists no steps: ${JSON.stringify(reply.steps)}`);
  else {
    for (let k = 1; k <= n; k++) {
      const at = steps.filter((s) => s.step === k);
      if (at.length !== 1) { problems.push(`step ${k} was audited ${at.length} times, not once`); continue; }
      const [s] = at as [Obj];
      const call = (reply.journey?.steps as Obj[] | undefined)?.[k - 1]?.id;
      if (s.id !== call) problems.push(`step ${k} is audited as ${JSON.stringify(s.id)}, the journey's step is ${JSON.stringify(call)}`);
      if (!s.snapshot?.tree) problems.push(`step ${k}'s audit holds no snapshot of the screen it audited`);
      if (!Array.isArray(s.findings)) problems.push(`step ${k}'s audit has no findings list`);
    }
    if (steps.length !== n) problems.push(`${steps.length} steps audited for a journey of ${n}`);
    if (steps.some((s, i) => i > 0 && s.step <= steps[i - 1]!.step)) problems.push('the steps are out of order');
  }
  for (const f of (reply.findings as Obj[] | undefined) ?? []) {
    if (typeof f.step !== 'number' || f.step < 1 || f.step > n) problems.push(`a finding names no step of the journey: ${JSON.stringify(f).slice(0, 200)}`);
    else if (!(stepOf(reply, f.step)?.findings as Obj[] | undefined)?.some((g) => JSON.stringify(g) === JSON.stringify(f))) problems.push(`a finding at step ${f.step} isn't in that step's audit`);
  }
  for (const s of steps ?? []) for (const f of (s.findings as Obj[] | undefined) ?? []) {
    if (f.step !== s.step) problems.push(`step ${s.step}'s audit holds a finding that names step ${f.step}`);
    if (!(reply.findings as Obj[] | undefined)?.some((g) => JSON.stringify(g) === JSON.stringify(f))) problems.push(`step ${s.step}'s finding isn't in the top-level list`);
  }
  if (problems.length && reply.claim === 'PASS') problems.push('the UI claim is PASS on a journey not audited at every step');
  return problems;
}

/**
 * One finding of `audit` at step `k`, checked against that step's own snapshot: the node is the real one, at its real
 * bounds, `by` names what covers it, and `box` is the part of the node it covers. Problems, none when it holds.
 */
export function coveredProblems(reply: Obj, o: { k: number; audit: string; node: { role: string; name: string }; by: { role: string; name: string | null; bounds?: Box } }): string[] {
  const problems: string[] = [];
  const step = stepOf(reply, o.k);
  const found = ((step?.findings as Obj[] | undefined) ?? []).filter((f) => f.audit === o.audit && f.node?.name === o.node.name);
  if (found.length !== 1) return [`step ${o.k} has ${found.length} ${o.audit} findings naming ${o.node.name}: ${JSON.stringify(step?.findings ?? null).slice(0, 400)}`];
  const [f] = found as [Obj];
  const node = nodeIn(step, o.node.role, o.node.name);
  if (!node) return [`step ${o.k}'s snapshot holds no one ${o.node.role} named ${o.node.name}`];
  if (f.step !== o.k) problems.push(`the finding names step ${f.step}, not ${o.k}`);
  if (f.node.role !== o.node.role) problems.push(`the finding's node is a ${f.node.role}, not a ${o.node.role}`);
  if (JSON.stringify(f.node.bounds) !== JSON.stringify(node.bounds)) problems.push(`the finding's node is at ${JSON.stringify(f.node.bounds)}, the step's ${o.node.name} at ${JSON.stringify(node.bounds)}`);
  let cover: Box | undefined = o.by.bounds;
  if (f.by?.role !== o.by.role || f.by?.name !== o.by.name) problems.push(`the finding says ${JSON.stringify(f.by ?? null)} covers it, not the ${o.by.role} ${JSON.stringify(o.by.name)}`);
  if (!cover && o.by.name !== null) cover = nodeIn(step, o.by.role, o.by.name)?.bounds;
  if (!cover) problems.push(`step ${o.k}'s snapshot holds no one ${o.by.role} named ${o.by.name}`);
  else {
    if (JSON.stringify(f.by?.bounds) !== JSON.stringify(cover)) problems.push(`the finding puts what covers it at ${JSON.stringify(f.by?.bounds)}, not ${JSON.stringify(cover)}`);
    const part = overlap(node.bounds, cover);
    if (!part) problems.push(`${o.node.name} ${JSON.stringify(node.bounds)} and what covers it ${JSON.stringify(cover)} don't overlap at step ${o.k}`);
    else if (JSON.stringify(f.box) !== JSON.stringify(part)) problems.push(`the finding's box ${JSON.stringify(f.box)} isn't the covered part ${JSON.stringify(part)}`);
  }
  return problems;
}

/** The findings at each step, as `audit node` strings, step 1 first. */
export const perStep = (reply: Obj, n: number): string[][] =>
  Array.from({ length: n }, (_, i) => ((stepOf(reply, i + 1)?.findings as Obj[] | undefined) ?? []).map((f) => `${f.audit} ${f.node?.name}`).sort());
