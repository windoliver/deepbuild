// #1861: a check that counts no test tool's tests is labelled a static check on its receipt, never a test run.
//
// One claim through `deep_claim` on a real hub (`deep hub run`), its session played through the real deep-hook with
// its own `deep mcp` (#965's Session, as #1863's suite plays it), on #322's world. The handed definition has two
// requirements, each covered by one drafted check and nothing else:
//   R1: `.deepbuild/checks/types.sh` runs `tsc --noEmit` over src/sum.ts, which is clean: no test tool, its exit status
//       its one result (#33).
//   R2: `.deepbuild/checks/sum.sh` runs Vitest on tests/sum.test.ts, one passing test the command check counts.
// The repo has no `.deepbuild/done.yaml`, so no spec check covers or sits beside either. The claim passes; R1's row in
// `verdict.made` reads proof `static_check` and R2's `test_run`.
//
// Wrong programs: the merge base labels every check `test_run`, so AC1 fails naming R1; a gate that labels every
// command check `static_check` fails AC2, naming R2.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, it } from 'vitest';
import { cleanup as cleanup322, expectTask, lastPos, lockedFor, makeWorld, must, REPO, req, runsOf, settle, startHub, stopHub, taskVerdicts, trustRepo, type Ev, type Hub, type World } from '../322/helpers.ts';
import { cleanup as cleanup965, Session, type Clock } from '../965/helpers.ts';
import { claimAfter, judged, outcomeOf, sayVerdicts } from '../1537/helpers.ts';
import { installVitest } from '../875/helpers.ts';

// ---- The criteria: `#1861.<first 8 hex of SHA-256 of the criterion's text, trimmed, white space collapsed>`.
const AC1 = 'AC1 #1861.0f1b7e41';
const AC2 = 'AC2 #1861.129e4c71';

// ---- The fixture repo.
const ASK = 'make the sum helper skip numbers that are not finite';
const SUM = 'src/sum.ts';
const SUM_BASE = 'export function sum(xs: number[]): number {\n  return xs.reduce((a, b) => a + b, 0);\n}\n';
const EDIT = { from: 'return xs.reduce(', to: 'return xs.filter((x) => Number.isFinite(x)).reduce(' } as const;
const TYPES = '.deepbuild/checks/types.sh';
const UNIT = '.deepbuild/checks/sum.sh';
const TEST = 'tests/sum.test.ts';
const FILES: Record<string, string> = {
  '.gitignore': 'node_modules/\n',
  'package.json': `${JSON.stringify({ name: 'shop', version: '1.0.0', private: true, type: 'module' }, null, 2)}\n`,
  [SUM]: SUM_BASE,
  // A typecheck: tsc over one clean file, no test tool. It passes at the merge base and after the edit.
  // Its tsconfig names src/sum.ts alone and no @types packages, so tsc reads none of the installed node_modules.
  'tsconfig.json': `${JSON.stringify({ compilerOptions: { strict: true, noEmit: true, target: 'es2022', module: 'es2022', types: [] }, files: [SUM] }, null, 2)}\n`,
  [TYPES]: `#!/bin/sh\n# Drafted check: the sum helper's types hold.\nnode node_modules/typescript/bin/tsc --noEmit -p tsconfig.json\n`,
  // A Vitest file of one test, passing at the merge base and after the edit.
  [UNIT]: `#!/bin/sh\n# Drafted check: the sum helper adds its numbers.\nnode_modules/.bin/vitest run ${TEST}\n`,
  [TEST]: "import { expect, it } from 'vitest';\nimport { sum } from '../src/sum.ts';\n\nit('sum adds its numbers', () => {\n  expect(sum([1, 2, 3])).toBe(6);\n});\n",
};
const DRAFT = {
  ask: ASK,
  requirements: [
    req('R1', "The sum helper's types hold", { check: TYPES, on_base: 'passes' }),
    req('R2', 'The sum helper adds its numbers', { check: UNIT, on_base: 'passes' }),
  ],
  deliverables: [SUM], budget: null,
};

/** #322's world with no spec, the fixture committed at its base, and TypeScript and Vitest installed (ignored) beside it. */
function world(): World {
  const w = makeWorld({ drafts: [DRAFT], spec: null, files: FILES });
  for (const pkg of ['node_modules/typescript', 'node_modules/vitest']) must(existsSync(join(REPO, pkg)), `BLOCKED: this checkout has no ${pkg} (run npm ci once)`);
  mkdirSync(dirname(join(w.repo, 'node_modules/typescript')), { recursive: true });
  cpSync(join(REPO, 'node_modules/typescript'), join(w.repo, 'node_modules/typescript'), { recursive: true, dereference: true });
  installVitest(w.repo);
  return w;
}

