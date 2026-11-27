// #1892 AC2: a test agent registered in a test, with parts of its own, runs a job to a recorded result with no edit
// to packages/runner/src/runner.ts.
//
// Registration is what agents.ts already has for pi: an entry assigned into its exported `AGENTS` table. The tests
// add theirs under names runner.ts has never heard of and take them out again; they touch nothing else of the
// runner, and reach it through `openRunner` (helpers.ts). The agent's binary is a stand-in printing a fixed stream.
//
// What the tests need of the stream parser's shape (README, The shapes chosen):
// - it is a member of an agent's `AgentParts`, so parts copied whole carry it (the first two tests need only this);
// - it is named `stream`, and the runner calls it once for each line of the job's stdout that parses as a JSON
//   object, with that object among its arguments (the third test needs this, and nothing of the other arguments).
import { afterAll, afterEach, expect, it } from 'vitest';
import { AGENTS, type AgentParts } from '../../../packages/runner/src/agents.ts';
import { closeWorlds, printed, runJob, shown, shownEnded } from './helpers.ts';

const table = AGENTS as Record<string, AgentParts | undefined>;
const registered: string[] = [];
function register(name: string, parts: AgentParts): void {
  expect(table[name], `${name} is already an agent of the runner`).toBeUndefined();
  table[name] = parts;
  registered.push(name);
}
afterEach(closeWorlds, 60_000);
afterAll(() => { for (const name of registered) delete table[name]; });

const CODEX_STREAM = [
  { type: 'thread.started', thread_id: '018f1892-0000-7000-8000-00000000c0de' },
  { type: 'item.completed', item: { id: 'item_0', type: 'agent_message', text: 'A test agent on Codex\'s parts answered.' } },
  { type: 'turn.completed', usage: { input_tokens: 120, cached_input_tokens: 100, output_tokens: 9 } },
];
const PI_STREAM = [
  { type: 'session', id: 'pi-session-1892' },
  { type: 'message_end', message: { role: 'assistant', model: 'pi-model-1892', stopReason: 'stop', content: [{ type: 'text', text: 'A test agent on pi\'s parts answered.' }], usage: { input: 4, output: 8, cacheRead: 50, cacheWrite: 6, cost: { total: 0.25 } } } },
  { type: 'agent_settled' },
];

it('#1892.3bee48f8 AC2: a test agent registered with Codex\'s parts under its own name runs a job to Codex\'s recorded result', async () => {
  register('agent-1892-on-codex-parts', { ...AGENTS.codex! });
  const { rec, output, ended } = await runJob('agent-1892-on-codex-parts', 'codex.facts.json', CODEX_STREAM);
  expect(output, 'the job\'s stdout, as the runner read it').toBe(printed(CODEX_STREAM));
  expect(rec.agent).toBe('agent-1892-on-codex-parts');
  const expected = {
    state: 'finished', result: 'A test agent on Codex\'s parts answered.', session: '018f1892-0000-7000-8000-00000000c0de', model: 'unknown',
    usage: { input: 20, cached: 100, output: 9 }, cost_usd: undefined, cause: undefined, refused: undefined,
  };
  expect(shown(rec), 'the job\'s record').toEqual({ ...expected, blocked: undefined });
  expect(ended.map(shownEnded), 'its job.ended event').toEqual([expected]);
}, 180_000);

it('#1892.3bee48f8 AC2: a test agent registered with pi\'s parts under its own name runs a job to pi\'s recorded result', async () => {
  register('agent-1892-on-pi-parts', { ...AGENTS.pi! });
  const { rec, output, ended } = await runJob('agent-1892-on-pi-parts', 'pi.facts.json', PI_STREAM);
  expect(output, 'the job\'s stdout, as the runner read it').toBe(printed(PI_STREAM));
  expect(rec.agent).toBe('agent-1892-on-pi-parts');
  const expected = {
    state: 'finished', result: 'A test agent on pi\'s parts answered.', session: 'pi-session-1892', model: 'pi-model-1892',
    usage: { input: 10, cached: 50, output: 8 }, cost_usd: 0.25, cause: undefined, refused: undefined,
  };
  expect(shown(rec), 'the job\'s record').toEqual({ ...expected, blocked: undefined });
  expect(ended.map(shownEnded), 'its job.ended event').toEqual([expected]);
}, 180_000);

// An agent no shipped parser can read: its binary prints lines of its own, marked `agent1892`. Its parts are its
// own: no sign-in, no account, no plan window, no MCP flags, and a stream parser that reads its lines. So that the
// parser depends on no more of the runner's shape than its name and the line it is handed, it says what its lines
// mean in Codex's words and hands them on to Codex's parser, every other argument untouched.
const OWN_STREAM = [
  { agent1892: 'hello', id: 'own-session-1892' },
  'a line that is no JSON',
  { agent1892: 'said', words: 'An agent of the test\'s own answered.' },
  { agent1892: 'bye', read: 40, kept: 30, wrote: 7 },
];
type Line = Record<string, unknown>;
const isOwn = (v: unknown): v is Line => typeof v === 'object' && v !== null && typeof (v as Line).agent1892 === 'string';
function inCodexWords(line: Line): Line {
  if (line.agent1892 === 'hello') return { type: 'thread.started', thread_id: line.id };
  if (line.agent1892 === 'said') return { type: 'item.completed', item: { type: 'agent_message', text: line.words } };
  if (line.agent1892 === 'bye') return { type: 'turn.completed', usage: { input_tokens: line.read, cached_input_tokens: line.kept, output_tokens: line.wrote } };
  return {};
}
const ownParts = (): AgentParts => {
  const parts = {
    // A shipped facts file, since facts are read by name from the repo's adapters/ folder: its binary is named
    // `codex`, launched with Codex's read-only job arguments at a version its facts cover.
    facts: 'codex.facts.json',
    confine: () => [],
    account: () => null,
    signIn: () => [],
    windows: () => new Map<string, { used: number; resets: number | null }>(),
    windowless: true,
    hosts: ['example.invalid:443'],
    reach: ({ temp }: { temp: string }) => ({ TMPDIR: temp }),
    token: async () => undefined,
    expires: async () => undefined,
    stream(...given: unknown[]): unknown {
      const codex = AGENTS.codex as unknown as { stream(...args: unknown[]): unknown };
      return codex.stream(...given.map((one) => (isOwn(one) ? inCodexWords(one) : one)));
    },
  };
  return parts as unknown as AgentParts;
};

it('#1892.3bee48f8 AC2: a test agent with parts and a stream parser of its own runs a job to a recorded result', async () => {
  register('agent-1892-own', ownParts());
  const { rec, output, ended } = await runJob('agent-1892-own', 'codex.facts.json', OWN_STREAM);
  expect(output, 'the job\'s stdout, as the runner read it').toBe(printed(OWN_STREAM));
  expect(rec.agent).toBe('agent-1892-own');
  const expected = {
    state: 'finished', result: 'An agent of the test\'s own answered.', session: 'own-session-1892', model: 'unknown',
    usage: { input: 10, cached: 30, output: 7 }, cost_usd: undefined, cause: undefined, refused: undefined,
  };
  expect(shown(rec), 'the job\'s record').toEqual({ ...expected, blocked: undefined });
  expect(ended.map(shownEnded), 'its job.ended event').toEqual([expected]);
}, 180_000);
