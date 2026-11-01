// The criteria's assertions, as judges: each returns the problems it found, each naming what its criterion says the
// failure names (the extension, the project), and an empty list when the criterion holds. A test runs a scenario on
// the real host and reader and expects no problem; on a planted twin (twins.json), which the proof lane lays over the
// code under test, the same test fails at that assertion with the problem the criterion describes.
import { basename } from 'node:path';
import type { HookReply, Load } from '../../../packages/extension-host/src/index.ts';
import { DEADLINE_MS, deniedBy } from './helpers.ts';

const shown = (reply: HookReply): string => `denies ${JSON.stringify(reply.denies)}, failed ${JSON.stringify(reply.failed)}`;

/** AC1: the project extension's deny reaches the agent: it is in the reply, nothing of it failed, and the reply came within the hook's deadline. */
export function judgeDenyReaches(call: { reply: HookReply; ms: number }, id: string): string[] {
  const problems: string[] = [];
  if (!deniedBy(call.reply, id)) problems.push(`${id}'s deny didn't reach the agent (${shown(call.reply)})`);
  const failed = call.reply.failed.filter((f) => f.extension === id);
  if (failed.length) problems.push(`${id} was recorded as failed: ${failed.map((f) => f.reason).join('; ')}`);
  if (call.ms > DEADLINE_MS) problems.push(`${id}'s reply came ${call.ms.toFixed(0)} ms after the request, past the ${DEADLINE_MS} ms deadline`);
  return problems;
}

export interface RevokeSeen {
  id: string;
  /** The project's folder, a real path. */
  project: string;
  /** The tool call before the revoke, and the one call after it. */
  before: { reply: HookReply; ms: number };
  after: { reply: HookReply; ms: number };
  /** The calls the extension's handler took up to each point, from its notes in the record. */
  askedBefore: number;
  askedAfter: number;
  /** The loaded extensions right after the one call after the revoke, on the same host: no restart. */
  loaded: string[];
}
/**
 * AC2: the one tool call after the revoke finds the extension unloaded before it (its handler took no call, its deny
 * is gone, the host no longer lists it loaded) and is refused naming the project (its folder's path or its name, in
 * the reply's failure for the extension or a deny's reason).
 */
export function judgeRevoke(seen: RevokeSeen): string[] {
  const { id, project, before, after } = seen;
  const problems: string[] = [];
  if (!deniedBy(before.reply, id) || seen.askedBefore !== 1) problems.push(`before the revoke, ${id} didn't take the call and deny it (asked ${seen.askedBefore}; ${shown(before.reply)})`);
  if (deniedBy(after.reply, id)) problems.push(`${id}'s deny still reached the agent on the first call after the revoke`);
  if (seen.askedAfter > seen.askedBefore) problems.push(`${id}'s handler still took the first call after the revoke`);
  if (seen.loaded.includes(id)) problems.push(`${id} is still loaded after the first call after the revoke`);
  const said = [...after.reply.failed.filter((f) => f.extension === id).map((f) => f.reason), ...after.reply.denies.map((d) => d.reason)];
  if (!said.some((text) => text.includes(project) || text.includes(basename(project)))) {
    problems.push(`the first call after the revoke wasn't refused naming the project ${project}: ${shown(after.reply)}`);
  }
  return problems;
}

export interface SharedSeen {
  real: string;
  link: string;
  /** After trusting through the link: what the reader answers for each folder. */
  trusted: { real: boolean; link: boolean };
  /** The loads of the extension that comes with each folder. */
  loads: { real: Load | string; link: Load | string };
  ids: { real: string; link: string };
  /** The tool call after the trust, and the one after revoking through the real path. */
  trustedCall: HookReply;
  /** After revoking through the real path: what the reader answers for each folder. */
  revoked: { real: boolean; link: boolean };
  revokedCall: HookReply;
}
/** AC3: the folder and the symlink to it share one answer: trusting one trusts the other, and revoking one revokes the other. */
export function judgeShared(seen: SharedSeen): string[] {
  const problems: string[] = [];
  const { real, link, ids } = seen;
  if (!seen.trusted.real) problems.push(`trusting ${link} didn't trust ${real}, its real path`);
  if (!seen.trusted.link) problems.push(`trusting ${link} didn't trust it`);
  for (const side of ['real', 'link'] as const) {
    const load = seen.loads[side];
    if (typeof load === 'string' || load.status !== 'loaded') problems.push(`${ids[side]}, which comes with ${seen[side]}, didn't load once ${link} was trusted: ${JSON.stringify(load)}`);
    else if (!deniedBy(seen.trustedCall, ids[side])) problems.push(`${ids[side]}'s deny didn't reach the agent once ${link} was trusted (${shown(seen.trustedCall)})`);
    if (seen.revoked[side]) problems.push(`revoking ${real} left ${seen[side]} trusted`);
    if (deniedBy(seen.revokedCall, ids[side])) problems.push(`${ids[side]}'s deny still reached the agent after ${real} was revoked`);
  }
  return problems;
}