// ---- The session: the task opened and locked, the edit, deep_claim, the stop.
const noClock = { now: () => Date.now(), pass: async () => undefined } as unknown as Clock;
async function claim(hub: Hub, w: World): Promise<{ claim: string; events: Ev[]; ref: string; since: number }> {
  const s = new Session(w as never, noClock);
  await s.start();
  await s.typed(ASK);
  const as = s as unknown as Parameters<typeof expectTask>[1];
  const ok = (all: Ev[]): boolean => { try { return lockedFor(all, expectTask(all, as, ASK, 'setup')).length > 0; } catch { return false; } };
  const opened = await settle(hub, ok, 120_000);
  must(ok(opened), 'BLOCKED: the handed definition must lock: none was recorded');
  const ref = expectTask(opened, as, ASK, 'setup');
  const path = join(s.cwd, SUM);
  const content = readFileSync(path, 'utf8');
  const lines = content.split('\n').length;
  await s.call('Read', { file_path: path }, { response: { type: 'text', file: { filePath: path, content, numLines: lines, startLine: 1, totalLines: lines } } });
  const since = await lastPos(hub);
  await s.call('Edit', { file_path: path, old_string: EDIT.from, new_string: EDIT.to, replace_all: false }, {
    response: { filePath: path, oldString: EDIT.from, newString: EDIT.to, replaceAll: false, structuredPatch: [], userModified: false },
    effect: () => writeFileSync(path, readFileSync(path, 'utf8').replace(EDIT.from, EDIT.to)),
  });
  await s.deepClaim(ref);
  await s.stop('The sum helper now skips numbers that are not finite; its types hold and its test passes.');
  const events = await judged(hub, ref, since, { timeoutMs: 400_000 });
  const handle = claimAfter(events, ref, since);
  must(handle !== undefined, `BLOCKED: the session's deep_claim must make a claim for ${ref}: none was recorded`);
  // Both checks really ran on the claim's snapshot and passed: otherwise the labels below say nothing.
  const runs = runsOf(events, ref, since).filter((r) => String(r.started.data.commit) !== w.base).map((r) => ({ check: String(r.started.data.check), outcome: String(r.finished?.data.outcome ?? 'unfinished'), tests_run: r.finished?.data.tests_run }));
  for (const check of [TYPES, UNIT]) {
    must(runs.some((r) => r.check.includes(check)) && runs.filter((r) => r.check.includes(check)).every((r) => r.outcome === 'passed'), `BLOCKED: ${handle}'s check ${check} must run on the claim and pass: ${JSON.stringify(runs)}`);
  }
  return { claim: handle, events, ref, since };
}

/** A requirement's row in the claim's last verdict.made. */
const rowOf = (v: Ev, r: string): { req: string; proof?: unknown; outcome?: unknown } | undefined =>
  ((v.data.requirements ?? []) as { req: string; proof?: unknown; outcome?: unknown }[]).find((row) => String(row.req).endsWith(`#${r}`));

let hub: Hub | undefined;
let verdict: Ev;
let handle: string;
beforeAll(async () => {
  const w = world();
  await trustRepo(w, true);
  hub = await startHub(w);
  const c = await claim(hub, w);
  handle = c.claim;
  const verdicts = taskVerdicts(c.events, c.ref, c.since);
  must(verdicts.length > 0, `${handle} must be judged: no verdict.made was recorded`);
  verdict = verdicts.at(-1)!;
}, 900_000);
afterAll(async () => {
  if (hub) await stopHub(hub);
  await cleanup965();
  await cleanup322();
}, 60_000);

describe('#1861 a check that counts no test tool\'s tests is labelled static_check, one that does test_run', () => {
  it(`${AC1} R1, covered only by tsc --noEmit over a clean file, passes and its row reads proof static_check`, () => {
    must(outcomeOf(verdict) === 'PASS', `${AC1} R1: ${handle}, whose checks both passed, must be PASS: ${sayVerdicts([verdict])}`);
    const r1 = rowOf(verdict, 'R1');
    must(r1 !== undefined, `${AC1} R1: the verdict.made on ${handle} has no row for R1: ${sayVerdicts([verdict])}`);
    must(r1.outcome === 'PASS', `${AC1} R1: R1's row must read PASS: ${JSON.stringify(r1)}`);
    must(r1.proof === 'static_check', `${AC1} R1 is covered only by ${TYPES} (tsc --noEmit, which counts no test tool's tests), so its row reads proof static_check, not ${JSON.stringify(r1.proof)}: ${JSON.stringify(r1)}`);
  });
  it(`${AC2} R2, covered by a passing Vitest file, reads proof test_run in the same claim`, () => {
    must(outcomeOf(verdict) === 'PASS', `${AC2} R2: ${handle}, whose checks both passed, must be PASS: ${sayVerdicts([verdict])}`);
    const r2 = rowOf(verdict, 'R2');
    must(r2 !== undefined, `${AC2} R2: the verdict.made on ${handle} has no row for R2: ${sayVerdicts([verdict])}`);
    must(r2.outcome === 'PASS', `${AC2} R2: R2's row must read PASS: ${JSON.stringify(r2)}`);
    must(r2.proof === 'test_run', `${AC2} R2 is covered by ${UNIT} (Vitest, whose report counted its test), so its row reads proof test_run, not ${JSON.stringify(r2.proof)}: ${JSON.stringify(r2)}`);
  });
});
