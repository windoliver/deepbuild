// Shared test-side tools for the #87 `models` acceptance tests: the review check and the adapters' route (imported
// lazily, so each test fails on its own at the base), the fake `claude` with its recorded stream-json runs, the
// session that made the change (its transcript and the route its adapter recorded at its start), review jobs run
// through the real runner (#159's world: a real record, asks core, budget ledger, supervisor and runner), and the
// core's verdict on a claim the review check covers. None of them stands in for the review check, the runner or
// the adapter.
//
// Safety, as #159's: every folder is under /tmp/dh159-*, HOME is a temp folder with a fake sign-in, processes are
// stopped by PID only (#159's `cleanup`), no `claude` here is real, and nothing calls a model or the network.
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verdict } from '../../../../packages/verdicts/src/index.ts';
import type { ClaimCheck, ClaimInput, Run, Verdict } from '../../../../packages/verdicts/src/index.ts';
import type { JobRecord, JobSpec, Plant } from '../../../../packages/runner/src/index.ts';
import type { ChangeSession, ReviewAt } from '../../../../packages/checks-review/src/index.ts';
import { home, sub, tempDir, ulid } from '../../159/helpers.ts';
import { job, openWorld, room, type World } from '../../159/world.ts';

// ---- The review check and the adapters, reached only through their public entries, imported when a test first needs them.

type Review = typeof import('../../../../packages/checks-review/src/index.ts');
export const review = (): Promise<Review> => import('../../../../packages/checks-review/src/index.ts');
type Adapters = typeof import('../../../../packages/adapters/src/index.ts');
const adapters = (): Promise<Adapters> => import('../../../../packages/adapters/src/index.ts');

const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const FAKE = fileURLToPath(new URL('./fixtures/fake-claude.pl', import.meta.url));
const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

// ---- Recorded stream-json runs of a Claude Code review job, in Claude Code's own shapes (#159's fake prints the same).

/** One assistant message of a run: the model it names (none: the message names no model) and its output tokens. */
export interface Said { model: string | null; output: number }
/** A run's recorded stream: its init event (naming the launched model), its assistant messages, and its result
 *  event with total_cost_usd and, unless `usage` is empty, modelUsage listing each model in the order given. */
export interface Recorded { launched: string | null; said: Said[]; usage: Said[]; cost_usd: number }

