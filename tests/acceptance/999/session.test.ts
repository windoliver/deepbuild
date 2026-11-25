// AC1 #999.1bb7a56d, up to its semicolon: a Claude Code session on a test host records its tool calls and claim into
// your hub, shows under the host's name, and its claim is gated by a check run on the host.
//
// After `deep host add <host>`, a session in the sample repo on the host (README, A session on the host) starts, takes
// the prompt, reads price.txt, changes it to 18.00 and stops saying done; then changes it to 17.00 and stops again.
// Read (README): every event of its hooks, each claim and each verdict is in the hub's record carrying the host's
// name, while a session on this Mac beside it carries none; mid-turn, `deep status` lists it under the host's name;
// each claim's check runs on the host as a user service named by its run token, recorded on the host, never on this
// Mac; and the verdicts follow the check: FAIL while price.txt holds 18.00, PASS once it holds 17.00.
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { AC, CHECK, childEnv, cleanup, cut, deep, DEEP_HOOK, hostAdd, hostOf, HostSession, LIMIT, openWorld, PROMPT, proof, rowOf, run, shown, statusRows, type Ev, type Line, type World } from './helpers.ts';

afterEach(cleanup, 900_000);

/** The events a session's hooks become. */
const HOOK_KINDS = ['session.start', 'user.ask', 'tool.before', 'tool.after', 'agent.stop'];

interface Run { run: string; check: string; host: unknown; outcome: string | null }
interface Claim { id: string; made: Ev; runs: Run[]; verdicts: Ev[]; outcome: string | null }
/**
 * The claim the session's stop made on its task, among the events after index `from`, read once it has a verdict,
 * every run it started has ended and a run of the sample check ended before that verdict. A stop that makes no claim
 * fails here; what the claim then holds is the test's to judge.
 */
async function claimAfter(w: World, task: string, from: number): Promise<Claim> {
  const madeOf = (events: readonly Ev[]): Ev | undefined => events.slice(from).find((e) => e.kind === 'claim.made' && e.data.task_ref === task);
  if (!await w.log.until((events) => madeOf(events) !== undefined, 300_000)) {
    throw Error(`the session's stop on ${w.alias} made no claim on ${task}: the record since holds ${[...new Set(w.log.events.slice(from).map((e) => e.kind))].join(', ') || 'nothing'}`);
  }
  const made = madeOf(w.log.events)!;
  const id = `claim:${made.id}`;
  const verdicts = (events: readonly Ev[]): Ev[] => events.filter((e) => e.kind === 'verdict.made' && (e.subject === id || e.data.claim === id));
  const runs = (events: readonly Ev[]): (Run & { ended: Ev | undefined })[] => events.filter((e) => e.kind === 'run.started' && e.data.claim === id).map((e) => {
    const ended = events.find((x) => x.kind === 'run.finished' && x.data.run === e.data.run);
    return { run: String(e.data.run), check: String(e.data.check), host: e.data.host, outcome: ended ? String(ended.data.outcome) : null, ended };
  });
  await w.log.until((events) => {
    const v = verdicts(events).at(-1);
    const r = runs(events);
    return v !== undefined && r.every((x) => x.ended) && r.some((x) => x.check === CHECK && x.ended!.log_pos < v.log_pos);
  }, 900_000);
  const all = verdicts(w.log.events);
  return { id, made, runs: runs(w.log.events).map((r) => ({ run: r.run, check: r.check, host: r.host, outcome: r.outcome })), verdicts: all, outcome: all.length ? String(all.at(-1)!.data.outcome) : null };
}
const shownClaim = (c: Claim): string => `${c.id}: outcome ${c.outcome}; verdicts ${cut(JSON.stringify(c.verdicts.map((v) => [v.data.outcome, v.data.reasons])), 900)}; runs ${c.runs.map((r) => `${r.run} ${r.check} on ${String(r.host)} ${r.outcome ?? 'running'}`).join(', ') || 'none'}`;

