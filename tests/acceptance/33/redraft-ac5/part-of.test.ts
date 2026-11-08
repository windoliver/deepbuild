// #33 AC5: until drafting lands, each task in this repository takes its definition of done from its issue's
// acceptance criteria. A change that passes the bootstrap's commands but leaves a criterion unproven stays "Part of";
// a gate that judges only the bootstrap's commands says "Closes" and fails this test.
//
// The world stands in for this repository (README, The world): a repo whose `.deepbuild/done.yaml` is the maintainer's
// bootstrap, its two checks the repo's own test and typecheck commands (the commands its package.json's `test` and
// `typecheck` scripts run), committed at the base, with the project trusted as #348 records it. The session starts
// from issue #7 at the test work source, whose two acceptance criteria no test in the repo is tagged with, and no
// definition is handed (no drafting job yet), so the task's definition is the issue's criteria. The agent makes the
// unit test pass (FIX) and stops: the bootstrap's `test` and `typecheck` run on the claim and pass. Then:
//   1. `gh pr create … --body "Closes #7"` is refused at PreToolUse, its reason naming Part of and each unproven
//      criterion (its requirement ID, its `#7.<hash>` ID, or its text);
//   2. the same call saying `Part of #7` and listing what's left is allowed;
//   3. no verdict on the task's claim is PASS, and the stop's reply line doesn't say PASS.
// The wrong program `bootstrap-commands-only` (DEEP_HUB_PLANT) judges a claim on the bootstrap's commands alone, so
// the claim passes and the PR may say Closes: the scenario must fail on it, at its own assertion, naming Closes or PASS.
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, it } from 'vitest';
import {
  ACCOUNT, AUTH_JS, DEFAULT_RULES, FIX, SETTINGS, UNIT_TEST, claimsOf, cleanup, decision, failureOf, git, itemTask, lastPos, lockedFor, must, replyText,
  requirementsOf, runsOf, Session, settle, sha256, shown, startHub, taskVerdicts, trustRepo, type Ev, type Reading, type World,
} from '../../322/helpers.ts';

const AC5 = 'AC5 #33.64a97658';
const CRITERION = 'Until drafting lands, each task here takes its definition of done from its issue\'s acceptance criteria: a change that passes the bootstrap\'s commands but leaves one criterion unproven stays "Part of"; a gate that judges only the bootstrap\'s commands says "Closes" and fails this test';
const PLANT = 'bootstrap-commands-only';

/** The repo's existing test and typecheck commands: what its package.json's scripts run, and what the bootstrap runs. */
const TEST_CMD = 'node --test tests/unit.test.js';
const TYPECHECK_CMD = 'node --check src/auth.js';
/** The maintainer's bootstrap spec: the repo's test and typecheck commands, nothing drafted. */
const BOOTSTRAP = `# .deepbuild/done.yaml: the maintainer's bootstrap, written and approved by hand; the drafted spec replaces it
claims:
  done:
    checks: [test, typecheck]
checks:
  test:      { type: command, run: "${TEST_CMD}", min_tests: 1 }
  typecheck: { type: command, run: "${TYPECHECK_CMD}" }
`;

/** The issue the task comes from, at the test work source (DEEP_HUB_TEST_WORK): two acceptance criteria, no test tagged with either. */
const N = 7;
const CRITERIA = ['An expired token is rejected with 401', 'The e2e test for expired tokens passes'] as const;
/** A criterion's ID as scripts/proof-change.mjs computes it: `#<issue>.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed. */
const tagOf = (issue: number, text: string): string => `#${issue}.${sha256(text.trim().replace(/\s+/g, ' ')).slice(0, 8)}`;
const idOf = (text: string): string => tagOf(N, text);
const LINK = `https://work.test/windoliver/deepbuild/issues/${N}`;
const ISSUE: Reading = {
  source_id: `windoliver/deepbuild#${N}`, link: LINK, title: 'Expired tokens are accepted',
  body: `The auth middleware still accepts expired tokens.\n\n### Acceptance criteria\n- [ ] ${CRITERIA[0]}\n- [ ] ${CRITERIA[1]}\n`,
  criteria: [...CRITERIA], authors: [{ handle: 'windoliver', role: 'owner' }], updated: '2026-11-07T09:00:00Z',
};

const CLOSES = `gh pr create --title "Reject expired tokens" --body "Closes #${N}"`;
const PART_OF = `gh pr create --title "Reject expired tokens" --body "Part of #${N}. Still open: R1 (${idOf(CRITERIA[0])}: ${CRITERIA[0]}); R2 (${idOf(CRITERIA[1])}: ${CRITERIA[1]})"`;

