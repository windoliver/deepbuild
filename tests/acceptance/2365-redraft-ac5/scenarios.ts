// The runs AC5 judges. Each scenario writes transcripts and runs archive passes as one #20 acceptance test or one of
// #20's perf tasks does (README, The transcripts); then the runner:
//   1. lists every transcript file the scenario left under the agents' homes (the finished files);
//   2. runs one more pass an hour later, nothing changed, with the read meter on those files (meter.ts);
//   3. reads the session's parts back through the record and the evidence store, and joins them (`readings`);
//   4. runs the merge base's own archive once over the same finished files (base.ts) for its one copy of each.
// `problemsOf` is the criterion's check on what a run left; it names the session and the file.

import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import type { Event } from '../../../packages/record/src/index.ts';
import {
  allEvents, appendClaude, ARCHIVE, claudeHome, claudeTranscript, codexHome, codexTranscript, DAY, handle, HOUR, letters, MINUTE, mulberry32, numbered,
  openArchiveOn, openWorld, T0, tempDir, tinyHome, tinyTranscript, word, type Env, type World,
} from '../20/helpers.ts';
import { appendSession, linesUpTo, session, writeSession } from '../20/generate.ts';
import { baseCopies, perfGenerator, type BaseRun } from './base.ts';
import { meterReads } from './meter.ts';

const MB = 1_000_000;

// ---- The criterion, and its ID: `#2365.<first 8 hex of the SHA-256 of its text>` (trimmed, whitespace collapsed).
export const CRITERION = "For every transcript in #20's suite and its perf tasks, the parts joined are byte-identical to the one copy the merge base stores of the finished file, and a second pass over an unchanged transcript reads none of it";
export const AC5 = `#2365.${createHash('sha256').update(CRITERION.trim().replace(/\s+/g, ' ')).digest('hex').slice(0, 8)}`;

// ---- What is archived: the real archive through its public entry, or a twin (wrong.ts).
export interface Runner { pass(): Promise<void>; close?(): Promise<void> }
export type Make = (w: World, held: readonly string[]) => Promise<Runner>;
export const realArchive: Make = (w, held) => openArchiveOn(w, { held });

export interface Scenario {
  name: string;
  /** The agents' homes beyond the world's HOME, when the #20 test moves them. */
  env?: () => Env;
  held?: readonly string[];
  /** Writes the transcripts and runs the passes; `pass(ms)` advances the clock by `ms` (an hour by default) and runs one. */
  run(env: Env, pass: (ms?: number) => Promise<void>): Promise<void>;
}

/** A transcript file the scenario left, its session handle, and what the change and the merge base made of it. */
export interface Seen {
  agent: string;
  path: string;
  session: string;
  size: number;
  /** Bytes the unchanged second pass read of it, and whole-file operations on it. */
  read: number;
  whole: string[];
  /** The candidate joins of its parts, in the order the record holds them (README, Readings: the parts). */
  readings: { name: string; bytes: Buffer }[];
  /** The merge base's copies of it, from one pass on the finished file. */
  base: Buffer[];
}
export interface Run { scenario: string; base: BaseRun; secondPass: string | null; seen: Seen[] }

/** Every transcript under the agents' homes, as their facts lay them out: Claude Code, Codex and #20's `tiny`. */
export function transcriptsIn(env: Env): { agent: string; path: string; id: string }[] {
  const found: { agent: string; path: string; id: string }[] = [];
  const walk = (dir: string, take: (file: string) => string | undefined, agent: string): void => {
    if (!existsSync(dir)) return;
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path, take, agent);
      else if (entry.isFile()) { const id = take(entry.name); if (id) found.push({ agent, path, id }); }
    }
  };
  const projects = join(claudeHome(env), 'projects');
  if (existsSync(projects)) {
    for (const folder of readdirSync(projects, { withFileTypes: true })) {
      if (!folder.isDirectory()) continue;
      for (const f of readdirSync(join(projects, folder.name))) if (f.endsWith('.jsonl')) found.push({ agent: 'claude', path: join(projects, folder.name, f), id: basename(f, '.jsonl') });
    }
  }
  walk(join(codexHome(env), 'sessions'), (f) => /^rollout-.*-([0-9a-f-]{36})\.jsonl$/.exec(f)?.[1], 'codex');
  const tiny = join(tinyHome(env), 'sessions');
  if (existsSync(tiny)) for (const f of readdirSync(tiny)) if (f.endsWith('.jsonl')) found.push({ agent: 'tiny', path: join(tiny, f), id: basename(f, '.jsonl') });
  return found;
}