/** What the review answers: no finding. Its words are the reviewer's; these tests read only which model said them. */
const ANSWER = 'I found nothing to send back in this diff.';
let ids = 0;
function stream(r: Recorded): string[] {
  const id = (): string => `${(++ids).toString(16).padStart(8, '0')}-87a0-4000-8000-0000000000${(ids % 100).toString().padStart(2, '0')}`;
  const init: Record<string, unknown> = {
    type: 'system', subtype: 'init', cwd: '/private/tmp/dh87-job', session_id: '__SESSION__', tools: ['Read', 'Grep', 'Glob'], mcp_servers: [],
    permissionMode: 'dontAsk', apiKeySource: 'none', claude_code_version: FAKE_VERSION, output_style: 'default', agents: [], skills: [], plugins: [], uuid: id(),
  };
  if (r.launched) init.model = r.launched;
  const lines: Record<string, unknown>[] = [init];
  let output = 0;
  for (const [i, s] of r.said.entries()) {
    output += s.output;
    const message: Record<string, unknown> = {
      id: `msg_011Cg87${i}${ids}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: i === r.said.length - 1 ? ANSWER : 'Reading the diff.' }],
      stop_reason: i === r.said.length - 1 ? 'end_turn' : 'tool_use', stop_sequence: null,
      usage: { input_tokens: 4, cache_creation_input_tokens: 1200, cache_read_input_tokens: 9000, output_tokens: s.output, service_tier: 'standard' },
    };
    if (s.model) message.model = s.model;
    lines.push({ type: 'assistant', message, parent_tool_use_id: null, session_id: '__SESSION__', uuid: id() });
  }
  const result: Record<string, unknown> = {
    type: 'result', subtype: 'success', is_error: false, duration_ms: 41_200, duration_api_ms: 39_800, num_turns: r.said.length, result: ANSWER,
    session_id: '__SESSION__', total_cost_usd: r.cost_usd,
    usage: { input_tokens: 4 * r.said.length, cache_creation_input_tokens: 1200 * r.said.length, cache_read_input_tokens: 9000 * r.said.length, output_tokens: output, service_tier: 'standard' },
    permission_denials: [], uuid: id(),
  };
  if (r.usage.length) {
    result.modelUsage = Object.fromEntries(r.usage.map((u) => [u.model!, {
      inputTokens: 4, outputTokens: u.output, cacheReadInputTokens: 9000, cacheCreationInputTokens: 1200, webSearchRequests: 0, costUSD: r.cost_usd / r.usage.length, contextWindow: 200_000,
    }]));
  }
  lines.push(result);
  return lines.map((l) => JSON.stringify(l));
}
/** A review answered by one model, named in its messages and its usage, as Claude Code prints it. */
export const answeredBy = (model: string, launched = 'gpt-5-codex'): Recorded =>
  ({ launched, said: [{ model, output: 380 }, { model, output: 1240 }], usage: [{ model, output: 1620 }], cost_usd: 0.0412 });

/** The recorded review runs the tests name, by the name a job's prompt gives (`@stream <name>`). */
export const STREAMS: Readonly<Record<string, Recorded>> = {
  // Launched for gpt-5-codex; the output names another model.
  'opus': answeredBy('claude-opus-4-1'),
  'sonnet': answeredBy('claude-sonnet-4-5'),
  'codex': answeredBy('gpt-5-codex'),
  'bedrock-opus': answeredBy('us.anthropic.claude-opus-4-1-20250805-v1:0'),
  'sonnet-dated': answeredBy('claude-sonnet-4-5-20250929'),
  // Nothing in the output names a model: no init model, no message model, no modelUsage.
  'nameless': { launched: null, said: [{ model: null, output: 380 }, { model: null, output: 1240 }], usage: [], cost_usd: 0.0412 },
  // Claude Code's own small calls on haiku (40 output tokens) are listed first in its usage; the review itself is
  // sonnet's, 3,000 output tokens over its messages.
  'haiku-then-sonnet': {
    launched: 'claude-sonnet-4-5',
    said: [{ model: 'claude-sonnet-4-5', output: 600 }, { model: 'claude-sonnet-4-5', output: 2400 }],
    usage: [{ model: 'claude-haiku-4-5', output: 40 }, { model: 'claude-sonnet-4-5', output: 3000 }],
    cost_usd: 0.0533,
  },
};

/** The newest Claude Code version the facts cover, which the fake prints for `--version`. */
const FAKE_VERSION = (JSON.parse(readFileSync(join(REPO, 'adapters/claude-code.facts.json'), 'utf8')) as { versions: string[] }).versions.at(-1)!;
/** Installs the fake `claude`, with every recorded run baked in, in a folder of its own; its path. */
export function install(): string {
  const dir = sub(tempDir(), 'bin');
  mkdirSync(dir, { recursive: true });
  const streams = Object.fromEntries(Object.entries(STREAMS).map(([name, r]) => [name, stream(r)]));
  const text = readFileSync(FAKE, 'utf8')
    .replace('__VERSION__', FAKE_VERSION)
    .replace('__STREAMS__', Buffer.from(JSON.stringify(streams), 'utf8').toString('base64'));
  const path = join(dir, 'claude');
  writeFileSync(path, text, { mode: 0o755 });
  chmodSync(path, 0o755);
  return path;
}

// ---- The runner, as #159's world opens it, with the fake first on the login shell's PATH.

export async function world(o: { plant?: Plant; reservePct?: number } = {}): Promise<World> {
  const bin = install();
  return await openWorld({ loginPath: `${dirname(bin)}:/usr/bin:/bin`, ...o });
}
/** The diff the review reads (its prompt; the change's session, claim and PR text never reach it). */
export const DIFF = [
  'diff --git a/src/cart.ts b/src/cart.ts',
  '--- a/src/cart.ts',
  '+++ b/src/cart.ts',
  '@@ -8,3 +8,4 @@ export function total(items: Item[]): number {',
  '   let sum = 0;',
  '   for (const item of items) sum += item.price * item.quantity;',
  '+  if (sum < 0) throw new Error(\'negative total\');',
  '   return sum;',
].join('\n');
export const CLAIM = `claim:${ulid()}`;
export const TASK = `task:${ulid()}`;
/** A review job's spec, as the review check submits it: kind review, the diff as its prompt, naming the claim and task.
 *  The `@stream` line picks the fake's recorded run. */
export const reviewSpec = (recorded: string, over: Partial<JobSpec> = {}): JobSpec =>
  job('review', `Review this diff.\n\n${DIFF}\n\n@stream ${recorded}\n`, { model: 'gpt-5-codex', claim: CLAIM, task: TASK, ...over });
/** Runs one review job to its end on a world with room in its window; its record. */
export async function reviewJob(w: World, recorded: string, over: Partial<JobSpec> = {}): Promise<JobRecord> {
  await room(w);
  const rec = await w.runner.run(reviewSpec(recorded, over));
  if (rec.state !== 'finished') throw new Error(`the review job didn't finish: ${JSON.stringify(rec)}; stdout: ${(await w.runner.output(rec.job)).slice(0, 2000)}`);
  return rec;
}

// ---- The session that made the change: its transcript, as Claude Code writes one, and the route its adapter recorded.

/** A Claude Code transcript (JSONL) of the session that made the change, whose assistant messages name `model`. */
export function transcript(model: string): string {
  const session = '7e0c87a1-0000-4000-8000-000000000087';
  const at = { sessionId: session, cwd: '/private/tmp/dh87-work', version: FAKE_VERSION, gitBranch: 'work', userType: 'external', entrypoint: 'cli' };
  const lines = [
    { parentUuid: null, isSidechain: false, type: 'user', message: { role: 'user', content: 'Reject negative cart totals in src/cart.ts.' }, uuid: 'u1', timestamp: '2026-11-03T09:00:00.000Z', ...at },
    {
      parentUuid: 'u1', isSidechain: false, type: 'assistant', requestId: 'req_011Cg87a', uuid: 'a1', timestamp: '2026-11-03T09:00:04.000Z', ...at,
      message: {
        model, id: 'msg_011Cg87work1', type: 'message', role: 'assistant', stop_reason: 'tool_use', stop_sequence: null,
        content: [{ type: 'tool_use', id: 'toolu_011Cg87e', name: 'Edit', input: { file_path: 'src/cart.ts', old_string: '  return sum;', new_string: '  if (sum < 0) throw new Error(\'negative total\');\n  return sum;' } }],
        usage: { input_tokens: 6, cache_creation_input_tokens: 2100, cache_read_input_tokens: 18000, output_tokens: 214, service_tier: 'standard' },
      },
    },
    {
      parentUuid: 'a1', isSidechain: false, type: 'assistant', requestId: 'req_011Cg87b', uuid: 'a2', timestamp: '2026-11-03T09:00:09.000Z', ...at,
      message: {
        model, id: 'msg_011Cg87work2', type: 'message', role: 'assistant', stop_reason: 'end_turn', stop_sequence: null,
        content: [{ type: 'text', text: 'Done: negative totals now throw.' }],
        usage: { input_tokens: 4, cache_creation_input_tokens: 300, cache_read_input_tokens: 20100, output_tokens: 31, service_tier: 'standard' },
      },
    },
  ];
  return `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`;
}
/** The environment a Claude Code session of yours starts in, plus `extra`. */
export const sessionEnv = (extra: Record<string, string> = {}): Record<string, string> =>
  ({ HOME: home(), PATH: '/usr/bin:/bin', LANG: 'en_US.UTF-8', TERM: 'xterm-256color', ...extra });
/** The session that made the change: a Claude Code session on `model`, its route as Claude Code's adapter records it
 *  at session start from the environment it started in. */
export async function changeSession(model: string, env: Record<string, string> = sessionEnv()): Promise<ChangeSession> {
  const claude = (await adapters()).shipped().get('claude');
  if (typeof claude.routeAtStart !== 'function') throw new Error('Claude Code\'s adapter records no route at session start (Adapter.routeAtStart)');
  return { agent: 'claude-code', transcript: transcript(model), route: claude.routeAtStart(env) };
}

// ---- The core's verdict on a claim whose one requirement a code check and the review check cover.

const HEAD = 'c'.repeat(40);
const ENV = { os: 'darwin' };
const REQ = 'R1';
const T0 = 1_762_160_400_000;
const keyOf = (check: string) => ({ check, digest: `d1:${sha256(check)}`, environment: { ...ENV }, tools: {} });
/** The review check as the claim selected it: a model is its oracle. */
export const REVIEW_CHECK: ClaimCheck = { ...keyOf('check:review'), source: 'definition', depth: 'unit', proof: 'static_check', oracle: 'model', covers: [REQ] };
const TESTS_CHECK: ClaimCheck = { ...keyOf('check:tests'), source: 'definition', depth: 'unit', proof: 'test_run', oracle: 'code', covers: [REQ] };
/** Where a review run lands: the claim, its commit, and the review check. */
export const AT: ReviewAt = { claim: CLAIM, commit: HEAD, check: REVIEW_CHECK };
const testsRun: Run = {
  run: 'run:tests1', ...keyOf('check:tests'), claim: CLAIM, commit: HEAD, outcome: 'passed', started: T0, ended: T0 + 1, tests_run: 3,
  reads: ['src/cart.ts'], failures: [], evidence: [], kept: true,
};
/** The verdict on the claim: its one requirement covered by a passing code check and by the review check, whose only
 *  run is `reviewRun` (no other review). */
export function claimVerdict(reviewRun: Run): Verdict {
  const claim: ClaimInput = {
    claim: CLAIM, agent: 'session:7e0c87a1', repo: 'repo:shop', task: TASK, commit: HEAD,
    requirements: [{ req: REQ, depth: 'unit', oracle: 'code', on_base: 'passes' }],
    checks: [TESTS_CHECK, REVIEW_CHECK], runs: [testsRun, reviewRun], changes: [], waivers: [], now: T0 + 60_000,
  };
  return verdict(claim);
}
export const shown = (v: Verdict): string => `${v.outcome}; reasons: ${v.reasons.join(' | ')}`;