// ---- The world, under /tmp/dh33r-* (a Unix socket path must fit in 104 bytes on macOS), HOME `<tmp>/h`.
const made: string[] = [];
afterEach(async () => {
  await cleanup();
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
}, 60_000);

/** The #322 suite's world shape (its World), with this repository's bootstrap as the spec and no drafted check. */
function bootstrapWorld(): World {
  const tmp = realpathSync(mkdtempSync('/tmp/dh33r-'));
  made.push(tmp);
  const home = join(tmp, 'h');
  const root = join(home, '.deepbuild');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(root, { recursive: true, mode: 0o700 });
  writeFileSync(join(root, 'rules.json'), readFileSync(DEFAULT_RULES, 'utf8'));
  writeFileSync(join(root, 'config.json'), `${JSON.stringify({ asks: SETTINGS }, null, 2)}\n`);
  const confirm = join(tmp, 'confirm');
  writeFileSync(confirm, 'confirmed\n');
  const repo = join(tmp, 'repo');
  mkdirSync(join(repo, 'src'), { recursive: true });
  mkdirSync(join(repo, 'tests'), { recursive: true });
  mkdirSync(join(repo, '.deepbuild'), { recursive: true });
  writeFileSync(join(repo, 'src', 'auth.js'), AUTH_JS);
  writeFileSync(join(repo, 'tests', 'unit.test.js'), UNIT_TEST);
  writeFileSync(join(repo, 'package.json'), `${JSON.stringify({ name: 'deepbuild', version: '0.0.0', private: true, scripts: { test: TEST_CMD, typecheck: TYPECHECK_CMD } }, null, 2)}\n`);
  writeFileSync(join(repo, '.deepbuild', 'done.yaml'), BOOTSTRAP);
  git(tmp, repo, ['init', '-q', '-b', 'main']);
  git(tmp, repo, ['add', '.']);
  git(tmp, repo, ['commit', '-q', '-m', 'base, with the maintainer\'s bootstrap spec']);
  const base = git(tmp, repo, ['rev-parse', 'HEAD']);
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'you@example.test' }, numStartups: 3 }, null, 2)}\n`);
  const drafts = join(tmp, 'drafts.json');
  writeFileSync(drafts, `${JSON.stringify({ drafts: [] }, null, 2)}\n`);
  const work = join(tmp, 'work.json');
  writeFileSync(work, `${JSON.stringify({ readings: [ISSUE] }, null, 2)}\n`);
  const github = join(tmp, 'github.json');
  writeFileSync(github, `${JSON.stringify({ answers: [] }, null, 2)}\n`);
  return { tmp, home, root, repo: realpathSync(repo), confirm, drafts, work, github, base };
}

/** Whether a run is of the bootstrap's check `name`: its `check` is the name, or ends with it after a separator. */
const ofCheck = (name: string) => (r: { started: Ev }): boolean => { const c = String(r.started.data.check); return c === name || new RegExp(`(^|[#:/.\\s])${name}$`).test(c); };
/** Whether a reason names a criterion: its requirement ID, its `#7.<hash>` ID, or its text. */
const names = (reason: string, rid: string | undefined, text: string): boolean => (rid !== undefined && new RegExp(`\\b${rid}\\b`).test(reason)) || reason.includes(idOf(text)) || reason.includes(text);

/** The scenario; throws a message starting with AC5 when the gate doesn't keep the change at Part of. */
async function scenario(plant?: string): Promise<void> {
  const w = bootstrapWorld();
  await trustRepo(w, true);
  const hub = await startHub(w, { plant });
  const s = new Session(w);
  await s.start();
  await s.typed(`Fix ${LINK}`);
  await s.read('src/auth.js');

  // The task's definition is the issue's acceptance criteria: no definition was handed.
  let events = await settle(hub, (all) => { const ref = itemTask(all, s); return ref !== undefined && lockedFor(all, ref).length > 0; }, 60_000);
  const ref = itemTask(events, s);
  must(ref !== undefined, `${AC5} the session started from ${LINK} must open one task under its thread`);
  const [lock] = lockedFor(events, ref!);
  must(lock !== undefined, `${AC5} with no drafting job and no definition handed, ${ref}'s definition must lock from ${ISSUE.source_id}'s acceptance criteria: no definition.locked was recorded`);
  const reqs = requirementsOf(lock);
  const rids: (string | undefined)[] = [];
  for (const text of CRITERIA) {
    const q = reqs.find((r) => typeof r.text === 'string' && r.text.includes(text));
    must(q !== undefined, `${AC5} the definition takes each acceptance criterion of the issue as a requirement, quoting "${text}": ${JSON.stringify(reqs).slice(0, 600)}`);
    rids.push(typeof q!.id === 'string' ? q!.id : undefined);
  }

  // The change passes the bootstrap's commands.
  const since = await lastPos(hub);
  await s.edit(FIX.file, FIX.from, FIX.to);
  const stop = await s.stop('checkToken now rejects a token whose exp has passed; the tests and the typecheck pass.');
  events = await settle(hub, (all) => ['test', 'typecheck'].every((c) => runsOf(all, ref!, since).some((r) => ofCheck(c)(r) && r.finished !== undefined)), 120_000);
  if (!claimsOf(events, ref!, since).length) throw Error(`BLOCKED: ${AC5} the stop after the change must make a claim for ${ref}, so the bootstrap's commands judge it: no claim.made after it (stop ${shown(stop)})`);
  for (const c of ['test', 'typecheck']) {
    const run = runsOf(events, ref!, since).find(ofCheck(c));
    if (run?.finished?.data.outcome !== 'passed') throw Error(`BLOCKED: ${AC5} the scenario's premise is a change that passes the bootstrap's commands, but its \`${c}\` check did not pass on the claim: ${JSON.stringify(run?.finished?.data ?? run?.started.data ?? 'no run')}`);
  }

  // Closes is refused, naming Part of and what's left.
  const closes = await s.bash(CLOSES);
  must(!closes.allowed, `${AC5} the change passes the bootstrap's commands but no acceptance criterion of #${N} is proven, so it stays Part of #${N}: \`${CLOSES}\` must be refused at PreToolUse; deep-hook allowed it, so the gate says Closes: ${shown(closes.before)}`);
  const reason = replyText(closes.before);
  must(/\bPart of\b/.test(reason), `${AC5} the refusal of \`${CLOSES}\` must say the PR stays Part of #${N}: ${reason.slice(0, 500)}`);
  CRITERIA.forEach((text, i) => {
    must(names(reason, rids[i], text), `${AC5} the refusal of Closes must list what's left, naming the unproven criterion "${text}" (${rids[i] ?? 'its requirement'}, ${idOf(text)} or its text): ${reason.slice(0, 500)}`);
  });
  const partOf = await s.bash(PART_OF);
  must(partOf.allowed, `${AC5} the same call saying Part of #${N} and listing what's left is allowed (decision ${decision(partOf.before)}): ${shown(partOf.before)}`);

  // Nothing unproven passes: the claim's verdict is never PASS.
  events = await settle(hub, () => false, 3_000);
  const passed = taskVerdicts(events, ref!, since).filter((v) => v.data.outcome === 'PASS');
  must(!passed.length, `${AC5} with the issue's criteria unproven, the claim judged on the bootstrap's commands is never PASS: ${passed.map((v) => JSON.stringify(v.data).slice(0, 300)).join('; ')}`);
  const line = replyText(stop);
  must(!/(^|\n)\s*PASS\b/.test(line), `${AC5} the stop's reply never says PASS while the issue's criteria are unproven: ${line.slice(0, 300)}`);
}

describe(`${AC5} until drafting lands, a task here is done by its issue's acceptance criteria: passing the bootstrap's commands keeps it at Part of`, () => {
  it(`${AC5} a change that passes the bootstrap's test and typecheck but proves none of #${N}'s criteria: gh pr create with Closes #${N} is refused naming Part of and each criterion; Part of #${N} is allowed; no PASS`, async () => {
    must(tagOf(33, CRITERION) === AC5.split(' ')[1], `${AC5} the criterion's text hashes to this test's tag: ${tagOf(33, CRITERION)}`);
    await scenario();
  }, 300_000);

  it(`${AC5} the wrong program ${PLANT} (a gate that judges a claim on the bootstrap's commands alone) says Closes and fails the scenario`, async () => {
    const message = await failureOf(() => scenario(PLANT));
    must(message !== null, `${AC5} the scenario must fail on the planted ${PLANT}, which judges the claim on the bootstrap's commands alone, yet it held`);
    must(message.startsWith(AC5) && /\bCloses\b|\bPASS\b/.test(message), `${AC5} on ${PLANT} the scenario must fail at its own assertion, naming Closes (or the PASS that maps to it): ${message.slice(0, 500)}`);
  }, 300_000);
});
