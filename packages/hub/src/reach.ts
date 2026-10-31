// Two things the hub reads from outside for a task's check (#85), each carrying nothing it doesn't need: whether the
// host a session's API calls go to can be reached, by a bare TCP connection that sends nothing; and a Slack thread,
// through a connector whose one method reads.
import { readFileSync, statSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';

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
      return `${url.hostname}:${url.port || (url.protocol === 'http:' ? '80' : '443')}`;
    } catch { /* not a URL: the next */ }
  }
  return 'api.anthropic.com:443';
}

/** Whether a TCP connection to the host opens within the try's limit. It sends nothing. */
export function reachable(host: string): Promise<boolean> {
  const at = host.lastIndexOf(':');
  return new Promise((resolve) => {
    const socket = net.connect({ host: host.slice(0, at).replace(/^\[|\]$/g, ''), port: Number(host.slice(at + 1)), timeout: TRY_MS });
    const done = (reached: boolean) => { socket.destroy(); resolve(reached); };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

/**
 * A network task's check: called on every tick while one is open, it starts a try at most once every 5 s and hands
 * each result over once, so no earlier result ever closes a later task.
 */
export function networkCheck(): { read(): { host: string; reached: boolean } | null } {
  let result: { host: string; reached: boolean } | null = null;
  let trying = false;
  let last = 0;
  return {
    read() {
      const done = result;
      result = null;
      if (!done && !trying && Date.now() - last >= CHECK_MS) {
        trying = true;
        last = Date.now();
        const host = apiHost();
        void reachable(host).then((reached) => { result = { host, reached }; trying = false; });
      }
      return done;
    },
  };
}

interface Slack { token: string; you: string; api: string }

/** `<hub root>/slack.json`, only as your own file (mode 0600); null otherwise, and the connector is off. */
export function slackConfig(root: string): Slack | null {
  const file = join(root, 'slack.json');
  try {
    if ((statSync(file).mode & 0o777) !== 0o600) return null;
    const c = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    if (typeof c.token !== 'string' || typeof c.you !== 'string') return null;
    return { token: c.token, you: c.you, api: typeof c.api === 'string' ? c.api.replace(/\/$/, '') : 'https://slack.com/api' };
  } catch { return null; }
}

/** The channel and thread a Slack thread link names; null for any other link, so the token only goes to Slack's API. */
export function slackThread(link: string): { channel: string; ts: string } | null {
  let url: URL;
  try { url = new URL(link); } catch { return null; }
  const path = /^\/archives\/([A-Z0-9]+)\/p(\d{10})(\d{6})$/.exec(url.pathname);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !/^[a-z0-9-]+\.slack\.com$/.test(url.hostname) || !path) return null;
  const inThread = url.searchParams.get('thread_ts');
  return { channel: path[1]!, ts: inThread && /^\d{10}\.\d{6}$/.test(inThread) ? inThread : `${path[2]}.${path[3]}` };
}

/** The read-only connector: conversations.replies, each thread at most once every 5 s. A failure's text never holds what Slack echoed. */
export function slackThreads(root: string): { read(link: string): Promise<{ from: string; text: string; at: number }[]> } {
  type Messages = { from: string; text: string; at: number }[];
  const seen = new Map<string, { at: number; read: Promise<Messages> }>();
  const fetched = async (link: string): Promise<Messages> => {
    const slack = slackConfig(root);
    const thread = slackThread(link);
    if (!slack || !thread) throw new Error('no connector for this thread: check slack.json and the link');
    const out: Messages = [];
    for (let cursor = '';;) {
      const query = new URLSearchParams({ channel: thread.channel, ts: thread.ts, limit: '200', ...(cursor ? { cursor } : {}) });
      const reply = await fetch(`${slack.api}/conversations.replies?${query}`, { headers: { authorization: `Bearer ${slack.token}` }, redirect: 'error', signal: AbortSignal.timeout(CHECK_MS) });
      if (!reply.ok) throw new Error(`Slack answered HTTP ${reply.status}`);
      const body = (await reply.json()) as { ok?: boolean; error?: unknown; messages?: { user?: string; bot_id?: string; text?: string; ts?: string }[]; response_metadata?: { next_cursor?: string } };
      if (body.ok !== true) throw new Error(`Slack refused the read: ${typeof body.error === 'string' && /^[a-z_]{1,64}$/.test(body.error) ? body.error : 'no reason it gave can be shown'}`);
      for (const m of body.messages ?? []) out.push({ from: m.user === slack.you ? 'you' : m.user ?? m.bot_id ?? 'someone', text: m.text ?? '', at: Math.round(Number(m.ts) * 1000) });
      cursor = body.response_metadata?.next_cursor ?? '';
      if (!cursor) return out;
    }
  };
  return {
    read(link) {
      const before = seen.get(link);
      if (before && Date.now() - before.at < CHECK_MS) return before.read;
      const read = fetched(link);
      seen.set(link, { at: Date.now(), read });
      return read;
    },
  };
}
