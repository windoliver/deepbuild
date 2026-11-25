// Test-side tools for issue #3305 (README). Everything else comes from #83's suite (../83/helpers.ts: the real hub's
// process shape, `deep setup`, the Claude Code stand-in with its hook log) and #2669's (../2669/helpers.ts: a session
// outside any repo whose first task lands late, and its workspace notice). The one thing added is the hub started with
// #906's planted late reply (DEEP_HUB_TEST_LATE_REPLY, tests/acceptance/906/README.md: Defined here). Nothing here
// stands in for DeepBuild.
import { spawn } from 'node:child_process';
import { availableParallelism, loadavg } from 'node:os';
import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  childEnv, firedShown, isDeepBuild, own, parseObject, payload, promptEntry, readLines, rootOf, setup,
  type Claude, type Fired, type Home, type Hub, type Line, type Session,
} from '../83/helpers.ts';

/** The criteria, by their IDs (#3305. + the first 8 hex of the SHA-256 of each criterion's text). */
export const CONTINUE = '#3305.bc1fc765';
export const NOTICE_ID = '#3305.d2dd0332';

/** The automatic continue's own words for a turn stopped on a dropped connection or an overloaded service (#85). */
export const CONTINUE_WORDS = 'this is its one automatic continue';

/** The planted late reply's file for a home: absent until a test makes it. */
export const lateFile = (h: Home) => join(h.tmp, 'late');
/** While the file exists the hub writes a held hook's reply 1 s past deep-hook's hold, so deep-hook lets the hook through without it. */
export const plantLate = (h: Home) => writeFileSync(lateFile(h), 'late\n');
export const liftLate = (h: Home) => rmSync(lateFile(h), { force: true });

/**
 * `deep hub run` as #83's startHub runs it (HOME the test's home, test.verdict served), with #906's planted late reply
 * named in its environment; then `deep setup` against it.
 */
export async function lateHub(h: Home): Promise<Hub> {
  const env = childEnv(h, { DEEP_HUB_TEST_VERDICT: '1', DEEP_HUB_TEST_LATE_REPLY: lateFile(h) });
  const child = spawn(process.execPath, [h.co.cli, 'hub', 'run'], { cwd: h.co.root, env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
  own(child.pid);
  let out = '';
  child.stderr!.setEncoding('utf8').on('data', (d: string) => (out += d));
  const ready = await new Promise<boolean>((resolve) => {
    let first = '';
    const timer = setTimeout(() => resolve(false), 120_000);
    child.stdout!.setEncoding('utf8').on('data', (d: string) => {
      out += d;
      first += d;
      if (first.includes('\n')) { clearTimeout(timer); resolve(parseObject(first.split('\n')[0]!)?.ready === true); }
    });
    child.on('exit', () => { clearTimeout(timer); resolve(false); });
  });
  if (!ready) throw Error(`BLOCKED: the hub didn't start with DEEP_HUB_TEST_LATE_REPLY set: ${out.slice(0, 2000)}`);
  const root = rootOf(h);
  const hub: Hub = { pid: child.pid!, h, socket: join(root, 'hub.sock'), root, child, output: () => out };
  await setup(h);
  return hub;
}

/**
 * A prompt you typed (its transcript entry, then its UserPromptSubmit) fired with the planted late reply in place, so
 * the hub's reply reaches deep-hook only after its hold ran out and the prompt goes to the model without it. BLOCKED
 * unless deep-hook waited on the hub for it (1 s or more): one the hub didn't acknowledge at once went through as with
 * the hub away, so the hold and the planted delay were never reached (machine load, not the program under test).
 */
export async function lostPrompt(h: Home, claude: Claude, s: Session, text: string): Promise<Fired> {
  promptEntry(s, text, 'person');
  plantLate(h);
  let fired: Fired;
  try {
    fired = await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: text }));
  } finally {
    liftLate(h);
  }
  const r = fired.ran.find((x) => isDeepBuild(x.command));
  const ms = r && r.ended !== null ? r.ended - r.started : null;
  if (ms === null || ms < 1000) throw Error(`BLOCKED: deep-hook let "${text}" through in ${ms} ms, before any hold (1-minute load ${loadavg()[0]!.toFixed(1)} on ${availableParallelism()} cores), so the planted late reply was never reached; rerun on a quieter machine: ${firedShown(fired)}`);
  return fired;
}

/** A prompt you typed that goes as usual: its transcript entry, then its UserPromptSubmit. */
export async function typed(claude: Claude, s: Session, text: string): Promise<Fired> {
  promptEntry(s, text, 'person');
  return claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: text }));
}

/** Whether what DeepBuild's entries printed for a hook carries `words`. */
export const firedCarries = (f: Fired, words: string): boolean => [...f.ran, ...f.background].some((r) => r.stdout.includes(words));

export interface Reached { event: string; prompt: string | undefined; reply: string }
/**
 * Every hook reply in the hook log that brought `words` to the agent for this session, over the whole run: any reply
 * carrying them, except a prompt's reply that blocked the prompt (Claude Code drops a blocked prompt, so its context
 * never reaches the model), as #2669's suite counts. A reply is what the entry printed on stdout: a waiter's wake
 * (exit 2, its text on stderr) isn't counted, since this Claude Code stand-in starts no turn from a wake (no model line
 * follows it), so its text reaches no model (README: How the continue comes to wait).
 */
export function reached(h: Home, s: Session, words: string): Reached[] {
  const lines = readLines(h.hookLog).filter((l) => l.session === s.id);
  const promptOf = new Map(lines.filter((l) => l.phase === 'start').map((l) => [String(l.invocation), l.prompt as string | undefined]));
  const text = (reply: unknown) => (typeof reply === 'string' ? reply : JSON.stringify(reply ?? null));
  return lines
    .filter((l) => l.phase === 'reply' && text(l.reply).includes(words))
    .filter((l) => !(l.event === 'UserPromptSubmit' && typeof l.reply === 'object' && (l.reply as Line | null)?.decision === 'block'))
    .map((l) => ({ event: String(l.event), prompt: promptOf.get(String(l.invocation)), reply: text(l.reply).slice(0, 400) }));
}
export const reachedShown = (r: Reached[]) => JSON.stringify(r);
/** The prompts that reached the model in this session, in order (the stand-in's model lines). */
export const modelPrompts = (h: Home, s: Session): string[] => readLines(h.hookLog).filter((l) => l.phase === 'model' && l.session === s.id).map((l) => String(l.prompt));
