// #1906, the children criterion: "Every child the core thread starts is in `children.ts`'s table at exit: a test
// fails on the merge base for the two forks", with the scope line "The two forks go through `children.ts`" and the
// issue's sites, `open-items.ts:57-60` and `scope.ts:82` (README).
//
// One real hub (`deep hub run`) with fixtures/threads.mjs loaded into each of its threads, and one Claude Code session
// sent over the hub's socket in the hook protocol's lines. The session's handed definition locks, it leaves a
// placeholder in a file it edits and in a file it creates, and it stops. The record then shows what each fork's
// output gave (the two placeholder items; the usual size read from the repo's own history), so each `git` ran; the
// preload's log says which thread started it. `children.ts` starts its children from its own thread
// (children-worker.js), so a fork that goes through it is started there and nowhere else.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, it } from 'vitest';
import { ulid } from '../../../../packages/record/src/index.ts';
import {
  BEHAVIOR, BEHAVIOR_DRAFT, CLI, COVERED, FLAG, NODE, REPO, USUAL, childEnv, cleanup, listed, lockedFor, makeWorld, must, own, parseObject, plan, said, settle,
  sleep, type Ev, type Hub, type Line,
} from '../../324/helpers.ts';

afterAll(cleanup, 60_000);

const AC = '#1906 children';
const PRELOAD = fileURLToPath(new URL('./fixtures/threads.mjs', import.meta.url));
/** The file the session creates, with a placeholder: only the listing of untracked files finds it. */
const NEW_FILE = 'src/refresh.js';
/** The placeholder the session adds to the tracked file it edits: only the diff against the base finds it. */
const EDIT_TODO = '// TODO: reject a token with no exp';
const NEW_TODO = '// TODO: wire the refresh endpoint';

/** One child process a thread of the hub started, as the preload recorded it. */
interface Start { pid: number; thread: number; main: boolean; call: string; file: string; args: string[]; cwd: string | null; stack: string[] }
/** Started by children.ts's thread: the call was made in children-worker.js. */
const fromChildren = (s: Start): boolean => s.stack.some((frame) => /[\\/]children-worker\.[cm]?[jt]s/.test(frame));
const shown = (starts: readonly Start[]): string => starts.map((s) => `thread ${s.thread}${s.main ? ' (main)' : ''}: ${s.file} ${s.args.join(' ')} <- ${s.stack.filter((f) => !f.includes('node:') && !f.includes('threads.mjs')).slice(0, 3).join(' | ')}`).join('\n  ') || 'none';

/** One hook request as deep-hook writes it (design: Hook protocol): the hello, the line, its acknowledgement and, when waited for, the reply. */
function hook(socket: string, line: Line, replyMs = 0): Promise<void> {
  return new Promise((resolve, reject) => {
    const sock = net.connect(socket);
    let got = '';
    let timer: NodeJS.Timeout | undefined;
    const done = () => { clearTimeout(timer); sock.destroy(); resolve(); };
    sock.setEncoding('utf8');
    sock.on('error', reject);
    sock.on('data', (d: string) => {
      const before = got.split('\n').length;
      got += d;
      const lines = got.split('\n').length;
      if (before < 2 && lines >= 2) sock.write(`${JSON.stringify(line)}\n`);
      if (lines > 2 && !replyMs) done();
      else if (lines > 3) done();
      else if (lines > 2 && !timer) timer = setTimeout(done, replyMs);
    });
  });
}

