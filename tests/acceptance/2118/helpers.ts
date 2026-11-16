// What #2118's hub tests share (README): the readings that say load spoiled a hook, and a wait. The worlds are the
// neighbouring suites', imported where each test needs one; nothing here stands in for DeepBuild, and no criterion's
// ID is kept here: each test file binds its own.
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism, loadavg } from 'node:os';
import { join } from 'node:path';

export const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
export const loadReading = (): string => `1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores`;

/** Polls `probe` until it answers something or `ms` pass: its answer, or undefined at the deadline, for the test's own assertion to judge. */
export async function eventually<T>(probe: () => Promise<T | undefined> | T | undefined, ms: number, every = 250): Promise<T | undefined> {
  for (const end = Date.now() + ms; ;) {
    const value = await probe();
    if (value !== undefined || Date.now() >= end) return value;
    await sleep(every);
  }
}

/**
 * Whether deep-hook says it couldn't hand a hook to the hub within its budget: it spooled the call, or denied it on
 * the floor that holds while the hub doesn't answer. Such a reply says nothing of what the hub decides, so a reading
 * that stands on it is INCONCLUSIVE, never a pass and never the criterion's failure.
 */
export const unheard = (stderr: string): boolean => /deep-hook: (spooled|could not spool)|spooled \S+, but its sync didn't finish|could not spool \S+ within|while the hub doesn't answer/.test(stderr);

/** One event of the record, as far as these readings go. */
interface Recorded { kind: string; data: Record<string, unknown> }
/**
 * Whether the hub never decided a tool call: deep-hook says so (`unheard`), or the record marks the call's tool.before
 * late, its acknowledgement having come after deep-hook stopped waiting. The record is read for up to 10 s, until it
 * holds the call. Only these two say so: a reply that merely says nothing is the hub's own, and is judged.
 */
export async function undecided(events: () => Promise<readonly Recorded[]>, call: string, stderr: string): Promise<boolean> {
  if (unheard(stderr)) return true;
  const before = await eventually(async () => (await events()).find((e) => e.kind === 'tool.before' && e.data.call === call), 10_000);
  return before?.data.late === true;
}

/**
 * The agents' own CLIs are a boundary this repo doesn't own, and the hub runs `claude plugin list --json` when a
 * session starts. As #1337's world does, a `claude` and a `codex` that list no plugins and do nothing else go first on
 * the PATH every child of this test file gets, in a folder under `dir`, so no real agent program runs under a test's
 * home (a real one would also write its settings there after the folder is removed). Returns what puts PATH back.
 */
export function standInAgents(dir: string): () => void {
  const bin = join(dir, 'agents-bin');
  mkdirSync(bin, { recursive: true });
  for (const agent of ['claude', 'codex']) writeFileSync(join(bin, agent), `#!/bin/sh\n[ "$1 $2 $3" = "plugin list --json" ] && { echo '[]'; exit 0; }\necho "${agent}: test stand-in" >&2\nexit 1\n`, { mode: 0o755 });
  const before = process.env.PATH;
  process.env.PATH = `${bin}:${before ?? '/usr/bin:/bin'}`;
  return () => { if (before === undefined) delete process.env.PATH; else process.env.PATH = before; };
}
