// AC1 #999.1bb7a56d, after its semicolon: with the link cut for 5 minutes mid-session, its events arrive once and in
// order after the link returns, and its row reads unknown meanwhile.
//
// "Reads unknown" is the owner's ruling (README, The owner's ruling): the row's word is `quiet`, its why says the link
// to that host is down and since when, and it never reads `finished`, nor is the session ended or gone. The five
// minutes pass on the hub's own clock (README, The five minutes): the link is cut for real, the session's hooks go on
// running on the host, and the hub's clock is stepped 300 000 ms while it is down.
//
// The first test is the criterion's scene. The second holds a wrong program apart: a hub that takes the host's name
// from what the request carries, not from the link it arrived on.
import { randomBytes } from 'node:crypto';
import net from 'node:net';
import { afterEach, describe, expect, test } from 'vitest';
import { AC, bound, cleanup, decision, hostAdd, hostOf, HostSession, isRow, LIMIT, norm, openWorld, parseObject, PROMPT, proof, rowOf, shown, statusRows, type Called, type Ev, type Line, type World } from './helpers.ts';

afterEach(cleanup, 900_000);

/** Whether a row's why says the link to the host is down. */
const saysDown = (w: World, why: unknown): boolean => typeof why === 'string' && why.includes(w.alias) && /\blink\b/i.test(why) && /\bdown\b/i.test(why);
/**
 * What's wrong with the session's row while the link is down, in words; nothing when it reads as the ruling says.
 * `floor` is a minute before the last hook the hub had from the host before the cut, and `now` the hub's clock.
 */
function downRow(w: World, row: Line | undefined, floor: number, now: number): string[] {
  if (!row) return ['deep status --json lists no row for the session'];
  const out: string[] = [];
  if (row.word !== 'quiet') out.push(`its word is ${JSON.stringify(row.word)}, not quiet`);
  if (!saysDown(w, row.why)) out.push(`its why, ${JSON.stringify(row.why)}, doesn't say the link to ${w.alias} is down`);
  if (typeof row.since !== 'number' || row.since < floor || row.since > now) out.push(`its since, ${JSON.stringify(row.since)}, isn't a time from the last hook the hub had from ${w.alias} (${floor}, less a minute) to now on the hub's clock (${now})`);
  return out;
}
/** The hub's clock now, in ms, stepped `ms` forward first (test.clock, #965's). */
const hubClock = async (w: World, ms = 0): Promise<number> => Number((await w.log.call('test.clock', { advance_ms: ms })).now);

/** A hook request line handed to the hub on its own socket here, after its hello: the first line it answers with. */
function hand(socket: string, request: string): Promise<Line | undefined> {
  return new Promise((resolve) => {
    const sock = net.connect(socket);
    let buffer = '';
    let lines = 0;
    const done = (answer: Line | undefined): void => { sock.destroy(); resolve(answer); };
    sock.setEncoding('utf8').on('data', (chunk: string) => {
      buffer += chunk;
      for (let i = buffer.indexOf('\n'); i >= 0; i = buffer.indexOf('\n')) {
        const line = buffer.slice(0, i);
        buffer = buffer.slice(i + 1);
        lines += 1;
        if (lines === 1) sock.write(`${request}\n`);
        else return done(parseObject(line));
      }
    });
    sock.on('error', () => done(undefined));
    sock.on('close', () => done(undefined));
    void bound(30_000).then(() => done(undefined));
  });
}

