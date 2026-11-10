// #19.21db8bc2 (AC8): "`deep status` with 30 sessions shows every session that needs you, is stuck or is flagged
// within its first 20 lines". A blind redraft (README). Thirty Claude Code sessions reach a real hub the way a real
// one does: each is its own stand-in agent process (agent.sh) that runs the built deep-hook as its hook entries run it.
// Twenty-four keep working (a Bash call every few seconds) and six need attention: two permission prompts left open,
// three turns that ended failed on a sign-in, a usage limit and a spend limit, and one agent killed mid-tool-call with
// no SessionEnd (its app quit). The fixture is built so that a listing in start order, ID order, repo-name order or
// newest-activity order puts every one of the six past line 20 (the second test proves it on the judge), so only a
// `deep status` that lists them first passes. Processes are stopped by PID only, never by name or port.

import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadavg } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  alive, buildDeepHook, childEnv, CLI, cleanup, deep, DEEP_HOOK, events, makeHome, own, REPO, run, shown, sleep, startHub,
  type Home, type Line, type Ran,
} from '../helpers.ts';

afterEach(cleanup, 60_000);

const ID = '#19.21db8bc2';
const AGENT_SH = fileURLToPath(new URL('./agent.sh', import.meta.url));
const VERSION = (JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as { versions: string[] }).versions.at(-1)!;
const MODEL = 'claude-haiku-5-5';
/** The lines of `deep status` an attention session must be named within. */
const FIRST = 20;

// ---- The plan: 30 sessions over four repos (README: The fixture).
type Kind = 'working' | 'permission' | 'signed-out' | 'usage-limit' | 'spend-limit' | 'app-quit';
interface Planned { repo: string; kind: Kind; what: string; id: string; prompt: string }
const attention = (p: { kind: Kind }): boolean => p.kind !== 'working';

/**
 * Twelve working sessions in `alder`, ten in `birch`, two in `cedar`; the six attention sessions in `cedar` and
 * `delta`, the repos that sort last. Working IDs start 0-e, attention IDs f, so they sort last by ID too.
 */
function plan(): Planned[] {
  const taken = new Set<string>();
  const id = (lead: string): string => {
    for (;;) {
      const v = `${lead}${randomUUID().slice(1)}`;
      if (!taken.has(v.slice(0, 8))) { taken.add(v.slice(0, 8)); return v; }
    }
  };
  const working = Array.from({ length: 24 }, (_, i): Planned => {
    const repo = i < 12 ? 'alder' : i < 22 ? 'birch' : 'cedar';
    return { repo, kind: 'working', what: 'working: a Bash call every few seconds', id: id('0123456789abcde'[i % 15]!), prompt: `${repo} task ${i}: make the pkg-${i} build pass` };
  });
  const six: [string, Kind, string][] = [
    ['cedar', 'permission', 'needs you: a permission prompt for a Write, open'],
    ['cedar', 'signed-out', 'its turn ended failed: signed out (authentication_failed)'],
    ['cedar', 'usage-limit', 'its turn ended failed: a usage limit hit (rate_limit)'],
    ['delta', 'permission', 'needs you: a permission prompt for a Bash call, open'],
    ['delta', 'spend-limit', 'its turn ended failed: a spend limit hit (billing_error)'],
    ['delta', 'app-quit', 'its agent process killed mid-tool-call, no SessionEnd: the app quit'],
  ];
  return [
    ...working,
    ...six.map(([repo, kind, what], i): Planned => ({ repo, kind, what, id: id('f'), prompt: `${repo} job ${i}: ship the ${kind} fix` })),
  ];
}

// ---- The judge.
/** 0-based index of the first line naming the session: by its ID's first 8 characters (which its full ID, handle and link hold too), or by its prompt. */
function lineOf(lines: readonly string[], p: Planned): number {
  const prefix = p.id.slice(0, 8);
  return lines.findIndex((l) => l.toLowerCase().includes(prefix) || l.includes(p.prompt));
}
/** One line per attention session not named within the first 20 lines of `stdout`; empty when all are. */
function misplaced(stdout: string, sessions: readonly Planned[]): string[] {
  const lines = stdout.split('\n');
  return sessions.filter(attention).flatMap((p) => {
    const at = lineOf(lines, p);
    return at >= 0 && at < FIRST ? [] : [`session ${p.id} (${p.what}; repo ${p.repo}) is ${at < 0 ? 'not shown' : `first named on line ${at + 1}`}, not within the first ${FIRST} lines`];
  });
}

