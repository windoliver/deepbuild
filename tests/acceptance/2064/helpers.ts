// Test-side tools for #2064 (README). Everything real except the forge: `deep hub run` in a temporary HOME (#322's world:
// the repo, the drafted definition handed for issue 7, the shipped rules), the session's hooks as lines on the hub's
// socket (#1881's), the record read back through the hub, a real git checkout. The one stand-in is the forge, #1881's
// GitHub-shaped REST API, given to the hub as DEEP_HUB_TEST_FORGE. Reused, not copied: ../322/helpers.ts, ../322/work.ts,
// ../1881/helpers.ts.
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import {
  COVERED, CLI, FLAG, control, NODE, allEvents, childEnv, cleanup as cleanup322, git, makeWorld, own, parseObject, settle, sleep, trustRepo, type Ev, type World,
} from '../322/helpers.ts';
import { CRITERIA, WORK_LINK, workDraft, workIssue } from '../322/work.ts';
import { completedCall, denies, endAgents, hook, newSession, replyWords, startForge, startedCall, stopTurn, type Forge, type Obj, type Session } from '../1881/helpers.ts';

export { CRITERIA, FLAG, denies, replyWords, sleep };
export type { Forge, Obj };

/** The criteria's tags: `#2064.` and the first eight hex digits of the SHA-256 of each criterion's text (design: Criteria to tests). */
export const AC1 = 'AC1 #2064.715f176e';
export const AC2 = 'AC2 #2064.9e9dae21';
export const AC3 = 'AC3 #2064.c8d25a38';
export const AC4 = 'AC4 #2064.ab3e665d';
export const AC5 = 'AC5 #2064.80da88e3';
export const AC6 = 'AC6 #2064.2afeb0df';
export const AC7 = 'AC7 #2064.20caa9d6';

export const ISSUE = 7;
export const BRANCH = 'b';
export const REMOTE = 'https://github.com/acme/shop.git';

type Wire = { home: string; root: string; socket: string; output: () => string };
// The record is read through the hub's control socket, which needs only its root and socket.
const asHub = (hub: Wire) => hub as unknown as Parameters<typeof allEvents>[0];
/** The record's events once `done` holds of them, or what was read at the timeout. */
export const until = (hub: Wire, done: (events: Ev[]) => boolean, ms = 60_000): Promise<Ev[]> => settle(asHub(hub), done, ms);

/** A prompt you typed: its transcript entry as Claude Code writes it (human origin, typed), then UserPromptSubmit. */
async function typedTurn(hub: Wire, s: Session, prompt: string): Promise<string> {
  const promptId = randomUUID();
  const entry = { parentUuid: null, isSidechain: false, promptId, type: 'user', message: { role: 'user', content: prompt }, turnPosition: { promptIndex: 0, turnIndex: ++s.prompt }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human',
    uuid: randomUUID(), timestamp: new Date().toISOString(), userType: 'external', entrypoint: 'cli', cwd: s.cwd, sessionId: s.id, version: COVERED, gitBranch: BRANCH };
  appendFileSync(s.transcript, `${JSON.stringify(entry)}\n`);
  await hook(hub, s, 'UserPromptSubmit', { prompt, prompt_id: promptId, permission_mode: 'default' });
  return promptId;
}
export { typedTurn };

/** What the issue says is left: R2, "The e2e test for expired tokens passes", has no check and so no PASS; R1 has one. */
export interface Room {
  w: World; hub: Wire; forge: Forge; s: Session; ref: string;
  /** One shell call at PreToolUse: whether it is denied, and the words of its reply. */
  call(command: string): Promise<{ denied: boolean; words: string }>;
  /** Writes a file into the session's checkout. */
  file(name: string, text: string): void;
  /** Checks out `branch` (made from main, with one commit of that message when it doesn't exist yet). */
  onBranch(branch: string, message?: string): void;
  /** The session's readings of the record that name `text`. */
  readings(text: string): Promise<string[]>;
}

/** Registers the cleanup of every process and folder this file made. */
export function cleaning(): void {
  afterAll(async () => { endAgents(); await cleanup322().catch(() => undefined); }, 60_000);
}

