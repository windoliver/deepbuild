// `deep inbox`, `deep inbox answer` (#24) and `deep inbox undo` (#667): your open asks, your answer to one, and the
// undo of a default, through the hub's socket as the cli role. An answer or an undo counts only once the OS confirms
// you, which the hub asks for; run inside an agent's process tree, the command acts as that agent's session, and no
// agent answers.
import { readFileSync } from 'node:fs';
import { call, UNDECIDED_CODES, type Reply } from './client.js';
import { hubAddress, installedRoot, rootOf } from './paths.js';
import { elapsed } from './promises.js';
import { visible } from './visible.js';
import { startOf } from './wire.js';

const USAGE = 'Usage: deep inbox\n       deep inbox answer <ask> <option>\n       deep inbox undo <ask>\n       deep inbox save <offer>';
/** One line of output: an ask's, a plan's or a call's text comes from the record, so it prints through `visible` (#1510). */
const say = (line: string): void => void process.stdout.write(`${visible(line)}\n`);
/** Refusals of what you typed: nothing ran. */
const USAGE_CODES = new Set(['handle_syntax', 'not_found', 'enum']);

/** How far back `deep inbox` lists what was decided for you. */
const DAY_MS = 86_400_000;

interface Row { opens?: { kind: string; name?: string; command?: string }; ask: string; kind: string; session: string; status: string; outcome: string; age: number; question: string; options: string[]; plan?: { hash: string; steps: Step[] } | null; decision: string | null; answer?: string | null }
/** A plan's step, as an authority ask shows it (#69). */
interface Step { does: string; changes: string[]; undo: string; cost: number }
/** A permission you said yes to in the terminal, offered back as a decision to save (#23). */
interface Offer { offer: string; session: string; command: string; scope: string }

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
    // A block's task (#85), a fold and an ask with no repo or session save no decision; the sentence says only what the record holds.
    say(`${String(reply.result.ask)} answered ${String(reply.result.answer)}${reply.result.scope === null ? '; no decision saved' : `, saved as a decision for ${String(reply.result.scope)}`}`);
    return 0;
  }
  if (undoing) {
    say(`${String(reply.result.ask)} is open again, its default undone; it waits until ${new Date(Number(reply.result.deadline)).toISOString()}`);
    return 0;
  }
  if (saving) {
    say(`${String(reply.result.offer)} saved as ${String(reply.result.decision)}, a decision for ${String(reply.result.scope)}`);
    return 0;
  }
  // The hub's inbox holds every ask; the list is the open ones.
  const rows = (reply.result.asks as Row[]).filter((r) => r.status !== 'closed');
  if (!rows.length) say('No open asks.');
  for (const r of rows) {
    say(`${r.ask}  ${r.kind}  ${r.session}  ${elapsed(r.age)}  ${r.status}  ${r.question}  [${r.options.join(' | ')}]`);
    // Where a task sends you, from the trusted path alone (#84).
    if (r.opens) say(`    opens ${r.opens.kind === 'secret' ? `the entry field of ${r.opens.name ?? ''}` : r.opens.command ?? ''}`);
    // Before a yes with authority, what will happen: each step, what it changes, its undo and its cost (#69).
    if (!r.plan) continue;
    say(`    plan ${r.plan.hash.slice(0, 12)}: ${r.plan.steps.length} step${r.plan.steps.length === 1 ? '' : 's'}, ${r.plan.steps.filter((s) => s.undo === "can't undo").length} can't be undone`);
    for (const [i, s] of r.plan.steps.entries()) say(`    ${i + 1}. ${s.does}  changes ${s.changes.join(', ')}  undo: ${s.undo}  cost $${s.cost.toFixed(2)}`);
  }
  // What was decided for you in the last day (#27), each line led by its label so no reader takes it for an open ask.
  for (const r of (reply.result.asks as Row[]).filter((r) => r.outcome === 'decided_for_you' && r.age < DAY_MS)) {
    say(`decided for you  ${r.ask}  ${r.decision ?? ''}  ${r.session}  ${elapsed(r.age)}  ${r.question}  → ${r.answer ?? ''}`);
  }
  // What you said yes to in the terminal, offered back: one click saves it as a decision.
  for (const o of (reply.result.offers ?? []) as Offer[]) say(`${o.offer}  offered  ${o.session}  save \`${o.command}\` as a decision for ${o.scope}  (deep inbox save ${o.offer})`);
  return 0;
}

/** `deep race <issue>` (#352): a race you start on an issue, from your own terminal; exit 0 started, 2 a usage error, 3 the hub unreached, 1 refused. */
export async function raceCommand(args: readonly string[]): Promise<number> {
  if (args.length !== 1 || !/^[1-9][0-9]*$/.test(args[0]!)) {
    process.stderr.write('Usage: deep race <issue number>\n');
    return 2;
  }
  let reply: Reply;
  try {
    const token = readFileSync(rootOf(installedRoot()).token, 'utf8').trim();
    reply = await call(hubAddress().path, token, 'race.start', { issue: Number(args[0]) }, { pid: process.pid, start: (await startOf(process.pid)) ?? '' });
  } catch (error) {
    process.stderr.write(`BLOCKED: ${error instanceof Error ? error.message : String(error)}; no race started\n`);
    return 3;
  }
  if ('error' in reply) {
    process.stderr.write(`${reply.error.remediation}\n`);
    return 1;
  }
  process.stdout.write(`A race on issue #${args[0]} started: its sessions settle on the first PASS.\n`);
  return 0;
}
