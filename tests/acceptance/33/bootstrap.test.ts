// #33 AC4: with only the bootstrap `.deepbuild/done.yaml` the maintainer approved, and no drafted spec, this repo is
// gated, not watch-only: a change whose tests pass and whose typecheck fails is FAIL, naming the typecheck command; a
// gate that counts only a drafted spec as approved stays watch-only, gives no verdict and fails this test.
//
// Three tests.
// 1. This checkout's bootstrap: `.deepbuild/done.yaml` exists, its `done` claim runs the repo's existing test and
//    typecheck commands (the typecheck lane's `tsc --noEmit`, and a test runner the unit lane runs), and the commit
//    that last changed it carries the maintainer's approval as this repo records one (scripts/proof-change.mjs
//    `readApprovals`: an SSH-signed tag under refs/tags/deep/approved/ with `Approves: .deepbuild/done.yaml`). Where
//    the repo has no .deepbuild/approvers yet, the approval can't be read: that part is INCONCLUSIVE and the test skips.
// 2. A repo gated the same way (helpers.ts, bootstrapWorld): a hand-written bootstrap with `test` and `typecheck`, no
//    drafted spec and no handed definition, trusted in Claude Code. The session starts from a work item; the agent's
//    change makes the test pass and adds a type error; its stop is sent back, the verdict is FAIL, and both name the
//    typecheck (its name or `tsc`).
// 3. The wrong program `drafted-spec-only` (DEEP_HUB_PLANT): a gate that counts only a drafted spec as approved. The
//    same scenario must fail on it.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { afterEach, describe, it } from 'vitest';
import {
  AC4, PRICE_FIXED_BAD_TYPES, PRICE_BASE, REPO, Session, bootstrapWorld, cleanup, decision, failureOf, isFile, itemLink, itemTask, lockedFor, must,
  replyText, runsOf, settle, shown, startHub, taskVerdicts, verdict, verdictText, type Ev,
} from './helpers.ts';

afterEach(cleanup, 60_000);

const PLANT = 'drafted-spec-only';
const TYPECHECK = /\btypecheck\b|\btsc\b/;

/** The scenario of test 2; throws a message starting with AC4 when it doesn't hold. */
async function typecheckFails(plant?: string): Promise<void> {
  const w = bootstrapWorld(4);
  const hub = await startHub(w, { plant });
  const s = new Session(w);
  await s.start();
  await s.typed(`Fix ${itemLink(4)}`);
  await s.read('src/price.ts');
  let events = await settle(hub, (all) => { const t = itemTask(all, s); return t !== undefined && lockedFor(all, t).length > 0; }, 120_000);
  const task = itemTask(events, s);
  must(task !== undefined, `${AC4} the session started from ${itemLink(4)} opens one task, its definition from the item's criterion`);
  await s.edit('src/price.ts', PRICE_BASE, PRICE_FIXED_BAD_TYPES);
  const since = events.length ? events[events.length - 1]!.log_pos : 0;
  const stop = await s.stop('Fixed the total; the test passes now. Done.');
  events = await settle(hub, (all) => taskVerdicts(all, task!, since).some((v) => v.data.outcome !== 'pending'), 180_000);
  const verdicts = taskVerdicts(events, task!, since);
  const runs = runsOf(events, task!, since);
  const ran = (name: string) => runs.filter((r) => String(r.started.data.check) === name || String(r.started.data.check).includes(name));
  must(decision(stop) === 'deny', `${AC4} the repo is gated on its bootstrap, not watch-only: the stop whose typecheck fails is sent back; deep-hook let it through (${verdicts.length} verdicts: ${verdicts.map((v: Ev) => v.data.outcome).join(', ') || 'none'}): ${shown(stop)}`);
  must(TYPECHECK.test(replyText(stop)), `${AC4} the send-back names the typecheck command: ${replyText(stop).slice(0, 600)}`);
  const fail = verdicts.find((v) => v.data.outcome === 'FAIL');
  must(fail !== undefined, `${AC4} the claim's verdict is FAIL: ${verdicts.map(verdictText).join(' | ').slice(0, 600) || 'no verdict in the record'}`);
  must(TYPECHECK.test(JSON.stringify(fail!.data.reasons ?? [])) || TYPECHECK.test(JSON.stringify(fail!.data.requirements ?? [])), `${AC4} the FAIL names the typecheck command: ${verdictText(fail).slice(0, 600)}`);
  must(ran('test').some((r) => r.finished?.data.outcome === 'passed'), `${AC4} the bootstrap's test command ran and passed: ${JSON.stringify(ran('test').map((r) => r.finished?.data.outcome ?? 'running'))}`);
  must(ran('typecheck').some((r) => r.finished?.data.outcome === 'failed'), `${AC4} the bootstrap's typecheck command ran and failed: ${JSON.stringify(ran('typecheck').map((r) => r.finished?.data.outcome ?? 'running'))}`);
}

