// Test-side tools for issue #2218's acceptance tests (README): a trusted fixture repo with a `.deepbuild/done.yaml`,
// one Claude Code session that makes a fix in it and stops, and the claim that stop makes, read back from the record.
// Everything of DeepBuild's is real: `deep hub run` in a temporary HOME, the real deep-hook for every hook, the project's
// trust decision as #348 records it, and the record through the hub's socket. Reused, not copied: ../322/helpers.ts
// (the world, trust, the session, the record's readers). This file adds only what #2218 needs: the fixture's files,
// a hub start that can put programs first on the hub's PATH (the twin's build), a stop with a longer limit for a
// loaded machine, the claim's reading, and how a verdict's words are read for a name, a count or a line.
//
// A judgement is a vitest `expect`, whose failure is the framework's own assertion failure, as the proof lanes read a
// test that failed at its assertion (scripts/proof-runs.mjs); a scenario that never reached its criterion throws a
// plain Error starting BLOCKED, which is never read as the criterion's failure.
import { spawn } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { expect } from 'vitest';
import {
  BEHAVIOR, CLI, FIX, NODE, REPO, Session, allEvents, childEnv, claimsOf, expectTask, git, lastPos, lockedFor, makeWorld, own, parseObject, replyText,
  req, shown, sleep, tag, trustRepo, type Draft, type Ev, type Hub, type Line, type Ran, type World,
} from '../322/helpers.ts';

export { REPO, cleanup } from '../322/helpers.ts';

/** Each criterion's ID: `#2218.` and the first 8 hex of SHA-256 of its text, trimmed, whitespace collapsed (scripts/proof-change.mjs). */
export const AC1 = 'AC1 #2218.21b6bc5c';
export const AC2 = 'AC2 #2218.fbc757ce';
export const AC3 = 'AC3 #2218.a145523d';
export const AC4 = 'AC4 #2218.1a2df3f9';
export const AC5 = 'AC5 #2218.cb279bf8';

/** A file of this suite's fixtures folder. */
export const fixture = (name: string): string => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
/** The repo's spec, as the fixture repo holds it. */
export const SPEC_FILE = '.deepbuild/done.yaml';

// ---- The fixture repo: #322's shop (src/auth.js, whose checkToken accepts an expired token until FIX), with this
// suite's spec, the suite the spec's check runs, and a definition of done the session's fix meets.
/** The drafted check of the task's one requirement: a guard, which passes on the base commit and after the fix. */
const GUARD = '.deepbuild/checks/valid-token.sh';
/** The definition handed for the prompt: R1, behavior that must not change, judged by GUARD. With it locked, a claim whose spec checks pass can pass. */
const DRAFT: Draft = {
  ask: BEHAVIOR,
  requirements: [req('R1', 'A token that has not expired is accepted', { check: GUARD, on_base: 'passes' })],
  deliverables: [FIX.file],
  budget: null,
};
/**
 * The suite the spec's `suite` check runs: three tests. Neither it nor the turnstile is named `*.test.js`: a run plants
 * a control in every file so named in its checkout and takes it out as it ends (design: Check health), and at the base
 * commit a run that shares its checkout, as the definition's check does, can take its own out while this one's file is
 * being read, which moves the line this run's control was written for and leaves the run uncounted. Seen once while
 * drafting (README, Unrelated findings); the criteria are about the spec's keys, so the fixture stays out of its way.
 */
const SUITE = 'tests/suite.js';
/** The test file AC1's `turnstile` check runs. */
export const TURNSTILE = 'tests/turnstile.js';

interface ShopOptions {
  /** The repo's `.deepbuild/done.yaml`. */
  spec: string;
  /** More files of the base commit, path to bytes. */
  files?: Record<string, string>;
  /** Files that name the world's own folder, committed on top before any session starts. */
  late?: (w: World) => Record<string, string>;
}
/** A world whose repo holds the spec, the suite, the drafted guard and the handed definition; trusted by your decision. */
export async function shop(o: ShopOptions): Promise<World> {
  const w = makeWorld({ drafts: [DRAFT], spec: o.spec, files: { [GUARD]: fixture('valid-token.sh'), [SUITE]: fixture('suite.js'), ...o.files } });
  const late = o.late?.(w);
  if (late) {
    for (const [path, bytes] of Object.entries(late)) {
      mkdirSync(dirname(join(w.repo, path)), { recursive: true });
      writeFileSync(join(w.repo, path), bytes);
    }
    git(w.tmp, w.repo, ['add', '.']);
    git(w.tmp, w.repo, ['commit', '-q', '-m', 'the fixture files that name this world']);
  }
  await trustRepo(w, true);
  return w;
}

