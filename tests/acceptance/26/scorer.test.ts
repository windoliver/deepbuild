// #26.4c0cfacd The manual evaluation scores real sessions on closed claim manifests against evidence delivered in
// that session, and fails a run whose skill didn't load or doesn't match the live tool list.
// (Added Oct 9: a wrong first tool or a repeated call fails the run; no expected values in the prompt.)
// Real agent sessions are run by hand, never in CI (README: The manual evaluation). What is tested here is the
// scorer they are scored by, `node scripts/agent-eval.mjs score <run.json>`, on a recorded session (fixtures/eval/
// run.json, completed with the installed skill and the live tool list) and on one mutant of it per rule.

import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, expect, test } from 'vitest';
import {
  cleanup, initialize, listTools, makeHome, makeWorktree, McpProcess, NODE, REPO, run, sha256, SKILL, startHub, type Line,
} from './helpers.ts';

afterAll(cleanup, 30_000);

const SCORER = join(REPO, 'scripts/agent-eval.mjs');
const TEMPLATE = new URL('./fixtures/eval/run.json', import.meta.url);

let clean: Promise<{ dir: string; recording: Line }> | undefined;
/** The recorded run, its skill the installed one and its tool list the one a live deep mcp serves. */
const setUp = () => (clean ??= (async () => {
  if (!existsSync(SKILL)) throw Error(`BLOCKED: no skill at ${SKILL}`);
  const { tmp, home } = makeHome();
  const wt = makeWorktree(join(tmp, 'work'));
  await startHub(home);
  const live = McpProcess.start(home, wt.path);
  await initialize(live);
  const tools = await listTools(live);
  const recording = JSON.parse(readFileSync(TEMPLATE, 'utf8')) as Line;
  recording.skill.text = readFileSync(SKILL, 'utf8');
  recording.tools = tools;
  return { dir: tmp, recording };
})());

let n = 0;
async function score(recording: Line): Promise<{ code: number | null; verdict: Line | undefined; stdout: string; stderr: string }> {
  const { dir } = await setUp();
  const file = join(dir, `run-${++n}.json`);
  writeFileSync(file, JSON.stringify(recording, null, 2));
  const r = await run(NODE, [SCORER, 'score', file]);
  let verdict: Line | undefined;
  try { verdict = JSON.parse(r.stdout.trim().split('\n').at(-1) ?? '') as Line; } catch { verdict = undefined; }
  return { code: r.code, verdict, stdout: r.stdout, stderr: r.stderr };
}
const mutate = async (change: (r: Line) => void): Promise<Line> => {
  const r = structuredClone((await setUp()).recording);
  change(r);
  return r;
};

test('#26.4c0cfacd the scorer passes a recorded run whose skill loaded and matches the live tools, whose claims match the manifest on evidence delivered in that session', async () => {
  const r = await score((await setUp()).recording);
  expect({ code: r.code, outcome: r.verdict?.outcome, reasons: r.verdict?.reasons }, `the clean recorded run scores PASS: ${r.stdout}${r.stderr}`).toEqual({ code: 0, outcome: 'PASS', reasons: [] });
}, 120_000);

const MUTANTS: [string, string, (r: Line) => void][] = [
  ['a run whose skill didn\'t load', 'skill_not_loaded', (r) => { r.skill = { loaded: false, text: null }; }],
  ['a run whose skill names a tool the live list lacks', 'skill_tools_mismatch', (r) => { r.tools = (r.tools as Line[]).slice(0, -1); }],
  ['a run whose skill names a tool that isn\'t live', 'skill_tools_mismatch', (r) => { r.skill.text = `${r.skill.text}\nFinish with deep_frobnicate.\n`; }],
  ['a claim citing evidence never delivered in that session', 'evidence_not_delivered', (r) => { r.answer.claims[0].evidence = `ev:${sha256('delivered in another session')}`; }],
  ['a claim whose value the manifest doesn\'t expect', 'claim_mismatch', (r) => { r.answer.claims[0].value = '16 tests passed'; }],
  ['a claim outside the closed manifest', 'claim_not_in_manifest', (r) => { r.answer.claims.push({ id: 'lint-clean', value: 'clean', evidence: r.answer.claims[0].evidence }); }],
  ['a wrong first tool', 'wrong_first_tool', (r) => { r.calls.push(r.calls.shift()); }],
  ['a repeated call', 'repeated_call', (r) => { r.calls.splice(1, 0, structuredClone(r.calls[0])); }],
  ['an expected value in the prompt', 'expected_in_prompt', (r) => { r.prompt = `${r.prompt} It should end with 17 tests passed.`; }],
];

test.each(MUTANTS)('#26.4c0cfacd the scorer fails %s (%s)', async (_what, code, change) => {
  const r = await score(await mutate(change));
  expect(r.code, `the scorer exits 1 for FAIL: ${r.stdout}${r.stderr}`).toBe(1);
  expect(r.verdict?.outcome, `the scorer's verdict is FAIL: ${r.stdout}`).toBe('FAIL');
  expect(((r.verdict?.reasons ?? []) as Line[]).map((x) => x.code), `the scorer names why: ${r.stdout}`).toContain(code);
}, 120_000);
