// The scripted model for the Codex corpus sessions that need no sign-in (#3136): an OpenAI Responses endpoint on
// loopback that answers each request the real Codex binary sends with the next step of one scenario, in the stream
// shape Codex's own tests serve (codex-rs/core/tests/common/responses.rs). Codex, its hooks and its rollout are real;
// only the model is scripted, as pi's sets script pi's model.
import http from 'node:http';

const CHILD = 'corpus child: reply with the word child-done.';
const MULTI_AGENT = 'multi_agent_v1';
const say = (text) => ({ type: 'message', role: 'assistant', id: `msg-${text}`, content: [{ type: 'output_text', text }] });
const call = (callId, name, args, namespace) => ({ type: 'function_call', call_id: callId, name, arguments: JSON.stringify(args), ...(namespace ? { namespace } : {}) });

/** What a request reads as: its input as text, the output of each call it answers, and the tools it lists. */
function read(body) {
  const input = Array.isArray(body.input) ? body.input : [];
  const outputs = new Map(input.filter((item) => item?.call_id && /_output$/.test(String(item.type))).map((item) => [item.call_id, JSON.stringify(item.output ?? item.tools ?? '')]));
  const tools = new Set((body.tools ?? []).map((tool) => tool.name ?? tool.type));
  return { text: JSON.stringify(input), outputs, tools };
}

// Each scenario: the reply items for one request, and the tokens the reply says the context holds.
const SCENARIOS = {
  // A spawned child, then a wait on it: SubagentStart, and SubagentStop in place of the child's own Stop. Where the
  // multi-agent tools sit behind tool_search, a search comes first.
  subagent: (request) => {
    if (request.text.includes(CHILD) && !request.text.includes('spawn-1')) return [say('child-done')];
    if (request.outputs.has('wait-1')) return [say('parent-done')];
    if (request.outputs.has('spawn-1')) {
      const agent = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/.exec(request.outputs.get('spawn-1'))?.[0];
      return [call('wait-1', 'wait_agent', { targets: agent ? [agent] : [], timeout_ms: 30_000 }, MULTI_AGENT)];
    }
    if (!request.tools.has(MULTI_AGENT) && !request.outputs.has('search-1')) return [{ type: 'tool_search_call', call_id: 'search-1', execution: 'client', arguments: { query: 'spawn agent', limit: 5 } }];
    return [call('spawn-1', 'spawn_agent', { message: CHILD }, MULTI_AGENT)];
  },
  // A shell call whose reply says the context is past the session's auto-compact limit: Codex compacts mid-turn
  // (PreCompact, PostCompact, trigger auto), then the turn goes on.
  compact: (request, state) => {
    if (request.text.includes('CONTEXT CHECKPOINT COMPACTION')) {
      state.compacted = true;
      return [say('summary: the shell call echoed before-compact.')];
    }
    if (state.compacted) return [say('after-compact')];
    return { items: [call('cmd-1', 'exec_command', { cmd: 'echo before-compact' })], tokens: 200_000 };
  },
  // A shell call long enough to be interrupted.
  interrupt: (request) => (request.outputs.has('cmd-1') ? [say('slept')] : [call('cmd-1', 'exec_command', { cmd: 'sleep 30 && echo slept' })]),
};

/** The scenario's model, listening on loopback: its base URL, and close. */
export function scriptedModel(name) {
  const scenario = SCENARIOS[name];
  if (!scenario) throw Error(`no scripted model for ${name}`);
  const state = {};
  let count = 0;
  const server = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8').on('data', (chunk) => { raw += chunk; }).on('end', () => {
      if (req.method !== 'POST' || !req.url.endsWith('/responses')) { res.writeHead(404).end(); return; }
      let body = {};
      try { body = JSON.parse(raw); } catch { /* answered as an empty request */ }
      const reply = scenario(read(body), state);
      const { items, tokens } = Array.isArray(reply) ? { items: reply, tokens: 100 } : reply;
      const id = `resp-${name}-${++count}`;
      const usage = { input_tokens: tokens, input_tokens_details: null, output_tokens: 1, output_tokens_details: null, total_tokens: tokens + 1 };
      const events = [{ type: 'response.created', response: { id } }, ...items.map((item) => ({ type: 'response.output_item.done', item })), { type: 'response.completed', response: { id, usage } }];
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(events.map((event) => `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`).join(''));
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/v1`, close: () => server.close() })));
}
