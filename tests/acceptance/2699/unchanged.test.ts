// AC1 and AC2: a stop after a turn that ran `git status` and one shell command and changed no file, on a tree whose last
// claim ended every check, makes no checkout, writes nothing under the checkouts' folder and starts no process beyond
// the snapshot's (README).
//
// The gate runner on the bench (bench.ts): one session, two checks. Its first claim runs both in a checkout of its
// snapshot and both pass. The session then runs `git status` and one shell command in its worktree, which change no
// file, and stops again: the hub hands that stop to the gate as a stop with work since the last claim (no `same`). The
// bench counts, from just before that stop until its runs and writes have settled, every folder made under the
// base-commit service's checkouts' folder, every write there and every git process started. On the merge base the gate
// makes a checkout of the unchanged snapshot, carries every result and gives the checkout back.
import { afterEach, expect, test } from 'vitest';
import { commandsChangingNothing, openBench, PRICE, recorded, shownStarts, shownVerdict, SUM, verdict, type Bench, type Counted } from './bench.ts';

const AC1 = 'AC1 #2699.de6fa40e';
const AC2 = 'AC2 #2699.aefbe26c';
const CHECKS = [PRICE, SUM];
const FIRST = 'claim:2699U1';
const SECOND = 'claim:2699U2';
const THIRD = 'claim:2699U3';

let bench: Bench | undefined;
afterEach(async () => { await bench?.close(); bench = undefined; }, 120_000);

/** The first claim: both checks run in a checkout of its snapshot and pass. Anything else is BLOCKED: the scenario never reached the criterion. */
async function firstClaim(b: Bench, tag: string): Promise<unknown> {
  await b.stop({ claim: FIRST, checks: CHECKS });
  const v = b.gate.verdictOf(FIRST);
  const ran = b.starts.filter((s) => s.claim === FIRST);
  const inCheckout = ran.every((s) => s.cwd.startsWith(`${b.root}/`) && s.outcome === 'passed');
  if (v?.outcome !== 'PASS' || ran.length !== CHECKS.length || !inCheckout) throw Error(`BLOCKED: ${tag} the first claim must run ${CHECKS.map((c) => c.check).join(' and ')} in a checkout under ${b.root}, each passing, so it is PASS: it is ${shownVerdict(v)}; starts: ${shownStarts(b.starts)}`);
  return recorded(v);
}
/** The second stop, after a turn that ran `git status` and one shell command and changed no file; what the bench counted around it. */
async function stopAfterCommands(b: Bench): Promise<Counted> {
  commandsChangingNothing(b.repo);
  await b.count();
  await b.stop({ claim: SECOND, checks: CHECKS });
  return b.counted();
}
const shownProcesses = (c: Counted): string => c.processes.map((p) => `git ${p.args.join(' ')} (in ${p.cwd})`).join('; ') || 'none';

test(`${AC1} after a claim that ended every check, a turn runs git status and one shell command and changes no file, and the session stops: that stop makes no checkout, and its verdict and runs are the ones the merge base gives`, async (ctx) => verdict(ctx, async () => {
  const b = bench = await openBench();
  const before = await firstClaim(b, AC1);

  const c = await stopAfterCommands(b);

  const v = b.gate.verdictOf(SECOND);
  const seen = `the second claim's verdict is ${shownVerdict(v)}; every start the gate asked for: ${shownStarts(b.starts)}; folders made under the checkouts' folder ${b.root}: ${JSON.stringify(c.checkouts)}`;
  // Its runs: nothing ran for it, as on the merge base: every check carries the first claim's run.
  expect(b.starts.filter((s) => s.claim === SECOND).map((s) => `${s.check} ${s.run ?? s.refused}`), `${AC1} no file changed and every check ended on the last claim, so no run starts for the second claim; ${seen}`).toEqual([]);
  // Its verdict: the first claim's outcome, commit, results and counted runs, as the merge base carries them.
  expect(recorded(v), `${AC1} the second claim's verdict carries the first claim's: the same outcome on the same commit, each check's result and counted runs the same; ${seen}`).toEqual(before);
  // The checkout, counted: none.
  expect(c.checkouts, `${AC1} nothing would run on the second claim, so its stop makes no checkout, yet ${c.checkouts.length} checkout(s) were made under the checkouts' folder ${b.root} (${c.checkouts.join(', ')}); ${seen}`).toEqual([]);
}), 900_000);

test(`${AC2} that stop writes no file under the checkouts' folder and starts no process beyond the snapshot's: every git process it starts is one a stop after reads alone on the same tree also starts`, async (ctx) => verdict(ctx, async () => {
  const b = bench = await openBench();
  await firstClaim(b, AC2);

  const c = await stopAfterCommands(b);
  // The reference: the same tree, a stop after reads alone (`same`), which reuses the snapshot with no checkout on the
  // merge base as on the change (#2078). What it starts is the snapshot's work, and the reads of the worktree beside it.
  await b.count();
  await b.stop({ claim: THIRD, checks: CHECKS, same: true });
  const ref = await b.counted();
  if (ref.checkouts.length || ref.written.length) throw Error(`BLOCKED: ${AC2} the reference stop after reads alone must make no checkout and write nothing under ${b.root}: it made ${JSON.stringify(ref.checkouts)} and wrote ${JSON.stringify(ref.written)}`);

  const seen = `processes the stop started: ${shownProcesses(c)}; the reference stop's: ${shownProcesses(ref)}`;
  // Files written under the checkouts' folder, counted: none.
  expect(c.written, `${AC2} the stop after commands that changed no file writes no file under the checkouts' folder ${b.root}, yet these were written: ${c.written.join(', ')}; ${seen}`).toEqual([]);
  // No process works in or names the checkouts' folder.
  expect(c.processes.filter((p) => p.cwd.startsWith(`${b.root}/`) || p.args.some((a) => a.includes(`${b.root}/`))).map((p) => `git ${p.args.join(' ')} (in ${p.cwd})`), `${AC2} no process the stop starts works in or names the checkouts' folder ${b.root}; ${seen}`).toEqual([]);
  // Processes beyond the snapshot's, counted: each process is matched against one of the reference stop's, by its
  // folder and its whole command line; what is left over is beyond the snapshot's.
  const left = ref.processes.map((p) => `${p.cwd} ${p.args.join(' ')}`);
  const beyond: string[] = [];
  for (const p of c.processes) {
    const name = `${p.cwd} ${p.args.join(' ')}`;
    const i = left.indexOf(name);
    if (i >= 0) left.splice(i, 1);
    else beyond.push(`git ${p.args.join(' ')} (in ${p.cwd})`);
  }
  expect(beyond, `${AC2} the stop starts no process beyond the snapshot's: ${c.processes.length} git processes against the reference stop's ${ref.processes.length}, ${beyond.length} beyond them; ${seen}`).toEqual([]);
}), 900_000);
