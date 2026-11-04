// Shared test-side tools for the issue #1108 acceptance tests: the surface README declares (types only), and a world
// that drives the real default launcher (`runEval` with no launcher) against a stand-in Claude Code on PATH
// (fake-claude.mjs), a user's home that holds MCP servers, allow rules and a forge token, and loopback fixture servers
// for the model endpoint, the user's chat MCP server and the forge. Nothing here stands in for the eval, the launcher,
// the recording or the sandbox.

import { execFileSync } from 'node:child_process';
import { chmodSync, copyFileSync, linkSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openEvidenceStore } from '../../../packages/evidence/src/index.ts';
import { openRecord, openRecordReader, type Connection, type ReplayPlan, type ReplayRun, type Comparison } from '../../../packages/record/src/index.ts';
import * as evalModule from '../../../packages/config-eval/src/index.ts';

// ---- Criterion IDs: `#1108.` and the first 8 hex of SHA-256 of the criterion's text, trimmed, whitespace collapsed.
export const AC1 = '#1108.13e6be53';
export const AC2 = '#1108.00f85bd0';
export const AC3 = '#1108.2ddbed50';
export const AC4 = '#1108.b3120abf';

// ---- The surface README declares, in packages/config-eval/src/index.ts (extending #112's shapes).
/** One outside call the original session made, with its result, as its transcript holds them. */
export interface RecordedCall { tool: string; input: unknown; result: string; error?: boolean }
export interface ReplayTask { id: string; at: number; repo: string; commit: string; prompt: string; recording?: RecordedCall[] }
/** One outside call a replayed agent made, as the replay recorded it. */
export interface ReplayCall { task: string; side: 'base' | 'change'; repeat: number; tool: string; input: unknown; answered: boolean }
export interface EvalReport {
  plan: ReplayPlan;
  hash: string;
  runs: ReplayRun[];
  after: Comparison;
  before: Comparison;
  held: boolean;
  usage: { ms: number; plan_share: number | null };
  calls: ReplayCall[];
  diverged: { task: string; calls: ReplayCall[] }[];
}

// ---- Fake values: obviously not credentials, and matching no token pattern.
export const SIGN_IN = 'fake-model-sign-in-for-tests-5d6e7f';
export const FORGE_TOKEN = 'fake-forge-token-for-tests-0f1e2d';
export const CHAT_TOKEN = 'fake-chat-token-for-tests-9a8b7c';
/** An allow rule of the user's own that no launcher would write for itself. */
export const USER_RULE = 'Bash(./scripts/deploy-staging.sh:*)';
export const USER_PLUGIN = 'forge-helper@shop-market';
export const T0 = Date.UTC(2026, 9, 5, 9, 0, 0);
const HOUR = 3_600_000;

/** One tool call a stand-in agent makes: Claude Code's tool name and input; `when` limits it to a variant whose CLAUDE.md holds those words. `{{now}}` is the time, `{{tmp}}` a fresh temp folder. */
export interface Step { tool: string; input: Record<string, unknown>; when?: string }
/** What a stand-in agent saw in one run, sent to its model endpoint. */
export interface Observation {
  prompt: string; cwd: string; claudeMd: string; argv: string[]; env: Record<string, string>; configDir: string; globalFile: string; mode: string;
  settings: { source: string; path: string | null; json: unknown }[];
  servers: Record<string, unknown>;
  calls: { tool: string; input: Record<string, unknown>; ran: unknown; content: string; is_error: boolean }[];
  reads: { path: string; ok: boolean; text?: string; error?: string }[];
  home: { path: string; text?: string | null; error?: string }[];
  net: { from: string; target: string; ok: boolean; errno?: string }[];
  crash?: string;
}
interface Hit { method: string; url: string; headers: http.IncomingHttpHeaders; body: string }

const HERE = fileURLToPath(new URL('.', import.meta.url));
const roots: string[] = [];
const closers: (() => Promise<void>)[] = [];
/** Removes every world's folder and closes its servers; each test file calls it in afterEach. */
export async function cleanup(): Promise<void> {
  for (const c of closers.splice(0)) await c();
  for (const r of roots.splice(0)) rmSync(r, { recursive: true, force: true });
}

