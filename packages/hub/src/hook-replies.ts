// Hook replies formatted for the agent: the hub's settled reply, with the core's or an extension's words.
import { isRecord as isObj } from '@deepbuild/contracts';
import type { Part } from './context-fit.js';
import { heavyDenial } from './heavy.js';
import { adapterOf } from './hookmap.js';
import type { Reply as WaitReply } from './waits.js';
import { line, type ExtensionReply, type HookMeta, type Plant } from './wire.js';

type Obj = Record<string, unknown>;

export const EMPTY_REPLY = line({ exit: 0, stdout: '', stderr: '' });
/** A matched heavy call's rewrite, or its one denial when the adapter cannot rewrite input (#1015). */
export function heavyReply(meta: HookMeta, ruled: string, rewrites: boolean, plant: Plant | undefined): string {
  const command = typeof meta.call?.input.command === 'string' ? meta.call.input.command : undefined;
  // The planted wrong program for AC2 denies the leased form too, so the agent's retry is denied again.
  const retried = plant === 'denies-every-retry' && !rewrites && command !== undefined && /^\s*deep lease\b/.test(command);
  if ((!meta.heavy && !retried) || command === undefined || plant === 'runs-matched-as-written') return ruled;
  const reply = ruled === EMPTY_REPLY ? { exit: 0, stdout: '', stderr: '' } : JSON.parse(ruled) as { exit: number; stdout: string; stderr: string };
  if (reply.exit !== 0) return ruled;
  const form = retried ? command : meta.heavy!.form;
  if (!rewrites) {
    return line({ exit: 2, stdout: '', stderr: `${heavyDenial(command, form, meta.heavy?.name ?? 'deep lease')}\n` });
  }
  const out = reply.stdout ? JSON.parse(reply.stdout) as Record<string, unknown> : {};
  const specific = isObj(out.hookSpecificOutput) ? out.hookSpecificOutput : { hookEventName: 'PreToolUse' };
  specific.updatedInput = { ...meta.call!.input, ...(isObj(specific.updatedInput) ? specific.updatedInput : {}), command: form };
  out.hookSpecificOutput = specific;
  return line({ exit: 0, stdout: JSON.stringify(out), stderr: reply.stderr });
}

/** A warn entry's words in the guard entries' reply to a call no entry blocks, or none. */
export const warnings = (ruled: string): string[] => {
  const stdout = String((JSON.parse(ruled) as Obj).stdout ?? '');
  const said = stdout ? (JSON.parse(stdout) as { hookSpecificOutput?: { additionalContext?: unknown } }).hookSpecificOutput?.additionalContext : undefined;
  return typeof said === 'string' ? [said] : [];
};
/**
 * The extensions' joined reply as the agent's own hook output (#350): a deny ends the call, its reasons on stderr
 * as deep-hook's own denials are; context goes as Claude Code reads it, after a warn entry's words, each block
 * labelled with its extension. `ruled` is the guard entries' reply: an agent with no context channel, or a reply
 * with no context, gets it as it is.
 */
export function agentReply(agent: string, reply: ExtensionReply, ruled: string, fitted?: string): string {
  if (reply.denies.length) return line({ exit: 2, stdout: '', stderr: reply.denies.map((d) => `DeepBuild blocked this: [${d.extension}] ${d.reason}`).join('\n') + '\n' });
  if (!reply.context.length || (agent !== 'claude-code' && agent !== 'claude')) return ruled;
  return settledWith(ruled, { additionalContext: fitted ?? contextParts(reply, ruled).map((p) => p.text).join('\n') });
}
/** The settled reply with a PreToolUse's own output set over its own: its rewrite, deadline and wait line stay beside it (#2084). */
function settledWith(ruled: string, specific: Obj): string {
  const settled = JSON.parse(ruled) as { exit: number; stdout: string; stderr: string };
  const out: Obj = settled.stdout ? JSON.parse(settled.stdout) as Obj : {};
  out.hookSpecificOutput = { hookEventName: 'PreToolUse', ...(isObj(out.hookSpecificOutput) ? out.hookSpecificOutput : {}), ...specific };
  return line({ ...settled, stdout: JSON.stringify(out) });
}
/**
 * Your standing rule's yes as Claude Code's hook output (#23): the explicit allow, never past a permission mode that
 * denies the call (`past`), and as context a warn entry's words, the rule's, then each extension's block (#350).
 */
