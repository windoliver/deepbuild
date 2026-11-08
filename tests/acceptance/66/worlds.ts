// Worlds for each provider: the controlled clock, the provider's local server, a host on a world with the HTTP client
// routed to it, the source's package installed and loaded, and the work source added on the trusted path.
import type { TestStorage } from '../../../packages/record/src/index.ts';
import {
  clock, grantFor, installAndLoad, MINUTE, memoryStore, openHost, openWorld, pkg, routedClient, shipped, vfsWorld, workSourcesOf, YOU,
  type Clock, type Host, type HostSeams, type World,
} from './helpers.ts';
import { chat, CHAT, gmail, GMAIL, LABEL, linear, LINEAR, tracker, TRACKER, REPO_WEB, type Chat, type Gmail, type Linear, type Tracker } from './providers.ts';

export const TRACKER_SOURCE = 'ext.tracker.issues';
export const CHAT_SOURCE = 'ext.chat.threads';
export const REPLY_RULE = { sentence: 'reply in the thread it came from' };
/** Test values for the keys the shipped sources name (README); no real account's. */
export const LINEAR_KEY = 'lin_api_dh66test0000000000000000000000000001';
export const GMAIL_TOKEN = 'ya29.dh66-test-token-0001';

export interface TrackerWorld { c: Clock; w: World; h: Host; tr: Tracker; ch: Chat; seams: HostSeams; handle: string; chatHandle: string | null }
/**
 * The tracker plug-in (fixtures/tracker, with `probe`) loaded and its work source added over `acme/web` at `start`;
 * with `rule`, your standing rule for its deliveries; with `chat`, the chat plug-in too, its work source over `C1`.
 */
export async function trackerWorld(start: number, o: { probe?: Record<string, unknown>; every?: number; rule?: boolean; storage?: TestStorage; chat?: boolean } = {}): Promise<TrackerWorld> {
  const c = clock(start);
  const tr = await tracker(c);
  const ch = await chat(c);
  const seams: HostSeams = { secrets: memoryStore(), http: routedClient({ [TRACKER]: tr.p, [CHAT]: ch.p }).client };
  const w = o.storage ? await vfsWorld(c, o.storage) : await openWorld(c);
  const h = await openHost(w, seams);
  await installAndLoad(h, await pkg('tracker', o.probe ?? {}), grantFor(TRACKER));
  const handle = await h.addWorkSource(YOU, { source: TRACKER_SOURCE, scope: REPO_WEB, every: o.every ?? 5 * MINUTE });
  if (o.rule) await h.setWorkRule(YOU, handle, REPLY_RULE);
  let chatHandle: string | null = null;
  if (o.chat) {
    await installAndLoad(h, await pkg('chat'), grantFor(CHAT));
    chatHandle = await h.addWorkSource(YOU, { source: CHAT_SOURCE, scope: 'C1', every: o.every ?? 5 * MINUTE });
    if (o.rule) await h.setWorkRule(YOU, chatHandle, REPLY_RULE);
  }
  return { c, w, h, tr, ch, seams, handle, chatHandle };
}

export interface LinearWorld { c: Clock; w: World; h: Host; lin: Linear; source: string; handle: string; id: string }
/** The shipped Linear source, its key entered on the trusted path, its work source added over the team `LIN`. */
export async function linearWorld(start: number): Promise<LinearWorld> {
  const c = clock(start);
  const lin = await linear(c, start);
  const w = await openWorld(c);
  const h = await openHost(w, { secrets: memoryStore(), http: routedClient({ [LINEAR]: lin.p }).client });
  const dir = await shipped('linear');
  const p = await installAndLoad(h, dir, grantFor(LINEAR));
  const entered = await h.enterSecret(YOU, p.id, 'linear_key', LINEAR_KEY);
  if (!entered.saved) throw Error(`the Linear key wasn't saved: ${JSON.stringify(entered)}`);
  const [source] = workSourcesOf(dir);
  if (!source) throw Error('packages/sources/linear registers no source whose reading is work.item@1');
  const handle = await h.addWorkSource(YOU, { source, scope: 'LIN', every: 5 * MINUTE });
  return { c, w, h, lin, source, handle, id: p.id };
}

export interface GmailWorld { c: Clock; w: World; h: Host; gm: Gmail; source: string; handle: string }
/** The shipped Gmail label source, its token entered, `before` run on the mailbox first, its work source added over `Label_7` at `start`. */
export async function gmailWorld(start: number, o: { before?: (gm: Gmail) => void; rule?: boolean } = {}): Promise<GmailWorld> {
  const c = clock(start);
  const gm = await gmail(c);
  o.before?.(gm);
  const w = await openWorld(c);
  const h = await openHost(w, { secrets: memoryStore(), http: routedClient({ [GMAIL]: gm.p }).client });
  const dir = await shipped('gmail');
  const p = await installAndLoad(h, dir, grantFor(GMAIL));
  const entered = await h.enterSecret(YOU, p.id, 'gmail_token', GMAIL_TOKEN);
  if (!entered.saved) throw Error(`the Gmail token wasn't saved: ${JSON.stringify(entered)}`);
  const [source] = workSourcesOf(dir);
  if (!source) throw Error('packages/sources/gmail registers no source whose reading is work.item@1');
  const handle = await h.addWorkSource(YOU, { source, scope: LABEL, every: 5 * MINUTE });
  if (o.rule) await h.setWorkRule(YOU, handle, REPLY_RULE);
  return { c, w, h, gm, source, handle };
}
