// Test-side tools for issue #2669 (README). Everything else comes from #83's suite (../83/helpers.ts): the real hub,
// `deep setup`, the Claude Code stand-in and its hook log. Nothing here stands in for DeepBuild.
import { randomUUID } from 'node:crypto';
import {
  allEvents, appendTranscript, Claude, payload, readLines,
  type Fired, type Home, type Hub, type Line, type Session,
} from '../83/helpers.ts';

/** The criteria, by their IDs (#2669. + the first 8 hex of the SHA-256 of each criterion's text). */
export const LATE = '#2669.3a6c6d5b';
export const ONCE = '#2669.8fb05bc5';
export const STATUS83 = '#2669.6995f057';

/** The workspace notice's own words, as the hub tells a session outside any repo where its task's home is. */
export const NOTICE = 'this session is outside any repo';

/**
 * The first prompt of a session, as Claude Code sends it when its transcript entry is written after the hook fires
 * (#567): UserPromptSubmit with the prompt's ID, and no entry yet. The hub can't read the prompt's origin, so it sets
 * the prompt aside and replies; the task opens only once the entry is there and the session's next hook places it.
 * Returns the reply and writes the entry to call once the reply has gone.
 */
export async function promptBeforeEntry(claude: Claude, s: Session, text: string): Promise<{ fired: Fired; writeEntry: () => void }> {
  const promptId = randomUUID();
  s.prompt = promptId;
  const fired = await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: text }));
  const writeEntry = () => appendTranscript(s, { promptId, type: 'user', message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  return { fired, writeEntry };
}

/** Whether the record holds a workspace made for this session's task: the task has landed. */
export async function landed(hub: Hub, s: Session): Promise<boolean> {
  const events = await allEvents(hub);
  const tasks = new Set(events.filter((e) => e.kind === 'task.created' && e.session === s.id).map((e) => String(e.data?.task_ref)));
  return events.some((e) => e.kind === 'workspace.created' && tasks.has(String(e.data?.task_ref)));
}

/** Whether one reply (a hook-log reply object or a hook's stdout) carries the workspace notice. */
export const carries = (reply: unknown): boolean => (typeof reply === 'string' ? reply : JSON.stringify(reply ?? null)).includes(NOTICE);
/** Whether the stand-in's reply for a prompt carried the notice, in any of the entries that ran for it. */
export const firedCarries = (f: Fired): boolean => [...f.ran, ...f.background].some((r) => r.stdout.includes(NOTICE));

export interface Reached { event: string; prompt: string | undefined; reply: Line | string }
/**
 * Every hook reply in the hook log that brought the notice to the agent for this session: any reply carrying it,
 * except a prompt's reply that blocked the prompt (Claude Code drops a blocked prompt, so its context never reaches
 * the model). A waiter's wake counts too: its output is the agent's next prompt.
 */
export function noticeReached(h: Home, s: Session): Reached[] {
  const lines = readLines(h.hookLog).filter((l) => l.session === s.id);
  const promptOf = new Map(lines.filter((l) => l.phase === 'start').map((l) => [String(l.invocation), l.prompt as string | undefined]));
  return lines
    .filter((l) => l.phase === 'reply' && carries(l.reply))
    .filter((l) => !(l.event === 'UserPromptSubmit' && typeof l.reply === 'object' && l.reply?.decision === 'block'))
    .map((l) => ({ event: String(l.event), prompt: promptOf.get(String(l.invocation)), reply: l.reply as Line | string }));
}
export const reachedShown = (r: Reached[]) => JSON.stringify(r.map((x) => ({ event: x.event, prompt: x.prompt, reply: JSON.stringify(x.reply).slice(0, 400) })));