/** A loopback server that keeps every request it gets and answers with `answer`. */
async function fixture(answer: (hit: Hit, res: http.ServerResponse) => void): Promise<{ url: string; hits: Hit[] }> {
  const hits: Hit[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d: Buffer) => { body += d.toString('utf8'); });
    req.on('end', () => { const hit = { method: req.method ?? '', url: req.url ?? '', headers: req.headers, body }; hits.push(hit); answer(hit, res); });
  });
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  closers.push(() => new Promise<void>((done) => { server.closeAllConnections(); server.close(() => done()); }));
  return { url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, hits };
}
const json = (res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) => {
  res.writeHead(status, { 'content-type': 'application/json', ...headers });
  res.end(JSON.stringify(body));
};

/** The live answer of the user's chat server: what a replay must never get. */
export const LIVE_CHAT_RESULT = '{"ok":true,"channel":"C0LIVE","ts":"live-post-sent"}';

export interface World {
  box: string;
  home: string;
  repo: string;
  commit: string;
  env: Record<string, string>;
  model: { url: string; hits: Hit[] };
  chat: { url: string; hits: Hit[] };
  forge: { url: string; hits: Hit[] };
  /** Every observation the stand-in agents sent their model, with the sign-in each request carried. */
  observations(): { auth: string; obs: Observation }[];
  plan(tasks: string[], repeats?: number): ReplayPlan;
  /** A task in the world's repo, after the plan's cutoff. */
  task(id: string, prompt: string, recording?: RecordedCall[]): ReplayTask;
  /** The real eval with its default launcher: no `launcher` given. */
  run(plan: ReplayPlan, tasks: ReplayTask[]): Promise<EvalReport>;
}

/** The base side's and the change side's instruction file; the change's asks for a PR, which some scripts act on. */
export const VARIANTS = {
  base: { name: 'terse', files: { 'CLAUDE.md': '# Shop\nKeep replies short.\n' } },
  change: { name: 'pr', files: { 'CLAUDE.md': '# Shop\nKeep replies short. Open a PR when done.\n' } },
};