interface Told { events: Ev[]; ref: string; starts: Start[]; repo: string }
let told: Promise<Told> | undefined;
/** The session, once: the record after its stop was read for open items and sized, and every child the hub's threads started. */
const scenario = (): Promise<Told> => (told ??= (async () => {
  const w = makeWorld({ drafts: [BEHAVIOR_DRAFT(plan({ files: [FLAG.file, NEW_FILE] }))] });
  const log = join(w.tmp, 'threads.jsonl');
  // No DEEP_HUB_TEST_ACCEPTED: the changes you accepted are the repo's own history, which scope.ts reads with git.
  const env = childEnv(w.home, {
    DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_DRAFTS: w.drafts, DEEP_HUB_TEST_STOP_HOLD_MS: '30000',
    NODE_OPTIONS: `--import=${PRELOAD}`, DEEP_TEST_THREADS_LOG: log,
  });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { cwd: REPO, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  let err = '';
  child.stderr.setEncoding('utf8').on('data', (d: string) => (err += d));
  const exit = new Promise<void>((resolve) => child.on('exit', () => resolve()));
  const ready = await Promise.race([
    new Promise<Line | undefined>((resolve) => child.stdout.setEncoding('utf8').on('data', (d: string) => { out += d; if (out.includes('\n')) resolve(parseObject(out.split('\n')[0]!)); })),
    exit.then(() => undefined),
    sleep(120_000).then(() => undefined),
  ]);
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub did not start: ${err.slice(-1500)}`);
  const hub: Hub = { pid: Number(ready.pid ?? child.pid), socket: String(ready.socket), home: w.home, root: w.root, child, exit, stderr: () => err };

  // The session's own Claude Code process, and its transcript where Claude Code keeps it.
  const agent = spawn(NODE, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  own(agent.pid);
  const id = randomUUID();
  const transcript = join(w.home, '.claude/projects', w.repo.replace(/[^A-Za-z0-9]/g, '-'), `${id}.jsonl`);
  mkdirSync(dirname(transcript), { recursive: true });
  writeFileSync(transcript, '');
  let parent: string | null = null;
  const entry = (value: Line) => {
    const uuid = randomUUID();
    writeFileSync(transcript, `${JSON.stringify({ parentUuid: parent, isSidechain: false, ...value, uuid, timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: w.repo, sessionId: id, version: COVERED, gitBranch: 'main' })}\n`, { flag: 'a' });
    parent = uuid;
  };
  const assistant = (content: Line[], stop: string): Line => ({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${randomUUID()}`, type: 'message', role: 'assistant', content, stop_reason: stop, usage: { input_tokens: 2, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 10 } } });
  const prompt = randomUUID();
  let n = 0;
  const fire = (event: string, fields: Line, replyMs = 0) => hook(hub.socket, {
    v: 1, agent: 'claude-code', event, seq: String(BigInt(Date.now()) * 1_000_000n + BigInt(++n)), id: ulid(Date.now()), pid: process.pid, ppid: agent.pid, matched: [],
    payload: { session_id: id, transcript_path: transcript, cwd: w.repo, hook_event_name: event, permission_mode: 'default', ...(event === 'SessionStart' ? {} : { prompt_id: prompt }), ...fields },
  }, replyMs);
  const call = async (tool_name: string, tool_input: Line, response: Line, effect?: () => void) => {
    const tool_use_id = `toolu_${randomUUID().replace(/-/g, '')}`;
    entry(assistant([{ type: 'tool_use', id: tool_use_id, name: tool_name, input: tool_input }], 'tool_use'));
    await fire('PreToolUse', { tool_name, tool_input, tool_use_id }, 5000);
    effect?.();
    entry({ promptId: prompt, type: 'user', message: { role: 'user', content: [{ tool_use_id, type: 'tool_result', content: JSON.stringify(response) }] }, toolUseResult: response });
    await fire('PostToolUse', { tool_name, tool_input, tool_use_id, tool_response: response, duration_ms: 40 });
  };

  await fire('SessionStart', { source: 'startup', model: 'claude-haiku-5-5' });
  entry({ promptId: prompt, type: 'user', message: { role: 'user', content: BEHAVIOR }, turnPosition: { promptIndex: 0, turnIndex: 1 }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  await fire('UserPromptSubmit', { prompt: BEHAVIOR }, 5000);
  const auth = join(w.repo, FLAG.file);
  const text = readFileSync(auth, 'utf8');
  await call('Read', { file_path: auth }, { type: 'text', file: { filePath: auth, content: text, numLines: text.split('\n').length, startLine: 1, totalLines: text.split('\n').length } });
  let events = await settle(hub, (all) => all.some((e) => e.kind === 'definition.locked'), 60_000);
  const locked = events.filter((e) => e.kind === 'definition.locked');
  if (locked.length !== 1) throw Error(`BLOCKED: ${AC} the definition handed for "${BEHAVIOR}" must lock once before the agent works: ${listed(locked)}; the record holds ${events.map((e) => e.kind).join(', ') || 'nothing'}; the hub said: ${err.slice(-800)}`);
  const ref = String(locked[0]!.data.task_ref);
  must(lockedFor(events, ref).length === 1, `BLOCKED: ${AC} the lock names its task: ${said(locked[0])}`);

  const edited = `${text.replace(FLAG.from, FLAG.to)}${EDIT_TODO}\n`;
  await call('Edit', { file_path: auth, old_string: FLAG.from, new_string: FLAG.to, replace_all: false }, { filePath: auth, oldString: FLAG.from, newString: FLAG.to, replaceAll: false, structuredPatch: [], userModified: false }, () => writeFileSync(auth, edited));
  const created = join(w.repo, NEW_FILE);
  const body = `${NEW_TODO}\nmodule.exports = {};\n`;
  await call('Write', { file_path: created, content: body }, { type: 'create', filePath: created, content: body, structuredPatch: [] }, () => writeFileSync(created, body));
  const words = 'The middleware flags expired tokens.';
  entry(assistant([{ type: 'text', text: words }], 'end_turn'));
  await fire('Stop', { stop_hook_active: false, last_assistant_message: words }, 120_000);
  events = await settle(hub, (all) => all.some((e) => e.kind === 'claim.sized') && all.filter((e) => e.kind === 'open_item.opened').length >= 2, 90_000);
  if (!events.some((e) => e.kind === 'claim.made' && e.data.task_ref === ref)) throw Error(`BLOCKED: ${AC} the session's stop must make a claim for ${ref}: ${listed(events.filter((e) => e.kind === 'claim.made' || e.kind === 'agent.stop'))}; the hub said: ${err.slice(-800)}`);

  const lines = readFileSync(log, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l) as Start & { loaded?: boolean });
  const mine = lines.filter((l) => l.pid === hub.pid);
  const loaded = mine.filter((l) => l.loaded);
  if (!loaded.some((l) => l.main) || !loaded.some((l) => !l.main)) throw Error(`BLOCKED: ${AC} the preload must load in the hub's main thread and in its worker threads: it loaded in ${loaded.map((l) => `thread ${l.thread}${l.main ? ' (main)' : ''}`).join(', ') || 'none'}`);
  return { events, ref, starts: mine.filter((l) => !l.loaded && l.file === 'git'), repo: w.repo };
})());