async function startHub(w: World, forge: Forge): Promise<Wire> {
  const env = childEnv(w.home, {
    DEEP_HUB_TEST_CONFIRM: w.confirm, DEEP_HUB_TEST_DRAFTS: w.drafts, DEEP_HUB_TEST_WORK: w.work, DEEP_HUB_TEST_GITHUB: w.github, DEEP_HUB_TEST_FORGE: forge.url, DEEP_HUB_TEST_VERDICT: '1',
  });
  const child = spawn(NODE, [CLI, 'hub', 'run'], { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let err = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (err += d));
  const ready = await new Promise<Obj | undefined>((resolve) => {
    let out = '';
    child.stdout!.setEncoding('utf8').on('data', (d: string) => { out += d; if (out.includes('\n')) resolve(parseObject(out.split('\n')[0]!)); });
    child.on('exit', () => resolve(undefined));
    setTimeout(() => resolve(undefined), 120_000).unref();
  });
  if (!ready || ready.ready !== true) throw Error(`BLOCKED: the hub did not start: ${err.slice(-1500)}`);
  return { home: w.home, root: w.root, socket: String(ready.socket), output: () => err };
}

/**
 * A session in a checkout of acme/shop on branch b (origin and origin/main set), started from the link of issue 7, whose
 * definition is locked: R1 (judged by a drafted check) and R2 (no check). R1 has passed (R2 has no PASS); `passing` makes R2 pass too, so no requirement is left.
 */
export async function room(o: { passing?: boolean } = {}): Promise<Room> {
  const w = makeWorld({ drafts: [workDraft(ISSUE)], readings: [workIssue(ISSUE)] });
  await trustRepo(w, true);
  git(w.tmp, w.repo, ['checkout', '-q', '-b', BRANCH]);
  git(w.tmp, w.repo, ['remote', 'add', 'origin', REMOTE]);
  git(w.tmp, w.repo, ['update-ref', 'refs/remotes/origin/main', w.base]);
  const forge = await startForge('acme', 'shop');
  const hub = await startHub(w, forge);
  const s = newSession(hub, w.repo);
  await hook(hub, s, 'SessionStart', { source: 'startup' }, Date.now() - 2000);
  const prompt = await typedTurn(hub, s, `Fix ${WORK_LINK(ISSUE)}`);
  const path = join(w.repo, 'src/auth.js');
  await completedCall(hub, s, 'Read', { file_path: path }, { type: 'text', file: { filePath: path, content: 'x', numLines: 1, startLine: 1, totalLines: 1 } });
  const events = await until(hub, (all) => all.some((e) => e.kind === 'definition.locked'), 60_000);
  const lock = events.find((e) => e.kind === 'definition.locked');
  if (!lock) throw Error('BLOCKED: the handed definition for issue 7 never locked, so the gate has no task to judge against');
  const ref = String(lock.data.task_ref);
  await judge(hub, s, w, prompt, o.passing ? ['R1', 'R2'] : ['R1']);
  let n = 0;
  return {
    w, hub, forge, s, ref,
    async call(command) {
      const reply = await startedCall(hub, s, 'Bash', { command, description: `call ${++n}` });
      return { denied: denies(reply), words: replyWords(reply) };
    },
    file: (name, text) => writeFileSync(join(w.repo, name), text),
    onBranch(branch, message) {
      const known = git(w.tmp, w.repo, ['branch', '--list', branch]);
      if (known) return void git(w.tmp, w.repo, ['checkout', '-q', branch]);
      git(w.tmp, w.repo, ['checkout', '-q', '-b', branch, 'main']);
      if (message) git(w.tmp, w.repo, ['commit', '-q', '--allow-empty', '-m', message]);
    },
    async readings(text) {
      return (await allEvents(asHub(hub))).filter((e: Ev) => e.kind === 'session.reading' && e.session === s.id && String(e.data.reading).includes(text)).map((e) => String(e.data.reading));
    },
  };
}

/**
 * The agent edits and stops: the stop's claim is judged by the hub as it is (on a machine whose sandbox lets the drafted
 * checks run, as on the implementer's, or not). Then the record holds the newest verdict of the claim, as the hub's own
 * `test.verdict` plants it (DEEP_HUB_TEST_VERDICT, the facility #83's suite uses): PASS for `passed`, nothing for the rest.
 * The issue's state is R1 passed and R2 with no PASS; the twin's, both passed.
 */
async function judge(hub: Wire, s: Session, w: World, prompt: string, passed: string[]): Promise<void> {
  const path = join(w.repo, FLAG.file);
  writeFileSync(path, readFileSync(path, 'utf8').replace(FLAG.from, FLAG.to));
  await completedCall(hub, s, 'Edit', { file_path: path, old_string: FLAG.from, new_string: FLAG.to, replace_all: false }, { filePath: path, oldString: FLAG.from, newString: FLAG.to, replaceAll: false, structuredPatch: [], userModified: false });
  await stopTurn(hub, s, prompt, 'rejectsExpired is now true.');
  const done = await until(hub, (all) => all.some((e) => e.kind === 'claim.made') && all.some((e) => e.kind === 'stop.held'), 150_000);
  const claim = done.find((e) => e.kind === 'claim.made');
  if (!claim) throw Error('BLOCKED: the agent stopped after its edit but no claim was recorded, so there is no verdict to state');
  const requirements = passed.map((id) => ({ req: `req:01K74G0A1B2C3D4E5F6G7H8J9K#${id}`, outcome: 'PASS', check: 'unit' }));
  await control(asHub(hub), 'test.verdict', { session: s.id, claim: `claim:${claim.id}`, outcome: 'PASS', requirements, ran: [] });
}
