// #1015 AC7, redrafted blind (README): in DeepBuild's own repo, a preflight (its lane runner, scaled down) and two real
// `node scripts/affected.mjs` runs, each in its own scripted Claude Code session through the real deep-hook into
// `deep hub run`, start together; each of their blocks must have run while its session held a `cpu.slot` lease in the
// hub's table. The planted `scripts/lease` that runs its command directly must fail the same assertion, naming the block.
//
// The sessions' commands get the machine's own PATH, with only `deep` put ahead of it, so `cargo metadata`, `git` and
// `node` are the machine's. No path to the block or its folders is written as one literal: affected.mjs links a test to
// every repo path its literals name, and a run handed the block would then run this file too.

import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AC7, claudeCall, heldBy, heldNow, leaseRows, mustFail, NODE, REPO, Session, shownHook, shownLeases, sleep, slotsOf, until, World,
  type LeaseRow, type Pre, type Ran,
} from '../helpers.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
/** The block, repo-relative, as affected.mjs is handed it and the lane runs it. */
const BLOCK = relative(REPO, join(HERE, ['block', 'test', 'mjs'].join('.')));
const LANES = relative(REPO, join(HERE, 'preflight-lanes.mjs'));
const AFFECTED = 'scripts/affected.mjs';
/** Clock slack between a file's birth time and the hub's clock (both the system's), in ms. */
const SLACK = 50;
const MIN = 60_000;

/** The sessions' PATH: a folder holding only `deep` (the built CLI), then the machine's own PATH unchanged. */
function tools(w: World): string {
  const bin = join(w.dir, 'tools');
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, 'deep'), readFileSync(join(w.bin, 'deep'), 'utf8'), { mode: 0o755 });
  return `${bin}:${process.env.PATH ?? '/usr/bin:/bin'}`;
}
/** What a session's commands get on top of the world's environment: the PATH above, its own temp folder, the block's log. */
function extra(w: World, label: string): Record<string, string> {
  const tmp = join(w.dir, 'tmp');
  mkdirSync(tmp, { recursive: true });
  return { PATH: tools(w), TMPDIR: tmp, DH1015_DIR: w.runs, DH1015_LABEL: label };
}

/**
 * The precondition: affected.mjs, run as the sessions run it, selects the block and nothing else (no other suite, no
 * crate), so the runs below run only the block and their lint jobs. Anything else is BLOCKED, never a pass.
 */
let listed = false;
function guard(w: World): void {
  if (listed) return;
  const r = spawnSync(NODE, [AFFECTED, '--list', BLOCK], { cwd: REPO, env: w.env(extra(w, 'list')), encoding: 'utf8', timeout: 15 * MIN, maxBuffer: 1 << 26 });
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
  if (r.status !== 0) throw Error(`BLOCKED: \`node ${AFFECTED} --list ${BLOCK}\` with the sessions' environment exited ${r.status ?? r.signal}: ${out.slice(-1500)}`);
  const files = out.split('\n').flatMap((l) => /^(?:parallel|alone|timed) (?:vitest|node): (.+)$/.exec(l)?.[1]?.split(' ') ?? []);
  if (files.join(' ') !== BLOCK || /^parallel cargo test:/m.test(out)) throw Error(`BLOCKED: affected.mjs handed ${BLOCK} would run more than the block: ${out.slice(0, 1500)}`);
  listed = true;
}

interface RunSpec { name: string; label: string; command: string; affected: boolean }
interface Done extends RunSpec { s: Session; pre: Pre; ran?: Ran; output: string; atStart?: LeaseRow[] }

/** The runs, each in its own session in this checkout, started together; each block let end once its start is read. */
async function scenario(w: World, specs: readonly RunSpec[], ms: number): Promise<Done[]> {
  guard(w);
  const hub = await w.startHub();
  const sessions = specs.map((spec) => new Session(w, 'claude', REPO, extra(w, spec.label)));
  await Promise.all(sessions.map((s) => s.begin('Run the checks and tell me whether they pass.')));
  const calls = await Promise.all(specs.map((spec, i) => claudeCall(sessions[i]!, spec.command)));
  const done: Done[] = specs.map((spec, i) => ({ ...spec, s: sessions[i]!, pre: calls[i]!.pre, output: '' }));
  calls.forEach((c, i) => void c.bash?.done.then((ran) => { done[i]!.ran = ran; }));
  const deadline = Date.now() + ms;
  while (Date.now() < deadline && calls.some((c) => c.bash && !c.bash.finished())) {
    for (const d of done) {
      if (d.atStart || !w.started(d.label)) continue;
      // The block runs, held by its go file: the hub's table as it is now.
      d.atStart = heldNow(await leaseRows(hub));
      w.go(d.label);
    }
    await sleep(500);
  }
  done.forEach((d, i) => { d.output = calls[i]!.bash?.output() ?? ''; });
  // Leases end on the supervisor's proof after the groups end: give them a minute, then read the table.
  await until(async () => { const held = heldNow(await leaseRows(hub)); return sessions.every((s) => !slotsOf(held, s).length); }, MIN, 1000);
  for (const s of sessions) s.stop();
  return done;
}