const has = (s: Start, ...words: string[]): boolean => words.every((word) => s.args.includes(word));
const items = (t: Told): Ev[] => t.events.filter((e) => e.kind === 'open_item.opened' && e.data.task_ref === t.ref);
const naming = (t: Told, ...parts: string[]): Ev[] => items(t).filter((e) => parts.every((p) => String(e.data.text).includes(p)));

describe(`${AC}: the two forks open-items.ts and scope.ts start go through children.ts`, () => {
  it(`${AC} open-items.ts's diff against the base: the placeholder the session added to ${FLAG.file} is an open item, and each \`git diff -U0\` behind it is started by children.ts's thread`, async () => {
    const t = await scenario();
    must(naming(t, FLAG.file, 'TODO').length > 0, `${AC} the placeholder added to ${FLAG.file} must be an open item of ${t.ref}, as on the base: its open items are ${listed(items(t))}`);
    const starts = t.starts.filter((s) => has(s, 'diff', '-U0', '--no-ext-diff'));
    if (!starts.length) throw Error(`BLOCKED: ${AC} no thread of the hub recorded the \`git diff -U0\` the open item came from; the hub's git starts were:\n  ${shown(t.starts)}`);
    const stray = starts.filter((s) => !fromChildren(s));
    must(stray.length === 0, `${AC} open-items.ts's \`git diff --no-ext-diff -U0 <base>\` must be started by children.ts's thread (children-worker.js); ${stray.length} of ${starts.length} were started elsewhere:\n  ${shown(stray)}`);
  }, 600_000);

  it(`${AC} open-items.ts's listing of untracked files: the placeholder in the new file ${NEW_FILE} is an open item, and a \`git ls-files -o\` is started by children.ts's thread`, async () => {
    const t = await scenario();
    must(naming(t, NEW_FILE, 'TODO').length > 0, `${AC} the placeholder in the new file ${NEW_FILE} must be an open item of ${t.ref}, as on the base: its open items are ${listed(items(t))}`);
    const starts = t.starts.filter((s) => has(s, 'ls-files', '-o', '--exclude-standard'));
    if (!starts.length) throw Error(`BLOCKED: ${AC} no thread of the hub recorded the \`git ls-files -o\` the open item came from; the hub's git starts were:\n  ${shown(t.starts)}`);
    // The gate's snapshot counts untracked files with the same command (packages/gate, not one of the issue's two
    // forks), so this asks only that the listing open-items.ts reads is among those children.ts's thread started.
    must(starts.some(fromChildren), `${AC} open-items.ts's \`git ls-files -o --exclude-standard\` must be started by children.ts's thread (children-worker.js); every one was started elsewhere:\n  ${shown(starts)}`);
  }, 600_000);

  it(`${AC} scope.ts's read of the changes you accepted: the stop is sized against the usual ${USUAL.lines} lines over ${USUAL.files} files of the repo's own history, and each \`git log --first-parent --no-merges\` behind it is started by children.ts's thread`, async () => {
    const t = await scenario();
    const sized = t.events.filter((e) => e.kind === 'claim.sized' && e.data.task_ref === t.ref);
    must(sized.length > 0, `${AC} the judged stop must be sized (claim.sized) for ${t.ref}, as on the base: ${listed(t.events.filter((e) => e.kind === 'claim.sized'))}`);
    const usual = sized[0]!.data.usual as Line | null;
    must(usual?.lines === USUAL.lines && usual?.files === USUAL.files, `${AC} with no list handed, the usual size is read from the repo's own history, ${USUAL.lines} lines over ${USUAL.files} files, as on the base: ${said(sized[0])}`);
    const starts = t.starts.filter((s) => has(s, 'log', '--first-parent', '--no-merges'));
    if (!starts.length) throw Error(`BLOCKED: ${AC} no thread of the hub recorded the \`git log --first-parent --no-merges\` the usual size came from; the hub's git starts were:\n  ${shown(t.starts)}`);
    const stray = starts.filter((s) => !fromChildren(s));
    must(stray.length === 0, `${AC} scope.ts's \`git log --first-parent --no-merges\` must be started by children.ts's thread (children-worker.js); ${stray.length} of ${starts.length} were started elsewhere:\n  ${shown(stray)}`);
  }, 600_000);
});