// ---- The fixture on disk: repos, folders, transcripts and each session's hook payloads, as Claude Code 2.1.308 sends them (adapters/corpus/claude-code).
interface Session extends Planned { cwd: string; transcript: string; scratch: string; promptId: string; steps: string; loop?: string }
function materialize(h: Home, p: Planned, n: number): Session {
  const repoDir = join(h.tmp, 'src', p.repo);
  const cwd = join(repoDir, `pkg-${n}`);
  mkdirSync(cwd, { recursive: true });
  const transcript = join(h.home, '.claude', 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'), `${p.id}.jsonl`);
  mkdirSync(join(transcript, '..'), { recursive: true });
  const s: Session = { ...p, cwd, transcript, scratch: join(h.tmp, 'scratch', p.id, 'scratchpad'), promptId: randomUUID(), steps: join(h.tmp, 'agents', p.id, 'steps') };
  // The prompt's own transcript entry, as Claude Code writes it before the turn's hooks.
  writeFileSync(transcript, `${JSON.stringify({
    parentUuid: null, isSidechain: false, promptId: s.promptId, type: 'user', message: { role: 'user', content: p.prompt }, uuid: randomUUID(),
    timestamp: new Date().toISOString(), permissionMode: 'default', userType: 'external', entrypoint: 'cli', cwd, sessionId: p.id, version: VERSION, gitBranch: 'HEAD',
  })}\n`);
  const common = (event: string): Line => ({ session_id: p.id, transcript_path: transcript, cwd, scratchpad_dir: s.scratch, hook_event_name: event });
  const turn = (event: string): Line => ({ ...common(event), prompt_id: s.promptId, permission_mode: 'default' });
  const tool = (event: string, name: string, input: Line, extra: Line = {}): Line => ({ ...turn(event), effort: { level: 'medium' }, tool_name: name, tool_input: input, ...extra });
  const failed = (error: string, text: string): Line => ({ ...common('StopFailure'), prompt_id: s.promptId, effort: { level: 'medium' }, error, last_assistant_message: text });
  const bash = (command: string, description: string): Line => ({ command, description });
  const write: Line = { file_path: join(cwd, 'NOTES.md'), content: 'one' };
  const steps: [string, Line][] = [
    ['SessionStart', { ...common('SessionStart'), source: 'startup', model: MODEL }],
    ['UserPromptSubmit', { ...turn('UserPromptSubmit'), prompt: p.prompt }],
  ];
  const build = bash(`npm run build -w pkg-${n}`, `Build pkg-${n}`);
  const call = (k: string): string => `toolu_${p.id.slice(0, 8)}_${k}`;
  switch (p.kind) {
    case 'working': {
      steps.push(['PreToolUse', tool('PreToolUse', 'Bash', build, { tool_use_id: call('0') })]);
      s.loop = join(h.tmp, 'agents', p.id, 'loop');
      mkdirSync(s.loop, { recursive: true });
      writeFileSync(join(s.loop, 'pre.json'), JSON.stringify(tool('PreToolUse', 'Bash', build, { tool_use_id: call('@N@') })));
      writeFileSync(join(s.loop, 'post.json'), JSON.stringify(tool('PostToolUse', 'Bash', build, {
        tool_response: { stdout: 'built', stderr: '', interrupted: false, isImage: false, noOutputExpected: false }, tool_use_id: call('@N@'), duration_ms: 3000,
      })));
      break;
    }
    case 'permission': {
      const [name, input]: [string, Line] = p.repo === 'cedar' ? ['Write', write] : ['Bash', bash('npx prettier --write .', 'Format the package')];
      steps.push(['PreToolUse', tool('PreToolUse', name, input, { tool_use_id: call('0') })]);
      steps.push(['PermissionRequest', tool('PermissionRequest', name, input, {
        permission_suggestions: [name === 'Write' ? { type: 'setMode', mode: 'acceptEdits', destination: 'session' } : { type: 'addRules', rules: [{ toolName: 'Bash', ruleContent: 'npx prettier:*' }], behavior: 'allow', destination: 'localSettings' }],
      })]);
      break;
    }
    case 'signed-out': steps.push(['StopFailure', failed('authentication_failed', 'Not logged in. Please run /login.')]); break;
    case 'usage-limit': steps.push(['StopFailure', failed('rate_limit', 'You have hit your usage limit. It resets later today.')]); break;
    case 'spend-limit': steps.push(['StopFailure', failed('billing_error', 'Your credit balance is too low to continue.')]); break;
    case 'app-quit': steps.push(['PreToolUse', tool('PreToolUse', 'Bash', bash('npm run e2e', 'Run the end-to-end suite'), { tool_use_id: call('0') })]); break;
  }
  mkdirSync(s.steps, { recursive: true });
  steps.forEach(([event, body], i) => writeFileSync(join(s.steps, `${String(i + 1).padStart(2, '0')}-${event}.json`), JSON.stringify(body)));
  return s;
}

// ---- The stand-in agents.
interface Agent { s: Session; pid: number }
/** Starts the session's stand-in agent process and waits until it has run its steps; BLOCKED if a hook failed or it never got there. */
function startAgent(h: Home, s: Session): Promise<Agent> {
  return new Promise((resolve, reject) => {
    const child = spawn('/bin/sh', [AGENT_SH, DEEP_HOOK, s.steps, ...(s.loop ? [s.loop] : [])], { cwd: s.cwd, env: childEnv(h.home), stdio: ['ignore', 'pipe', 'pipe'] });
    own(child.pid);
    let out = '';
    let err = '';
    let done = false;
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ s, pid: child.pid! });
    };
    const timer = setTimeout(() => finish(Error(`BLOCKED: the stand-in agent for ${s.id} (${s.what}) didn't finish its hooks in 90 s (load ${loadavg()[0]!.toFixed(1)}): ${out}${err}`)), 90_000);
    child.stdout.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      if (!/^ready$/m.test(out)) return;
      const bad = [...out.matchAll(/^hook (\S+) (\d+)$/gm)].filter((m) => m[2] !== '0');
      finish(bad.length ? Error(`BLOCKED: deep-hook claude-code ${bad.map((m) => `${m[1]} exited ${m[2]}`).join(', ')} for ${s.id} (${s.what})`) : undefined);
    });
    child.stderr.setEncoding('utf8').on('data', (d: string) => { err += d; });
    child.on('exit', (code) => finish(Error(`BLOCKED: the stand-in agent for ${s.id} exited ${code} before its hooks ran: ${out}${err}`)));
  });
}