describe(AC[1], () => {
  test('with the link cut mid-session and five minutes passing on the hub\'s clock, the session\'s hooks are let through on the host, its row reads quiet with the link down and never finished, and after the link returns its events arrive once and in order', async () => {
    const w = await openWorld();
    await hostAdd(w);
    const s = await HostSession.open(w);
    await s.start();
    await s.typed(PROMPT);
    const up = await s.bash('cat price.txt');
    expect(up.after, `before the cut, the session's call on ${w.alias} is let through and recorded: ${w.redact(shown(up.before))}`).not.toBeNull();
    const lastHook = w.log.events.findLast((e) => e.session === s.id && e.kind === 'tool.after')!;
    const cutPos = w.log.events.at(-1)!.log_pos;

    // The link is cut: every connection the hub holds to the host closes, and each new one closes as it arrives.
    const held = w.relay.cut();
    expect(held, `the hub holds a connection to ${w.alias} through the Port your SSH config names while the session records: the SSH link that forwards the hooks' socket`).toBeGreaterThan(0);
    // The session goes on: four calls, then five minutes on the hub's clock, then two more.
    const calls: Called[] = [];
    for (let i = 1; i <= 4; i++) calls.push(await s.bash(`echo step ${i}`, false));
    const quiet = await w.log.until((events) => events.some((e) => e.log_pos > cutPos && isRow(e, s) && e.data.word === 'quiet'), 180_000);
    const soon = downRow(w, rowOf(await statusRows(w), s), lastHook.ts - 60_000, await hubClock(w));
    const stepped = await hubClock(w, 300_000);
    const later = downRow(w, rowOf(await statusRows(w), s), lastHook.ts - 60_000, stepped);
    for (let i = 5; i <= 6; i++) calls.push(await s.bash(`echo step ${i}`, false));

    // What the hub's record holds of the session since the cut, before the link returns.
    const ids = new Set(calls.map((c) => c.id));
    const ofCut = (e: Ev): boolean => e.session === s.id && (e.kind === 'tool.before' || e.kind === 'tool.after') && ids.has(String(e.data.call));
    const during = w.log.events.filter((e) => e.log_pos > cutPos);
    if (during.some(ofCut)) throw Error(`BLOCKED: with the relay cut, ${during.filter(ofCut).length} of the session's events reached the hub: the relay isn't its only way to ${w.alias}`);
    const rows = during.filter((e) => isRow(e, s));
    const firstQuiet = rows.findIndex((e) => e.data.word === 'quiet');
    const sinceQuiet = firstQuiet < 0 ? [] : rows.slice(firstQuiet);
    const ended = during.filter((e) => (e.kind === 'session.end' || e.kind === 'session.gone') && (e.session === s.id || norm(e.subject) === `session${norm(s.id)}`));

    // The link returns.
    const restorePos = w.log.events.at(-1)!.log_pos;
    w.relay.restore();
    const wanted = calls.flatMap((c) => [`tool.before ${c.id}`, `tool.after ${c.id}`]);
    const arrived = await w.log.until((events) => wanted.every((want) => events.some((e) => ofCut(e) && `${e.kind} ${String(e.data.call)}` === want)), 600_000);
    // A later hook of the session, recorded live: whatever the host's spool held was replayed by then.
    const back = arrived ? await s.bash('echo back') : undefined;
    const got = w.log.events.filter(ofCut);
    const upAgain = await w.log.until((events) => { const last = events.findLast((e) => isRow(e, s)); return last !== undefined && last.log_pos > restorePos && !saysDown(w, last.data.why); }, arrived ? 120_000 : 1);
    const after = rowOf(await statusRows(w), s);
    proof(w, 'ac1-cut.json', {
      host: w.alias, session: s.id, connections_cut: held, connections_refused_while_cut: w.relay.refused,
      hooks_while_cut: calls.map((c) => ({ call: c.id, before: c.before.code, after: c.after?.code ?? null })),
      row_while_cut: { at_once: soon, after_five_minutes: later, rows: rows.map((e) => ({ log_pos: e.log_pos, listed: e.data.listed, word: e.data.word, why: e.data.why, since: e.data.since })) },
      replayed: got.map((e) => ({ kind: e.kind, call: e.data.call, log_pos: e.log_pos, seq: e.seq, host: hostOf(e) ?? null })), row_after: after,
    });

    // While the link is down, deep-hook on the host fails open: every call is let through.
    expect.soft(calls.filter((c) => decision(c.before) !== 'allow' || c.after?.code !== 0).map((c) => w.redact(`${c.id}: PreToolUse ${shown(c.before)}${c.after ? `; PostToolUse ${shown(c.after)}` : ''}`)), `with the link down, each of the session's calls on ${w.alias} is let through, its hooks ending with exit 0`).toEqual([]);
    // Its row reads unknown meanwhile, never finished.
    expect.soft(quiet, `once the link is cut, the session's row is set to quiet in the record (row.set); its rows since the cut read ${JSON.stringify(rows.map((e) => e.data.word))}`).toBe(true);
    expect.soft(soon, 'while the link is down, the session\'s row in deep status --json reads quiet, and its why says the link to the host is down and since when').toEqual([]);
    expect.soft(later, 'five minutes on, on the hub\'s clock, the row still reads so').toEqual([]);
    expect.soft(sinceQuiet.filter((e) => e.data.listed === false || e.data.word !== 'quiet').map((e) => `log_pos ${e.log_pos}: ${e.data.listed === false ? 'left the list' : JSON.stringify(e.data.word)}`), 'from its first quiet row until the link returns, the session\'s row reads nothing else').toEqual([]);
    expect.soft(rows.filter((e) => e.data.listed === false || e.data.word === 'finished').map((e) => `log_pos ${e.log_pos}: ${e.data.listed === false ? 'left the list' : 'finished'}`), 'the session\'s row never reads finished, nor leaves the list, because of the cut').toEqual([]);
    expect.soft(ended.map((e) => `${e.kind} at log_pos ${e.log_pos}`), 'the session is neither ended nor gone in the record because of the cut').toEqual([]);
    // Its events arrive once and in order after the link returns.
    expect.soft(got.map((e) => `${e.kind} ${String(e.data.call)}`), `after the link returns, each hook the session ran on ${w.alias} while it was down is in the record once, in the order they ran${arrived ? '' : ' (10 minutes after the link returned, some were still missing)'}`).toEqual(wanted);
    expect.soft(got.filter((e) => e.log_pos <= restorePos || (back !== undefined && e.log_pos >= w.log.events.find((x) => x.kind === 'tool.before' && x.data.call === back.id)!.log_pos)).map((e) => `${e.kind} at log_pos ${e.log_pos}`), 'they arrive after the link returns, and before the session\'s next hook').toEqual([]);
    expect.soft(got.filter((e, i) => typeof e.seq !== 'string' || (i > 0 && BigInt(e.seq) <= BigInt(got[i - 1]!.seq ?? '0'))).map((e) => `${e.kind} at log_pos ${e.log_pos} has seq ${String(e.seq)}`), 'each keeps the stamp its hook took on the host, rising in the record\'s order').toEqual([]);
    expect.soft(got.filter((e) => hostOf(e) !== w.alias).map((e) => `${e.kind} at log_pos ${e.log_pos} carries ${JSON.stringify(hostOf(e) ?? null)}`), `each carries the host's name, ${w.alias}`).toEqual([]);
    expect.soft(upAgain && !saysDown(w, after?.why), `once the link is back and its events are in, the session's row no longer says the link is down: ${JSON.stringify(after?.why)}`).toBe(true);
  }, LIMIT);

  test('a hook request deep-hook spooled on the host, handed to the hub on this Mac\'s own socket, is not recorded under the host\'s name', async () => {
    const w = await openWorld();
    await hostAdd(w);
    const s = await HostSession.open(w);
    await s.start();
    expect(w.relay.cut(), `the hub holds a connection to ${w.alias} through the Port your SSH config names while the session records`).toBeGreaterThan(0);
    // Another session on the host, whose one hook runs while the link is down, so the hub never had it from the host.
    const stray = await HostSession.open(w);
    const id = `toolu_${randomBytes(12).toString('hex')}`;
    const ran = await stray.hook('PreToolUse', { tool_name: 'Bash', tool_input: { command: 'echo stray', description: 'Run a command' }, tool_use_id: id });
    const spooled = (await w.host.sh('cat "$HOME"/.deepbuild/spool/*.jsonl 2>/dev/null')).stdout.split('\n').find((l) => parseObject(l)?.payload?.tool_use_id === id);
    expect(spooled, `with the link down, deep-hook on ${w.alias} spools the hook's request as it does locally, a line of ~/.deepbuild/spool/*.jsonl there; the hook ended ${w.redact(shown(ran))}`).toBeDefined();
    const request = parseObject(spooled!)!;
    // The same bytes, on the hub's own socket here: a connection that is no host's link.
    const answer = await hand(w.hub.socket, spooled!);
    if (!answer) throw Error('BLOCKED: the hub gave no answer in 30 s to the request handed to it on its own socket, so nothing was read');
    if (answer.ack !== undefined) await w.log.until((events) => events.some((e) => e.id === request.id), 60_000);
    const mine = w.log.events.filter((e) => e.id === request.id || e.session === stray.id);
    proof(w, 'ac1-request-handed-here.json', { host: w.alias, answer, events: mine.map((e) => ({ kind: e.kind, log_pos: e.log_pos, host: hostOf(e) ?? null })) });
    expect(mine.filter((e) => hostOf(e) === w.alias).map((e) => `${e.kind} at log_pos ${e.log_pos}`), `a request that reached the hub on this Mac's socket isn't recorded under ${w.alias}: the host's name comes from the link a hook arrives on, never from what its request says (the hub answered ${w.redact(JSON.stringify(answer))})`).toEqual([]);
  }, LIMIT);
});