export async function world(scripts: Record<string, { steps: Step[] }>, opts: { probes?: { host: string; port: number; ms: number }[] } = {}): Promise<World> {
  const box = realpathSync(mkdtempSync(join(tmpdir(), 'dh1108-')));
  roots.push(box);
  const bin = join(box, 'bin');
  const home = join(box, 'you');
  const repo = join(box, 'shop');
  for (const d of [bin, home, repo, join(home, '.claude'), join(home, '.config', 'gh')]) mkdirSync(d, { recursive: true });

  const model = await fixture((hit, res) => {
    const auth = String(hit.headers.authorization ?? hit.headers['x-api-key'] ?? '');
    if (auth !== `Bearer ${SIGN_IN}` && auth !== SIGN_IN) return json(res, 401, { type: 'error', error: { type: 'authentication_error', message: 'invalid sign-in' } });
    json(res, 200, { id: 'msg_fake', type: 'message', role: 'assistant', content: [{ type: 'text', text: 'Done.' }], usage: { input_tokens: 100, output_tokens: 20 } });
  });
  const chat = await fixture((hit, res) => {
    let m: { id?: number; method?: string } = {};
    try { m = JSON.parse(hit.body) as typeof m; } catch { /* not JSON-RPC */ }
    if (m.id === undefined) { res.writeHead(202); res.end(); return; }
    const result = m.method === 'initialize' ? { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'chat', version: '1.0.0' } }
      : m.method === 'tools/list' ? { tools: [{ name: 'post_message', description: 'Post a message to a channel', inputSchema: { type: 'object', properties: { channel: { type: 'string' }, text: { type: 'string' } }, required: ['channel', 'text'] } }] }
      : m.method === 'tools/call' ? { content: [{ type: 'text', text: LIVE_CHAT_RESULT }] } : {};
    json(res, 200, { jsonrpc: '2.0', id: m.id, result }, { 'mcp-session-id': 'chat-session-1' });
  });
  const forge = await fixture((_hit, res) => json(res, 201, { number: 7, html_url: 'https://github.test/shop/shop/pull/7' }));

  // The stand-in CLI and a stand-in gh, with the interpreter they run on, all in the one folder PATH names for them.
  const node = join(bin, 'node');
  try { linkSync(process.execPath, node); } catch { copyFileSync(process.execPath, node); }
  chmodSync(node, 0o755);
  copyFileSync(join(HERE, 'fake-claude.mjs'), join(bin, 'claude.mjs'));
  writeFileSync(join(bin, 'gh.mjs'), `// A stand-in gh: it sends its call to the forge (a loopback fixture) with whatever token it can find.
import { readFileSync } from 'node:fs';
const S = JSON.parse(readFileSync(new URL('./scenario.json', import.meta.url), 'utf8'));
const args = process.argv.slice(2);
let token = process.env.GH_TOKEN ?? '';
try { token ||= /oauth_token:\\s*(\\S+)/.exec(readFileSync((process.env.HOME ?? '') + '/.config/gh/hosts.yml', 'utf8'))?.[1] ?? ''; } catch {}
try {
  await fetch(S.forge + '/gh', { method: 'POST', headers: { authorization: 'token ' + token }, body: JSON.stringify(args), signal: AbortSignal.timeout(5000) });
  console.log(args[0] === 'pr' && args[1] === 'create' ? 'https://github.test/shop/shop/pull/7' : '{"state":"LIVE"}');
} catch (e) { console.error('error connecting to api.github.com: ' + (e?.cause?.code ?? e?.message)); process.exit(1); }
`);
  for (const name of ['claude', 'gh']) {
    writeFileSync(join(bin, name), `#!/bin/sh\nexec "${node}" "${join(bin, `${name}.mjs`)}" "$@"\n`);
    chmodSync(join(bin, name), 0o755);
  }
  const userFiles = [join(home, '.claude', 'settings.json'), join(home, '.claude.json'), join(home, '.config', 'gh', 'hosts.yml')];
  writeFileSync(join(bin, 'scenario.json'), JSON.stringify({ scripts, userFiles, forge: forge.url, probes: opts.probes }));

  // The user's own Claude Code home: a model sign-in, allow rules, a plug-in, a chat MCP server with its token, another
  // MCP server, and a forge token for gh.
  writeFileSync(join(home, '.claude', '.credentials.json'), JSON.stringify({ claudeAiOauth: { accessToken: SIGN_IN, refreshToken: 'fake-model-refresh-for-tests', expiresAt: 4_102_444_800_000, scopes: ['user:inference'] } }));
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({
    permissions: { allow: ['mcp__chat__post_message', 'Bash(gh pr create:*)', 'Bash(gh pr view:*)', USER_RULE] },
    enabledPlugins: { [USER_PLUGIN]: true },
  }, null, 2));
  writeFileSync(join(home, '.claude.json'), JSON.stringify({
    mcpServers: {
      chat: { type: 'http', url: `${chat.url}/mcp`, headers: { Authorization: `Bearer ${CHAT_TOKEN}` } },
      tracker: { type: 'stdio', command: 'tracker-mcp', args: ['--team', 'shop'] },
    },
  }, null, 2));
  writeFileSync(join(home, '.config', 'gh', 'hosts.yml'), `github.com:\n    oauth_token: ${FORGE_TOKEN}\n    user: shop-dev\n    git_protocol: https\n`);

  // The repo the past tasks ran in: one commit, before the plan's cutoff.
  const git = (...args: string[]) => execFileSync('git', ['-c', 'user.name=Dev', '-c', 'user.email=dev@shop.test', ...args], {
    cwd: repo, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_DATE: new Date(T0 - HOUR).toISOString(), GIT_COMMITTER_DATE: new Date(T0 - HOUR).toISOString() },
  }).trim();
  git('init', '-q', '-b', 'main');
  writeFileSync(join(repo, 'CLAUDE.md'), '# Shop\n');
  writeFileSync(join(repo, 'cart.js'), 'export const total = (items) => items.reduce((s, i) => s + i.price, 0);\n');
  git('add', '-A');
  git('commit', '-q', '-m', 'start');
  const commit = git('rev-parse', 'HEAD');

  const env = { PATH: `${bin}:/usr/bin:/bin`, HOME: home, ANTHROPIC_BASE_URL: model.url, GH_TOKEN: FORGE_TOKEN };
  return {
    box, home, repo, commit, env, model, chat, forge,
    observations() {
      return model.hits.flatMap((h) => {
        try {
          const body = JSON.parse(h.body) as { metadata?: { observation?: Observation } };
          return body.metadata?.observation ? [{ auth: String(h.headers.authorization ?? h.headers['x-api-key'] ?? ''), obs: body.metadata.observation }] : [];
        } catch { return []; }
      });
    },
    plan(tasks, repeats = 1) {
      return {
        id: 'p1108', cutoff: T0, tasks, fitted: [], repeats, rule: 'paired-mean-one-sided-95', variants: VARIANTS,
        models: { agent: 'claude-haiku-5-5', judge: 'gpt-reserve' }, measures: [{ name: 'tokens', better: 'lower' }], budget: { ms: 900_000, plan_share: 1 },
      };
    },
    task(id, prompt, recording) {
      return { id, at: T0 + HOUR, repo, commit, prompt, ...(recording ? { recording } : {}) };
    },
    async run(plan, tasks) {
      const report = await evalModule.runEval({ plan, tasks: tasks as evalModule.ReplayTask[], root: join(box, 'work'), env });
      return report as unknown as EvalReport;
    },
  };
}

