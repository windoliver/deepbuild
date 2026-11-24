// A Claude Code session bound to a real hub by its hooks, with its own `deep mcp` (AC4, AC6). Imported, not copied:
// #806's hub, world file and agent stand-in, #26's MCP client and record reader, and #1725's red-box document and the
// deep_* call as a session makes it. The session's deep mcp is initialized as Claude Code names itself, at the newest
// version its facts list. `deep setup`'s server entry, `deepbuild`, is in the home's Claude Code config, so the hub reads
// the session's server as a real session's.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLAUDE, DOC, call, redBox, sessionId, t26, type Opened } from '../1725/helpers.ts';
import { CLI, NODE, Stand, World, makeHome, startHub, t393 } from '../806/helpers.ts';
import { claudeClient, type Tool } from './helpers.ts';

export { cleanup } from '../806/helpers.ts';
export { CLAUDE, sessionId };

export interface ClaudeWorld extends Opened { stand: Stand; tools: Tool[] }

export async function claudeWorld(): Promise<ClaudeWorld> {
  const { tmp, home } = makeHome();
  writeFileSync(join(home, '.claude.json'), `${JSON.stringify({ mcpServers: { deepbuild: { type: 'stdio', command: NODE, args: [CLI, 'mcp'] } } })}\n`);
  const world = new World(join(tmp, 'world.json'), { names: { [sessionId(CLAUDE)]: CLAUDE.name }, panels: t393.PANELS, docs: { [DOC.a]: { panel: 'main' } } });
  const work = t26.makeWorktree(join(tmp, 'work'));
  const hub = await startHub(home, { world: world.path });
  const stand = Stand.start(home, work.path, CLAUDE.kind, sessionId(CLAUDE));
  await stand.establish(hub);
  const { reply } = await stand.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: claudeClient() });
  if (!reply.result) throw Error(`BLOCKED: deep mcp refused initialize: ${JSON.stringify(reply)}`);
  await stand.notify('notifications/initialized');
  const tools = (await t26.listTools(stand)) as unknown as Tool[];
  return { tmp, home, hub, stands: new Map([[CLAUDE.label, stand]]), ask: undefined, stand, tools };
}

/** The session's first deep_show, with a valid red-box document on the world's document. */
export async function firstShow(w: ClaudeWorld): Promise<{ isError: boolean; value: unknown; raw: string }> {
  const outcome = await call(w, CLAUDE, 'deep_show', { doc: DOC.a, document: redBox(), include: ['issues'] });
  const value = outcome.value as { outcome?: unknown } | null;
  // "runs": answered, and not refused, as a call or as a document.
  const refused = outcome.isError || value?.outcome === 'refused';
  return { isError: refused, value: outcome.value, raw: JSON.stringify(outcome.reply) };
}

/** The record's events of the session. */
export async function sessionEvents(w: ClaudeWorld): Promise<t26.Ev[]> {
  return (await t26.events(w.hub)).filter((e) => e.session === sessionId(CLAUDE));
}