/**
 * A session's parts as the record and the store hold them. The events are those the archive wrote through its
 * connection that name the session (`data.session`, as transcript.archived does, or the event's own session), other
 * than the asks core's, each with the evidence it links (the event's `evidence` list), in log order. Each candidate
 * join is either one event's list joined in order (a whole copy, as the merge base links one, or an event listing
 * every part), or the lists of a run of consecutive events up to the newest, joined in order (one part per event).
 */
export async function readings(w: World, id: string): Promise<{ name: string; bytes: Buffer }[]> {
  const events = (await allEvents(w.record)).filter((e: Event) => e.writer === ARCHIVE.writer && !e.kind.startsWith('ask.') && e.evidence.length > 0
    && ((e.data as { session?: unknown } | null)?.session === handle(id) || (e.session !== undefined && letters(e.session) === letters(id))));
  const cache = new Map<string, Buffer>();
  const bytesOf = async (sha: string): Promise<Buffer> => {
    let b = cache.get(sha);
    if (!b) { b = Buffer.from(await w.store.read(sha).catch(() => new Uint8Array())); cache.set(sha, b); }
    return b;
  };
  const joined = async (shas: readonly string[]): Promise<Buffer> => Buffer.concat(await Promise.all(shas.map(bytesOf)));
  const out: { name: string; bytes: Buffer }[] = [];
  for (let k = 0; k < events.length; k++) {
    const run = events.slice(k);
    out.push({ name: `the parts of events ${k + 1}…${events.length} of ${events.length} (${run[0]!.kind}…) in order`, bytes: await joined(run.flatMap((e) => e.evidence)) });
  }
  for (let k = events.length - 1; k >= 0; k--) out.push({ name: `event ${k + 1} of ${events.length} (${events[k]!.kind}) alone`, bytes: await joined(events[k]!.evidence) });
  return out;
}

/** Runs a scenario on a fresh world with `make`, then judges nothing: it returns what the criterion's check reads. */
export async function runScenario(s: Scenario, make: Make = realArchive): Promise<Run> {
  const extra = s.env?.() ?? {};
  const w = await openWorld({ env: extra });
  const held = s.held ?? [];
  let archive: Runner | undefined;
  try {
    archive = await make(w, held);
    const a = archive;
    await s.run(w.env, async (ms = HOUR) => { w.clock.tick(ms); await a.pass(); });
    const files = transcriptsIn(w.env);
    if (!files.length) throw Error(`BLOCKED: scenario ${s.name} left no transcript`);
    w.clock.tick(HOUR);
    const meter = await meterReads(files.map((f) => f.path));
    let secondPass: string | null = null;
    try {
      await a.pass();
    } catch (e) {
      secondPass = (e as Error).message;
    } finally {
      meter.stop();
    }
    const base = baseCopies(w.env, held);
    const seen: Seen[] = [];
    for (const f of files) {
      const session = handle(f.id);
      seen.push({
        agent: f.agent, path: f.path, session, size: readFileSync(f.path).length,
        read: meter.bytes.get(f.path) ?? 0, whole: meter.whole.filter((x) => x.endsWith(f.path)),
        readings: await readings(w, f.id),
        base: base.copies.filter((c) => c.session === session).map((c) => c.bytes),
      });
    }
    return { scenario: s.name, base, secondPass, seen };
  } finally {
    await archive?.close?.();
    await w.close();
    // This run's temp folders (its world, and the agents' homes it moved), so a batch leaves the disk as it found it.
    for (const dir of [w.dir, ...Object.values(extra).map((p) => /^(.*\/dh20-[^/]+)/.exec(p ?? '')?.[1])]) if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

/** The first line where two texts differ, both shown cut short. */
export function firstDifference(want: Buffer, got: Buffer): string {
  const a = want.toString('utf8').split('\n');
  const b = got.toString('utf8').split('\n');
  const cut = (s: string | undefined) => (s === undefined ? '(none)' : JSON.stringify(s.length > 120 ? `${s.slice(0, 120)}…` : s));
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) return `line ${i + 1} differs: the merge base's copy has ${cut(a[i])}, the parts joined have ${cut(b[i])}`;
  }
  return 'the same lines, other bytes';
}

