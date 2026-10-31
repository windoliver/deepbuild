// #111's helpers. A temp home holding every agent's memory files and transcripts where each agent keeps them (README,
// Where each agent keeps its files), `deep setup` through #356's helpers (launchd stand-in, fake reading agent, plan
// windows), #26's agent stand-in for deep_* calls and session hooks, deep-hook as an agent's hook entry runs it (#316's
// helpers). Nothing here stands in for DeepBuild.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect } from 'vitest';
import { Agent, callTool, cleanup as cleanup26, filedWhileWaiting, initialize, pending, type Hub } from '../26/helpers.ts';
import { bash, decision, denialText, hook, newSession, payload, shown as shownHook, type Session as HookSession } from '../316/helpers.ts';
import { msg, sessionId, writeSession } from '../356/history.ts';
import {
  ACCOUNT, cleanup as cleanup356, claims, control, deep, eventsOf, gitRepo, installFake, makeHome, onMac, rootOf, setupWithWindows, shown, snapshot, type Claim, type Home, type Line, type Ran, type World,
} from '../356/helpers.ts';

export { bash, callTool, control, decision, deep, denialText, eventsOf, filedWhileWaiting, gitRepo, onMac, pending, rootOf, shown, shownHook, snapshot, type Claim, type Home, type Line, type Ran };
export const FIX = fileURLToPath(new URL('./fixtures/memory/', import.meta.url));
export const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url));
export const cleanup = async (): Promise<void> => { await cleanup26(); await cleanup356(); };

// ---- The rules the fixtures state, by what each should become.
export const WIDE = 'Keep pull requests small and reviewable'; // Claude Code, Codex, pi, Cursor
export const TWO = 'Run the linter before every commit'; // Claude Code, Codex
export const NEAR = 'Run the linter before every push'; // Codex only: not the same rule as TWO
export const PI_ONLY = 'Prefer small functions over deep class trees';
export const CURSOR_ONLY = 'Name test files after the behaviour they prove';
export const GUARD_COMMAND = 'make nuke-db';
export const GONE = 'scripts/gone-deploy.sh';
export const LIVE = 'scripts/live.sh';
export const AGENT_WROTE = 'The api folder holds the billing webhooks';

/** Where each agent keeps its user-level memory file, under a home (README). */
export const memoryFile = (home: string, agent: 'claude' | 'codex' | 'pi' | 'cursor'): string => ({
  claude: join(home, '.claude', 'CLAUDE.md'),
  codex: join(home, '.codex', 'AGENTS.md'),
  pi: join(home, '.pi', 'agent', 'AGENTS.md'),
  cursor: join(home, '.cursor', 'rules', 'team.mdc'),
}[agent]);
export const FIXTURE_OF = { claude: 'claude-CLAUDE.md', codex: 'codex-AGENTS.md', pi: 'pi-AGENTS.md', cursor: 'cursor-team.mdc' } as const;
export type AgentName = keyof typeof FIXTURE_OF;
export const AGENTS = Object.keys(FIXTURE_OF) as AgentName[];
const put = (file: string, text: string | Buffer): void => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };

