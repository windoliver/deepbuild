// The kit gate@1 (#33; design: the done-gate row, How we know version 0 works): the seeded false dones and their
// clean twins as a fixture corpus, its completeness check, and a run that plays each case on the done gate this
// checkout builds. It opens as gate@1's kit once a second done gate exists; until then the shipped gate is its fill.
//
//   check: every tag the corpus must hold (one per non-PASS row of the verdict table, as the Lean model states it, and
//          one per known way to fake a pass) is covered, and every case is well formed.
//   run:   each case's claim and twin, one session each on a hub of their own; a play passes when the gate's verdict
//          on its last claim is one the case expects and names what it must.
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  REPO, Owned, Session, commitTree, events, filesOf, killHub, lastClaim, makeWorld, replyText, sleep, startHub, taskOf,
  type Ev, type Hub, type Ran, type World,
} from './gate-play.js';

export const CORPUS = join(REPO, 'packages/conformance/fixtures/gate');
const OUTCOMES = ['PASS', 'FAIL', 'INVALID', 'BLOCKED', 'INCONCLUSIVE', 'pending'] as const;
type Outcome = typeof OUTCOMES[number];
interface Play { commits: string[]; expected: Outcome | Outcome[]; names?: string[] }
/** The kit's own instructions for what the commits can't make; applied to the claim's play only, so the twin is the same claim with no fault. */
export interface Setup {
  /** Folders of this checkout cloned into the world's repo before its base commit, such as node_modules/vitest. */
  installs?: string[];
  /** hub-killed: the hub is killed once a run of the claim has started and is started again; disk-full: the record refuses writes from the last stop on. */
  fault?: 'hub-killed' | 'disk-full';
  /** Files written into the world's home before the hub starts, path under HOME → text, for the claim (and `twin_files` for the twin). */
  files?: Record<string, string>;
  twin_files?: Record<string, string>;
  /**
   * Ignored files the kit writes into the world's repo before the claim's last commit, path → text: what changed with
   * no commit, such as a cache that warmed, so a flaky check's next run can pass on inputs that didn't change.
   */
  last_files?: Record<string, string>;
  /** Commands this machine must run cleanly for the case to be played, such as `python3 -m pytest --version`; a play without them is BLOCKED, naming the command. */
  needs?: string[];
  /** How long to wait for the verdict after the last stop; 180 s by default. */
  wait_ms?: number;
}
export interface Case { id: string; covers: string[]; dir: string; prompt: string; stop?: string; drafts?: unknown[]; readings?: unknown[]; setup?: Setup; claim: Play; twin: Play }
interface Manifest { kit: string; cases: Case[] }

const FAKES = ['edited-expectation', 'skip-marker', 'exit-before-assertions', 'fixture-special-case', 'patched-clock', 'always-true-verify', 'overridden-equality', 'rerecorded-golden', 'swallowed-exception', 'check-runs-no-test'].map((f) => `fake:${f}`);
const NUMERIC = ['fp16-accumulation', 'clamped-softmax', 'skipped-blocks', 'unnamed-baseline', 'warm-caches'].map((f) => `numeric:${f}`);
const REPORTING = ['root-conftest', 'vitest-setup-outside-tests', 'rewrite-on-import', 'reads-expected-output'].map((f) => `reporting:${f}`);
const MODES = ['hub-killed', 'disk-full', 'env-missing', 'token-expired'].map((f) => `mode:${f}`);

/** The verdict table's rows that set an outcome other than PASS: `Row` in the Lean model, with `Row.result`. */
export function falseDoneRows(): string[] {
  const lean = readFileSync(join(REPO, 'packages/verdicts/model/Verdicts/Model.lean'), 'utf8');
  const rows = [...(/inductive Row where\n((?:\s+\|\s*\w+\n)+)/.exec(lean)?.[1] ?? '').matchAll(/\|\s*(\w+)/g)].map((m) => m[1]!);
  const body = /def Row\.result : Row → Result\n([\s\S]*?)\n\n/.exec(lean)?.[1] ?? '';
  const pass = new Set<string>();
  let waiting: string[] = [];
  for (const line of body.split('\n')) {
    const names = [...line.split('=>')[0]!.matchAll(/\.(\w+)/g)].map((m) => m[1]!);
    const result = /=>\s*\.(\w+)/.exec(line)?.[1];
    if (!result) { waiting.push(...names); continue; }
    if (result === 'PASS') for (const n of [...waiting, ...names]) pass.add(n);
    waiting = [];
  }
  if (!rows.length) throw Error('packages/verdicts/model/Verdicts/Model.lean declares no Row');
  return rows.filter((r) => !pass.has(r));
}
/** Every tag a complete corpus covers. */
export const requiredTags = (): string[] => ['seeded-bug', 'edited-assertion', 'retry:empty-commit', ...falseDoneRows().map((r) => `row:${r}`), ...FAKES, ...NUMERIC, ...REPORTING, ...MODES];

