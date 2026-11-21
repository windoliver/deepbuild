// Manual e2e for #2699: a real hub (`deep hub run`), the real deep-hook and #82's Claude Code stand-in. The session's
// first stop makes a passing claim; then a turn that only runs `git status` and `ls src` (real Bash calls through the
// hooks, run for real in the worktree) and stops. Prints the second claim's verdict and runs, and what appeared under
// the hub's checkouts folder during that second stop.
import { it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, watch } from 'node:fs';
import { join } from 'node:path';
import { cleanup } from '<worktree>/tests/acceptance/82/helpers.ts';
import { allEvents } from '<worktree>/tests/acceptance/82/helpers.ts';
import { removeTemp } from '<worktree>/tests/acceptance/875/helpers.ts';
import { passingClaim, shownClaim } from '<worktree>/tests/acceptance/2078/helpers.ts';

const label = process.env.E2E_LABEL ?? 'change';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
it('e2e #2699', async () => {
try {
  const scene = await passingClaim();
  console.log(`[${label}] first claim: ${shownClaim(scene.first)}`);
  const dir = join(scene.w.root, 'checkouts');
  const listed = () => (existsSync(dir) ? readdirSync(dir) : []);
  await sleep(2000);
  const before = new Set(listed());
  const seen = new Set<string>();
  const w = existsSync(dir) ? watch(dir, { recursive: true }, (_e, f) => { if (f) seen.add(String(f)); }) : null;
  const evs = await allEvents(scene.hub);
  const since = evs.length ? evs[evs.length - 1]!.log_pos : 0;
  const run = (cmd: string, args: string[]) => () => ({ stdout: execFileSync(cmd, args, { cwd: scene.w.repo, encoding: 'utf8' }), stderr: '', interrupted: false, isImage: false });
  const a = await scene.s.bash('git status', run('git', ['status']));
  const b = await scene.s.bash('ls src', run('ls', ['src']));
  console.log(`[${label}] Bash calls allowed: git status ${a.allowed}, ls src ${b.allowed}`);
  console.log(`[${label}] git status --porcelain in the worktree: ${JSON.stringify(execFileSync('git', ['status', '--porcelain'], { cwd: scene.w.repo, encoding: 'utf8' }))}`);
  await scene.s.stop('Done.');
  // settle: wait for the second claim's verdict and quiet
  let second;
  for (let i = 0; i < 240; i++) {
    const all = await allEvents(scene.hub);
    const claims = all.filter((e) => e.kind === 'claim.made' && e.data.task_ref === scene.ref);
    if (claims[1] && all.some((e) => e.kind === 'verdict.made' && e.subject === `claim:${claims[1]!.id}`)) { second = { all, made: claims[1]! }; break; }
    await sleep(500);
  }
  await sleep(3000);
  w?.close();
  const all = await allEvents(scene.hub);
  const after = all.filter((e) => e.log_pos > since);
  const claim = second ? `claim:${second.made.id}` : '(none)';
  const verdicts = after.filter((e) => e.kind === 'verdict.made' && e.subject === claim).map((e) => ({ outcome: e.data.outcome, commit: e.data.commit, reasons: e.data.reasons }));
  const started = after.filter((e) => e.kind === 'run.started').map((e) => `${e.data.run} ${e.data.check} on ${e.data.commit} for ${e.data.claim}`);
  const newDirs = listed().filter((d) => !before.has(d));
  const topNew = [...new Set([...seen].map((f) => f.split('/')[0]!))].filter((d) => !before.has(d));
  console.log(`[${label}] second claim ${claim}: verdicts ${JSON.stringify(verdicts)}`);
  console.log(`[${label}] first claim verdict: ${scene.first.outcome} on ${scene.first.commit}`);
  console.log(`[${label}] runs started after the second stop: ${JSON.stringify(started)}`);
  console.log(`[${label}] checkouts folder ${dir} (watched: ${w !== null}, entries before: ${JSON.stringify([...before])}): entries made during the second stop (watched): ${JSON.stringify(topNew)}; files written: ${seen.size}; new entries still there: ${JSON.stringify(newDirs)}`);
  console.log(`[${label}] events after the second stop: ${after.map((e) => e.kind).join(', ')}`);
} catch (error) {
  console.log(`[${label}] ERROR ${error instanceof Error ? error.stack : String(error)}`);
} finally {
  await cleanup();
  removeTemp();
}
}, 2_400_000);