export interface Mem { h: Home; wiki: string; api: string; web: string }
/** A home with the fake agent, a sign-in, two repos, and every agent's memory files, unless `agents` narrows them. */
export function memoryHome(o: { agents?: readonly AgentName[]; extra?: Partial<Record<AgentName, string>> } = {}): Mem {
  onMac();
  const h = makeHome();
  installFake(h.bin);
  put(join(h.home, '.claude.json'), JSON.stringify({ oauthAccount: { accountUuid: ACCOUNT, emailAddress: 'a@example.invalid' } }));
  for (const agent of o.agents ?? AGENTS) put(memoryFile(h.home, agent), readFileSync(join(FIX, FIXTURE_OF[agent]), 'utf8') + (o.extra?.[agent] ?? ''));
  const api = join(h.tmp, 'work', 'api');
  put(join(api, 'scripts', 'live.sh'), '#!/bin/sh\n');
  gitRepo(h.home, api);
  const web = join(h.tmp, 'work', 'web');
  put(join(web, 'README.md'), '# web\n');
  gitRepo(h.home, web);
  return { h, wiki: join(rootOf(h.home), 'wiki'), api, web };
}
/** Claude Code's own memory for a repo, the folder its memory feature writes (agents write these). */
export function projectMemory(m: Mem, cwd: string): void {
  const dir = join(m.h.home, '.claude', 'projects', cwd.replace(/[^0-9A-Za-z]/g, '-'), 'memory');
  mkdirSync(dir, { recursive: true });
  copyFileSync(join(FIX, 'claude-project-MEMORY.md'), join(dir, 'MEMORY.md'));
  copyFileSync(join(FIX, 'claude-project-notes.md'), join(dir, 'api-notes.md'));
}