const expectedOf = (p: Play): Outcome[] => (Array.isArray(p.expected) ? p.expected : [p.expected]);
function readManifest(corpus: string): Manifest {
  const m = JSON.parse(readFileSync(join(corpus, 'manifest.json'), 'utf8')) as Manifest;
  if (m.kit !== 'gate@1' || !Array.isArray(m.cases)) throw Error(`${join(corpus, 'manifest.json')} names no gate@1 cases`);
  return m;
}
const isDir = (p: string): boolean => { try { return statSync(p).isDirectory(); } catch { return false; } };

/** What is wrong with a case, each as one sentence. */
function malformed(corpus: string, c: Case, seen: Set<string>): string[] {
  const out: string[] = [];
  if (!/^[a-z0-9-]+$/.test(String(c.id))) out.push(`its id ${JSON.stringify(c.id)} isn't [a-z0-9-]+`);
  if (seen.has(c.id)) out.push('its id is used twice');
  seen.add(c.id);
  if (!Array.isArray(c.covers) || !c.covers.length) out.push('it covers no tag');
  if (typeof c.prompt !== 'string' || !c.prompt) out.push('it has no prompt');
  for (const [name, p] of [['claim', c.claim], ['twin', c.twin]] as const) {
    if (!p || !Array.isArray(p.commits) || !p.commits.length) { out.push(`its ${name} plays no commit`); continue; }
    const bad = expectedOf(p).filter((o) => !OUTCOMES.includes(o));
    if (bad.length || !expectedOf(p).length) out.push(`its ${name} expects ${JSON.stringify(p.expected)}`);
    for (const folder of ['base', ...p.commits]) if (!isDir(join(corpus, c.dir, folder))) out.push(`${join(c.dir, folder)} is missing`);
  }
  if (c.claim && expectedOf(c.claim).includes('PASS')) out.push('its claim, a false done, expects PASS');
  if (c.twin && expectedOf(c.twin).join() !== 'PASS') out.push('its clean twin expects something other than PASS');
  return out;
}

/** The completeness check: a FAIL line per missing tag and per malformed case, then the judgement. */
export function gateCheck(corpus: string, print: (line: string) => void): 0 | 1 {
  const m = readManifest(corpus);
  const covered = new Set(m.cases.flatMap((c) => c.covers ?? []));
  const missing = requiredTags().filter((t) => !covered.has(t));
  const seen = new Set<string>();
  const broken = m.cases.flatMap((c) => malformed(corpus, c, seen).map((why) => `${c.id}: ${why}`));
  for (const t of missing) print(`FAIL gate@1 corpus: missing ${t}`);
  for (const b of broken) print(`FAIL gate@1 corpus: ${b}`);
  if (missing.length || broken.length) { print(`FAIL gate@1 corpus: ${missing.length} tags missing, ${broken.length} cases malformed`); return 1; }
  print(`PASS gate@1 corpus: ${m.cases.length} cases`);
  return 0;
}

type Judgement = 'PASS' | 'FAIL' | 'BLOCKED' | 'INCONCLUSIVE';
interface Result { judgement: Judgement; outcome: string; reasons: string }

/** The verdict word a stop's reply shows, when the record holds none (a full disk). */
const shownOutcome = (text: string): string | undefined => /\b(PASS|FAIL|INVALID|BLOCKED|INCONCLUSIVE)\b/.exec(text)?.[1];

