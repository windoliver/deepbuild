// A Claude Code turn as its transcript shows it: its entries, and the loops it left at its stop (#965).
import { loopFact } from './hookmap.js';
import { isObj, TURN_ENTRIES, type Obj } from './hub-shared.js';
import type { Live, Session } from './session-types.js';
import type { TranscriptReader } from './transcript-reader.js';

/**
 * The wake-ups and cron jobs the turn's transcript shows it scheduled or cancelled, read by the same loop facts as
 * their hooks (#965): a PostToolUse deep-hook spooled under load reaches the hub after the stop, and the stop would
 * otherwise read no loop and start checks on code the next wake-up changes. A wake-up its hook counted too is due
 * at the same time.
 */
export function loopsOfTurn(live: Live, entries: readonly Obj[], stepped: number): void {
  const results = new Map<string, unknown>();
  const parts = (e: Obj): Obj[] => (isObj(e.message) && Array.isArray(e.message.content) ? e.message.content.filter(isObj) : []);
  for (const e of entries) for (const p of parts(e)) if (p.type === 'tool_result') results.set(String(p.tool_use_id), e.toolUseResult);
  for (const e of entries) {
    for (const p of parts(e)) {
      if (p.type !== 'tool_use' || !results.has(String(p.id))) continue;
      const payload = { tool_input: p.input, tool_response: results.get(String(p.id)), tool_use_id: p.id } as Parameters<typeof loopFact>[3];
      const fact = loopFact('claude', String(p.name), 'PostToolUse', payload, '');
      if (!fact) continue;
      if ('scheduled' in fact) { if (fact.scheduled !== null) live.wakeups.push(Date.parse(String(e.timestamp)) + stepped + fact.scheduled); }
      else if ('cron' in fact) { if (!live.crons.has(fact.cron)) live.crons.set(fact.cron, { due: fact.due, recurring: fact.recurring }); }
      else if ('cancelled' in fact) live.crons.delete(fact.cancelled);
    }
  }
}

/**
 * A stop's loop reading, from the session's own tool calls: looping while a wake-up or cron job it scheduled is
 * due, or a background subagent or command it started hasn't reported; a loop with none left once neither holds.
 */
export function loopAt(live: Live, plant: string | undefined): Obj | undefined {
  const dues = [...live.wakeups, ...[...live.crons.values()].flatMap((c) => (c.due === null ? [] : [c.due]))];
  const due = dues.length ? Math.min(...dues) : null;
  // What the soonest is, for the gate runner and the line (#965).
  live.due = due === null ? null : { at: due, what: live.wakeups.includes(due) ? 'wake-up' : 'cron' };
  let loop: Obj | undefined;
  if (plant === 'loop-from-origins') {
    // The planted wrong program reads the loop from the prompt's origin alone.
    loop = live.from === 'scheduled' || live.from === 'subagent' ? { state: 'looping', due: null } : live.wakeups.length || live.background.size ? { state: 'looping', due } : undefined;
  } else if (live.wakeups.length || live.crons.size) loop = { state: 'looping', due };
  else if (live.background.size) loop = { state: 'looping', due: null };
  else if (live.looping || live.from === 'scheduled' || live.from === 'subagent') loop = { state: 'none_left' };
  live.looping = loop?.state === 'looping';
  live.wakeups = [];
  return loop;
}

/**
 * The transcript entries of the turn a prompt opened, from its own entry on. The core keeps the current turn's as
 * it reads them; a session it met after its prompt's entry was written (its first hook came late) is read here
 * from the transcript's last few MiB.
 */
export async function turnFrom(session: Session, promptId: string, reader: TranscriptReader): Promise<Obj[]> {
  if (session.prompts.has(promptId)) return session.entries[0]?.promptId === promptId ? session.entries : [session.prompts.get(promptId)!];
  const lines = (await reader.tail(session.transcript, 4 << 20)).split('\n');
  const at = lines.findIndex((l) => l.includes(promptId) && l.includes('"promptId"'));
  if (at < 0) return [];
  return lines.slice(at).flatMap((l) => { try { const e: unknown = JSON.parse(l); return isObj(e) && e.isSidechain !== true ? [e] : []; } catch { return []; } }).slice(0, TURN_ENTRIES);
}
