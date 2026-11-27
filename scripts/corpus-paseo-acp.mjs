// The fixture corpus's scripted ACP agent for paseo's set (#3429): it speaks the Agent Client Protocol over stdio in
// the shape of GitHub Copilot's CLI as paseo drives it, with Copilot's session modes and its `allow_all` option, and
// stands in for that CLI and its model, which this repo doesn't own. paseo's own Copilot provider runs it in place of
// `copilot --acp`, so the mode is paseo's: `allow-all` turns `allow_all` on. Each prompt is one turn with one shell
// call. With `allow_all` off the call asks first, through ACP's session/request_permission, and runs once it is
// allowed; with it on the agent approves the call itself and runs it. It decides nothing about DeepBuild.
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';

const MODES = [
  { id: 'https://agentclientprotocol.com/protocol/session-modes#agent', name: 'Agent', description: 'Default agent mode for conversational interactions' },
  { id: 'https://agentclientprotocol.com/protocol/session-modes#plan', name: 'Plan', description: 'Plan mode for creating and executing multi-step plans' },
];
const COMMAND = 'echo corpus-probe';
const sessions = new Map();
const waiting = new Map();
let asked = 0;

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const update = (sessionId, body) => send({ method: 'session/update', params: { sessionId, update: body } });
const request = (method, params) => new Promise((resolve) => {
  const id = `corpus-acp-request-${++asked}`;
  waiting.set(id, resolve);
  send({ id, method, params });
});
const options = (session) => [{
  type: 'select', id: 'allow_all', name: 'Allow all', description: 'Approve every tool, path and URL request without asking', category: '_allow_all', currentValue: session.allowAll,
  options: [{ value: 'off', name: 'Off' }, { value: 'on', name: 'On' }],
}];

async function prompt(sessionId, session) {
  const call = { toolCallId: `call-${++session.calls}`, title: `Run ${COMMAND}`, kind: 'execute', status: 'pending', rawInput: { command: COMMAND } };
  update(sessionId, { sessionUpdate: 'tool_call', ...call });
  let allowed = session.allowAll === 'on';
  if (!allowed) {
    const answer = await request('session/request_permission', {
      sessionId, toolCall: call,
      options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject', name: 'Reject', kind: 'reject_once' }],
    });
    allowed = answer?.outcome?.outcome === 'selected' && answer.outcome.optionId === 'allow';
  }
  if (allowed) execFileSync('/bin/sh', ['-c', COMMAND], { cwd: session.cwd });
  update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: call.toolCallId, status: allowed ? 'completed' : 'failed' });
  update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: allowed ? 'done' : 'not allowed' } });
  return { stopReason: 'end_turn' };
}

async function handle(method, params) {
  const session = sessions.get(params.sessionId);
  switch (method) {
    case 'initialize':
      return { protocolVersion: 1, agentCapabilities: { loadSession: false, promptCapabilities: {} }, authMethods: [] };
    case 'session/new': {
      const sessionId = `corpus-acp-${sessions.size + 1}`;
      const made = { cwd: String(params.cwd), allowAll: 'off', calls: 0 };
      sessions.set(sessionId, made);
      return { sessionId, modes: { currentModeId: MODES[0].id, availableModes: MODES }, configOptions: options(made) };
    }
    case 'session/set_mode':
      if (!session || !MODES.some((mode) => mode.id === params.modeId)) throw Object.assign(Error(`no mode ${params.modeId}`), { code: -32602 });
      return {};
    case 'session/set_config_option':
      if (!session || params.configId !== 'allow_all' || !['on', 'off'].includes(params.value)) throw Object.assign(Error(`no option ${params.configId}=${params.value}`), { code: -32602 });
      session.allowAll = params.value;
      return { configOptions: options(session) };
    case 'session/prompt':
      if (!session) throw Object.assign(Error(`no session ${params.sessionId}`), { code: -32602 });
      return prompt(params.sessionId, session);
    default:
      throw Object.assign(Error(`Method not found: ${method}`), { code: -32601 });
  }
}

createInterface({ input: process.stdin }).on('line', (text) => {
  let message;
  try { message = JSON.parse(text); } catch { return; }
  if (message.method === undefined) {
    // An answer to a request of this agent's own.
    waiting.get(message.id)?.(message.result);
    waiting.delete(message.id);
  } else if (message.id !== undefined) {
    handle(message.method, message.params ?? {}).then(
      (result) => send({ id: message.id, result }),
      (error) => send({ id: message.id, error: { code: error.code ?? -32603, message: error.message } }),
    );
  }
});
process.stdin.on('end', () => process.exit(0));
