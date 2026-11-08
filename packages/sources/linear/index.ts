// The Linear work source (#66): a team's issues as work items, read through Linear's GraphQL API by the hub, with your
// API key by handle. The scope is a team key (LIN); an item is an issue, its ID the issue's identifier (LIN-42), and
// each comment is a reading of its own. An author's role comes from the team's membership record, never from the
// text: a member who owns the team, or an admin, reads owner, any other member collaborator, anyone else outside.
// The acceptance criteria are the `- [ ]` lines under the description's `### Acceptance criteria` heading. A delivery
// is a comment on the issue carrying its send key as a marker, which the next read skips.
interface Answer { status: number; headers: Record<string, string>; body: string }
interface Ctx { fetch(r: { method: string; path: string; headers?: Record<string, string>; body?: string }): Promise<Answer> }
interface User { id: string; displayName: string; admin?: boolean }

const MARK = /deepbuild-send:([A-Za-z0-9_-]+)/;
const ISSUE = `id identifier title description url createdAt updatedAt
  team { id key memberships { nodes { owner user { id } } } }
  creator { id displayName admin }
  comments { nodes { id body createdAt updatedAt url user { id displayName admin } } }`;

async function gql(ctx: Ctx, query: string, variables: Record<string, unknown>): Promise<any> {
  const a = await ctx.fetch({ method: 'POST', path: '/graphql', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }) });
  if (a.status !== 200) throw Error(`Linear answered ${a.status}`);
  return JSON.parse(a.body);
}
function criteriaOf(body: string): string[] {
  const m = /^#+\s*acceptance criteria\s*$([\s\S]*?)(?=^#+\s|(?![\s\S]))/im.exec(body ?? '');
  return m ? [...m[1]!.matchAll(/^\s*- \[[ xX]\] (.+)$/gm)].map(([, t]) => t!.trim()).filter(Boolean) : [];
}
/** An issue by its identifier, or null when Linear holds none. */
async function issueOf(ctx: Ctx, id: string): Promise<any> {
  const r = await gql(ctx, `query Issue($id: String!) { issue(id: $id) { ${ISSUE} } }`, { id });
  return r.data?.issue ?? null;
}

export default async function (deep: any): Promise<void> {
  const secret = await deep.secret('linear_key');
  await deep.registerSource('ext.linear.issues', {
    variant: 'stream',
    host: 'api.linear.app',
    secret,
    header: 'Authorization',
    quota: { per_minute: 60, per_day: 20_000 },
    delivers: 'comment',
    // source@1's read, for the kit's own stream at install.
    read(stream: { events: unknown[] }, cursor: string | null, limit: number) {
      const start = cursor === null ? 0 : Number(cursor);
      const events = stream.events.slice(start, start + limit);
      return { events, cursor: String(start + events.length) };
    },
    async list(ctx: Ctx, q: { scope: string; since: string; cursor: string | null; limit: number }) {
      const r = await gql(ctx, `query Issues($team: String!, $first: Int, $after: String, $since: DateTimeOrDuration) {
        issues(first: $first, after: $after, filter: { team: { key: { eq: $team } }, updatedAt: { gte: $since } }) {
          nodes { identifier createdAt updatedAt team { key } } pageInfo { hasNextPage endCursor } } }`, { team: q.scope, first: q.limit, after: q.cursor, since: q.since });
      const c = r.data?.issues;
      if (!c) throw Error(`Linear gave no issues: ${JSON.stringify(r.errors ?? null).slice(0, 300)}`);
      return {
        items: c.nodes.map((i: any) => ({ id: i.identifier, scope: i.team?.key ?? '', created: i.createdAt, updated: i.updatedAt, mention: false })),
        cursor: c.pageInfo?.hasNextPage ? c.pageInfo.endCursor : null,
      };
    },
    async item(ctx: Ctx, q: { scope: string; id: string }) {
      const i = await issueOf(ctx, q.id);
      if (!i) return { failed: 'not found' };
      const members = new Map<string, boolean>((i.team?.memberships?.nodes ?? []).map((m: any) => [m.user?.id, m.owner === true]));
      const author = (u: User | null) => {
        if (!u) return { handle: 'unknown', role: 'outside' };
        if (!members.has(u.id)) return { handle: u.displayName, role: 'outside' };
        return { handle: u.displayName, role: members.get(u.id) || u.admin === true ? 'owner' : 'collaborator' };
      };
      const body = i.description || '-';
      return {
        events: [
          {
            id: `${i.identifier}@${i.updatedAt}`, kind: 'item', at: i.updatedAt, marker: null, mention: false,
            data: { source_id: i.identifier, link: i.url, title: i.title, body, criteria: criteriaOf(body), authors: [author(i.creator)], updated: i.updatedAt },
          },
          ...(i.comments?.nodes ?? []).map((c: any) => ({
            id: `${c.id}@${c.updatedAt}`, kind: 'comment', at: c.updatedAt, marker: MARK.exec(c.body ?? '')?.[1] ?? null, mention: false,
            data: { source_id: `${i.identifier}.${c.id}`, link: c.url, title: i.title, body: c.body || '-', criteria: [], authors: [author(c.user)], updated: c.updatedAt },
          })),
        ],
      };
    },
    async deliver(ctx: Ctx, d: { scope: string; id: string; key: string; text: string }) {
      const i = await issueOf(ctx, d.id);
      if (!i) return { outcome: 'gone', why: `Linear holds no issue ${d.id}: it was deleted` };
      const r = await gql(ctx, 'mutation Comment($input: CommentCreateInput!) { commentCreate(input: $input) { success comment { id } } }', { input: { issueId: i.id, body: `${d.text}\n\n<!-- deepbuild-send:${d.key} -->` } });
      if (r.data?.commentCreate?.success === true) return { outcome: 'sent' };
      throw Error(`Linear didn't take the comment: ${JSON.stringify(r.errors ?? null).slice(0, 300)}`);
    },
    async find(ctx: Ctx, d: { scope: string; id: string; key: string }) {
      const i = await issueOf(ctx, d.id);
      if (!i) return false;
      return (i.comments?.nodes ?? []).some((c: any) => MARK.exec(c.body ?? '')?.[1] === d.key);
    },
  });
}
