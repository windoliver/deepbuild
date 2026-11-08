// The recorded providers (README "The providers"): local servers standing in for Linear's GraphQL API, a Gmail-like
// label, a GitHub-like issue tracker and a chat app. Each answers from data the test holds, the answers shaped as
// the provider records them, and keeps every request it got. No network, no account, no secret: a provider that
// takes a key only checks that one came.
import { iso, json, provider, type Clock, type Provider, type Reply, type Seen } from './helpers.ts';

const b64url = (s: string): string => Buffer.from(s, 'utf8').toString('base64url');
const unb64 = (s: string): string => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
const body = (s: Seen): Record<string, unknown> => { try { return JSON.parse(s.body) as Record<string, unknown>; } catch { return {}; } };
const notFound = (message = 'Not Found'): Reply => json({ message }, 404);

// ---- A GitHub-like tracker at api.tracker.example (fixtures/tracker reads it).
export const TRACKER = 'api.tracker.example';
export const REPO_WEB = 'acme/web';
export interface TComment { id: number; event?: string; author: string; body: string; at: number; mention?: boolean }
export interface TIssue {
  n: number; repo?: string; title: string | null; body: string; author: string; created: number; updated: number; comments: TComment[];
  /** The status a read of the issue answers, now (default 200). */
  read?: (now: number) => number;
  /** Statuses the next comment POSTs answer, in turn; then 201. */
  post?: number[];
  /** A deleted issue answers 410 to a comment; a locked one 403. */
  gone?: boolean; locked?: boolean;
  /** A comment POST that reaches the provider is kept (default), or dropped as if it never came. */
  keep?: boolean;
  /** Holds the comment POST's answer: 'hang' never answers. */
  hold?: 'hang';
  /** Called as a comment POST reaches the tracker, before anything else. */
  onPost?: () => void;
}
export interface Tracker {
  p: Provider; issues: Map<number, TIssue>;
  add(issue: Omit<TIssue, 'comments' | 'body' | 'author' | 'title'> & Partial<Pick<TIssue, 'comments' | 'body' | 'author' | 'title'>>): TIssue;
  comment(n: number, c: Omit<TComment, 'id'> & { id?: number }): TComment;
  posts(n?: number): Seen[];
  reads(n: number): Seen[];
}
export async function tracker(c: Clock): Promise<Tracker> {
  const issues = new Map<number, TIssue>();
  let ids = 1000;
  const issueOf = (i: TIssue) => ({
    number: i.n, repo: i.repo ?? REPO_WEB, title: i.title, body: i.body, user: { login: i.author }, created_at: iso(i.created), updated_at: iso(i.updated),
    html_url: `https://tracker.example/${i.repo ?? REPO_WEB}/issues/${i.n}`, locked: i.locked === true,
  });
  const commentOf = (i: TIssue, x: TComment) => ({
    id: x.id, event: x.event ?? `comment-${x.id}`, user: { login: x.author }, body: x.body, created_at: iso(x.at), updated_at: iso(x.at),
    html_url: `https://tracker.example/${i.repo ?? REPO_WEB}/issues/${i.n}#comment-${x.id}`, mention: x.mention === true,
  });
  const p = await provider(c, (s) => {
    const m = /^\/repos\/([\w.-]+)\/([\w.-]+)(\/.*)?$/.exec(s.path);
    if (!m) return notFound();
    const repo = `${m[1]}/${m[2]}`;
    const rest = m[3] ?? '';
    if (s.method === 'GET' && rest === '/collaborators') return json([{ login: 'you', role_name: 'admin' }, { login: 'kim', role_name: 'write' }]);
    if (s.method === 'GET' && rest === '/issues') {
      const since = s.query.get('since') ? Date.parse(s.query.get('since')!) : 0;
      const per = Number(s.query.get('per_page') ?? 30);
      const page = Number(s.query.get('page') ?? 1);
      const all = [...issues.values()].filter((i) => (i.repo ?? REPO_WEB) === repo && i.updated >= since).sort((a, b) => a.updated - b.updated || a.n - b.n);
      const slice = all.slice((page - 1) * per, page * per);
      const headers: Record<string, string> = page * per < all.length ? { link: `<https://${TRACKER}/repos/${repo}/issues?page=${page + 1}>; rel="next"` } : {};
      return json(slice.map((i) => ({ ...issueOf(i), mention: i.comments.some((x) => x.mention && x.at >= since) })), 200, headers);
    }
    const one = /^\/issues\/(\d+)(\/comments)?$/.exec(rest);
    const issue = one ? issues.get(Number(one[1])) : undefined;
    if (!one || !issue || (issue.repo ?? REPO_WEB) !== repo) return notFound();
    if (s.method === 'GET') {
      const status = issue.read?.(c.now()) ?? 200;
      if (status === 410) return json({ message: 'This issue was deleted' }, 410);
      if (status !== 200) return json({ message: status === 404 ? 'Not Found' : 'Forbidden' }, status);
      return one[2] ? json(issue.comments.map((x) => commentOf(issue, x))) : json(issueOf(issue));
    }
    if (s.method === 'POST' && one[2]) {
      issue.onPost?.();
      if (issue.gone) return json({ message: 'This issue was deleted' }, 410);
      if (issue.locked) return json({ message: 'Unable to create comment because issue is locked.' }, 403);
      const next = issue.post?.shift();
      if (next !== undefined && next !== 201) return json({ message: 'Service Unavailable' }, next);
      const text = String(body(s).body ?? '');
      const x: TComment = { id: ++ids, author: 'you', body: text, at: c.now() };
      if (issue.keep !== false) {
        issue.comments.push(x);
        issue.updated = c.now();
      }
      if (issue.hold === 'hang') return 'hang';
      return json(commentOf(issue, x), 201);
    }
    return notFound();
  });
  return {
    p, issues,
    add: (i) => {
      const full: TIssue = { title: `Issue ${i.n}`, body: `The body of issue ${i.n}.`, author: 'you', comments: [], ...i };
      issues.set(i.n, full);
      return full;
    },
    comment: (n, x) => {
      const issue = issues.get(n)!;
      const full: TComment = { id: x.id ?? ++ids, ...x };
      issue.comments.push(full);
      issue.updated = Math.max(issue.updated, x.at);
      return full;
    },
    posts: (n) => p.seen.filter((s) => s.method === 'POST' && (n === undefined || s.path.endsWith(`/issues/${n}/comments`))),
    reads: (n) => p.seen.filter((s) => s.method === 'GET' && (s.path.endsWith(`/issues/${n}`) || s.path.endsWith(`/issues/${n}/comments`))),
  };
}
/** The send key a tracker comment carries, from the marker fixtures/tracker writes. */
export const markerIn = (text: string): string | null => /deepbuild-send:([^\s>]+)/.exec(text)?.[1] ?? null;