const tail = (text: string) => JSON.stringify(text.slice(-1200));

/**
 * Each run's blocks ran under `cpu.slot` leases of its session: the block this test holds, while it ran (a lease held
 * when it started, taken after its run began, released only after it ended); and for affected.mjs, every job the run
 * started (one log file each, created before its command starts) matched to a `cpu.slot` lease of its own, taken after
 * the job began. Throws one message naming every block that ran with none.
 */
function assertLeased(w: World, done: readonly Done[], rows: readonly LeaseRow[]): void {
  const failures: string[] = [];
  for (const d of done) {
    const where = `${d.name} (session ${d.s.id}, \`${d.command}\`)`;
    if (d.pre.decision.denied) { failures.push(`${where}: its call was denied: ${shownHook(d.pre.hooked)}`); continue; }
    const slots = slotsOf(rows, d.s);
    const logs = /logs in (\S+)/.exec(d.output)?.[1];
    if (!d.ran) failures.push(`${where} didn't end in time; its output so far: ${tail(d.output)}`);
    else if (d.affected && !logs) failures.push(`${where} ended (exit ${d.ran.code ?? d.ran.signal}) without its "logs in" line: ${tail(d.output)}`);
    const jobs = logs ? readdirSync(logs).filter((f) => f.endsWith('.log')).map((f) => ({ name: f.slice(0, -4), birth: statSync(join(logs, f)).birthtimeMs })).sort((a, b) => a.birth - b.birth) : [];

    // The block this test held.
    const block = d.affected ? `the block \`node --test ${BLOCK}\` of ${where}` : `the lane block \`node --test ${BLOCK}\` of ${where}`;
    const mark = readOrEmpty(join(w.runs, `began-${d.label}`));
    const began = d.affected ? jobs.find((j) => j.name.startsWith('node'))?.birth : mark ? Number(mark) : undefined;
    const S = w.started(d.label);
    const E = w.ended(d.label);
    if (!S || !E) failures.push(`${block} never ran to its end; output ${tail(d.output)}`);
    else {
      const since = began ?? -Infinity;
      const own = (d.atStart ?? []).filter((l) => l.kind === 'cpu.slot' && heldBy(l, d.s) && l.at >= since - SLACK && l.at <= S.ms)
        .find((l) => { const after = rows.find((r) => r.id === l.id); return after?.released === undefined || after.released >= E.ms; });
      if (!own) {
        const then = (d.atStart ?? []).filter((l) => heldBy(l, d.s));
        failures.push(`${block} ran with no cpu.slot lease of its session: when it started (${S.ms}) the session held ${shownLeases(then)}; its cpu.slot leases in all: ${shownLeases(slots)}`);
      }
    }

    // Every job of an affected.mjs run, each with a lease of its own.
    const free = [...slots].sort((a, b) => a.at - b.at);
    for (const job of jobs) {
      const i = free.findIndex((l) => l.at >= job.birth - SLACK);
      if (i < 0) failures.push(`the block "${job.name}" of ${where} took no cpu.slot lease of its own (${jobs.length} blocks, ${slots.length} cpu.slot leases of the session)`);
      else free.splice(i, 1);
    }
  }
  if (failures.length) expect.fail(failures.join('\n'));
}
function readOrEmpty(path: string): string { try { return readFileSync(path, 'utf8').trim(); } catch { return ''; } }

const PREFLIGHT: RunSpec = { name: "the preflight's lane runner", label: 'preflight', command: `node ${LANES}`, affected: false };
const affected = (n: number): RunSpec => ({ name: `affected.mjs run ${n}`, label: `affected-${n}`, command: `node ${AFFECTED} ${BLOCK}`, affected: true });

describe('#1015 AC7 (redraft): DeepBuild\'s own preflight and affected.mjs runs lease each block', () => {
  it(`${AC7} a preflight and two affected.mjs runs started together in three sessions: each block ran under a cpu.slot lease of its session`, async () => {
    const w = new World();
    const done = await scenario(w, [PREFLIGHT, affected(1), affected(2)], 40 * MIN);
    assertLeased(w, done, await leaseRows(w.hub!));
    await w.stopHub();
  }, 50 * MIN);

  it(`${AC7} its wrong program: a planted scripts/lease that runs the command directly (DEEP_HUB_PLANT=lease-script-runs-directly) fails, naming the block`, async () => {
    const w = new World({ plant: 'lease-script-runs-directly' });
    const done = await scenario(w, [PREFLIGHT, affected(1)], 30 * MIN);
    const rows = await leaseRows(w.hub!);
    await mustFail('lease-script-runs-directly', () => assertLeased(w, done, rows), [`node --test ${BLOCK}`, 'ran with no cpu.slot lease of its session']);
    await w.stopHub();
  }, 40 * MIN);
});