export function allowReply(allow: string, past: boolean, ruled: string, reply: ExtensionReply = { denies: [], context: [] }, fitted?: string): string {
  return settledWith(ruled, { ...(past ? { permissionDecision: 'allow', permissionDecisionReason: allow } : {}), additionalContext: fitted ?? contextParts(reply, ruled, allow).map((p) => p.text).join('\n') });
}
/** A warn entry's words, your standing rule's when it allowed the call, then each extension's block, labelled: the parts of a call's context the cap fits (#1296). */
export const contextParts = (reply: ExtensionReply, ruled: string, allow?: string): Part[] =>
  [...warnings(ruled).map((text) => ({ name: 'guard warnings', text, keep: true })), ...(allow === undefined ? [] : [{ name: "your standing rule's words", text: allow, keep: true }]), ...reply.context.map((b) => ({ name: `${b.extension}'s context`, text: `[${b.extension}] ${b.text}` }))];
/**
 * The core's reply as the agent's hook output: a block with its reason (a stop sent back, a prompt answered from the
 * record), or context the agent adds at a session's start or a prompt, never a decision; beside either, the one
 * line the chat shows (`systemMessage`, #83). The settled reply survives a hold (#2084): rewrites, warnings and wait
 * lines stay beside the core's context, and nothing from the core leaves the settled reply unchanged.
 */
export function coreReplyLine(agent: string, event: string, reply: { context?: string; block?: string; message?: string }, ruled: string, watchPaths?: string[]): string {
  const settled = JSON.parse(ruled) as { exit: number; stdout: string; stderr: string };
  if (settled.exit !== 0) return ruled;
  const out: Record<string, unknown> = settled.stdout ? JSON.parse(settled.stdout) as Obj : {};
  // Context goes as the agent's adapter gives it the model (#1296); one that gives none at this event sends nothing.
  const adapter = adapterOf(agent);
  const given = reply.context && !reply.block && adapter?.contextReply ? adapter.contextReply(event, reply.context) : undefined;
  if (reply.block) Object.assign(out, { decision: 'block', reason: reply.block });
  else if (given) {
    const json = ((): unknown => { try { return JSON.parse(given.stdout); } catch { return undefined; } })();
    if (!isObj(json)) return line(given);
    if (isObj(json.hookSpecificOutput)) {
      const prior = isObj(out.hookSpecificOutput) ? out.hookSpecificOutput : {};
      const additionalContext = [prior.additionalContext, json.hookSpecificOutput.additionalContext].filter(Boolean).join('\n');
      json.hookSpecificOutput = { ...prior, ...json.hookSpecificOutput, additionalContext };
    }
    Object.assign(out, json);
  }
  else if (reply.context && !adapter?.contextReply) {
    const prior = isObj(out.hookSpecificOutput) ? out.hookSpecificOutput : {};
    out.hookSpecificOutput = { ...prior, hookEventName: event, additionalContext: [prior.additionalContext, reply.context].filter(Boolean).join('\n') };
  }
  // A session's start names the ticker file whose change fires its FileChanged hook: the route a line takes into the
  // terminal while a call still runs (#120).
  if (watchPaths?.length && !reply.block) out.hookSpecificOutput = { hookEventName: event, ...(isObj(out.hookSpecificOutput) ? out.hookSpecificOutput : {}), watchPaths };
  if (reply.message) out.systemMessage = [out.systemMessage, reply.message].filter(Boolean).join('\n');
  return Object.keys(out).length ? line({ ...settled, stdout: JSON.stringify(out) }) : ruled;
}
/**
 * A hook's reply with what the waits add (#120): the one line the chat shows, context for the agent, and a rewritten
 * input carrying a deadline, never a decision. A reply that already denies the call stands as it is.
 */
export function withWaits(ruled: string, event: string, wait: WaitReply): string {
  if (!wait.message && !wait.context && !wait.updatedInput) return ruled;
  const reply = ruled === EMPTY_REPLY ? { exit: 0, stdout: '', stderr: '' } : JSON.parse(ruled) as { exit: number; stdout: string; stderr: string };
  if (reply.exit !== 0) return ruled;
  const out = reply.stdout ? JSON.parse(reply.stdout) as Record<string, unknown> : {};
  const specific = isObj(out.hookSpecificOutput) ? out.hookSpecificOutput : { hookEventName: event };
  if (wait.context) specific.additionalContext = [specific.additionalContext, wait.context].filter(Boolean).join('\n');
  if (wait.updatedInput) specific.updatedInput = wait.updatedInput;
  if (wait.context || wait.updatedInput) out.hookSpecificOutput = specific;
  if (wait.message) out.systemMessage = [out.systemMessage, wait.message].filter(Boolean).join('\n');
  return line({ exit: 0, stdout: JSON.stringify(out), stderr: reply.stderr });
}
