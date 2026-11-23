// #2695.7026a58e: "A forwarded PreToolUse opens the proofs' file zero times, counted by the test, and retires at least
// 0.3 M fewer instructions than on the merge base for a Read, over 15 alternated rounds (drafted from the audit's 0.3 to
// 1 M)"
//
// Two tests, one per clause. Both run the real deep-hook as Claude Code's hook entry runs it, in a home `deep setup`
// made, its hub (started by setup's login service) answering. README: Opens, counted; Instructions.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, expect, test } from 'vitest';
import { AC2, PROOFS, baseSideOf, buildBase, buildHook, mergeBase, cleanup, countOpens, countedHook, decision, hook, makeHome, median, proofsPath, recordedCalls, setup, shown, sleep, spooled, type Call, type Home } from './helpers.ts';

const T = 1_800_000;
const ROUNDS = 15;
const FEWER = 300_000;
beforeAll(() => buildHook(), 1_900_000);
afterAll(cleanup);

/** A Read of a file in the agent's folder, as Claude Code's Read tool sends it. */
function readCall(h: Home): Call {
  const file = join(h.work, 'notes.txt');
  writeFileSync(file, 'notes\n');
  return { tool_name: 'Read', tool_input: { file_path: file } };
}

test(`${AC2} a forwarded PreToolUse opens ${PROOFS} zero times, counted by the test`, async () => {
  const binary = await buildHook();
  const h = makeHome();
  const hub = await setup(h);
  const calls: Call[] = [readCall(h), { tool_name: 'Bash', tool_input: { command: 'git status' } }];
  const ids: string[] = [];
  const counter = countOpens(proofsPath(h));
  let opens: number;
  try {
    for (let i = 0; i < ROUNDS; i++) ids.push((await hook(binary, h, calls[i % 2]!)).id);
    await sleep(1000);
  } finally {
    opens = await counter.stop();
  }
  const recorded = await recordedCalls(hub);
  if (!ids.some((id) => recorded.has(id))) throw Error(`BLOCKED: the hub recorded none of the ${ROUNDS} PreToolUse calls, so none was forwarded`);
  expect(opens, `${ROUNDS} forwarded PreToolUse calls (a Read and \`git status\`, in turn) must open ~/.deepbuild/${PROOFS} zero times; it was opened ${opens} times`).toBe(0);
}, T);

test(`${AC2} a forwarded PreToolUse for a Read retires at least 0.3 M fewer instructions than on the merge base, over ${ROUNDS} alternated rounds`, async () => {
  if (process.platform !== 'darwin') throw Error(`INCONCLUSIVE: /usr/bin/time -l reports no instructions retired on ${process.platform}`);
  const change = await buildHook(true);
  // Redraft (blind, approved): the base side is the merge base computed now, not the pinned BASE (README).
  const rev = mergeBase();
  const base = await buildBase(rev);
  const c = makeHome();
  const hub = await setup(c);
  const b = baseSideOf(hub, rev);
  const read = readCall(c);
  readCall(b);
  const sides = { base: { binary: base, home: b }, change: { binary: change, home: c } };
  // One unmeasured call a side: each binary's first exec of the run, and the hub's first answer to each home.
  for (const s of Object.values(sides)) await hook(s.binary, s.home, read);

  const rounds: { base: number; change: number; late: boolean }[] = [];
  let skipped = 0;
  for (let tries = 0; rounds.length < ROUNDS; tries++) {
    if (tries >= ROUNDS * 4) throw Error(`INCONCLUSIVE: only ${rounds.length} of ${tries} rounds had the hub answering both sides alike (the machine may be loaded); rerun alone`);
    const order = (rounds.length % 2 === 0 ? ['base', 'change'] : ['change', 'base']) as ('base' | 'change')[];
    const got: Partial<Record<'base' | 'change', { instructions: number; late: boolean }>> = {};
    for (const side of order) {
      const { binary, home } = sides[side];
      const r = await countedHook(binary, home, read);
      if (decision(r.ran) !== 'allow') throw Error(`BLOCKED: the ${side} side's PreToolUse for a Read must be allowed: ${shown(r.ran)}`);
      if (r.instructions === null) throw Error(`INCONCLUSIVE: /usr/bin/time -l reported no instructions retired for the ${side} side (a count that can't be read is missing, never 0)`);
      // A call the hub didn't answer in time is spooled; a round counts only when both sides took the same path.
      got[side] = { instructions: r.instructions, late: spooled(home).has(r.id) || /spool/.test(r.ran.stderr) };
    }
    if (got.base!.late !== got.change!.late) { skipped++; continue; }
    rounds.push({ base: got.base!.instructions, change: got.change!.instructions, late: got.base!.late });
  }
  const fewer = rounds.map((r) => r.base - r.change);
  const m = median(fewer);
  const table = rounds.map((r, i) => `${i + 1}${i % 2 ? ' (change first)' : ' (base first)'}: base ${r.base}, change ${r.change}${r.late ? ', both late' : ''}`).join('; ');
  console.log(`AC2 instructions against the merge base ${rev}, release builds, ${ROUNDS} rounds (${skipped} skipped for unlike paths): ${table}; median fewer ${m}`);
  expect(m, `over ${ROUNDS} alternated rounds a forwarded PreToolUse for a Read must retire at least ${FEWER.toLocaleString('en-US')} fewer instructions than the merge base's deep-hook (the median of each round's base minus change); it retires ${Math.round(m).toLocaleString('en-US')} fewer. Rounds: ${table}`).toBeGreaterThanOrEqual(FEWER);
}, T);