// ---- Transcripts, in each agent's own shape and folder.
let sessions = 1_110_000;
export function claudeSession(m: Mem, cwd: string, ...lines: { role: 'user' | 'assistant'; text: string }[]): void {
  writeSession(m.h.home, { agent: 'claude', id: sessionId(++sessions), cwd, day: 1, messages: lines.map((l) => msg(l.role, l.text)) });
}
export function codexSession(m: Mem, cwd: string, ...lines: { role: 'user' | 'assistant'; text: string }[]): void {
  writeSession(m.h.home, { agent: 'codex', id: sessionId(++sessions), cwd, day: 2, messages: lines.map((l) => msg(l.role, l.text)) });
}
const iso = (i: number): string => new Date(Date.UTC(2026, 9, 3, 9, 0, i)).toISOString();
/** pi: `~/.pi/agent/sessions/--<path>--/<time>_<id>.jsonl`, a session header, then its message entries. */
export function piSession(m: Mem, cwd: string, ...lines: { role: 'user' | 'assistant'; text: string }[]): void {
  const id = sessionId(++sessions);
  const dir = join(m.h.home, '.pi', 'agent', 'sessions', `--${cwd.replace(/^\//, '').replace(/[/\\:]/g, '-')}--`);
  const body = [{ type: 'session', version: 3, id, timestamp: iso(0), cwd }, ...lines.map((l, i) => ({
    type: 'message', id: `p${sessions}m${i}`, parentId: i ? `p${sessions}m${i - 1}` : null, timestamp: iso(i + 1),
    message: { role: l.role, content: [{ type: 'text', text: l.text }] },
  }))];
  put(join(dir, `${iso(0).replace(/[:.]/g, '-')}_${id}.jsonl`), `${body.map((x) => JSON.stringify(x)).join('\n')}\n`);
}
/** Cursor: `~/.cursor/projects/<folder>/agent-transcripts/<id>.jsonl`, one role and message a line. */
export function cursorSession(m: Mem, cwd: string, ...lines: { role: 'user' | 'assistant'; text: string }[]): void {
  const id = sessionId(++sessions);
  const dir = join(m.h.home, '.cursor', 'projects', cwd.replace(/^\//, '').replace(/[^0-9A-Za-z]/g, '-'), 'agent-transcripts');
  put(join(dir, `${id}.jsonl`), `${lines.map((l) => JSON.stringify({ role: l.role, message: { content: [{ type: 'text', text: l.text }] } })).join('\n')}\n`);
}

// ---- Setup, and reading the wiki.
export async function compile(m: Mem): Promise<void> {
  const r = await setupWithWindows({ h: m.h } as World);
  expect(r.run.code, `deep setup exits 0: ${shown(r.run)}`).toBe(0);
}
export type Source = { at?: string; path?: string; quote?: string };
export const sourcesOf = (c: Claim): Source[] => (c.json.sources ?? []) as Source[];
/** The claims that state a rule, on any page but the derived standing questions. */
export const ruleClaims = (m: Mem, rule: string): Claim[] =>
  claims(m.wiki).filter((c) => !c.page.startsWith('questions/') && sourcesOf(c).some((s) => String(s.quote ?? '').includes(rule)));
export const sha = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
/** Whether a source names a memory file: its path, or the hash of its bytes (the handle `record.keep` gives them). */
export const namesFile = (source: unknown, file: string): boolean => {
  const text = JSON.stringify(source);
  return text.includes(file) || text.includes(sha(readFileSync(file)));
};

// ---- `deep memory`: the ranked keep-or-remove list (README, Invented here).
export interface Lesson { id: string; kind: string; text: string; rank: number; sources: Source[] }
export async function lessons(m: Mem): Promise<Lesson[]> {
  const r = await deep(m.h.home, ['memory', '--json']);
  expect(r.code, `deep memory --json lists the lessons: ${shown(r)}`).toBe(0);
  let parsed: { lessons?: Lesson[] } = {};
  try { parsed = JSON.parse(r.stdout) as { lessons?: Lesson[] }; } catch { expect.fail(`deep memory --json prints JSON: ${shown(r)}`); }
  expect(Array.isArray(parsed.lessons), `deep memory --json holds a lessons list: ${r.stdout.slice(0, 500)}`).toBe(true);
  return parsed.lessons!;
}
/** The lesson that holds these words in its text or one of its quotes. */
export const lessonNaming = (all: Lesson[], words: string): Lesson[] =>
  all.filter((l) => l.text.includes(words) || l.sources.some((s) => String(s.quote ?? '').includes(words)));

/** Every decision saved, as the record holds it. */
export interface Saved { id: string; writer: string; subject?: string; data: Line; handle: string }
export async function decisions(m: Mem): Promise<Saved[]> {
  const events = (await eventsOf(m.h.home, ['decision.created'])) as unknown as Saved[];
  return events.map((e) => ({ ...e, handle: `decision:${e.id}` }));
}

// ---- Agents. `hub` is what #26's stand-in needs of the hub setup's login service started.
export const hubOf = (m: Mem): Hub => ({ home: m.h.home, socket: join(rootOf(m.h.home), 'hub.sock') }) as Hub;
export interface Working { agent: Agent; session: ReturnType<Agent['session']>; delivered: string }
/** An agent starting a session in `cwd` with `prompt` first; `delivered` is what its SessionStart and first prompt were given. */
export async function startAgent(m: Mem, cwd: string, prompt: string): Promise<Working> {
  const hub = hubOf(m);
  const agent = Agent.start(m.h.home, cwd);
  const session = agent.session(cwd, prompt);
  const started = await agent.hook(hub, session, 'SessionStart');
  const asked = await agent.hook(hub, session, 'UserPromptSubmit', { prompt });
  await agent.hook(hub, session, 'PreToolUse');
  await initialize(agent);
  return { agent, session, delivered: [...(started.lines as string[]), ...(asked.lines as string[])].join('\n') };
}
/** deep-hook's PreToolUse for a Bash command in a fresh session in `cwd`, as Claude Code's hook entry runs it. */
export async function toolCallIn(m: Mem, cwd: string, command: string): Promise<Ran> {
  const s: HookSession = newSession(m.h.home, cwd);
  await hook(m.h.home, s, 'SessionStart', payload(s, 'SessionStart'));
  return hook(m.h.home, s, 'PreToolUse', bash(s, command)) as unknown as Ran;
}
export const inboxText = async (m: Mem): Promise<string> => (await deep(m.h.home, ['inbox'])).stdout;
export const onBranch = (m: Mem, repo: string, branch: string): void => {
  execFileSync('/usr/bin/git', ['-C', repo, 'checkout', '-q', '-B', branch], { env: { ...process.env, HOME: m.h.home } });
};
/** A small PNG-shaped file, different per `mark`. */
export const png = (mark: string): Buffer => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`IHDR-${mark}`), Buffer.from('IEND')]);
export { put };
