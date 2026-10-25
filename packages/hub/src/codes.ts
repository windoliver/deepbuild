// The pages deep mcp serves at deep://codes/<code> with no tool call (#26): for each error@2 code a deep_* tool
// raises, what it means, the planted call that raises it alone, the clean twin beside it and the fix. The planted
// calls and their twins are a kit: packages/hub/test/codes.test.ts makes each call against a live hub and fails a
// page whose planted call doesn't raise its code, or whose twin does, so a page can't drift from what the hub does.
//
// A call runs in the kit's fixture: a session whose repo's spec names the check unit, with a claim made and the file
// real.txt in its working folder. `from` is who calls: the session's own deep mcp, or one no session's hooks came
// from; `hub` is whether the hub runs.

/** One call of a page: the tool, its arguments, who calls it and whether the hub runs. */
export interface CodeCall { tool: string; arguments: Record<string, unknown>; from: 'session' | 'unbound'; hub: 'running' | 'stopped' }
export interface CodePage { code: string; meaning: string; planted: CodeCall; clean: CodeCall; fix: string }

const call = (tool: string, args: Record<string, unknown>, from: CodeCall['from'] = 'session', hub: CodeCall['hub'] = 'running'): CodeCall => ({ tool, arguments: args, from, hub });

export const CODES: readonly CodePage[] = [
  {
    code: 'unlisted_field', meaning: 'The call holds a field its tool\'s schema doesn\'t list. The hub refuses it rather than ignore it, since an ignored field could have meant anything.',
    planted: call('deep_status', { verbose: true }), clean: call('deep_status', {}), fix: 'Send only the fields the tool\'s schema lists.',
  },
  {
    code: 'required', meaning: 'A field the schema requires is missing or null.',
    planted: call('deep_search', {}), clean: call('deep_search', { query: 'unit' }), fix: 'Give the field the error\'s path names.',
  },
  {
    code: 'type', meaning: 'A field holds a value of the wrong type, such as a number where the schema takes a string.',
    planted: call('deep_search', { query: 7 }), clean: call('deep_search', { query: '7' }), fix: 'Give the field the type its schema names.',
  },
  {
    code: 'enum', meaning: 'A field holds a value off its list: a check the repo\'s spec doesn\'t name, or a kind the tool doesn\'t take.',
    planted: call('deep_run', { check: 'unti', claim: null }), clean: call('deep_run', { check: 'unit', claim: null }), fix: 'Give one of the values the remediation lists; a check\'s name is as the repo\'s .deepbuild/done.yaml writes it.',
  },
  {
    code: 'pattern', meaning: 'A field holds a string not in the form its schema gives, such as a commit that isn\'t a full SHA.',
    planted: call('deep_claim', { task_ref: 'task:01K74FX2B4D6F8H0K2M4P6R8T0', attempt: 1, commit: 'abc1234', scope: 'session', predictions: null }),
    clean: call('deep_claim', { task_ref: 'task:01K74FX2B4D6F8H0K2M4P6R8T0', attempt: 1, commit: '0c5e145756bbdaef4d9b8bdaca2d0bd0f900ed46', scope: 'session', predictions: null }),
    fix: 'Give the value in the form the remediation names.',
  },
  {
    code: 'not_found', meaning: 'What the call names doesn\'t exist for this session: a file outside its working folder or missing, an ask or a claim of another session or none.',
    planted: call('deep_evidence', { path: 'missing.txt', kind: null }), clean: call('deep_evidence', { path: 'real.txt', kind: null }), fix: 'Name a file in your working folder, or an ask or claim this session made.',
  },
  {
    code: 'unbound', meaning: 'The call binds to no session: its deep mcp\'s parent is no live session\'s agent, the session has ended, or more than one stamped PreToolUse matches it. It may read only what belongs to no session.',
    planted: call('deep_claim', { task_ref: 'task:01K74FX2B4D6F8H0K2M4P6R8T0', attempt: 1, commit: '0c5e145756bbdaef4d9b8bdaca2d0bd0f900ed46', scope: 'session', predictions: null }, 'unbound'),
    clean: call('deep_claim', { task_ref: 'task:01K74FX2B4D6F8H0K2M4P6R8T0', attempt: 1, commit: '0c5e145756bbdaef4d9b8bdaca2d0bd0f900ed46', scope: 'session', predictions: null }),
    fix: 'Call from the agent session\'s own deep mcp; a new session gets its own binding from its hooks.',
  },
  {
    code: 'unavailable', meaning: 'The DeepBuild hub can\'t be reached, or can\'t record right now. Nothing was recorded, and nothing succeeded.',
    planted: call('deep_status', {}, 'session', 'stopped'), clean: call('deep_status', {}), fix: 'Call again once the hub is back; deep mcp reconnects by itself.',
  },
];

/** The page at deep://codes/<code>, or undefined for a code no tool raises. */
export const codePage = (code: string): CodePage | undefined => CODES.find((page) => page.code === code);