/** Archives one Claude Code session's transcript in a real record over a real evidence store, and reads the archive's tasks back. */
export async function archivedTasksOf(w: World, lines: object[]): Promise<ReplayTask[]> {
  const store = await openEvidenceStore({ root: join(w.box, 'evidence'), now: () => T0 + 2 * HOUR });
  const record = await openRecord({ path: join(w.box, 'ledger.db'), now: () => T0 + 2 * HOUR, evidence: store });
  const you: Connection = { writer: 'app', actor: 'you', scope: 'you' };
  const put = await store.connect({ role: 'deepbuild', via: 'capture' }).put({
    bytes: new Uint8Array(Buffer.from(lines.map((l) => JSON.stringify(l)).join('\n'))), kind: 'transcript', source: 'claude-code', redaction: 'complete', license: { name: 'own', allows: [] },
  });
  if (put.status !== 'stored') throw Error(`the transcript wasn't stored: ${put.status}`);
  await record.append(you, { v: 1, id: '01K74FX2B4D6F8H0K2M4P6R001', kind: 'transcript.archived', ts: T0 + 2 * HOUR, data: { session: 'session:01K74FX2B4D6F8H0K2M4P6R000', evidence: put.evidence.sha256 } });
  await record.close();
  const reader = openRecordReader({ path: join(w.box, 'ledger.db'), evidence: store });
  try {
    const { tasks } = await evalModule.archivedTasks(reader, (sha) => store.read(sha));
    return tasks as ReplayTask[];
  } finally {
    reader.close();
  }
}
export const at = (h: number): string => new Date(T0 + h * HOUR).toISOString();

/** The observations of the runs of one task, by its words; and of one side, by its instruction file. */
export function runsOf(w: World, prompt: string, side?: 'base' | 'change'): { auth: string; obs: Observation }[] {
  return w.observations().filter((o) => o.obs.prompt === prompt && (!side || o.obs.claudeMd === VARIANTS[side].files['CLAUDE.md']));
}
/** A short view of a call, for assertion messages. */
export const shown = (c: { tool: string; input: unknown; content?: string; is_error?: boolean } | undefined): string =>
  c ? `${c.tool} ${JSON.stringify(c.input)} → ${c.is_error ? 'error' : 'result'} ${JSON.stringify(c.content ?? '').slice(0, 300)}` : 'no such call';