/** The criterion on what a run left: one finding per transcript and clause that fails; none when it holds. */
export function problemsOf(run: Run): string[] {
  const problems: string[] = [];
  if (run.base.error) problems.push(`BLOCKED: ${run.scenario}: the merge base's archive (${run.base.sha.slice(0, 12)}) left copies undone: ${run.base.error}`);
  if (run.secondPass) problems.push(`${run.scenario}: the second pass over unchanged transcripts failed: ${run.secondPass}`);
  for (const t of run.seen) {
    const at = `${run.scenario}: ${t.session} (${t.agent}, ${t.path}, ${t.size} bytes)`;
    if (t.base.length !== 1) {
      problems.push(`BLOCKED: ${at}: the merge base stored ${t.base.length} copies of the finished file, not its one copy`);
    } else if (!t.readings.some((r) => r.bytes.equals(t.base[0]!))) {
      const all = t.readings[0];
      problems.push(all
        ? `${at}: no join of its parts is byte-identical to the merge base's one copy (${t.base[0]!.length} bytes); ${all.name}: ${all.bytes.length} bytes, ${firstDifference(t.base[0]!, all.bytes)}`
        : `${at}: no event the archive wrote links a part of it`);
    }
    if (t.read > 0) problems.push(`${at}: the second pass over the unchanged transcript read ${t.read} bytes of it`);
    if (t.whole.length) problems.push(`${at}: the second pass over the unchanged transcript read it whole: ${t.whole.join(', ')}`);
  }
  return problems;
}