describe(AC[1], () => {
  test('a session on the host records its tool calls and claims into your hub under the host\'s name, shows under it in deep status, and each claim is judged by the check run on the host', async () => {
    const w = await openWorld();
    await hostAdd(w);
    const s = await HostSession.open(w);
    await s.start();
    await s.typed(PROMPT);
    const taskOf = (events: readonly Ev[]): string | undefined => events.find((e) => e.kind === 'user.ask' && e.session === s.id)?.data.tasks?.[0] as string | undefined;
    const locked = await w.log.until((events) => { const t = taskOf(events); return t !== undefined && events.some((e) => e.kind === 'definition.locked' && e.data.task_ref === t); }, 300_000);
    expect(locked, `the prompt typed on ${w.alias} opens a task whose handed definition locks, as a local session's does; the record holds ${cut(JSON.stringify(w.log.events.filter((e) => /^(user\.ask|task\.|definition\.)/.test(e.kind)).map((e) => [e.kind, e.data])))}`).toBe(true);
    const task = taskOf(w.log.events)!;
    const read = await s.bash('cat price.txt');
    expect(read.after, `the session's \`cat price.txt\` on ${w.alias} is let through: ${w.redact(shown(read.before))}`).not.toBeNull();

    // Mid-turn, as you: the list.
    const row = rowOf(await statusRows(w), s);
    const listing = (await deep(w, ['status'])).stdout.split('\n');
    const at = row ? listing.findIndex((l) => /^\s/.test(l) && l.includes(String(row.title))) : -1;
    const heading = at < 0 ? undefined : listing.slice(0, at).reverse().find((l) => /^\S/.test(l));

    // A session on this Mac, beside it: one hook through this checkout's deep-hook, fired until the record holds it.
    const local = { id: randomUUID(), cwd: w.tmp };
    const transcript = join(w.home, '.claude/projects', local.cwd.replace(/[^A-Za-z0-9]/g, '-'), `${local.id}.jsonl`);
    mkdirSync(dirname(transcript), { recursive: true });
    writeFileSync(transcript, '');
    const body = { session_id: local.id, transcript_path: transcript, cwd: local.cwd, hook_event_name: 'SessionStart', permission_mode: 'default', source: 'startup', model: 'claude-haiku-5-5' };
    let here = false;
    for (let n = 0; n < 6 && !here; n++) {
      await run(DEEP_HOOK, ['claude-code', 'SessionStart'], { cwd: local.cwd, env: childEnv(w.home, { CLAUDECODE: '1', CLAUDE_CODE_ENTRYPOINT: 'cli' }), input: JSON.stringify(body) });
      here = await w.log.until((events) => events.some((e) => e.kind === 'session.start' && e.session === local.id), 20_000);
    }
    if (!here) throw Error('BLOCKED: the record holds no session.start of a session on this Mac after six tries of its hook');

    // The first stop says done after a change that doesn't take the coupon off; the second after the one that does.
    await s.edit('price.txt', '18.00\n');
    let from = w.log.events.length;
    await s.stop();
    const first = await claimAfter(w, task, from);
    const startsFirst = await w.host.lines(`${w.host.folder}/price.starts`);
    await s.edit('price.txt', '17.00\n');
    from = w.log.events.length;
    await s.stop();
    const second = await claimAfter(w, task, from);
    const starts = await w.host.lines(`${w.host.folder}/price.starts`);

    const all = w.log.events;
    const hooks = all.filter((e) => e.session === s.id && HOOK_KINDS.includes(e.kind));
    const carried = [...hooks, first.made, ...first.verdicts, second.made, ...second.verdicts];
    const units = starts.map((l) => { const [token = '', ...rest] = l.split(' '); return { token, cgroup: rest.join(' ') }; });
    proof(w, 'ac1-session.json', {
      host: w.alias, session: s.id, row, heading,
      events: carried.map((e) => ({ kind: e.kind, log_pos: e.log_pos, host: hostOf(e) ?? null })),
      claims: [first, second].map((c) => ({ claim: c.id, outcome: c.outcome, runs: c.runs })),
      check_runs_on_the_host: units.map((u) => ({ token: `${u.token.slice(0, 8)}…`, cgroup: u.cgroup })),
    });

    // Records its tool calls and claim into your hub, each event carrying the host's name.
    expect.soft(HOOK_KINDS.filter((kind) => !hooks.some((e) => e.kind === kind)), `the record holds the session's start, prompt, tool calls and stops on ${w.alias}`).toEqual([]);
    expect.soft(JSON.stringify(hooks.find((e) => e.kind === 'tool.before' && e.data.call === read.id)?.data ?? null), 'the record holds the tool call as the session made it').toContain('cat price.txt');
    expect.soft(carried.filter((e) => hostOf(e) !== w.alias).map((e) => `${e.kind} at log_pos ${e.log_pos} carries ${JSON.stringify(hostOf(e) ?? null)}`), `each event of the session's hooks, each claim and each verdict carries the host's name, ${w.alias}`).toEqual([]);
    expect.soft(all.filter((e) => e.session === local.id && hostOf(e) === w.alias).map((e) => `${e.kind} at log_pos ${e.log_pos}`), `no event of the session on this Mac carries ${w.alias}: a host's name comes with the link its hook arrived on`).toEqual([]);

    // Shows under the host's name.
    expect.soft(row, 'deep status --json lists the session while its turn is at work').toBeDefined();
    const { why: _why, title: _title, ...named } = (row ?? {}) as Line;
    expect.soft(JSON.stringify(named), `the session's row names the host it is on, ${w.alias}`).toContain(w.alias);
    expect.soft(heading ?? `no line of deep status holds the row's title ${JSON.stringify(row?.title)}`, `in deep status, the session's row sits under a heading that names the host, ${w.alias}`).toContain(w.alias);

    // Its claim is gated by a check run on the host.
    for (const [c, price, want] of [[first, '18.00', 'FAIL'], [second, '17.00', 'PASS']] as const) {
      const checks = c.runs.filter((r) => r.check === CHECK);
      expect.soft(checks.length, `the claim made while price.txt holds ${price} runs the sample check: ${shownClaim(c)}`).toBeGreaterThan(0);
      expect.soft(checks.filter((r) => r.host !== w.alias).map((r) => `${r.run} on ${String(r.host)}`), `each run of that claim's check is recorded on ${w.alias}, a remote run, never on this Mac: ${shownClaim(c)}`).toEqual([]);
      expect.soft(c.outcome, `the claim made while price.txt holds ${price} reads ${want}, as its check on ${w.alias} ended: ${shownClaim(c)}`).toBe(want);
    }
    expect.soft(startsFirst.length, `the first claim's check ran on ${w.alias}: it noted its run in ~/${w.host.folder.split('/').pop()}/price.starts there`).toBeGreaterThan(0);
    expect.soft(starts.length, `the second claim's check ran on ${w.alias} too, after the first's ${startsFirst.length} run(s)`).toBeGreaterThan(startsFirst.length);
    expect.soft(units.filter((u) => u.token === 'none' || !new RegExp(`user@\\d+\\.service/.*${u.token.replace(/[^A-Za-z0-9]/g, '.')}`).test(u.cgroup)).map((u) => w.redact(`${u.token} in ${u.cgroup}`)), `each run of the check on ${w.alias} is a user service whose name holds its run token, as #1942's remote runs are`).toEqual([]);
  }, LIMIT);
});
