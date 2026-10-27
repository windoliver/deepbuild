// The fixture corpus: recorded Claude Code sessions, generated from seeds so every run reads the same bytes. The
// repo holds no corpus of 212 sessions (tests/fixtures has none; adapters/corpus holds hook payloads per version), so
// this file makes one, written as Claude Code writes its transcripts (one JSONL entry per message, `uuid` naming it),
// recorded as its hooks record a session (`session.start` under the session's project), and archived by the real
// archive (#20) into the evidence store with a `transcript.archived` link (world.ts, `seed`).
//
// Each message's text starts with a tag unique in the corpus, `[q<session>m<message>]`, so a test can tell which
// message any text in a prompt came from (AC4). Each session's second message is your own words holding one fact of
// its project, `remember: <fact>.`, which the fake agent finds and quotes; the rest is seeded filler.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { letters, seededUuid, type Line } from './helpers.ts';

/** A message: your words, the agent's, or a tool's result (a WebFetch's is outside content; a Bash command's is not). */
export interface Msg { id: string; from: 'you' | 'agent' | 'fetch' | 'bash'; text: string }
export interface Session { seed: number; id: string; handle: string; project: string; worktree: string; messages: Msg[] }

/** Claude Code's JSONL for a session: a tool result is an assistant `tool_use` entry, then a user entry holding it. */
export function transcriptOf(s: Pick<Session, 'id' | 'worktree' | 'messages'>, at = Date.UTC(2026, 9, 5, 9)): string {
  const lines: Line[] = [];
  let parent: string | null = null;
  let t = at;
  const push = (entry: Line) => {
    lines.push({ parentUuid: parent, isSidechain: false, userType: 'external', cwd: s.worktree, sessionId: s.id, version: '2.1.304', gitBranch: 'main', timestamp: new Date(t).toISOString(), ...entry });
    parent = String(entry.uuid);
    t += 1000;
  };
  for (const m of s.messages) {
    if (m.from === 'you') push({ type: 'user', uuid: m.id, message: { role: 'user', content: m.text } });
    else if (m.from === 'agent') push({ type: 'assistant', uuid: m.id, message: { model: 'claude-opus-5-5', id: `msg_${m.id}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: m.text }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 10 } } });
    else {
      const call = `toolu_${m.id}`;
      const tool = m.from === 'fetch'
        ? { type: 'tool_use', id: call, name: 'WebFetch', input: { url: 'https://docs.example.invalid/setup', prompt: 'how is it set up' } }
        : { type: 'tool_use', id: call, name: 'Bash', input: { command: 'cat SETUP.txt', description: 'Read the setup notes' } };
      push({ type: 'assistant', uuid: `${m.id}c`, message: { model: 'claude-opus-5-5', id: `msg_${m.id}c`, type: 'message', role: 'assistant', content: [tool], stop_reason: 'tool_use', usage: { input_tokens: 10, output_tokens: 10 } } });
      push({ type: 'user', uuid: m.id, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: call, content: m.text }] } });
    }
  }
  return lines.map((l) => JSON.stringify(l)).join('\n') + '\n';
}
/** Where Claude Code keeps a session's transcript under an agent home: projects/<cwd with each non-alphanumeric as ->/<id>.jsonl. */
export const transcriptPath = (agentsHome: string, s: Pick<Session, 'id' | 'worktree'>): string =>
  join(agentsHome, '.claude', 'projects', s.worktree.replace(/[^0-9A-Za-z]/g, '-'), `${s.id}.jsonl`);
export function writeTranscript(agentsHome: string, s: Session): string {
  const path = transcriptPath(agentsHome, s);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, transcriptOf(s));
  return path;
}

// ---- Seeded filler.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const WORDS = ['the', 'checkout', 'page', 'test', 'build', 'cart', 'total', 'query', 'cache', 'route', 'handler', 'button', 'layout', 'render', 'commit', 'branch', 'review', 'retry', 'timeout', 'schema', 'column', 'index', 'deploy', 'preview', 'fixture', 'logger', 'worker', 'queue', 'token', 'refresh'];
function filler(rng: () => number, chars: number): string {
  const out: string[] = [];
  let n = 0;
  while (n < chars) { const w = WORDS[Math.floor(rng() * WORDS.length)]!; out.push(w); n += w.length + 1; }
  return out.join(' ');
}

/** Each project's fact, said in your own words in every one of its sessions. */
export const FACTS: Record<string, string> = {
  api: 'api starts with `npm run dev` on port 3000',
  web: 'web starts with `npm start` on port 5173',
  cli: 'cli builds with `cargo build --release` in the cli folder',
  docs: 'docs serve with `mkdocs serve` on port 8000',
};
export const PROJECTS = Object.keys(FACTS);
export const tag = (seed: number, n: number): string => `[q${seed}m${n}]`;

/** One generated session: `count` messages of about `size` characters each, its second one your fact. */
export function session(seed: number, o: { project?: string; count?: number; size?: number; at?: Partial<Record<number, Msg['from']>>; texts?: Partial<Record<number, string>> } = {}): Session {
  const rng = mulberry32(0x63_0000 + seed);
  const project = o.project ?? PROJECTS[seed % PROJECTS.length]!;
  const id = seededUuid(seed);
  const messages: Msg[] = [];
  for (let n = 1; n <= (o.count ?? 60); n++) {
    const from: Msg['from'] = o.at?.[n] ?? (n <= 2 || n % 2 === 0 ? 'you' : 'agent');
    const text = o.texts?.[n] ?? (n === 2 ? `${tag(seed, n)} remember: ${FACTS[project]}.` : `${tag(seed, n)} ${filler(rng, o.size ?? 1000)}`);
    messages.push({ id: `m${n}`, from, text });
  }
  return { seed, id, handle: `session:${letters(id)}`, project, worktree: `/tmp/dh63-work/${project}`, messages };
}

/** The fixture corpus of the install read (AC1): 212 recorded sessions across four projects, about 60 KB of text each. */
export const CORPUS_SIZE = 212;
export const fixtureCorpus = (): Session[] => Array.from({ length: CORPUS_SIZE }, (_, i) => session(i));
/** Every message's text by its tag, for telling which record text a prompt holds (AC4). */
export function byTag(sessions: readonly Session[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of sessions) for (const m of s.messages) { const t = /^\[q\d+m\d+\]/.exec(m.text)?.[0]; if (t) out.set(t, m.text); }
  return out;
}