// ---- #20's acceptance suite: every transcript its tests write, written and archived as each test does. Keys and the
// held value the #20 tests draw at random are drawn here from fixed seeds; the CI logs of #20 AC6 are not transcripts.
const key = (seed: number): string => `ghp_${word(mulberry32(seed), 36)}`;
const heldSecret = word(mulberry32(0x2365_0005), 28, 'abcdefghijklmnopqrstuvwxyz');
export const SUITE: Scenario[] = [
  {
    name: '#20 AC1 (copies.test.ts): Claude Code and Codex in moved homes, a new adapter in its default home',
    env: () => { const agents = tempDir('agents'); return { CLAUDE_CONFIG_DIR: join(agents, 'claude-config'), CODEX_HOME: join(agents, 'codex-home') }; },
    async run(env, pass) {
      claudeTranscript(env, numbered(1, 6, 'claude'));
      codexTranscript(env, ['codex: fix the checkout total', 'codex: now run the tests']);
      tinyTranscript(env, ['tiny: rename the cart module']);
      await pass();
    },
  },
  {
    name: '#20 AC2 (copies.test.ts): two Claude Code sessions, one grown before its first pass, and a Codex rollout',
    async run(env, pass) {
      const claude = claudeTranscript(env, numbered(1, 8, 'first'));
      claudeTranscript(env, numbered(1, 3, 'second'), { cwd: '/tmp/dh20-work/api' });
      appendClaude(claude, numbered(9, 12, 'first'));
      codexTranscript(env, ['codex: add the refund route']);
      await pass();
      await pass();
    },
  },
  {
    name: '#20 AC3 (quiet.test.ts): a session captured hourly for three hours',
    async run(env, pass) {
      const t = claudeTranscript(env, numbered(1, 3, 'hour 0'), { at: T0 });
      await pass();
      for (let hour = 1; hour <= 3; hour++) { appendClaude(t, numbered(hour * 10 + 1, hour * 10 + 3, `hour ${hour}`), T0 + hour * HOUR); await pass(); }
    },
  },
  {
    name: '#20 AC3 (quiet.test.ts): a session captured every hour for 28 hours',
    async run(env, pass) {
      const t = claudeTranscript(env, numbered(1, 3, 'hour 0'), { at: T0 });
      await pass();
      for (let hour = 1; hour <= 3 + 25; hour++) { appendClaude(t, numbered(hour * 10 + 1, hour * 10 + 3, `hour ${hour}`), T0 + hour * HOUR); await pass(); }
    },
  },
  {
    name: '#20 AC4 (secrets.test.ts): a key pasted into a user message',
    async run(env, pass) {
      claudeTranscript(env, [
        ...numbered(1, 2, 'setup'),
        { uuid: 'm3', role: 'user', text: `here is my GitHub token so you can push: ${key(0x2365_0041)} use it for the deploy` },
        { uuid: 'm4', role: 'assistant', text: 'Thanks. I will set up the deploy step now.' },
      ]);
      await pass();
    },
  },
  {
    name: '#20 AC4 (secrets.test.ts): a key pasted first, the session grown after two passes',
    async run(env, pass) {
      const t = claudeTranscript(env, [{ uuid: 'm1', role: 'user', text: `use this token: ${key(0x2365_0042)}` }, ...numbered(2, 4, 'after')]);
      await pass();
      await pass();
      appendClaude(t, numbered(5, 9, 'later'));
      await pass();
    },
  },
  {
    name: '#20 AC5 (secrets.test.ts): a held value with no pattern pasted into a user message',
    held: [heldSecret],
    async run(env, pass) {
      claudeTranscript(env, [...numbered(1, 2, 'setup'), { uuid: 'm3', role: 'user', text: `the staging database password is ${heldSecret} so log in with it` }, ...numbered(4, 5, 'after')]);
      await pass();
    },
  },
  {
    name: '#20 AC8 (readback.test.ts): a plain session, a keyed one and a Codex rollout; and the session whose copy the store bent, here unbent',
    async run(env, pass) {
      claudeTranscript(env, numbered(1, 5, 'plain'));
      claudeTranscript(env, [...numbered(1, 2, 'keyed'), { uuid: 'm3', role: 'user', text: `deploy with ghp_${word(mulberry32(0x20_08), 36)} please` }], { cwd: '/tmp/dh20-work/api' });
      codexTranscript(env, ['codex: tidy the cart']);
      claudeTranscript(env, numbered(1, 6, 'bent'), { cwd: '/tmp/dh20-work/bent' });
      await pass();
    },
  },
  {
    name: "#20 AC9 (retention.test.ts): a session with a deploy token, in Claude Code's default home",
    async run(env, pass) {
      claudeTranscript(env, [...numbered(1, 3, 'kept'), { uuid: 'm4', role: 'user', text: `the deploy token is ${key(0x2365_0009)}` }, ...numbered(5, 6, 'kept')]);
      await pass();
    },
  },
  {
    name: '#20 AC10 (growth.test.ts): a session archived at 10 lines and again at 50',
    async run(env, pass) {
      const t = claudeTranscript(env, numbered(1, 10, 'grow'));
      await pass();
      appendClaude(t, numbered(11, 50, 'grow'));
      await pass();
    },
  },
];

