// #1892 AC3: no visible change. For each agent the runner ships parts for (claude-code, codex, pi), a fixed stream
// fed through a real job gives exactly the record the base gives: its result text, session, usage, cost, model,
// stop cause and state, in the job's record and in its `job.ended` event, and its stdout as the runner read it. The
// runner's entry exports what it did. Every expected value here is the base's (8e3278862), read from its parsers
// and confirmed by this suite's run on it (BASE-FAILURE.txt): these tests pass on the base and must still pass
// unchanged; a planted wrong program proves them (README, AC3).
import { afterEach, describe, expect, it } from 'vitest';
import { closeWorlds, factsOf, printed, runJob, shown, shownEnded, type Shown, type StreamLine } from './helpers.ts';

afterEach(closeWorlds, 60_000);

type Expected = Omit<Shown, 'blocked'>;
const none = { result: undefined, session: undefined, model: undefined, usage: undefined, cost_usd: undefined, cause: undefined, refused: undefined };
/** Lines no parser reads: text that is no JSON, and JSON that is no object. They change no record. */
const NOISE: StreamLine[] = ['no JSON at all', '[1,2,3]', '"a string"', '7'];

async function pin(agent: string, factsFile: string, lines: StreamLine[], expected: Expected, o: { exit?: number } = {}): Promise<void> {
  const { rec, output, ended } = await runJob(agent, factsFile, lines, { ...o, window: agent === 'claude-code' });
  expect(output, 'the job\'s stdout, as the runner read it').toBe(printed(lines));
  expect({ agent: rec.agent, kind: rec.kind, version: rec.binary?.version }).toEqual({ agent, kind: 'read', version: factsOf(factsFile).versions.at(-1) });
  expect(shown(rec), 'the job\'s record').toEqual({ ...expected, blocked: undefined });
  expect(ended.map(shownEnded), 'its job.ended event').toEqual([expected]);
}

describe('a Claude Code job', () => {
  const S = '00000000-0000-4000-8000-000000001892';
  const assistant = (id: string, model: string, usage: Record<string, number>, more: Record<string, unknown> = {}) => ({ type: 'assistant', session_id: S, message: { id, role: 'assistant', model, usage }, ...more });
  const claude = (lines: StreamLine[], expected: Expected) => pin('claude-code', 'claude-code.facts.json', lines, expected);

  it('#1892.6f3b1f79 AC3: records its result, session, cost, each message\'s usage once, and the model with the most output tokens', async () => {
    await claude([
      { type: 'system', subtype: 'init', session_id: S },
      ...NOISE,
      assistant('msg_1', 'claude-big-1892', { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 7 }),
      // The same message again, as a stream repeats it for each content block: counted once.
      assistant('msg_1', 'claude-big-1892', { input_tokens: 10, cache_creation_input_tokens: 5, cache_read_input_tokens: 100, output_tokens: 7 }),
      // A synthetic message is no model's: neither its usage nor its model is read.
      assistant('msg_2', '<synthetic>', { input_tokens: 1000, cache_creation_input_tokens: 1000, cache_read_input_tokens: 1000, output_tokens: 1000 }),
      assistant('msg_3', 'claude-small-1892', { input_tokens: 2, cache_read_input_tokens: 1, output_tokens: 3 }),
      { type: 'result', subtype: 'success', is_error: false, result: 'Claude Code\'s answer.', total_cost_usd: 0.0375, session_id: S, modelUsage: { 'claude-small-1892': { outputTokens: 3 }, 'claude-big-1892': { outputTokens: 7 } } },
    ], { ...none, state: 'finished', result: 'Claude Code\'s answer.', session: S, model: 'claude-big-1892', usage: { input: 17, cached: 101, output: 10 }, cost_usd: 0.0375 });
  }, 180_000);

  it('#1892.6f3b1f79 AC3: with no model usage in its result, records the last model that answered', async () => {
    await claude([
      { type: 'system', subtype: 'init', session_id: S },
      assistant('msg_1', 'claude-big-1892', { input_tokens: 1, output_tokens: 2 }),
      assistant('msg_2', 'claude-small-1892', { input_tokens: 3, output_tokens: 4 }),
      { type: 'result', subtype: 'success', is_error: false, result: 'Answered.', session_id: S },
    ], { ...none, state: 'finished', result: 'Answered.', session: S, model: 'claude-small-1892', usage: { input: 4, cached: 0, output: 6 } });
  }, 180_000);

  it('#1892.6f3b1f79 AC3: stops for max_turns when its result is an error of that subtype', async () => {
    await claude([
      { type: 'system', subtype: 'init', session_id: S },
      assistant('msg_1', 'claude-big-1892', { input_tokens: 1, output_tokens: 2 }),
      { type: 'result', subtype: 'error_max_turns', is_error: true, total_cost_usd: 0.5, session_id: S },
    ], { ...none, state: 'stopped', session: S, model: 'claude-big-1892', usage: { input: 1, cached: 0, output: 2 }, cost_usd: 0.5, cause: 'max_turns' });
  }, 180_000);

  it('#1892.6f3b1f79 AC3: stops for the cause its facts map an API error entry to', async () => {
    const errors = factsOf('claude-code.facts.json').stop!.cause!.errors!;
    const [said, cause] = Object.entries(errors.values)[0]!;
    await claude([
      { type: 'system', subtype: 'init', session_id: S },
      assistant('msg_e', '<synthetic>', { input_tokens: 0, output_tokens: 0 }, { is_api_error_message: true, [errors.field]: said }),
      { type: 'result', subtype: 'success', is_error: true, result: 'API Error', session_id: S },
    ], { ...none, state: 'stopped', result: 'API Error', session: S, model: 'unknown', cause });
  }, 180_000);

  it('#1892.6f3b1f79 AC3: finishes with a refusal when its result lists a permission denial', async () => {
    await claude([
      { type: 'system', subtype: 'init', session_id: S },
      { type: 'result', subtype: 'success', is_error: false, result: 'Could not write.', session_id: S, permission_denials: [{ tool_name: 'Write' }] },
    ], { ...none, state: 'finished', result: 'Could not write.', session: S, model: 'unknown', cause: 'refusal' });
  }, 180_000);

  it('#1892.6f3b1f79 AC3: stops as crashed when it ends with no result', async () => {
    await claude([{ type: 'system', subtype: 'init', session_id: S }, assistant('msg_1', 'claude-big-1892', { input_tokens: 1, output_tokens: 2 })],
      { ...none, state: 'stopped', session: S, model: 'claude-big-1892', usage: { input: 1, cached: 0, output: 2 }, cause: 'agent_crashed' });
  }, 180_000);
});