describe(`${AC4} with only the maintainer's bootstrap done.yaml, the repo is gated: tests pass, typecheck fails → FAIL naming the typecheck`, () => {
  it(`${AC4} this checkout's .deepbuild/done.yaml runs the repo's test and typecheck commands, approved by the maintainer's signed tag`, async (ctx) => {
    const file = join(REPO, '.deepbuild/done.yaml');
    must(isFile(file), `${AC4} this repo's bootstrap .deepbuild/done.yaml must exist`);
    const spec = parseYaml(readFileSync(file, 'utf8')) as { claims?: { done?: { checks?: string[] } }; checks?: Record<string, { type?: string; run?: string }> };
    const names = spec.claims?.done?.checks ?? Object.keys(spec.checks ?? {});
    const runs = names.map((n) => ({ n, run: spec.checks?.[n]?.run ?? '' }));
    must(runs.some((c) => /\btsc\b/.test(c.run) && c.run.includes('--noEmit')), `${AC4} the bootstrap's done claim runs the repo's typecheck command (tsc --noEmit, as the typecheck lane runs it): ${JSON.stringify(runs)}`);
    must(runs.some((c) => /\bvitest\b|scripts\/affected\.mjs|node --test|cargo test/.test(c.run)), `${AC4} the bootstrap's done claim runs the repo's tests with a runner the unit lane uses (vitest, scripts/affected.mjs, node --test or cargo test): ${JSON.stringify(runs)}`);
    const { git } = (await import(join(REPO, 'scripts/proof-change.mjs'))) as { git: (root: string, args: string[]) => string };
    const sha = git(REPO, ['log', '-1', '--format=%H', '--', '.deepbuild/done.yaml']).trim();
    must(/^[0-9a-f]{40}$/.test(sha), `${AC4} the bootstrap is committed: ${sha}`);
    // The signers are the repo's own list at HEAD (#1326); until a person lands one, the approval can't be read.
    if (!git(REPO, ['ls-tree', '--name-only', 'HEAD', '.deepbuild/approvers']).trim()) return ctx.skip(`INCONCLUSIVE: this repo has no .deepbuild/approvers yet, so the maintainer's approval of ${sha.slice(0, 12)} can't be read here`);
    const { readApprovals } = (await import(join(REPO, 'scripts/proof-change.mjs'))) as { readApprovals: (root: string, change: { base: string; commits: { sha: string }[] }) => Map<string, string[]> };
    const items = readApprovals(REPO, { base: 'HEAD', commits: [{ sha }] }).get(sha) ?? [];
    must(items.includes('.deepbuild/done.yaml'), `${AC4} the commit ${sha.slice(0, 12)} that last changed the bootstrap carries the maintainer's SSH-signed tag under refs/tags/deep/approved/ with "Approves: .deepbuild/done.yaml" (fetch the tags first): it approves ${JSON.stringify(items)}`);
  }, 120_000);

  it(`${AC4} a repo gated on a hand-written bootstrap alone: tests pass and typecheck fails → sent back, FAIL, naming the typecheck`, async (ctx) => {
    await verdict(ctx, () => typecheckFails());
  }, 600_000);

  it(`${AC4} (wrong program) a gate that counts only a drafted spec as approved (DEEP_HUB_PLANT=${PLANT}) stays watch-only and fails the scenario`, async () => {
    const failure = await failureOf(() => typecheckFails(PLANT));
    must(failure !== null, `${AC4} the planted gate that counts only a drafted spec as approved passed the scenario: it must stay watch-only and give no verdict, so the scenario fails on it`);
    must(failure!.startsWith(AC4), `${AC4} the planted gate fails at one of the scenario's assertions: ${failure}`);
  }, 600_000);
});