// ---- #20's suite, its budgets (budgets.test.ts): sessions from generate.ts, as each budget writes and archives them.
export const BUDGET_LIVE: Scenario = {
  name: '#20 AC7 (budgets.test.ts): ten live sessions, 1 MB in, 12 lines a minute for six minutes',
  async run(env, pass) {
    const live = Array.from({ length: 10 }, (_, i) => {
      const g = session(0x20_7000 + i, 3 * MB, T0);
      const at = linesUpTo(g, MB);
      writeSession(env, g, at);
      return { g, at };
    });
    await pass();
    for (let minute = 0; minute < 6; minute++) {
      for (const s of live) { appendSession(env, s.g, s.at, s.at + 12); s.at += 12; }
      await pass(MINUTE);
    }
  },
};
/** One day of the heavy month: 20 sessions archived at half their 5 MB and again whole. */
export const budgetMonthDay = (day: number): Scenario => ({
  name: `#20 AC7 (budgets.test.ts): day ${day} of the heavy month, 20 sessions at half and whole`,
  async run(env, pass) {
    const seeds = Array.from({ length: 20 }, (_, s) => 0x20_3000 + day * 100 + s);
    for (const seed of seeds) { const g = session(seed, 5 * MB, T0 + day * DAY); writeSession(env, g, linesUpTo(g, 2.5 * MB)); }
    await pass(4 * HOUR);
    for (const seed of seeds) writeSession(env, session(seed, 5 * MB, T0 + day * DAY));
    await pass(6 * HOUR);
  },
});
/** Sessions `from`…`to - 1` of the 1 GB backlog (200 sessions of 5 MB), archived in one pass. */
export const budgetBacklog = (from: number, to: number): Scenario => ({
  name: `#20 AC7 (budgets.test.ts): backlog sessions ${from}…${to - 1} of 200, 5 MB each, in one pass`,
  async run(env, pass) {
    for (let i = from; i < to; i++) writeSession(env, session(0x20_1000 + i, 5 * MB, T0 - 10 * DAY + i * HOUR));
    await pass();
  },
});

// ---- #20's perf tasks (benchmarks/archive.mjs at the merge base): its own generator, its own steps, under a temp
// CLAUDE_CONFIG_DIR in its folder `projects/-tmp-shop`.
const perfEnv = (): Env => ({ CLAUDE_CONFIG_DIR: join(tempDir('perf'), 'claude') });
const perfFolder = (env: Env): string => { const f = join(env.CLAUDE_CONFIG_DIR!, 'projects', '-tmp-shop'); mkdirSync(f, { recursive: true }); return f; };
type PerfSession = { id: string; lines: string[] };
const perfWrite = (env: Env, s: PerfSession, upTo: number): void => writeFileSync(join(perfFolder(env), `${s.id}.jsonl`), s.lines.slice(0, upTo).join(''));
export const PERF: Scenario[] = [
  {
    name: 'perf task archive-live: ten sessions 1 MB in, 12 lines a minute, a pass a minute for five minutes',
    env: perfEnv,
    async run(env, pass) {
      const transcript = perfGenerator();
      const live = Array.from({ length: 10 }, (_, i) => ({ s: transcript(0x2070 + i, 2 * MB), at: 0 }));
      for (const l of live) {
        for (let bytes = 0; bytes < MB; l.at++) bytes += l.s.lines[l.at]!.length;
        perfWrite(env, l.s, l.at);
      }
      await pass();
      for (let minute = 0; minute < 5; minute++) {
        for (const l of live) { appendFileSync(join(perfFolder(env), `${l.s.id}.jsonl`), l.s.lines.slice(l.at, l.at + 12).join('')); l.at += 12; }
        await pass(MINUTE);
      }
    },
  },
  {
    name: 'perf task archive-month: four 5 MB sessions at half and whole',
    env: perfEnv,
    async run(env, pass) {
      const transcript = perfGenerator();
      const day = Array.from({ length: 4 }, (_, i) => transcript(0x2030 + i, 5 * MB));
      for (const s of day) perfWrite(env, s, s.lines.length >> 1);
      await pass();
      for (const s of day) perfWrite(env, s, s.lines.length);
      await pass(6 * 60 * MINUTE);
    },
  },
  {
    name: 'perf task archive-backlog: twenty 5 MB sessions in one pass',
    env: perfEnv,
    async run(env, pass) {
      const transcript = perfGenerator();
      for (let i = 0; i < 20; i++) { const s = transcript(0x2010 + i, 5 * MB); perfWrite(env, s, s.lines.length); }
      await pass();
    },
  },
];