describe('a Codex job', () => {
  const T = '018f1892-1111-7000-8000-000000000001';
  const codex = (lines: StreamLine[], expected: Expected) => pin('codex', 'codex.facts.json', lines, expected);
  const said = (text: string) => ({ type: 'item.completed', item: { id: 'item_1', type: 'agent_message', text } });

  it('#1892.6f3b1f79 AC3: records its thread as its session, its last message as its result, and its input without the cached tokens', async () => {
    await codex([
      { type: 'thread.started', thread_id: T },
      ...NOISE,
      { type: 'turn.started' },
      said('A first message.'),
      { type: 'item.completed', item: { id: 'item_2', type: 'command_execution', command: 'cat README.md', status: 'completed', aggregated_output: 'text' } },
      said('Codex\'s answer.'),
      { type: 'turn.completed', usage: { input_tokens: 120, cached_input_tokens: 100, output_tokens: 9 } },
    ], { ...none, state: 'finished', result: 'Codex\'s answer.', session: T, model: 'unknown', usage: { input: 20, cached: 100, output: 9 } });
  }, 180_000);

  it('#1892.6f3b1f79 AC3: stops for a cause unknown when its turn fails', async () => {
    await codex([
      { type: 'thread.started', thread_id: T },
      said('Half an answer.'),
      { type: 'turn.failed', error: { message: 'stream disconnected' } },
    ], { ...none, state: 'stopped', result: 'Half an answer.', session: T, model: 'unknown', cause: 'unknown' });
  }, 180_000);

  it('#1892.6f3b1f79 AC3: finishes with a refusal when it declined a patch or the sandbox stopped a write', async () => {
    await codex([
      { type: 'thread.started', thread_id: T },
      { type: 'item.completed', item: { id: 'item_1', type: 'file_change', status: 'declined' } },
      said('I can\'t write here.'),
      { type: 'turn.completed', usage: { input_tokens: 5, cached_input_tokens: 0, output_tokens: 2 } },
    ], { ...none, state: 'finished', result: 'I can\'t write here.', session: T, model: 'unknown', usage: { input: 5, cached: 0, output: 2 }, cause: 'refusal' });
    await codex([
      { type: 'thread.started', thread_id: T },
      { type: 'item.completed', item: { id: 'item_1', type: 'command_execution', command: 'touch out.txt', status: 'failed', aggregated_output: 'touch: out.txt: Operation not permitted' } },
      { type: 'turn.completed', usage: { input_tokens: 5, cached_input_tokens: 0, output_tokens: 2 } },
    ], { ...none, state: 'finished', session: T, model: 'unknown', usage: { input: 5, cached: 0, output: 2 }, cause: 'refusal' });
  }, 240_000);
});