/** Programs that do nothing but note their arguments, one line per call, in `<tmp>/standins.log`: first on the hub's PATH when asked for. */
export function standIns(w: World, names: string[]): { path: string; calls(): string[] } {
  const bin = join(w.tmp, 'bin');
  const log = join(w.tmp, 'standins.log');
  mkdirSync(bin, { recursive: true });
  writeFileSync(log, '');
  for (const name of names) {
    writeFileSync(join(bin, name), `#!/bin/sh\necho "${name} $*" >> '${log}'\n`);
    chmodSync(join(bin, name), 0o755);
  }
  return { path: bin, calls: () => readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}

/** `deep hub run` as #322's `startHub` starts it (HOME the world's, the handed drafts, no plant), with `path` first on its PATH when given. */
async function startHub(w: World, path?: string): Promise<Hub> {
  const env = childEnv(w.home, { DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_DRAFTS: w.drafts, DEEP_HUB_TEST_WORK: w.work, DEEP_HUB_TEST_GITHUB: w.github });
  if (path) env.PATH = `${path}:${env.PATH ?? ''}`;
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => { err = `${err}${d}`.slice(-20_000); });
  const exit = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const ready = await Promise.race([
    new Promise<Line | undefined>((resolve) => {
      child.stdout!.setEncoding('utf8').on('data', (d: string) => {
        out += d;
        if (out.includes('\n')) resolve(parseObject(out.split('\n')[0]!));
      });
    }),
    exit.then(() => undefined),
    sleep(300_000).then(() => undefined),
  ]);
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub did not start: ${err.slice(-1500)}`);
  return { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), home: w.home, root: w.root, child, exit, readyAt: Date.now(), plant: undefined, stderr: () => err };
}

// ---- The claim, read back from the record.
/** One run of the claim's checks, as run.started and run.finished record it. */
export interface RunRead { run: string; check: string; commit: string; outcome: string | null; tests: number | null; started: Ev; finished: Ev | undefined }
/** What the record shows of the claim the session's stop made. */
export interface Claimed {
  w: World; hub: Hub; ref: string; since: number; events: Ev[];
  /** `claim:<id>`, or undefined when the stop made no claim. */
  claim: string | undefined;
  /** Every verdict made on the claim, pending ones left out, in log order. */
  verdicts: Ev[];
  /** The claim's verdict as it stands: the last one made. */
  last: Ev | undefined;
  outcome: string | null;
  /** The runs started for the claim, in log order. */
  runs: RunRead[];
  /** What the stop's hook told Claude Code. */
  reply: string;
}
type Reading = Pick<Claimed, 'claim' | 'verdicts' | 'last' | 'outcome' | 'runs'>;
function readClaim(events: readonly Ev[], ref: string, since: number): Reading {
  const made = claimsOf(events, ref, since)[0];
  const claim = made ? `claim:${made.id}` : undefined;
  const verdicts = claim ? events.filter((e) => e.kind === 'verdict.made' && (e.data.claim === claim || e.subject === claim) && e.data.outcome !== 'pending') : [];
  const finished = new Map(events.filter((e) => e.kind === 'run.finished').map((e) => [String(e.data.run), e]));
  const runs = claim ? events.filter((e) => e.kind === 'run.started' && e.data.claim === claim).map((started): RunRead => {
    const f = finished.get(String(started.data.run));
    return { run: String(started.data.run), check: String(started.data.check), commit: String(started.data.commit), outcome: f ? String(f.data.outcome) : null, tests: f && typeof f.data.tests_run === 'number' ? f.data.tests_run : null, started, finished: f };
  }) : [];
  const last = verdicts.at(-1);
  return { claim, verdicts, last, outcome: last ? String(last.data.outcome) : null, runs };
}

/** How long a claim's checks may take on a loaded machine before the test reads what there is. */
const SETTLE_MS = 1_200_000;
/** How long nothing more must come for the claim, once it has a verdict and no run going, before it is read as settled. */
const QUIET_MS = 45_000;
/**
 * The record once the claim is settled: it has a verdict, none of its runs is going, and `done` holds or nothing more
 * (no run, no verdict) has come for it for QUIET_MS. A hub that makes a verdict and then starts more runs is waited
 * for; one that never judges is read at SETTLE_MS, and the test's own assertions say what is missing.
 */
async function settled(hub: Hub, ref: string, since: number, done: (c: Reading) => boolean): Promise<Ev[]> {
  const deadline = Date.now() + SETTLE_MS;
  let seen = '';
  let quiet = Date.now();
  for (;;) {
    const events = await allEvents(hub);
    const c = readClaim(events, ref, since);
    const idle = c.claim !== undefined && c.verdicts.length > 0 && c.runs.every((r) => r.finished !== undefined);
    const now = `${c.verdicts.length} ${c.runs.length} ${c.runs.filter((r) => r.finished).length}`;
    if (now !== seen || !idle) { seen = now; quiet = Date.now(); }
    if ((idle && (done(c) || Date.now() - quiet >= QUIET_MS)) || Date.now() > deadline) return events;
    await sleep(1000);
  }
}

/** The agent's last words of the turn, then Stop, as #322's `Session.stop` fires it, with ten minutes for a hold on a loaded machine. */
function stops(s: Session, words: string): Promise<Ran> {
  s.entry({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${tag(12)}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: words }], stop_reason: 'end_turn', usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } } });
  return s.hook('Stop', { stop_hook_active: false, last_assistant_message: words }, 600_000);
}

/**
 * One session in the world's repo: it types the change, reads src/auth.js, makes FIX once the handed definition has
 * locked, and stops. Resolves with the claim that stop made, once settled (`done` ends the wait early). A definition
 * that hasn't locked is BLOCKED (thrown) unless `unlocked` allows it: a hub may hold the lock back on a spec it refuses.
 */
export async function claimed(who: string, w: World, o: { done?: (c: Reading) => boolean; path?: string; unlocked?: boolean } = {}): Promise<Claimed> {
  const hub = await startHub(w, o.path);
  const s = new Session(w);
  await s.start();
  await s.typed(BEHAVIOR);
  await s.read(FIX.file);
  const locked = (all: readonly Ev[]): boolean => { try { return lockedFor(all, expectTask(all, s, BEHAVIOR, who)).length > 0; } catch { return false; } };
  const deadline = Date.now() + 180_000;
  let events = await allEvents(hub);
  while (!locked(events) && Date.now() < deadline) { await sleep(500); events = await allEvents(hub); }
  const ref = expectTask(events, s, BEHAVIOR, who);
  if (!o.unlocked && !locked(events)) throw Error(`BLOCKED: ${who} the handed definition of ${ref} must lock before the stop, so the claim is judged against it: none locked within 180 s; hub stderr ${JSON.stringify(hub.stderr().slice(-600))}`);
  const since = await lastPos(hub);
  await s.edit(FIX.file, FIX.from, FIX.to);
  const stop = await stops(s, 'checkToken now rejects a token whose exp has passed.');
  events = await settled(hub, ref, since, o.done ?? (() => false));
  const read = readClaim(events, ref, since);
  expect(read.claim, `${who} the stop after the fix must make a claim for ${ref}: no claim.made after it; the Stop hook: ${shown(stop)}; hub stderr ${JSON.stringify(hub.stderr().slice(-600))}`).toBeDefined();
  return { w, hub, ref, since, events, ...read, reply: replyText(stop) };
}

// ---- Reading a verdict's words.
/** What a verdict says in words: its reasons, and the sentence of each reason the core gave of its own (`why`). */
export function wordsOf(v: Ev | undefined): string[] {
  const reasons = Array.isArray(v?.data.reasons) ? (v!.data.reasons as unknown[]).map(String) : [];
  const why = Array.isArray(v?.data.why) ? (v!.data.why as Line[]).map((y) => String(y?.text ?? '')) : [];
  return [...new Set([...reasons, ...why])].filter(Boolean);
}
const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Whether `text` names `word` as a word of its own: not as part of a longer name. */
export const names = (text: string, word: string): boolean => new RegExp(`(?<![0-9A-Za-z_-])${escaped(word)}(?![0-9A-Za-z_-])`).test(text);
/** Whether `text` states the count `n` as a number of its own: not as digits of a longer number, a version or a handle. */
export const counts = (text: string, n: number): boolean => new RegExp(`(?<![0-9A-Za-z.])${n}(?![0-9A-Za-z])`).test(text);
/** Whether `text` names line `n`, however it writes a line: `line 12`, `L12`, `done.yaml:12`, `:12:5`. */
export const namesLine = (text: string, n: number): boolean => new RegExp(`(?<![0-9A-Za-z.])(?:[Ll](?:ine)?\\s*)?${n}(?![0-9A-Za-z])`).test(text);
/** The 1-based line of a spec on which the key `key` is written. */
export function lineOf(spec: string, key: string): number {
  const at = spec.split('\n').findIndex((line) => new RegExp(`^\\s*${escaped(key)}:`).test(line));
  if (at < 0) throw Error(`BLOCKED: the fixture spec has no key ${key}`);
  return at + 1;
}
/** Whether `text` says the owner is you: `owner you`, `owner: you`, `"owner":"you"`, `you own`, `yours`. */
export const ownerIsYou = (text: string): boolean => /\bowner\b(?:\W+\w+){0,3}?\W+you\b/i.test(text) || /\byou\b(?:\W+\w+){0,3}?\W+own/i.test(text) || /\byours\b/i.test(text);

/** A run in a few words, for failure messages. */
export const shownRun = (r: RunRead): string => `${r.run} of ${r.check} on ${r.commit.slice(0, 8)}: ${r.outcome ?? 'still going'}${r.tests === null ? '' : `, ${r.tests} tests`}`;
/** The claim in a few lines, for failure messages. */
export const shownClaim = (c: Reading): string => `${c.claim ?? 'no claim'}: verdict ${c.outcome ?? 'none'} ${JSON.stringify(wordsOf(c.last)).slice(0, 1200)}; runs: ${c.runs.map(shownRun).join('; ') || 'none'}`;
