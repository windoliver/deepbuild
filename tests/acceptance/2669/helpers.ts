import { randomUUID } from 'node:crypto';
import {
  allEvents, appendTranscript, Claude, payload, readLines,
  type Fired, type Home, type Hub, type Line, type Session,
} from '../83/helpers.ts';

export const LATE = '#2669.3a6c6d5b';
export const ONCE = '#2669.8fb05bc5';

export const NOTICE = 'this session is outside any repo';

export async function promptBeforeEntry(claude: Claude, s: Session, text: string): Promise<{ fired: Fired; writeEntry: () => void }> {
  const promptId = randomUUID();
  s.prompt = promptId;
  const fired = await claude.hook('UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: text }));
  const writeEntry = () => appendTranscript(s, { promptId, type: 'user', message: { role: 'user', content: text }, origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' });
  return { fired, writeEntry };
}

export async function landed(hub: Hub, s: Session): Promise<boolean> {
  const events = await allEvents(hub);
  const tasks = new Set(events.filter((e) => e.kind === 'task.created' && e.session === s.id).map((e) => String(e.data?.task_ref)));
  return events.some((e) => e.kind === 'workspace.created' && tasks.has(String(e.data?.task_ref)));
}

export const carries = (reply: unknown): boolean => (typeof reply === 'string' ? reply : JSON.stringify(reply ?? null)).includes(NOTICE);
export const firedCarries = (f: Fired): boolean => [...f.ran, ...f.background].some((r) => r.stdout.includes(NOTICE));

export interface Reached { event: string; prompt: string | undefined; reply: Line | string }
export function noticeReached(h: Home, s: Session): Reached[] {
  const lines = readLines(h.hookLog).filter((l) => l.session === s.id);
  const promptOf = new Map(lines.filter((l) => l.phase === 'start').map((l) => [String(l.invocation), l.prompt as string | undefined]));
  return lines
    .filter((l) => l.phase === 'reply' && carries(l.reply))
    .filter((l) => !(l.event === 'UserPromptSubmit' && typeof l.reply === 'object' && l.reply?.decision === 'block'))
    .map((l) => ({ event: String(l.event), prompt: promptOf.get(String(l.invocation)), reply: l.reply as Line | string }));
}
export const reachedShown = (r: Reached[]) => JSON.stringify(r.map((x) => ({ event: x.event, prompt: x.prompt, reply: JSON.stringify(x.reply).slice(0, 400) })));