/** The 30 sessions, live at a real hub: the 24 working first, in batches, then the six; the app-quit one's agent then killed. */
async function world(): Promise<{ h: Home; sessions: Session[] }> {
  if (!existsSync(CLI)) throw Error(`BLOCKED: ${CLI} is missing; run npm run build --workspaces`);
  await buildDeepHook();
  const h = makeHome();
  mkdirSync(h.root, { recursive: true, mode: 0o700 });
  writeFileSync(join(h.root, 'rules.json'), `${JSON.stringify({ v: 1, entries: {} })}\n`, { mode: 0o600 });
  const planned = plan();
  for (const repo of new Set(planned.map((p) => p.repo))) {
    const dir = join(h.tmp, 'src', repo);
    mkdirSync(dir, { recursive: true });
    const r = await run('git', ['init', '-q', dir], { env: childEnv(h.home) });
    if (r.code !== 0) throw Error(`BLOCKED: git init ${dir}: ${shown(r)}`);
  }
  const sessions = planned.map((p, n) => materialize(h, p, n));
  await startHub(h.home);

  const working = sessions.filter((s) => !attention(s));
  for (let i = 0; i < working.length; i += 6) await Promise.all(working.slice(i, i + 6).map((s) => startAgent(h, s)));
  const agents = await Promise.all(sessions.filter(attention).map((s) => startAgent(h, s)));

  // The app quits under its session in the middle of a tool call: its process gone, no SessionEnd, no Stop.
  const quit = agents.find((a) => a.s.kind === 'app-quit')!;
  process.kill(quit.pid, 'SIGKILL');
  for (const deadline = Date.now() + 10_000; alive(quit.pid);) {
    if (Date.now() > deadline) throw Error(`BLOCKED: the app-quit stand-in (pid ${quit.pid}) is still alive 10 s after SIGKILL`);
    await sleep(50);
  }

  // Precondition: the hub's record holds every one of the 30 sessions.
  let missing: Session[] = sessions;
  for (const deadline = Date.now() + 30_000; missing.length;) {
    const text = (await events(h.root)).map((e) => JSON.stringify(e)).join('\n');
    missing = sessions.filter((s) => !text.includes(s.id));
    if (!missing.length) break;
    if (Date.now() > deadline) throw Error(`BLOCKED: the hub's record names ${30 - missing.length} of the 30 sessions after 30 s (load ${loadavg()[0]!.toFixed(1)}); missing: ${missing.map((s) => `${s.id} (${s.what})`).join(', ')}`);
    await sleep(500);
  }
  return { h, sessions };
}

