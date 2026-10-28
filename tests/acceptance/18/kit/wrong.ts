// AC16's wrong program, on the test's side: a kit that checks only reply shapes. Its one case maps a Claude Code
// turn's hooks through the fill (a start, a prompt, a call's PreToolUse and PostToolUse, a Stop, then a late
// PostToolUse of the stopped turn). The runner's harness holds every mapping to adapter.event@1 and to the
// mapping's own shape, so the case fails only on a reply of the wrong shape; it never compares one event's ID
// with another's or reads which turn an event lands in.
// The adapter's own planted twins are reached through `shippedFill`'s `planted` option (README, Wrong programs).
import type { HookRequestLine, JsonObject } from '../../../../packages/adapters/src/index.ts';
import type { Kit } from '../../../../packages/conformance/src/index.ts';

const SESSION = '5b0c2d1e-7f3a-4c8e-9a6b-2d4f6e8a0c13';
const TURN = 'b7e1c9a0-3d5f-4e2a-8c6b-1f0e9d8c7b6a';
const CWD = '/private/tmp/dk18-shapes';

const line = (n: number, hook_event_name: string, fields: JsonObject): HookRequestLine => ({
  v: 1, agent: 'claude-code', event: hook_event_name, seq: String(1760013451123456789n + BigInt(n) * 1000n), id: `01K74FKZVK8Q2X5R7M3N9P4T${String(n).padStart(2, '0')}`,
  pid: 81234, ppid: 81200, matched: [], payload: { session_id: SESSION, transcript_path: `${CWD}/${SESSION}.jsonl`, cwd: CWD, hook_event_name, ...fields },
});
const call = { tool_name: 'Read', tool_input: { file_path: `${CWD}/a.txt` }, tool_use_id: 'toolu_01Shapes' };
const LINES: HookRequestLine[] = [
  line(1, 'SessionStart', { source: 'startup', model: 'claude-opus-4-1' }),
  line(2, 'UserPromptSubmit', { prompt_id: TURN, prompt: 'read a.txt', permission_mode: 'default' }),
  line(3, 'PreToolUse', { prompt_id: TURN, permission_mode: 'default', ...call }),
  line(4, 'PostToolUse', { prompt_id: TURN, permission_mode: 'default', ...call, tool_response: { type: 'text', file: { filePath: `${CWD}/a.txt`, content: 'a' } } }),
  line(5, 'Stop', { prompt_id: TURN, permission_mode: 'default', stop_hook_active: false, last_assistant_message: 'Done.' }),
  line(6, 'PostToolUse', { prompt_id: TURN, permission_mode: 'default', ...call, tool_use_id: 'toolu_01ShapesLate', tool_response: { type: 'text', file: { filePath: `${CWD}/a.txt`, content: 'a' } } }),
];

/** `kit` with its cases replaced by one that holds replies to their shapes and checks nothing else. */
export function shapeOnlyKit(kit: Kit): Kit {
  return {
    ...kit,
    cases: [{
      id: 'shapes/replies',
      revision: kit.revision,
      declares: { flags: [], operations: [], kinds: [] },
      run(h) {
        for (const request of LINES) h.hook(request);
      },
    }],
    fakes: [],
    planted: [],
  };
}