// ---- A chat app at api.chat.example (fixtures/chat reads it): a channel's threads and their replies.
export const CHAT = 'api.chat.example';
export interface ChatThread { ts: string; user: string; text: string; created: number; updated: number; replies: { id: number; user: string; text: string; key: string | null; at: number }[] }
export interface Chat { p: Provider; threads: Map<string, ChatThread>; replies(ts: string): { text: string; key: string | null }[] }
export async function chat(c: Clock): Promise<Chat> {
  const threads = new Map<string, ChatThread>();
  let ids = 1;
  const p = await provider(c, (s) => {
    const m = /^\/channels\/([\w-]+)\/threads(?:\/([\w.]+)(\/replies)?)?$/.exec(s.path);
    if (!m) return notFound();
    if (s.method === 'GET' && !m[2]) {
      const since = s.query.get('since') ? Date.parse(s.query.get('since')!) : 0;
      return json({ threads: [...threads.values()].filter((t) => t.updated >= since).map((t) => ({ ts: t.ts, created: iso(t.created), updated: iso(t.updated) })), next: null });
    }
    const t = threads.get(m[2]!);
    if (!t) return notFound();
    if (s.method === 'GET' && !m[3]) return json({ ts: t.ts, user: t.user, text: t.text, created: iso(t.created), updated: iso(t.updated), replies: t.replies.map((r) => ({ ...r, at: iso(r.at) })) });
    if (s.method === 'POST' && m[3]) {
      const b = body(s);
      const reply = { id: ++ids, user: 'deepbuild', text: String(b.text ?? ''), key: typeof b.key === 'string' ? b.key : null, at: c.now() };
      t.replies.push(reply);
      t.updated = c.now();
      return json({ id: reply.id });
    }
    return notFound();
  });
  return { p, threads, replies: (ts) => threads.get(ts)?.replies.map((r) => ({ text: r.text, key: r.key })) ?? [] };
}