describe('a pi job', () => {
  const pi = (lines: StreamLine[], expected: Expected) => pin('pi', 'pi.facts.json', lines, expected);
  const opened = { type: 'session', id: 'pi-session-1892' };
  const settled = { type: 'agent_settled' };
  const message = (model: string, texts: string[], usage: Record<string, unknown>, more: Record<string, unknown> = {}) => ({
    type: 'message_end', message: { role: 'assistant', model, stopReason: 'stop', content: texts.flatMap((text) => [{ type: 'text', text }, { type: 'thinking', thinking: 'not said' }]), usage, ...more },
  });

  it('#1892.6f3b1f79 AC3: records its session, its last message\'s text and model, and each message\'s usage and cost', async () => {
    await pi([
      opened,
      ...NOISE,
      message('pi-model-1', ['One.'], { input: 4, output: 8, cacheRead: 50, cacheWrite: 6, cost: { total: 0.25 } }),
      { type: 'message_end', message: { role: 'user', content: [{ type: 'text', text: 'a tool result' }], usage: { input: 1000, output: 1000, cost: { total: 1000 } } } },
      message('pi-model-2', ['pi\'s ', 'answer.'], { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, cost: { total: 0.5 } }),
      settled,
    ], { ...none, state: 'finished', result: 'pi\'s answer.', session: 'pi-session-1892', model: 'pi-model-2', usage: { input: 11, cached: 50, output: 10 }, cost_usd: 0.75 });
  }, 180_000);

  it('#1892.6f3b1f79 AC3: finishes when a message after an error it retried answers', async () => {
    await pi([
      opened,
      message('pi-model-1', [], { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0.125 } }, { stopReason: 'error', errorMessage: 'overloaded' }),
      message('pi-model-1', ['Answered after a retry.'], { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, cost: { total: 0.25 } }),
      settled,
    ], { ...none, state: 'finished', result: 'Answered after a retry.', session: 'pi-session-1892', model: 'pi-model-1', usage: { input: 3, cached: 0, output: 3 }, cost_usd: 0.375 });
  }, 180_000);

  it('#1892.6f3b1f79 AC3: stops for the cause its facts name for its last message\'s error, with no result', async () => {
    const cause = factsOf('pi.facts.json').errorTexts.causes!['context window'];
    expect(cause, 'pi\'s facts name a cause for "context window"').toBeTypeOf('string');
    await pi([
      opened,
      message('pi-model-1', ['Said before the error.'], { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, cost: { total: 0.25 } }),
      message('pi-model-1', [], { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, cost: { total: 0 } }, { stopReason: 'error', errorMessage: 'context window exceeded: 140300 tokens' }),
      settled,
    ], { ...none, state: 'stopped', session: 'pi-session-1892', model: 'pi-model-1', usage: { input: 3, cached: 0, output: 3 }, cost_usd: 0.25, cause });
  }, 180_000);

  it('#1892.6f3b1f79 AC3: stops for a cause unknown when it is cut off at its output limit', async () => {
    await pi([opened, message('pi-model-1', ['Cut'], { input: 2, output: 3, cacheRead: 0, cacheWrite: 0, cost: { total: 0.25 } }, { stopReason: 'length' }), settled],
      { ...none, state: 'stopped', session: 'pi-session-1892', model: 'pi-model-1', usage: { input: 2, cached: 0, output: 3 }, cost_usd: 0.25, cause: 'unknown' });
  }, 180_000);
});

it('#1892.6f3b1f79 AC3: the runner\'s entry exports openRunner and nothing new', async () => {
  expect(Object.keys(await import('../../../packages/runner/src/index.ts')).sort()).toEqual(['openRunner']);
});
