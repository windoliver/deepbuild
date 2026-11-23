// Criterion 2: before each deep_claim and deep_show call in AC2, the Codex stand-in sends a PreToolUse with tool_name
// mcp__deep__<tool> and a tool_input equal to the arguments that call then sends; a stand-in whose stamp carries other arguments is
// refused unbound, and the failure names the call. Read through the #806 suite's own world (figure.ts's openFigures and showFigure,
// helpers.ts's Stand) against a real hub: what the stand-in sends is read where it leaves the stand-in (Stand.hook and Stand.request),
// and what each call binds to is read from the hub's answers and its record.
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, Stand, t26, t393, type Line } from '../806/helpers.ts';
import { CODEX, openFigures, sessionId, showFigure } from '../806/figure.ts';

afterEach(cleanup, 60_000);

type Sent = { kind: 'hook'; event: string; extra: Line } | { kind: 'call'; tool: string; args: Line };
/** Everything the Codex stand-in sends, in order: its hooks with their fields, and its tools/call requests with their arguments. */
function listen(stand: Stand): Sent[] {
  const sent: Sent[] = [];
  const hook = stand.hook.bind(stand);
  const request = stand.request.bind(stand);
  stand.hook = (hub, event, extra = {}) => { sent.push({ kind: 'hook', event, extra: structuredClone(extra) }); return hook(hub, event, extra); };
  stand.request = (method, params = {}, timeoutMs) => {
    if (method === 'tools/call') sent.push({ kind: 'call', tool: String(params.name), args: structuredClone((params.arguments ?? {}) as Line) });
    return request(method, params, timeoutMs);
  };
  return sent;
}
const codeOf = (o: t26.Outcome): string | undefined => (o.isError && typeof o.value === 'object' && o.value !== null ? String((o.value as Line).code) : undefined);
const text = (v: unknown): string => JSON.stringify(v).slice(0, 600);

describe('#1176 criterion 2: the Codex stand-in stamps each AC2 call with the call itself', () => {
  it('#1176.56faa14e before each deep_claim and deep_show of AC2 the Codex stand-in sends PreToolUse for mcp__deep__<tool> with the call\'s arguments, and a stamp with other arguments is refused unbound, naming the call', async () => {
    const f = await openFigures({ app: false });
    const stand = f.stands.get(CODEX.label)!;
    const hub = f.hub;
    const sent = listen(stand);

    // AC2's calls, as every AC2 test makes them.
    const shown = await showFigure(f, CODEX, t393.DOC.a);
    const calls = sent.flatMap((s, i) => (s.kind === 'call' ? [{ s, i }] : []));
    expect(calls.map(({ s }) => s.kind === 'call' && s.tool), 'AC2\'s showFigure calls deep_claim, then deep_show').toEqual(['deep_claim', 'deep_show']);
    for (const { s, i } of calls) {
      if (s.kind !== 'call') continue;
      const prior = sent.slice(0, i).reverse().find((p) => p.kind === 'hook');
      expect(prior?.kind === 'hook' ? prior.event : undefined, `the stand-in's last hook before its ${s.tool} call is a PreToolUse: ${text(prior)}`).toBe('PreToolUse');
      const stamp = prior?.kind === 'hook' ? prior.extra : {};
      expect(stamp['tool_name'], `the PreToolUse before ${s.tool} names mcp__deep__${s.tool}`).toBe(`mcp__deep__${s.tool}`);
      expect(stamp['tool_input'], `the PreToolUse before ${s.tool} carries the arguments the call then sends`).toEqual(s.args);
    }
    // ... and the hub binds both to the Codex session by those stamps: its claim is filed as that session, its deep_show acts for it.
    const claimArgs = calls[0]!.s.kind === 'call' ? calls[0]!.s.args : {};
    const filed = t26.claimsFor(await t26.events(hub), String(claimArgs['task_ref']));
    expect(filed.map((e) => e.session), `the stamped deep_claim is filed as the Codex session (claim ${shown.claim})`).toEqual([sessionId(CODEX)]);
    expect([shown.reply['outcome'], shown.reply['code']], `the stamped deep_show is presented for the Codex session, not refused: ${text(shown.reply)}`).toEqual(['presented', undefined]);

    // A stand-in whose stamp carries other arguments than its call: refused unbound, the refusal naming deep_claim.
    const sends = t26.claimArgs();
    await stand.stamp(hub, 'deep_claim', t26.claimArgs());
    const other = await t26.callTool(stand, 'deep_claim', sends);
    expect(codeOf(other), `deep_claim under a stamp for other arguments binds to no session: ${text(other.reply)}`).toBe('unbound');
    expect(text(other.value), 'the refusal names the call').toContain('deep_claim');
    expect(t26.claimsFor(await t26.events(hub), String(sends['task_ref'])), 'and nothing is filed for it').toEqual([]);

    // A stamp with the call's arguments under another tool's name doesn't bind it either.
    const named = t26.claimArgs();
    await stand.stamp(hub, 'deep_show', named);
    const misnamed = await t26.callTool(stand, 'deep_claim', named);
    expect(codeOf(misnamed), `deep_claim under a stamp naming mcp__deep__deep_show binds to no session: ${text(misnamed.reply)}`).toBe('unbound');

    // The control: the same stand-in, stamping the very arguments it sends, is filed.
    const same = t26.claimArgs();
    await stand.stamp(hub, 'deep_claim', same);
    const bound = await t26.callTool(stand, 'deep_claim', same);
    expect(codeOf(bound), `deep_claim under a stamp for its own arguments binds: ${text(bound.reply)}`).toBeUndefined();
    expect(t26.claimsFor(await t26.events(hub), String(same['task_ref'])).map((e) => e.session), 'and is filed as the Codex session').toEqual([sessionId(CODEX)]);
  }, 600_000);
});
