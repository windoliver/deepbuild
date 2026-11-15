// Test-side tools for #2084 beyond what #1015's helpers give (re-exported, never copied): a Claude Code Edit as two
// hooks (PreToolUse, the edit made on disk, PostToolUse with its structuredPatch, as #352's sessions make them), and a
// second prompt of a session already begun. Both go through the 1015 `Session`'s own hooks and transcript, so the
// real deep-hook, hub and session map see what Claude Code would send. Nothing here stands in for DeepBuild.
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseObject, type Line } from '../18/mapping/helpers.ts';
import { decisionOf, type Hooked, type Session } from '../1015/helpers.ts';

export * from '../1015/helpers.ts';
export { parseObject, type Line };

/** The 1015 Session's transcript writer and prompt ID, which it keeps private. */
interface Inside { entry(value: Line): void; promptId: string | undefined }
const inside = (s: Session): Inside => s as unknown as Inside;

/** A hook deep-hook answered without the hub (its acknowledgement missed the deadline): nothing the hub decided can be read from it. */
export const spooled = (h: Hooked): boolean => /deep-hook: spooled|missed its deadline/.test(h.stderr);

/** What a PreToolUse reply told the agent as context (`hookSpecificOutput.additionalContext`). */
export function contextOf(h: Hooked): string {
  const out = parseObject(h.stdout.trim());
  const text = (out?.hookSpecificOutput as Line | undefined)?.additionalContext;
  return typeof text === 'string' ? text : '';
}

/** A Claude Code Edit of `file` (relative to the session's folder) from `from` to `to`: its hooks, with the edit made between. */
export async function edit(s: Session, file: string, from: string, to: string): Promise<void> {
  const path = join(s.cwd, file);
  const before = readFileSync(path, 'utf8');
  if (!before.includes(from)) throw Error(`BLOCKED: the test's own edit of ${file} finds no ${JSON.stringify(from)}`);
  const id = `toolu_${randomBytes(12).toString('hex')}`;
  const input = { file_path: path, old_string: from, new_string: to, replace_all: false };
  inside(s).entry({ type: 'assistant', message: { model: 'claude-haiku-5-5', id: `msg_${randomBytes(12).toString('hex')}`, type: 'message', role: 'assistant', content: [{ type: 'tool_use', id, name: 'Edit', input }], stop_reason: 'tool_use', usage: { input_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 20 } } });
  const pre = await s.hook('PreToolUse', { tool_name: 'Edit', tool_input: input, tool_use_id: id });
  if (decisionOf(pre).denied) throw Error(`BLOCKED: the Edit of ${file} in ${s.label} must be allowed: ${pre.stdout} ${pre.stderr}`);
  writeFileSync(path, before.replace(from, to));
  const at = before.slice(0, before.indexOf(from)).split('\n').length;
  const old = from.split('\n');
  const now = to.split('\n');
  const response = {
    filePath: path, oldString: from, newString: to, originalFile: before, replaceAll: false, userModified: false,
    structuredPatch: [{ oldStart: at, oldLines: old.length, newStart: at, newLines: now.length, lines: [...old.map((l) => `-${l}`), ...now.map((l) => `+${l}`)] }],
  };
  inside(s).entry({ promptId: inside(s).promptId, type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: JSON.stringify(response) }] }, toolUseResult: response });
  await s.hook('PostToolUse', { tool_name: 'Edit', tool_input: input, tool_use_id: id, tool_response: response, duration_ms: 40 });
}

/** Another prompt typed to a session already begun: its transcript entry, then UserPromptSubmit. Returns that hook's reply. */
export async function prompt(s: Session, text: string): Promise<Hooked> {
  const inner = inside(s);
  inner.promptId = randomUUID();
  inner.entry({ promptId: inner.promptId, type: 'user', message: { role: 'user', content: text }, origin: { kind: 'human' }, turnOrigin: 'human', turnPosition: { promptIndex: 2, turnIndex: 1 } });
  return s.hook('UserPromptSubmit', { prompt: text });
}
