// The parts of the shipped adapters that aren't data: what each can do, what it can't on each surface,
// its doctor items, and how it reads usage from its agent's transcript. The mapping itself is the
// facts file's (adapters/<agent>.facts.json).
import type { AdapterParts, DoctorItem, JsonObject, TurnUsage } from './types.js';
import type { JsonValue } from '@deepbuild/contracts';

const isObject = (v: unknown): v is JsonObject => typeof v === 'object' && v !== null && !Array.isArray(v);
/** A token count the transcript captured; anything else is absent, never zero. */
const whole = (v: unknown): number | undefined => (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0 ? v : undefined);

/** No driven surface ships yet: a terminal session takes none of the driven operations. */
const TERMINAL_ONLY = { terminal: ['startTurn', 'steer', 'followUp', 'interrupt', 'respond', 'history'] };

/** A check nobody ran reads skip, never ok (the design: an item that didn't run reads "not checked"). */
const notChecked = (binary: string): DoctorItem[] => [
  { code: 'not_checked', level: 'skip', evidence: `not checked: no ${binary} binary was looked for in this process`, fix: `Run deep doctor, which looks for ${binary} on your login shell's PATH.` },
];

/**
 * Claude Code's transcript: each assistant entry carries its message's usage, repeated per content block,
 * so it counts once per message id. Input is input plus cache creation, cached is cache read, and the
 * model is the one that answered (message.model), never requestedModel. The transcript carries no cost.
 */
function readClaudeUsage(transcript: readonly JsonValue[]): TurnUsage[] {
  const seen = new Set<string>();
  const out: TurnUsage[] = [];
  let turn = '';
  for (const entry of transcript) {
    if (!isObject(entry) || !isObject(entry.message)) continue;
    if (entry.type === 'user') { turn = String(entry.promptId ?? entry.uuid ?? turn); continue; }
    if (entry.type !== 'assistant') continue;
    const message = entry.message;
    const id = typeof message.id === 'string' ? message.id : undefined;
    if (!id || seen.has(id) || !isObject(message.usage) || typeof message.model !== 'string' || !message.model) continue;
    seen.add(id);
    const usage = message.usage;
    const input = whole(usage.input_tokens);
    const output = whole(usage.output_tokens);
    if (input === undefined || output === undefined) continue;
    // An uncached request carries no cache fields at all; a request that carries one reports it exactly.
    out.push({
      turn: turn || id,
      model: message.model,
      covers: 'turn',
      tokens: { input: input + (whole(usage.cache_creation_input_tokens) ?? 0), cached: whole(usage.cache_read_input_tokens) ?? 0, output, exact: true },
      cost: { basis: 'unpriced' },
    });
  }
  return out;
}

type Counts = { input: number; cached: number; output: number };
/** Codex's counts, whose input includes the cached tokens, taken back out here; absent when one wasn't captured. */
function codexCounts(usage: unknown): Counts | undefined {
  if (!isObject(usage)) return undefined;
  const [input, cached, output] = [whole(usage.input_tokens), whole(usage.cached_input_tokens), whole(usage.output_tokens)];
  return input === undefined || cached === undefined || output === undefined ? undefined : { input: input - cached, cached, output };
}

/**
 * Codex's rollout: each turn_context names its turn's model, and each token_count carries the session's
 * total_token_usage so far. A turn makes several model requests, each with its own token_count, so a turn's
 * tokens are the growth of the total across it, read at its last token_count; the session's reading is the
 * last total. On a plan Codex reports tokens only, so every reading is unpriced, never $0.
 */
function readCodexUsage(transcript: readonly JsonValue[]): TurnUsage[] {
  const turns: { turn: string; model: string; total?: Counts | undefined; last?: Counts | undefined; used?: number | undefined; window?: number | undefined }[] = [];
  for (const entry of transcript) {
    if (!isObject(entry) || !isObject(entry.payload)) continue;
    const payload = entry.payload;
    const current = turns.at(-1);
    if (entry.type === 'turn_context') {
      const turn = String(payload.turn_id ?? current?.turn ?? '');
      const model = typeof payload.model === 'string' && payload.model ? payload.model : current?.model ?? '';
      if (current && current.turn === turn) current.model = model;
      else turns.push({ turn, model });
      continue;
    }
    if (entry.type !== 'event_msg' || payload.type !== 'token_count' || !isObject(payload.info) || !current) continue;
    const info = payload.info;
    current.total = codexCounts(info.total_token_usage) ?? current.total;
    current.last = codexCounts(info.last_token_usage) ?? current.last;
    // The context in use is the last request's size, not the session's running sum.
    if (isObject(info.last_token_usage)) current.used = whole(info.last_token_usage.total_tokens) ?? current.used;
    current.window = whole(info.model_context_window) ?? current.window;
  }
  const out: TurnUsage[] = [];
  // The total at the previous turn's end; unknown after a turn that reported none, so the next turn reads its own last count.
  let before: Counts | undefined = { input: 0, cached: 0, output: 0 };
  let session: TurnUsage | undefined;
  for (const { turn, model, total, last, used, window } of turns) {
    if (!model) continue;
    const grown = total && before ? { input: total.input - before.input, cached: total.cached - before.cached, output: total.output - before.output } : last;
    if (grown) out.push({ turn: turn || model, model, covers: 'turn', tokens: { ...grown, exact: true }, cost: { basis: 'unpriced' } });
    before = total;
    if (total) {
      session = { turn: turn || model, model, covers: 'session', tokens: { ...total, exact: true }, cost: { basis: 'unpriced' } };
      if (used !== undefined && window) session.context = { used, window };
    }
  }
  return session ? [...out, session] : out;
}

export const claudeParts: AdapterParts = {
  // Claude Code's hooks: a Stop hook can block, a PermissionRequest hook decides and may carry updatedInput, a
  // PreToolUse hook may rewrite the input, and StopFailure fires for a turn that ends in an error.
  caps: { holdStop: true, wakeIdle: false, steer: false, followUp: false, answerPermission: true, nativeTools: true, mcp: true, rewrite: true, editInput: true, errorTurnHook: true, startTurn: false },
  unsupported: TERMINAL_ONLY,
  doctor: () => notChecked('claude'),
  readUsage: readClaudeUsage,
  // The PermissionRequest hook's output: allow only when the answer's decision is allow; deny or none denies, with
  // your words as the message. An option's label and the words never allow.
  permissionReply: (answer) => ({
    hookSpecificOutput: { hookEventName: 'PermissionRequest', decision: answer.decision === 'allow' ? { behavior: 'allow' } : { behavior: 'deny', ...(answer.words ? { message: answer.words } : {}) } },
  }),
};

export const codexParts: AdapterParts = {
  // Codex's hooks: a Stop hook can hold the turn and a PermissionRequest hook decides; no hook rewrites or
  // edits a call's input, and a turn that ends in an error fires no hook.
  caps: { holdStop: true, wakeIdle: false, steer: false, followUp: false, answerPermission: true, nativeTools: true, mcp: true, rewrite: false, editInput: false, errorTurnHook: false, startTurn: false },
  unsupported: TERMINAL_ONLY,
  doctor: () => notChecked('codex'),
  readUsage: readCodexUsage,
};
