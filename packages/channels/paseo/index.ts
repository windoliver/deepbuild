// The paseo channel (#65): paseo's relay to your phone, whose app signs each answer with the phone's paired key, and
// draws a plan's steps, so a card with a plan reaches it with its steps, its hash and buttons (#1580). It only transports. Its provider calls are the hub's (ctx.fetch, which holds
// the call to this channel's api and adds any token), and each answer's proof is passed on unchanged for the hub to
// check: POST /messages delivers an item, acknowledged by the provider; GET /answers reads what you answered or saw.
// The same protocol as packages/channels/{paseo,chat,email,text}, each a package of its own, installed alone.
type Reply = { status: number; body: any };
type Ctx = { settings: Record<string, unknown>; fetch(request: { method: 'GET' | 'POST'; path: string; body?: unknown }): Promise<Reply> };
let cursor: string | undefined;
const said = (reply: Reply): string | undefined => (reply.status === 409 ? String(reply.body?.conflict ?? 'another client holds this account') : undefined);

export default function (deep: any): void {
  void deep.registerChannel('paseo', {
    slot: 'channel@1', revision: 1, kind: 'device', steps: true,
    async deliver(item: unknown, ctx: Ctx) {
      let reply: Reply;
      try {
        reply = await ctx.fetch({ method: 'POST', path: '/messages', body: { to: ctx.settings.to ?? null, item } });
      } catch {
        return { outcome: 'timed_out' };
      }
      const conflict = said(reply);
      if (conflict) return { outcome: 'conflict', conflict };
      const ack = reply.body?.ack;
      return reply.status === 200 && typeof ack === 'string' && ack ? { outcome: 'delivered', ack } : { outcome: 'stalled' };
    },
    async receive(ctx: Ctx) {
      const reply = await ctx.fetch({ method: 'GET', path: cursor === undefined ? '/answers' : `/answers?after=${encodeURIComponent(cursor)}` });
      const conflict = said(reply);
      if (conflict) return { answers: [], seen: [], conflict };
      if (reply.status !== 200) return { answers: [], seen: [], conflict: null };
      const body = reply.body ?? {};
      if (typeof body.cursor === 'string') cursor = body.cursor;
      const answers = (Array.isArray(body.answers) ? body.answers : []).map((a: any) => ({
        thread_key: String(a?.thread_key ?? ''), answer: String(a?.answer ?? ''),
        ...(a?.signature !== undefined ? { signature: a.signature } : {}),
        ...(typeof a?.account === 'string' ? { account_link_id: a.account } : {}),
      }));
      return { answers, seen: Array.isArray(body.seen) ? body.seen.map(String) : [], conflict: null };
    },
  });
}
