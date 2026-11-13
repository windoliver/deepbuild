// Two things the hub reads from outside for a task's check (#85), each carrying nothing it doesn't need: whether the
// host a session's API calls go to can be reached, by a bare TCP connection that sends nothing; and a Slack thread,
// through a connector whose one method reads.
import { readFileSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { enter, hold, hubSecrets, namesToken, refusedFile, valueOf, type Named } from './held.js';

const TRY_MS = 1500;
/** How often a check may look: a network task's try, and a thread's read (design: 5 s). */
const CHECK_MS = 5000;

/** The host:port Claude Code's API calls go to: settings' proxy, then its base URL, then the service. */
export function apiHost(): string {
  let env: Record<string, unknown> = {};
  try { env = (JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf8')) as { env?: Record<string, unknown> }).env ?? {}; } catch { /* none: the default */ }
  for (const value of [env.HTTPS_PROXY, env.ANTHROPIC_BASE_URL]) {
    if (typeof value !== 'string') continue;
    try {
      const url = new URL(value);
      if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname) continue;
      return `${url.hostname}:${url.port || (url.protocol === 'http:' ? '80' : '443')}`;
    } catch { /* not a URL: the next */ }
  }
  return 'api.anthropic.com:443';
}

const trying = new Map<string, Promise<boolean>>();
/** Whether a TCP connection to the host opens within the try's limit, one try at a time per host. It sends nothing. */
export function reachable(host: string): Promise<boolean> {
  const running = trying.get(host);
  if (running) return running;
  const at = host.lastIndexOf(':');
  const attempt = new Promise<boolean>((resolve) => {
    const socket = net.connect({ host: host.slice(0, at).replace(/^\[|\]$/g, ''), port: Number(host.slice(at + 1)), timeout: TRY_MS });
    const done = (reached: boolean) => { socket.destroy(); resolve(reached); };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  }).finally(() => trying.delete(host));
  trying.set(host, attempt);
  return attempt;
}

/**
 * A network task's check: called on every tick while one is open, it starts a try at most once every 5 s and hands
 * each result over once, with when its try started, so the core can refuse one from before a task. Never waits.
 */
export function networkCheck(): { read(): { host: string; reached: boolean; at: number } | null } {
  let result: { host: string; reached: boolean; at: number } | null = null;
  let busy = false;
  let last = 0;
  return {
    read() {
      const done = result;
      result = null;
      if (!done && !busy && Date.now() - last >= CHECK_MS) {
        busy = true;
        const at = last = Date.now();
        const host = apiHost();
        void reachable(host).then((reached) => { result = { host, reached, at }; busy = false; });
      }
      return done;
    },
  };
}

/** slack.json as read: its token by handle (#1606), `secret:slack/token`, kept under `deepbuild/slack/token`. */
interface Slack { file: Record<string, unknown>; you: string; api: string }
const slackToken = (at: Record<string, unknown>): Named => ({ at, path: 'slack/token' });

/** `<hub root>/slack.json`, only as your own file that no one else can reach (#1606); null otherwise, and the connector is off. */
export function slackConfig(root: string): Slack | null {
  const file = join(root, 'slack.json');
  try {
    const c = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    if (!namesToken(c, (json) => [slackToken(json)]) || refusedFile(file) || typeof c.you !== 'string') return null;
    return { file: c, you: c.you, api: typeof c.api === 'string' ? c.api.replace(/\/$/, '') : 'https://slack.com/api' };
  } catch { return null; }
}

/** The connector's token entered on the trusted path (#1606): its value into the store, its handle into slack.json. */
export const enterSlackToken = (root: string, value: string): Promise<void> => enter(join(root, 'slack.json'), (json) => json, 'slack/token', value, hubSecrets(root));

/** The channel and thread a Slack thread link names; null for any other link, so the token only goes to Slack's API. */
export function slackThread(link: string): { channel: string; ts: string } | null {
  let url: URL;
  try { url = new URL(link); } catch { return null; }
  const path = /^\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})$/.exec(url.pathname);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !/^[a-z0-9-]+\.slack\.com$/.test(url.hostname) || !path) return null;
  const inThread = url.searchParams.get('thread_ts');
  return { channel: path[1]!, ts: inThread && /^\d{10}\.\d{6}$/.test(inThread) ? inThread : `${path[2]}.${path[3]}` };
}

/**
 * The read-only connector: conversations.replies, each thread at most once every 5 s, in the background, so a read
 * answers at once with what the last one found and a hung Slack never holds the asks core. What a failure says is
 * this file's own text: never what Slack sent, or an error that could quote the token.
 */
export function slackThreads(root: string): { read(link: string): Promise<{ from: string; text: string; at: number }[]> } {
  type Messages = { from: string; text: string; at: number }[];
  interface Seen { at: number; busy: boolean; found: Messages; failed: string | null }
  const seen = new Map<string, Seen>();
  const secrets = hubSecrets(root);
  // A plain token slack.json still holds moves into the store once, as the hub starts (#1606).
  const file = join(root, 'slack.json');
  const moving = hold<Record<string, unknown>>(file, (c) => [slackToken(c)], secrets).then((held) => {
    if ('refused' in held) process.stderr.write(`deep hub: the Slack connector refused: ${held.refused}\n`);
    else if (held.moved.length) process.stderr.write(`deep hub: moved the Slack connector's token from ${file} into the OS secret store; the file now names it by handle\n`);
  }, () => undefined);
  const fetched = async (link: string): Promise<Messages> => {
    await moving;
    const slack = slackConfig(root);
    const thread = slackThread(link);
    if (!slack || !thread) throw new Error('no connector for this thread: check slack.json and the link');
    const token = await valueOf(slackToken(slack.file), secrets);
    if (token === undefined) throw new Error('no Slack token in the OS secret store: enter it with deep secret add slack token');
    const out: Messages = [];
    for (let cursor = '';;) {
      const query = new URLSearchParams({ channel: thread.channel, ts: thread.ts, limit: '200', ...(cursor ? { cursor } : {}) });
      const reply = await fetch(`${slack.api}/conversations.replies?${query}`, { headers: { authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(CHECK_MS) }).catch(() => { throw new Error('Slack could not be reached with this token'); });
      if (!reply.ok) throw new Error(`Slack answered HTTP ${reply.status}`);
      const body = await reply.json().catch(() => { throw new Error('Slack answered with something other than JSON'); }) as { ok?: boolean; error?: unknown; messages?: { user?: string; bot_id?: string; text?: string; ts?: string }[]; response_metadata?: { next_cursor?: string } };
      if (body.ok !== true) throw new Error(`Slack refused the read: ${typeof body.error === 'string' && /^[a-z_]{1,64}$/.test(body.error) ? body.error : 'no reason it gave can be shown'}`);
      for (const m of body.messages ?? []) out.push({ from: m.user === slack.you ? 'you' : m.user ?? m.bot_id ?? 'someone', text: m.text ?? '', at: Math.round(Number(m.ts) * 1000) });
      cursor = body.response_metadata?.next_cursor ?? '';
      if (!cursor) return out;
    }
  };
  return {
    async read(link) {
      const s = seen.get(link) ?? { at: 0, busy: false, found: [], failed: null };
      seen.set(link, s);
      if (!s.busy && Date.now() - s.at >= CHECK_MS) {
        s.busy = true;
        s.at = Date.now();
        void fetched(link).then((found) => { s.found = found; s.failed = null; }, (error: Error) => { s.failed = error.message; }).finally(() => { s.busy = false; });
      }
      if (s.failed !== null) throw new Error(s.failed);
      return s.found;
    },
  };
}