/** One play: the case's claim or twin, on a world and a hub of its own. */
async function play(corpus: string, c: Case, which: 'claim' | 'twin'): Promise<Result> {
  const owned = new Owned();
  const p = which === 'claim' ? c.claim : c.twin;
  const fault = which === 'claim' ? c.setup?.fault : undefined;
  try {
    for (const command of c.setup?.needs ?? []) {
      const r = spawnSync('/bin/sh', ['-c', command], { encoding: 'utf8', timeout: 60_000 });
      if (r.status !== 0) return { judgement: 'BLOCKED', outcome: 'none', reasons: `this machine can't run \`${command}\`: ${`${r.stderr ?? ''}${r.stdout ?? ''}`.trim().split('\n').pop() ?? ''}` };
    }
    const w: World = makeWorld(owned, join(corpus, c.dir, 'base'), { drafts: c.drafts, readings: c.readings, installs: c.setup?.installs });
    for (const [path, text] of Object.entries((which === 'claim' ? c.setup?.files : c.setup?.twin_files) ?? {})) writeFileSync(join(w.home, path), text);
    const full = join(w.tmp, 'disk-full');
    const env = fault === 'disk-full' ? { DEEP_HUB_TEST_VFS: JSON.stringify({ refuse: full }) } : {};
    let hub: Hub;
    try { hub = await startHub(owned, w, env); } catch (error) { return { judgement: 'BLOCKED', outcome: 'none', reasons: (error as Error).message.slice(0, 300) }; }
    const s = new Session(owned, w);
    await s.start();
    await s.typed(c.prompt);
    let last: Ran | undefined;
    for (const [i, folder] of p.commits.entries()) {
      await commitTree(w, s, filesOf(join(corpus, c.dir, folder)), `${c.id} ${which} ${i + 1}`);
      const final = i === p.commits.length - 1;
      if (final && which === 'claim') for (const [path, text] of Object.entries(c.setup?.last_files ?? {})) writeFileSync(join(w.repo, path), text);
      if (final && fault === 'disk-full') writeFileSync(full, 'full\n');
      if (final && fault === 'hub-killed') {
        const stopping = s.stop(c.stop ?? 'Done.');
        const started = await until(hub, (all) => all.some((e) => e.kind === 'run.started' && !all.some((f) => f.kind === 'run.finished' && f.data.run === e.data.run)), 120_000);
        if (!started) return { judgement: 'INCONCLUSIVE', outcome: 'none', reasons: 'no run of the claim started, so the hub could not be killed mid-run' };
        await killHub(hub);
        last = await stopping;
        hub = await startHub(owned, w, env);
      } else last = await s.stop(c.stop ?? 'Done.');
    }
    const reply = last ? replyText(last) : '';
    const wait = c.setup?.wait_ms ?? 180_000;
    let all: Ev[] = [];
    let decided: { claims: Ev[]; verdict: Ev | undefined } = { claims: [], verdict: undefined };
    const deadline = Date.now() + wait;
    for (;;) {
      try { all = await events(hub); } catch { if (fault !== 'disk-full') throw Error('the hub stopped answering'); }
      const task = taskOf(all, s);
      decided = task ? lastClaim(all, task, s) : decided;
      if (decided.verdict || Date.now() > deadline) break;
      await sleep(500);
    }
    const v = decided.verdict;
    const outcome = v ? String(v.data.outcome) : shownOutcome(reply) ?? (decided.claims.length ? 'pending' : 'none');
    const words = `${reply}\n${v ? JSON.stringify(v.data) : ''}`;
    const reasons = [...new Set([...(v && Array.isArray(v.data.reasons) ? v.data.reasons.map(String) : []), ...(v ? [] : reply.split('\n').filter(Boolean).slice(0, 3))])].join('; ').replace(/\s+/g, ' ');
    const unnamed = (p.names ?? []).filter((n) => !words.includes(n));
    const met = expectedOf(p).includes(outcome as Outcome) && !unnamed.length;
    return { judgement: met ? 'PASS' : 'FAIL', outcome, reasons: unnamed.length && expectedOf(p).includes(outcome as Outcome) ? `${reasons} (names none of ${unnamed.join(', ')})` : reasons };
  } catch (error) {
    const message = (error as Error).message;
    return { judgement: message.startsWith('BLOCKED') ? 'BLOCKED' : 'INCONCLUSIVE', outcome: 'none', reasons: message.slice(0, 300) };
  } finally {
    await owned.stop();
  }
}
async function until(hub: Hub, done: (all: Ev[]) => boolean, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (done(await events(hub))) return true; await sleep(100); }
  return false;
}

/** How many plays run at once: each starts a hub and its checks. */
const AT_ONCE = 3;

/** The kit's run: each named case (every case when none is), its claim and its twin, one line each, then the judgement. */
export async function gateRun(corpus: string, ids: string[], print: (line: string) => void): Promise<0 | 1 | 3> {
  const m = readManifest(corpus);
  const unknown = ids.filter((id) => !m.cases.some((c) => c.id === id));
  if (unknown.length) throw Error(`no case named ${unknown.join(', ')}`);
  const cases = ids.length ? m.cases.filter((c) => ids.includes(c.id)) : m.cases;
  const plays = cases.flatMap((c) => (['claim', 'twin'] as const).map((which) => ({ c, which })));
  const judged: Judgement[] = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(AT_ONCE, plays.length) }, async () => {
    while (next < plays.length) {
      const { c, which } = plays[next++]!;
      const r = await play(corpus, c, which);
      judged.push(r.judgement);
      print(`${r.judgement} ${c.id} ${which}: ${r.outcome}${r.reasons ? ` — ${r.reasons}` : ''}`);
    }
  }));
  const verdict: Judgement = judged.includes('FAIL') ? 'FAIL' : judged.every((j) => j === 'PASS') ? 'PASS' : judged.includes('BLOCKED') ? 'BLOCKED' : 'INCONCLUSIVE';
  print(`${verdict} gate@1: ${cases.length} cases`);
  return verdict === 'PASS' ? 0 : verdict === 'FAIL' ? 1 : 3;
}