// ---- Linear's GraphQL API at api.linear.app/graphql. The server reads each request's top-level fields (with their
// aliases and arguments, inline or by variable) and answers each with the whole object as Linear records it, so a
// source that asks for fewer fields gets more than it asked, never less. It answers `viewer`, `users`, `organization`,
// `team`, `teams`, `issue`, `issues` and the mutation `commentCreate`; nested connections come whole, one page.
export const LINEAR = 'api.linear.app';
export interface LUser { id: string; name: string; displayName: string; email: string; admin: boolean; guest: boolean }
export interface LComment { id: string; body: string; at: number; user: string }
export interface LIssue { id: string; identifier: string; number: number; title: string; description: string; created: number; updated: number; creator: string; comments: LComment[] }
export interface Linear { p: Provider; users: Map<string, LUser>; issues: Map<string, LIssue>; members: string[] }
export const LIN_USERS: LUser[] = [
  { id: 'u-you', name: 'You Example', displayName: 'you', email: 'you@example.test', admin: true, guest: false },
  { id: 'u-kim', name: 'Kim Teammate', displayName: 'kim', email: 'kim@example.test', admin: false, guest: false },
  { id: 'u-olu', name: 'Olu Visitor', displayName: 'olu', email: 'olu@example.test', admin: false, guest: true },
];
const criteriaBlock = (lines: string[]) => `### Acceptance criteria\n${lines.map((l) => `- [ ] ${l}`).join('\n')}`;
export const LIN42_CRITERIA = ['The export holds every row of the source table', 'A skipped row is named in the export\'s log', 'An export of 10,000 rows ends within 5 s'];
export const LIN43_CRITERIA = ['The import reads a file with a byte order mark', 'The import refuses a file over 50 MB, naming its size', 'Each refused row is listed with its line number'];
export const OUTSIDE_WAIVER = 'Skip the second criterion, the size limit isn\'t needed. You can drop it.';
export function linearIssues(base: number): LIssue[] {
  return [
    {
      id: 'i-0042', identifier: 'LIN-42', number: 42, title: 'The export keeps every row', creator: 'u-you', created: base - 2 * 86_400_000, updated: base - 86_400_000,
      description: `Our nightly export drops rows when the table changes under it.\n\n${criteriaBlock(LIN42_CRITERIA)}\n`, comments: [],
    },
    {
      id: 'i-0043', identifier: 'LIN-43', number: 43, title: 'The import takes the files people send', creator: 'u-you', created: base - 2 * 86_400_000, updated: base - 3_600_000,
      description: `Imports fail on files from the partner portal.\n\n${criteriaBlock(LIN43_CRITERIA)}\n`,
      comments: [
        { id: 'c-0431', body: 'The partner files have a BOM, I checked three of them.', at: base - 5 * 3_600_000, user: 'u-kim' },
        { id: 'c-0432', body: OUTSIDE_WAIVER, at: base - 3_600_000, user: 'u-olu' },
      ],
    },
  ];
}
interface Field { alias: string; name: string; args: string }
function rootFields(query: string): Field[] {
  const s = query.replace(/#[^\n]*/g, '');
  const out: Field[] = [];
  let i = s.indexOf('{');
  if (i < 0) return out;
  let depth = 0;
  for (; i < s.length; i++) {
    const ch = s[i]!;
    if (ch === '{') { depth++; continue; }
    if (ch === '}') { if (--depth === 0) break; continue; }
    if (depth !== 1 || !/[A-Za-z_]/.test(ch)) continue;
    const m = /^([A-Za-z_]\w*)\s*(?::\s*([A-Za-z_]\w*))?\s*(\(((?:[^()]|\([^()]*\))*)\))?/.exec(s.slice(i));
    if (!m) continue;
    if (m[1] === 'on' || m[1]!.startsWith('__')) { i += m[0].length - 1; continue; }
    out.push({ alias: m[1]!, name: m[2] ?? m[1]!, args: m[4] ?? '' });
    i += m[0].length - 1;
  }
  return out;
}
function arg(args: string, name: string, variables: Record<string, unknown>): unknown {
  const m = new RegExp(`\\b${name}\\s*:\\s*(\\$\\w+|"((?:[^"\\\\]|\\\\.)*)"|-?\\d+)`).exec(args);
  if (!m) return undefined;
  if (m[1]!.startsWith('$')) return variables[m[1]!.slice(1)];
  if (m[2] !== undefined) return m[2];
  return Number(m[1]);
}
export async function linear(c: Clock, base: number): Promise<Linear> {
  const users = new Map(LIN_USERS.map((u) => [u.id, u]));
  const issues = new Map(linearIssues(base).map((i) => [i.identifier, i]));
  const L: Linear = { p: undefined as unknown as Provider, users, issues, members: ['u-you', 'u-kim'] };
  let ids = 1;
  const userOf = (id: string) => { const u = users.get(id)!; return { ...u, active: true, isMe: id === 'u-you' }; };
  const team = () => ({
    id: 't-lin', key: 'LIN', name: 'Engineering',
    members: { nodes: L.members.map(userOf), pageInfo: { hasNextPage: false, endCursor: null } },
    memberships: { nodes: L.members.map((m) => ({ id: `tm-${m}`, owner: m === 'u-you', user: userOf(m) })), pageInfo: { hasNextPage: false, endCursor: null } },
  });
  const commentOf = (i: LIssue, x: LComment) => ({
    id: x.id, body: x.body, createdAt: iso(x.at), updatedAt: iso(x.at), url: `https://linear.app/acme/issue/${i.identifier}#comment-${x.id}`,
    user: userOf(x.user), issue: { id: i.id, identifier: i.identifier },
  });
  const issueOf = (i: LIssue) => ({
    id: i.id, identifier: i.identifier, number: i.number, title: i.title, description: i.description,
    url: `https://linear.app/acme/issue/${i.identifier}/${i.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
    createdAt: iso(i.created), updatedAt: iso(i.updated), archivedAt: null, state: { id: 's-todo', name: 'Todo', type: 'unstarted' },
    creator: userOf(i.creator), assignee: null, team: team(), labels: { nodes: [] }, project: null,
    comments: { nodes: i.comments.map((x) => commentOf(i, x)), pageInfo: { hasNextPage: false, endCursor: null } },
  });
  const find = (id: unknown) => [...issues.values()].find((i) => i.identifier === id || i.id === id);
  L.p = await provider(c, (s) => {
    if (s.method !== 'POST' || s.path !== '/graphql') return notFound();
    if (!s.headers.authorization) return json({ errors: [{ message: 'Authentication required, not authenticated', extensions: { code: 'AUTHENTICATION_ERROR' } }] }, 400);
    const b = body(s);
    const query = String(b.query ?? '');
    const variables = (typeof b.variables === 'object' && b.variables !== null ? b.variables : {}) as Record<string, unknown>;
    const data: Record<string, unknown> = {};
    const errors: unknown[] = [];
    for (const f of rootFields(query)) {
      if (f.name === 'viewer') data[f.alias] = userOf('u-you');
      else if (f.name === 'users') data[f.alias] = { nodes: [...users.keys()].map(userOf), pageInfo: { hasNextPage: false, endCursor: null } };
      else if (f.name === 'organization') data[f.alias] = { id: 'o-acme', name: 'Acme', urlKey: 'acme', users: { nodes: [...users.keys()].map(userOf) } };
      else if (f.name === 'team') data[f.alias] = ['LIN', 't-lin'].includes(String(arg(f.args, 'id', variables))) ? team() : null;
      else if (f.name === 'teams') data[f.alias] = { nodes: [team()], pageInfo: { hasNextPage: false, endCursor: null } };
      else if (f.name === 'issue') {
        const i = find(arg(f.args, 'id', variables));
        if (!i) errors.push({ message: 'Entity not found: Issue', path: [f.alias], extensions: { code: 'INPUT_ERROR' } });
        data[f.alias] = i ? issueOf(i) : null;
      } else if (f.name === 'issues') {
        const filter = f.args.replace(/\$(\w+)/g, (_, v: string) => JSON.stringify(variables[v] ?? null));
        const since = /updatedAt[^}]*?gte?\W+"?([0-9T:.\-Z]{10,})/.exec(filter)?.[1];
        const first = Number(arg(f.args, 'first', variables) ?? 50);
        const after = Number(arg(f.args, 'after', variables) ?? 0) || 0;
        const all = [...issues.values()].filter((i) => !since || i.updated >= Date.parse(since)).sort((a, b) => a.updated - b.updated);
        const nodes = all.slice(after, after + first).map(issueOf);
        const end = after + nodes.length;
        data[f.alias] = { nodes, edges: nodes.map((n, k) => ({ node: n, cursor: String(after + k + 1) })), pageInfo: { hasNextPage: end < all.length, endCursor: String(end) } };
      } else if (f.name === 'commentCreate') {
        const input = (arg(f.args, 'input', variables) ?? {}) as { issueId?: string; body?: string };
        const i = find(input.issueId);
        if (!i) { errors.push({ message: 'Entity not found: Issue', path: [f.alias] }); data[f.alias] = null; continue; }
        const x: LComment = { id: `c-new-${++ids}`, body: String(input.body ?? ''), at: c.now(), user: 'u-you' };
        i.comments.push(x);
        i.updated = c.now();
        data[f.alias] = { success: true, lastSyncId: ids, comment: commentOf(i, x) };
      } else data[f.alias] = null;
    }
    return json(errors.length ? { data, errors } : { data });
  });
  return L;
}

// ---- A Gmail-like mailbox at gmail.googleapis.com: the label `Label_7` ("deep") and its messages. It answers
// users.getProfile, users.labels.list, users.messages.list (labelIds, q with `after:<epoch seconds>`, pageToken,
// maxResults), users.messages.get, users.threads.get and users.messages.send; not users.history.
export const GMAIL = 'gmail.googleapis.com';
export const LABEL = 'Label_7';
export interface GMessage { id: string; threadId: string; labelIds: string[]; at: number; from: string; to: string; subject: string; text: string; headers?: Record<string, string> }
export interface Gmail { p: Provider; messages: Map<string, GMessage>; add(m: Partial<GMessage> & { id: string; at: number }): GMessage; sent(): GMessage[]; hold: { list?: Promise<void> } }
const rfc822 = (raw: string): { headers: Record<string, string>; text: string } => {
  const [head, ...rest] = raw.replace(/\r\n/g, '\n').split('\n\n');
  const headers: Record<string, string> = {};
  for (const line of (head ?? '').split('\n')) { const m = /^([\w-]+):\s*(.*)$/.exec(line); if (m) headers[m[1]!.toLowerCase()] = m[2]!; }
  return { headers, text: rest.join('\n\n') };
};
export async function gmail(c: Clock): Promise<Gmail> {
  const messages = new Map<string, GMessage>();
  let ids = 9000;
  const G: Gmail = { p: undefined as unknown as Provider, messages, add: undefined as unknown as Gmail['add'], sent: () => [...messages.values()].filter((m) => m.labelIds.includes('SENT')), hold: {} };
  const full = (m: GMessage) => ({
    id: m.id, threadId: m.threadId, labelIds: m.labelIds, snippet: m.text.slice(0, 100), historyId: String(m.at), internalDate: String(m.at), sizeEstimate: m.text.length,
    payload: {
      mimeType: 'text/plain', filename: '',
      headers: [
        { name: 'From', value: m.from }, { name: 'To', value: m.to }, { name: 'Subject', value: m.subject }, { name: 'Date', value: new Date(m.at).toUTCString() },
        { name: 'Message-ID', value: `<${m.id}@mail.example.test>` }, ...Object.entries(m.headers ?? {}).map(([name, value]) => ({ name, value })),
      ],
      body: { size: m.text.length, data: b64url(m.text) },
    },
  });
  G.add = (m) => {
    const msg: GMessage = { threadId: `t-${m.id}`, labelIds: ['INBOX', LABEL], from: 'Ana Client <ana@client.example.test>', to: 'you@example.test', subject: `Request ${m.id}`, text: `Please look at ${m.id}.`, ...m };
    messages.set(msg.id, msg);
    return msg;
  };
  G.p = await provider(c, async (s) => {
    if (!s.headers.authorization) return json({ error: { code: 401, message: 'Request is missing required authentication credential.' } }, 401);
    const p = s.path.replace(/^\/gmail\/v1\/users\/me/, '');
    if (s.method === 'GET' && p === '/profile') return json({ emailAddress: 'you@example.test', messagesTotal: messages.size, threadsTotal: messages.size, historyId: String(c.now()) });
    if (s.method === 'GET' && p === '/labels') return json({ labels: [{ id: LABEL, name: 'deep', type: 'user' }, { id: 'INBOX', name: 'INBOX', type: 'system' }, { id: 'SENT', name: 'SENT', type: 'system' }] });
    if (s.method === 'GET' && p === '/messages') {
      if (G.hold.list) await G.hold.list;
      const labels = s.query.getAll('labelIds');
      const after = /after:(\d+)/.exec(s.query.get('q') ?? '')?.[1];
      const max = Math.min(Number(s.query.get('maxResults') ?? 100), 500);
      const from = Number(s.query.get('pageToken') ?? 0);
      const all = [...messages.values()].filter((m) => labels.every((l) => m.labelIds.includes(l)) && (!after || m.at >= Number(after) * 1000)).sort((a, b) => b.at - a.at);
      const page = all.slice(from, from + max);
      return json({ messages: page.map((m) => ({ id: m.id, threadId: m.threadId })), ...(from + max < all.length ? { nextPageToken: String(from + max) } : {}), resultSizeEstimate: all.length });
    }
    const one = /^\/messages\/([\w-]+)$/.exec(p);
    if (s.method === 'GET' && one) { const m = messages.get(one[1]!); return m ? json(full(m)) : json({ error: { code: 404, message: 'Requested entity was not found.' } }, 404); }
    const thread = /^\/threads\/([\w-]+)$/.exec(p);
    if (s.method === 'GET' && thread) {
      const ms = [...messages.values()].filter((m) => m.threadId === thread[1]).sort((a, b) => a.at - b.at);
      return ms.length ? json({ id: thread[1], historyId: String(c.now()), messages: ms.map(full) }) : json({ error: { code: 404, message: 'Requested entity was not found.' } }, 404);
    }
    if (s.method === 'POST' && p === '/messages/send') {
      const b = body(s);
      const { headers, text } = rfc822(unb64(String(b.raw ?? '')));
      const id = `s${++ids}`;
      const m: GMessage = { id, threadId: typeof b.threadId === 'string' ? b.threadId : `t-${id}`, labelIds: ['SENT'], at: c.now(), from: headers.from ?? 'you@example.test', to: headers.to ?? '', subject: headers.subject ?? '', text, headers };
      messages.set(id, m);
      return json({ id, threadId: m.threadId, labelIds: m.labelIds });
    }
    return json({ error: { code: 404, message: 'Not Found' } }, 404);
  });
  return G;
}
