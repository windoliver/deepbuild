// #315 AC5: a turn with tool calls but no hook event at the hub shows a "hooks not reaching DeepBuild" reading, so
// failing open is never silent. A session's transcript (in the shape of the corpus's Claude Code transcripts) holds
// three turns; turns 1 and 3 reach the hub through deep-hook, turn 2 ran a tool call and no hook of it reached the
// hub. A second session whose every turn reached the hub is the control. The reading is read where the record keeps
// a session's readings ("clock went back" is one, #14): `session(<agent session id>).readings` of the hub's ledger,
// opened with @deepbuild/record once the hub has stopped.
import { randomUUID } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { openRecord } from '../../../packages/record/src/index.ts';
import { buildDeepHook, callId, cleanup, hook, makeHome, newSession, payload, rootOf, sleep, startHub, stopHub, type Line, type Session } from './helpers.ts';

afterEach(cleanup, 60_000);

const READING = 'hooks not reaching DeepBuild';

/** One turn in the transcript: the prompt, a Bash call and its result, and the answer. Returns the ids the hooks share with it. */
function writeTurn(s: Session, n: number): { promptId: string; toolUseId: string; prompt: string; command: string } {
  const promptId = randomUUID();
  const toolUseId = callId();
  const prompt = `turn ${n}: list the files`;
  const command = `ls -la ${n}`;
  const at = (k: number) => new Date(Date.now() + k).toISOString();
  const common = { isSidechain: false, sessionId: s.id, session_id: s.id, cwd: s.cwd, version: '2.1.304', userType: 'external', entrypoint: 'cli', gitBranch: 'HEAD' };
  const user = randomUUID();
  const call = randomUUID();
  const result = randomUUID();
  const lines: Line[] = [
    { ...common, parentUuid: null, promptId, type: 'user', message: { role: 'user', content: prompt }, uuid: user, timestamp: at(0), permissionMode: 'default', origin: { kind: 'human' }, promptSource: 'typed', turnOrigin: 'human' },
    { ...common, parentUuid: user, type: 'assistant', uuid: call, timestamp: at(1), message: { model: 'claude-haiku-5-5', id: `msg_${randomUUID().replace(/-/g, '')}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id: toolUseId, name: 'Bash', input: { command } }], stop_reason: 'tool_use' } },
    { ...common, parentUuid: call, promptId, type: 'user', uuid: result, timestamp: at(2), message: { role: 'user', content: [{ tool_use_id: toolUseId, type: 'tool_result', content: 'a.txt', is_error: false }] }, toolUseResult: { stdout: 'a.txt', stderr: '', interrupted: false }, sourceToolAssistantUUID: call },
    { ...common, parentUuid: result, type: 'assistant', uuid: randomUUID(), timestamp: at(3), message: { model: 'claude-haiku-5-5', id: `msg_${randomUUID().replace(/-/g, '')}`, type: 'message', role: 'assistant', content: [{ type: 'text', text: 'There is one file.' }], stop_reason: 'end_turn' } },
  ];
  appendFileSync(s.transcript, lines.map((l) => `${JSON.stringify(l)}\n`).join(''));
  return { promptId, toolUseId, prompt, command };
}
/** A turn written to the transcript and, when `hooked`, each of its hooks run through deep-hook as it happens. */
async function turn(home: string, s: Session, n: number, hooked: boolean, binary: string): Promise<void> {
  const t = writeTurn(s, n);
  if (!hooked) return;
  const tool = { tool_name: 'Bash', tool_input: { command: t.command }, tool_use_id: t.toolUseId };
  const steps: [string, Line][] = [
    ['UserPromptSubmit', payload(s, 'UserPromptSubmit', { prompt: t.prompt, prompt_id: t.promptId })],
    ['PreToolUse', payload(s, 'PreToolUse', tool)],
    ['PostToolUse', payload(s, 'PostToolUse', { ...tool, tool_response: { stdout: 'a.txt', stderr: '', interrupted: false } })],
    ['Stop', payload(s, 'Stop')],
  ];
  for (const [event, body] of steps) {
    const r = await hook(home, s, event, body, { binary });
    if (r.code !== 0) throw Error(`BLOCKED: deep-hook ${event} exited ${r.code}: ${r.stderr}`);
  }
}

describe('AC5 #315.f8b9a600 a turn with tool calls but no hook event at the hub shows a "hooks not reaching DeepBuild" reading', () => {
  it('AC5 turn 2 ran a Bash call and no hook of it reached the hub: the session reads "hooks not reaching DeepBuild"; a session whose every turn reached the hub doesn\'t', async () => {
    const binary = await buildDeepHook();
    const home = makeHome();
    const hub = await startHub({ home });
    const quiet = newSession(home);
    const control = newSession(home);
    for (const s of [quiet, control]) {
      const r = await hook(home, s, 'SessionStart', payload(s, 'SessionStart'), { binary });
      if (r.code !== 0) throw Error(`BLOCKED: SessionStart exited ${r.code}: ${r.stderr}`);
    }
    await turn(home, quiet, 1, true, binary);
    await turn(home, control, 1, true, binary);
    await turn(home, quiet, 2, false, binary);     // tool calls, no hook event at the hub
    await turn(home, control, 2, true, binary);
    await turn(home, quiet, 3, true, binary);
    await turn(home, control, 3, true, binary);
    await sleep(5000);   // whatever reads the transcript after a hook has had its time
    await stopHub(hub);

    const record = await openRecord({ path: join(rootOf(home), 'ledger.db'), now: () => Date.now() });
    try {
      const q = await record.session(quiet.id);
      const c = await record.session(control.id);
      expect(q, `the record knows the session ${quiet.id}`).toBeDefined();
      expect(c, `the record knows the session ${control.id}`).toBeDefined();
      expect(q!.readings, `the session whose turn 2 reached no hook shows "${READING}"`).toContain(READING);
      expect(c!.readings, `the session whose every turn reached the hub doesn't show "${READING}"`).not.toContain(READING);
    } finally {
      await record.close();
    }
  }, 300_000);
});
