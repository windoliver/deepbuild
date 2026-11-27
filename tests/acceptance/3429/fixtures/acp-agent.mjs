#!/usr/bin/env node
// #3429's scripted ACP agent (README, The worlds): it stands in for an agent's own CLI and its model, which this repo
// doesn't own, and speaks the Agent Client Protocol over stdio (newline-delimited JSON-RPC 2.0, protocol version 1), as
// `copilot --acp` does for paseo. It decides nothing about DeepBuild and loads nothing from this repo.
//
//   node acp-agent.mjs            in the shape of GitHub Copilot's CLI as paseo 0.15.0 drives it
//                                 (packages/server/src/server/agent/providers/copilot-acp-agent.ts): the session modes
//                                 `…/session-modes#agent` and `#plan`, and the select option `allow_all`, on or off.
//                                 paseo's Copilot provider turns `allow_all` on for its mode `allow-all`.
//
// Each prompt is one turn with one tool call, a shell command that writes `dh3429-ran.txt` in the session's folder:
//   - with `allow_all` off (the asking mode) the agent asks first, through ACP's session/request_permission with
//     allow_once and reject_once, and runs the command only on allow_once;
//   - with `allow_all` on (the mode that approves its own calls) it asks nobody and runs the command.
// What it did goes to <cwd>/.dh3429-agent.jsonl, one JSON per line: {session, cwd}, {mode}, {allow_all},
// {prompt, allow_all}, {call, command, asked, answer, ran}, {turn: 'end'}.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';

const AGENT = 'https://agentclientprotocol.com/protocol/session-modes#agent';
const PLAN = 'https://agentclientprotocol.com/protocol/session-modes#plan';
const MODES = [
  { id: AGENT, name: 'Agent', description: 'Default agent mode for conversational interactions' },
  { id: PLAN, name: 'Plan', description: 'Plan mode for creating and executing multi-step plans' },
];
const COMMAND = 'echo dh3429-probe > dh3429-ran.txt';
const LOG = '.dh3429-agent.jsonl';

/** @type {Map<string, { cwd: string, mode: string, allowAll: 'on' | 'off', turn: number }>} */
const sessions = new Map();
/** @type {Map<number, (reply: any) => void>} */
const waiting = new Map();
let ids = 0;

const send = (message) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
const log = (cwd, value) => { try { appendFileSync(join(cwd, LOG), `${JSON.stringify(value)}\n`); } catch { /* the folder went */ } };
/** A request of the agent's own to the client (paseo): its reply, or its error. */
const ask = (method, params) => new Promise((resolve) => { const id = ++ids; waiting.set(id, resolve); send({ id: `dh3429-${id}`, method, params }); });
const update = (sessionId, body) => send({ method: 'session/update', params: { sessionId, update: body } });
const options = (s) => [{
  type: 'select', id: 'allow_all', name: 'Allow all', description: 'Approve every tool, path and URL request without asking', category: '_allow_all', currentValue: s.allowAll,
  options: [{ value: 'off', name: 'Off' }, { value: 'on', name: 'On' }],
}];

async function prompt(sessionId, s) {
  s.turn += 1;
  const call = `call_${s.turn}`;
  log(s.cwd, { prompt: s.turn, allow_all: s.allowAll, mode: s.mode });
  const tool = { toolCallId: call, title: `Run ${COMMAND}`, kind: 'execute', status: 'pending', rawInput: { command: COMMAND } };
  update(sessionId, { sessionUpdate: 'tool_call', ...tool });
  let answer = null;
  if (s.allowAll !== 'on') {
    const reply = await ask('session/request_permission', {
      sessionId, toolCall: tool,
      options: [{ optionId: 'allow', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject', name: 'Reject', kind: 'reject_once' }],
    });
    answer = reply?.result?.outcome?.outcome === 'selected' ? reply.result.outcome.optionId : reply?.result?.outcome?.outcome ?? 'error';
  }
  const ran = s.allowAll === 'on' || answer === 'allow';
  if (ran) execFileSync('/bin/sh', ['-c', COMMAND], { cwd: s.cwd });
  log(s.cwd, { call, command: COMMAND, asked: s.allowAll !== 'on', answer, ran });
  update(sessionId, { sessionUpdate: 'tool_call_update', toolCallId: call, status: ran ? 'completed' : 'failed', rawOutput: { ran } });
  update(sessionId, { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ran ? 'Ran it.' : 'It was not allowed.' } });
  log(s.cwd, { turn: 'end' });
  return { stopReason: answer === 'cancelled' ? 'cancelled' : 'end_turn' };
}

async function handle(method, params) {
  const s = params?.sessionId ? sessions.get(params.sessionId) : undefined;
  switch (method) {
    case 'initialize':
      return { protocolVersion: 1, agentCapabilities: { loadSession: false, promptCapabilities: {} }, authMethods: [], agentInfo: { name: 'dh3429-acp-agent', version: '0' } };
    case 'authenticate':
      return {};
    case 'session/new': {
      const sessionId = randomUUID();
      const made = { cwd: String(params.cwd), mode: AGENT, allowAll: /** @type {'off'} */ ('off'), turn: 0 };
      sessions.set(sessionId, made);
      log(made.cwd, { session: sessionId, cwd: made.cwd });
      return { sessionId, modes: { currentModeId: made.mode, availableModes: MODES }, configOptions: options(made) };
    }
    case 'session/set_mode':
      if (!s || !MODES.some((m) => m.id === params.modeId)) throw Object.assign(Error(`no mode ${params?.modeId}`), { code: -32602 });
      s.mode = params.modeId;
      log(s.cwd, { mode: s.mode });
      return {};
    case 'session/set_config_option':
      if (!s || params.configId !== 'allow_all' || !['on', 'off'].includes(params.value)) throw Object.assign(Error(`no option ${params?.configId}=${params?.value}`), { code: -32602 });
      s.allowAll = params.value;
      log(s.cwd, { allow_all: s.allowAll });
      return { configOptions: options(s) };
    case 'session/prompt':
      if (!s) throw Object.assign(Error(`no session ${params?.sessionId}`), { code: -32602 });
      return prompt(params.sessionId, s);
    default:
      throw Object.assign(Error(`Method not found: ${method}`), { code: -32601 });
  }
}

createInterface({ input: process.stdin }).on('line', (raw) => {
  let message;
  try { message = JSON.parse(raw); } catch { return; }
  if (message.method === undefined) {
    // A reply to a request of the agent's own.
    const id = Number(String(message.id).replace('dh3429-', ''));
    waiting.get(id)?.(message);
    waiting.delete(id);
    return;
  }
  // A notification (session/cancel) takes no reply.
  if (message.id === undefined) return;
  void handle(message.method, message.params ?? {}).then(
    (result) => send({ id: message.id, result }),
    (error) => send({ id: message.id, error: { code: error?.code ?? -32603, message: String(error?.message ?? error) } }),
  );
});
process.stdin.on('end', () => process.exit(0));
