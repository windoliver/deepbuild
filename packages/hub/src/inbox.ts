// `deep inbox`, `deep inbox answer` (#24) and `deep inbox undo` (#667): your open asks, your answer to one, and the
// undo of a default, through the hub's socket as the cli role. An answer or an undo counts only once the OS confirms
// you, which the hub asks for; run inside an agent's process tree, the command acts as that agent's session, and no
// agent answers.
import { readFileSync } from 'node:fs';
import { call, type Reply } from './client.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';
import { startOf } from './wire.js';

const USAGE = 'Usage: deep inbox\n       deep inbox answer <ask> <option>\n       deep inbox undo <ask>\n       deep inbox save <offer>';
/** Refusals of what you typed: nothing ran. */
const USAGE_CODES = new Set(['handle_syntax', 'not_found', 'enum']);
/** Refusals that leave the answer undecided: not confirmed, an agent's command, or a hub that couldn't. */
const UNDECIDED_CODES = new Set(['unconfirmed', 'role', 'unavailable']);

interface Row { ask: string; kind: string; session: string; status: string; age: number; question: string; options: string[] }
/** A permission you said yes to in the terminal, offered back as a decision to save (#23). */
interface Offer { offer: string; session: string; command: string; scope: string }

/** How long ago, in the largest whole unit that is at least 1: 2d, 3h, 5m, 30s. */
function age(ms: number): string {
  for (const [unit, size] of [['d', 86_400_000], ['h', 3_600_000], ['m', 60_000]] as const) if (ms >= size) return `${Math.floor(ms / size)}${unit}`;
  return `${Math.max(0, Math.floor(ms / 1000))}s`;
}

/** `deep inbox [answer <ask> <option> | undo <ask> | save <offer>]`: exit 0 listed or counted, 2 a usage error, 3 not decided, 1 refused otherwise. */
export async function inboxCommand(args: readonly string[]): Promise<number> {
  const answering = args[0] === 'answer';
  const undoing = args[0] === 'undo';
  const saving = args[0] === 'save';
  // A flag where an ask or option goes is a usage error, never read as one (#19's exit table).
  if ((answering ? args.length !== 3 : undoing || saving ? args.length !== 2 : args.length !== 0) || args.slice(1).some((a) => a.startsWith('-'))) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const at = rootOf(installedRoot());
  let reply: Reply;
  try {
    const token = readFileSync(at.token, 'utf8').trim();
    // Only an answer or an undo is judged by the peer check, so only they pay for the `ps` that names this process.
    const peer = answering || undoing || saving ? { pid: process.pid, start: (await startOf(process.pid)) ?? '' } : undefined;
    reply = answering
      ? await call(hubAddress().path, token, 'ask.answer', { ask: args[1], option: args[2] }, peer)
      : undoing ? await call(hubAddress().path, token, 'ask.undo', { ask: args[1] }, peer)
      : saving ? await call(hubAddress().path, token, 'offer.save', { offer: args[1] }, peer)
      : await call(hubAddress().path, token, 'inbox.read', {});
  } catch (error) {
    process.stderr.write(`BLOCKED: ${error instanceof Error ? error.message : String(error)}${answering ? `; ${args[1]} stays open` : undoing ? `; ${args[1]} keeps its default` : saving ? `; ${args[1]} isn't saved` : ''}\n`);
    return 3;
  }
  if ('error' in reply) {
    process.stderr.write(`${reply.error.remediation}\n`);
    return USAGE_CODES.has(reply.error.code) ? 2 : UNDECIDED_CODES.has(reply.error.code) ? 3 : 1;
  }
  if (answering) {
    process.stdout.write(`${String(reply.result.ask)} answered ${String(reply.result.answer)}, saved as a decision for ${String(reply.result.scope)}\n`);
    return 0;
  }
  if (undoing) {
    process.stdout.write(`${String(reply.result.ask)} is open again, its default undone; it waits until ${new Date(Number(reply.result.deadline)).toISOString()}\n`);
    return 0;
  }
  if (saving) {
    process.stdout.write(`${String(reply.result.offer)} saved as ${String(reply.result.decision)}, a decision for ${String(reply.result.scope)}\n`);
    return 0;
  }
  // The hub's inbox holds every ask; the list is the open ones.
  const rows = (reply.result.asks as Row[]).filter((r) => r.status !== 'closed');
  if (!rows.length) process.stdout.write('No open asks.\n');
  for (const r of rows) process.stdout.write(`${r.ask}  ${r.kind}  ${r.session}  ${age(r.age)}  ${r.status}  ${r.question}  [${r.options.join(' | ')}]\n`);
  // What you said yes to in the terminal, offered back: one click saves it as a decision.
  for (const o of (reply.result.offers ?? []) as Offer[]) process.stdout.write(`${o.offer}  offered  ${o.session}  save \`${o.command}\` as a decision for ${o.scope}  (deep inbox save ${o.offer})\n`);
  return 0;
}