describe(`${ID} deep status with 30 sessions`, () => {
  it(`${ID} with 30 live sessions over four repos, deep status names every session that needs you, is stuck or is flagged within its first 20 lines`, async () => {
    const { h, sessions } = await world();
    // A killed process is noticed on the hub's own clock, so the listing gets 60 s to show it; the 24 working sessions
    // keep calling tools all the while, so none of them goes quiet.
    let last: Ran | undefined;
    let problems: string[] = [];
    for (const deadline = Date.now() + 60_000; ;) {
      last = await deep(h.home, ['status'], { cwd: h.tmp });
      problems = misplaced(last.stdout, sessions);
      if (!problems.length || Date.now() > deadline) break;
      await sleep(1000);
    }
    expect(problems, `deep status, with 24 sessions working and these 6 needing attention:\n${sessions.filter(attention).map((s) => `  ${s.id}  ${s.repo}  ${s.what}`).join('\n')}\n`
      + `${problems.join('\n')}\nits output, ${shown(last!)}`).toEqual([]);
  }, 1_200_000);

  it(`${ID} (wrong programs) on this fixture, a listing in start order, ID order, repo-name order or newest-activity order fails the judge, naming a session; attention first passes`, () => {
    const sessions = plan();
    const head = ['Reading the hub at unix:/tmp/dh19t-xxxxxx/h/.deepbuild/hub.sock', '30 sessions'];
    const row = (p: Planned) => `  ${p.id.slice(0, 8)}  ${attention(p) ? 'attention' : 'working'}  claude-code`;
    const flat = (order: readonly Planned[]) => [...head, ...order.map(row)].join('\n');
    const byRepo = (order: readonly Planned[]) => {
      const out = [...head];
      for (const repo of [...new Set(order.map((p) => p.repo))]) out.push(repo, ...order.filter((p) => p.repo === repo).map(row));
      return out.join('\n');
    };
    const working = sessions.filter((p) => !attention(p));
    const six = sessions.filter(attention);
    const sortedBy = (key: (p: Planned) => string) => [...sessions].sort((a, b) => key(a).localeCompare(key(b)));
    const wrong: [string, string][] = [
      // The six start after all 24 working sessions.
      ['every session in the order it started', flat(sessions)],
      ['every session by ID', flat(sortedBy((p) => p.id))],
      ['by repo name, then ID', byRepo(sortedBy((p) => `${p.repo} ${p.id}`))],
      ['by repo name, attention first inside each repo', byRepo(sortedBy((p) => `${p.repo} ${attention(p) ? 0 : 1} ${p.id}`))],
      // The working sessions keep calling tools after the six's last hooks.
      ['newest activity first', flat([...working].reverse().concat([...six].reverse()))],
    ];
    for (const [name, listing] of wrong) {
      const problems = misplaced(listing, sessions);
      expect(problems.length, `the judge passes a listing ${name}:\n${listing}`).toBeGreaterThan(0);
      expect(problems.join('\n')).toMatch(/session f[0-9a-f]{7}-/);
    }
    expect(misplaced(byRepo([...six, ...working]), sessions), 'the judge fails a listing with the six first').toEqual([]);
  });
});
