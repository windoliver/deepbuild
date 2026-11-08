// The Gmail label work source (#66): each email in a label you name is a work item, read through the Gmail API by the
// hub, with your OAuth token by handle. The scope is a label ID (Label_7); an item is a message, its ID the message
// ID, and its link holds its thread; the other messages in the thread are its comments. The sender of an email you
// sent reads owner, anyone else outside, since a mailbox has no membership record. The acceptance criteria are the
// `- [ ]` lines under an `### Acceptance criteria` heading in the text. A delivery is a reply in the thread to the
// sender, carrying its send key in an X-DeepBuild-Send header the message keeps, which the next read skips.
interface Answer { status: number; headers: Record<string, string>; body: string }
interface Ctx { fetch(r: { method: string; path: string; headers?: Record<string, string>; body?: string }): Promise<Answer> }

const API = '/gmail/v1/users/me';
const MARK = 'x-deepbuild-send';

async function get(ctx: Ctx, path: string): Promise<{ status: number; json: any }> {
  const a = await ctx.fetch({ method: 'GET', path: `${API}${path}` });
  let json: any = null;
  try { json = JSON.parse(a.body); } catch { json = null; }
  return { status: a.status, json };
}
const header = (m: any, name: string): string => (m.payload?.headers ?? []).find((h: any) => String(h.name).toLowerCase() === name)?.value ?? '';
const address = (from: string): string => (/<([^>]+)>/.exec(from)?.[1] ?? from).trim().toLowerCase();
const decode = (data: string): string => Buffer.from(data.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');
/** The message's plain text: its body, or its first text/plain part. */
function textOf(part: any): string {
  if (part?.mimeType === 'text/plain' && part.body?.data) return decode(part.body.data);
  for (const p of part?.parts ?? []) {
    const t = textOf(p);
    if (t) return t;
  }
  return part?.body?.data ? decode(part.body.data) : '';
}
function criteriaOf(body: string): string[] {
  const m = /^#+\s*acceptance criteria\s*$([\s\S]*?)(?=^#+\s|(?![\s\S]))/im.exec(body ?? '');
  return m ? [...m[1]!.matchAll(/^\s*- \[[ xX]\] (.+)$/gm)].map(([, t]) => t!.trim()).filter(Boolean) : [];
}
const iso = (internalDate: string): string => new Date(Number(internalDate)).toISOString();
const link = (thread: string): string => `https://mail.google.com/mail/u/0/#all/${thread}`;

export default async function (deep: any): Promise<void> {
  const secret = await deep.secret('gmail_token');
  await deep.registerSource('ext.gmail.label', {
    variant: 'stream',
    host: 'gmail.googleapis.com',
    secret,
    bearer: true,
    quota: { per_minute: 120, per_day: 50_000 },
    delivers: 'email',
    // source@1's read, for the kit's own stream at install.
    read(stream: { events: unknown[] }, cursor: string | null, limit: number) {
      const start = cursor === null ? 0 : Number(cursor);
      const events = stream.events.slice(start, start + limit);
      return { events, cursor: String(start + events.length) };
    },
    async list(ctx: Ctx, q: { scope: string; since: string; cursor: string | null; limit: number }) {
      const after = Math.floor(Date.parse(q.since) / 1000);
      const r = await get(ctx, `/messages?labelIds=${encodeURIComponent(q.scope)}&q=${encodeURIComponent(`after:${after}`)}&maxResults=${q.limit}${q.cursor ? `&pageToken=${encodeURIComponent(q.cursor)}` : ''}`);
      if (r.status !== 200) throw Error(`Gmail answered ${r.status} to the list`);
      const items = [];
      // The list names messages only: each one's time comes from its metadata.
      for (const m of r.json?.messages ?? []) {
        const one = await get(ctx, `/messages/${m.id}?format=minimal`);
        if (one.status !== 200) continue;
        if (!(one.json.labelIds ?? []).includes(q.scope)) items.push({ id: m.id, scope: '', created: iso(one.json.internalDate), updated: iso(one.json.internalDate), mention: false });
        else items.push({ id: m.id, scope: q.scope, created: iso(one.json.internalDate), updated: iso(one.json.internalDate), mention: false });
      }
      return { items, cursor: r.json?.nextPageToken ?? null };
    },
    async item(ctx: Ctx, q: { scope: string; id: string }) {
      const m = await get(ctx, `/messages/${q.id}`);
      if (m.status === 404) return { failed: 'not found', status: 404 };
      if (m.status === 403) return { failed: 'forbidden', status: 403 };
      if (m.status !== 200) return { failed: 'error', status: m.status };
      const me = await get(ctx, '/profile');
      if (me.status !== 200) return { failed: 'error', status: me.status };
      const mine = String(me.json?.emailAddress ?? '').toLowerCase();
      const thread = await get(ctx, `/threads/${m.json.threadId}`);
      const all: any[] = thread.status === 200 ? thread.json.messages ?? [] : [m.json];
      const subject = header(m.json, 'subject');
      const reading = (x: any) => {
        const body = textOf(x.payload) || '-';
        const from = address(header(x, 'from'));
        return {
          source_id: x.id, link: link(x.threadId), title: header(x, 'subject') || subject, body, criteria: x.id === q.id ? criteriaOf(body) : [],
          authors: [{ handle: from, role: from === mine ? 'owner' : 'outside' }], updated: iso(x.internalDate),
        };
      };
      return {
        events: all.map((x) => ({
          id: x.id, kind: x.id === q.id ? 'item' : 'comment', at: iso(x.internalDate), marker: header(x, MARK) || null, mention: false, data: reading(x),
        })),
      };
    },
    async deliver(ctx: Ctx, d: { scope: string; id: string; key: string; text: string }) {
      const m = await get(ctx, `/messages/${d.id}`);
      if (m.status === 404) return { outcome: 'gone', why: `the email ${d.id} was deleted` };
      if (m.status !== 200) throw Error(`Gmail answered ${m.status}`);
      const subject = header(m.json, 'subject');
      const id = header(m.json, 'message-id');
      const raw = [
        `To: ${header(m.json, 'reply-to') || header(m.json, 'from')}`,
        `Subject: ${/^re:/i.test(subject) ? subject : `Re: ${subject}`}`,
        ...(id ? [`In-Reply-To: ${id}`, `References: ${id}`] : []),
        `X-DeepBuild-Send: ${d.key}`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        d.text,
      ].join('\r\n');
      const a = await ctx.fetch({
        method: 'POST', path: `${API}/messages/send`, headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ raw: Buffer.from(raw, 'utf8').toString('base64url'), threadId: m.json.threadId }),
      });
      if (a.status === 200) return { outcome: 'sent' };
      throw Error(`Gmail answered ${a.status}`);
    },
    async find(ctx: Ctx, d: { scope: string; id: string; key: string }) {
      const m = await get(ctx, `/messages/${d.id}`);
      if (m.status !== 200) return false;
      const t = await get(ctx, `/threads/${m.json.threadId}`);
      if (t.status !== 200) throw Error(`Gmail answered ${t.status}`);
      return (t.json.messages ?? []).some((x: any) => header(x, MARK) === d.key);
    },
  });
}
