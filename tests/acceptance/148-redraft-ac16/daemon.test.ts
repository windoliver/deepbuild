// AC16 #148.9536f2a1, redrafted blind from the criterion (README). One Codex daemon serves two sessions; a sync to Codex
// lands after it started. Both rows say so until a session's own evidence shows the new set; the restart is one
// authority ask naming both sessions, run through the facts' command only after your answer, and nothing signals the
// daemon. The facts record what the installed Codex's running daemon picks up. The twin plants a hub that restarts
// without your answer.
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, CodexSession, NODE, Proc, alive, answer, approve, call, events, factsOf, failsNaming, failureOf, installed, lastPos, makeWorld,
  parse, propose, readingsOf, realAgents, rowOf, shown, sleep, startHub, stdioServer, tag, tempDir, useCleanup, waitFor,
  type Ev, type Line, type World,
} from '../148/helpers.ts';

useCleanup();

const daemonName = (d: Proc): string => `Codex's daemon (pid ${d.pid})`;
const namesPid = (text: string, pid: number): boolean => new RegExp(`(^|\\D)${pid}(\\D|$)`).test(text);
const namesSession = (text: string, id: string): boolean => text.includes(id) || text.includes(id.replace(/-/g, ''));
const restarts = (w: World): Line[] => (existsSync(w.restarts) ? readFileSync(w.restarts, 'utf8').split('\n').flatMap((l) => (parse(l) ? [parse(l)!] : [])) : []);

/** The facts' restart: the arguments after `codex` (README 19). */
function restartArgs(): string[] {
  const r: unknown = factsOf('codex').daemon?.restart;
  expect(Array.isArray(r) && r.length > 0 && r.every((a) => typeof a === 'string'), `adapters/codex.facts.json names Codex's own restart command in daemon.restart: ${shown(r)}`).toBe(true);
  return r as string[];
}

/** Nothing signalled the daemon and it still runs. */
function untouched(d: Proc, when: string): void {
  expect(d.signalled(), `${daemonName(d)} got a signal ${when}`).toEqual([]);
  expect(alive(d.pid), `${daemonName(d)} still runs ${when}`).toBe(true);
}

async function readings(w: World, s: CodexSession): Promise<string[]> { return readingsOf(await rowOf(w, s.id)); }

/** The criterion, on a world whose hub runs; `seen.daemon` is the daemon it made, for the twin to name. */
async function check(w: World, seen: { daemon?: Proc }): Promise<void> {
  const daemon = Proc.start(w, 'codex-daemon');
  seen.daemon = daemon;
  const a = new CodexSession(w, w.work, daemon);
  const b = new CodexSession(w, w.work, daemon);
  await a.start();
  await b.start();
  for (const s of [a, b]) await waitFor(() => rowOf(w, s.id), 60_000, `session ${s.id}'s row in status.read`);
  // Control: before any sync, no row names the daemon.
  for (const s of [a, b]) {
    const r = await readings(w, s);
    expect(r.some((x) => namesPid(x, daemon.pid)), `before any sync, session ${s.id}'s row doesn't say ${daemonName(daemon)} started before one: ${shown(r)}`).toBe(false);
  }

  const from = await lastPos(w);
  const p = await propose(w, { via: 'app', server: stdioServer(w, `forge-${tag()}`), agents: ['codex'] });
  await approve(w, p);

  // Both rows say the daemon started before the sync.
  for (const s of [a, b]) {
    await waitFor(async () => (await readings(w, s)).some((x) => namesPid(x, daemon.pid)), 60_000,
      `session ${s.id}'s row to say ${daemonName(daemon)} started before the sync (readings ${shown(await readings(w, s))})`);
  }

  // Restart from the Agents page: one authority ask naming both sessions, and nothing runs before your answer.
  let refused = '';
  await call(w, 'agents.restart', { agent: 'codex' }).catch((e: Error) => { refused = e.message; });
  const own = String(p.ask).replace(/^ask:/, '');
  const restartAsks = async (): Promise<Ev[]> => (await events(w)).filter((e) => e.log_pos > from && e.kind === 'ask.created' && e.id !== own
    && [a, b].some((s) => namesSession(JSON.stringify(e.data), s.id)));
  await waitFor(async () => (await restartAsks()).length > 0 || undefined, 30_000, `an ask to restart ${daemonName(daemon)}${refused ? ` (agents.restart: ${refused})` : ''}`);
  await sleep(3000);
  expect(restarts(w), `${daemonName(daemon)} was restarted without your answer: Codex's restart command ran ${shown(restarts(w))}`).toEqual([]);
  untouched(daemon, 'while the restart ask is open');
  const asks = await restartAsks();
  expect(asks.length, `one ask to restart ${daemonName(daemon)}, not one per session: ${shown(asks.map((e) => e.data))}`).toBe(1);
  const ask = asks[0]!;
  expect(ask.data.kind, `the ask to restart ${daemonName(daemon)} is an authority ask: ${shown(ask.data)}`).toBe('authority');
  for (const s of [a, b]) expect(namesSession(JSON.stringify(ask.data), s.id), `the restart ask names session ${s.id}: ${shown(ask.data)}`).toBe(true);

  // Your yes runs Codex's own restart command, once, and still nothing signals the daemon.
  const yes = ((ask.data.options ?? []) as Line[]).find((o) => o.decision === 'allow');
  expect(yes, `the restart ask has an option that allows it: ${shown(ask.data.options)}`).toBeDefined();
  await answer(w, ask.id, String(yes!.id));
  await waitFor(() => restarts(w).length > 0 || undefined, 30_000, `Codex's restart command to run after your answer`);
  await sleep(1000);
  const ran = restarts(w);
  const want = restartArgs();
  expect(ran.length, `Codex's restart command ran once: ${shown(ran)}`).toBe(1);
  expect((ran[0]!.args as string[]).slice(0, want.length), `the restart is the facts' command, codex ${want.join(' ')}: ${shown(ran)}`).toEqual(want);
  untouched(daemon, 'after the restart');

  // A's own evidence of the new set: SessionStart (resume) from a daemon started after the sync. B has none.
  const fresh = Proc.start(w, 'codex-daemon');
  a.daemon = fresh;
  await a.start('resume');
  await waitFor(async () => !(await readings(w, a)).some((x) => namesPid(x, daemon.pid) || namesPid(x, fresh.pid) || /older/i.test(x)) || undefined, 60_000,
    `session ${a.id}'s row to stop saying it runs the older set once it resumed from a daemon started after the sync (readings ${shown(await readings(w, a))})`);
  const kept = await readings(w, b);
  expect(kept.some((x) => namesPid(x, daemon.pid)), `session ${b.id}, still on ${daemonName(daemon)}, keeps saying it started before the sync: ${shown(kept)}`).toBe(true);
  untouched(daemon, 'at the end');
}

describe(`${AC[16]}: Codex's shared daemon and a sync`, () => {
  it('both rows say the daemon started before the sync until their own evidence; the restart is one authority ask, run on your answer, never a signal', async () => {
    const w = await makeWorld({ codexRestartRecorded: true });
    await startHub(w);
    await check(w, {});
  });

  it("Codex's facts name its restart command and record what a running daemon picks up, for the pinned version", () => {
    const real = realAgents().codex;
    const version = installed.codex!;
    const want = restartArgs();
    const home = tempDir();
    const help = spawnSync(real, [...want, '--help'], { encoding: 'utf8', timeout: 60_000, env: { PATH: `${dirname(NODE)}:/usr/bin:/bin`, HOME: home, TMPDIR: home } });
    expect(help.status === 0 && /restart/i.test(help.stdout), `codex ${want.join(' ')} is a command Codex ${version} has: exit ${help.status}, ${shown(help.stdout + help.stderr, 600)}`).toBe(true);
    const picks: unknown = factsOf('codex').daemon?.picksUp?.[version];
    expect(picks, `adapters/codex.facts.json records under daemon.picksUp["${version}"] what a running daemon picks up: ${shown(factsOf('codex').daemon)}`).toBeDefined();
    for (const key of ['hooks.json', 'mcp_servers']) expect(typeof (picks as Line)[key], `daemon.picksUp["${version}"]["${key}"] is a boolean: ${shown(picks)}`).toBe('boolean');
  });

  it('twin: a hub that runs the restart without your answer fails, naming the daemon', async () => {
    const w = await makeWorld({ codexRestartRecorded: true });
    await startHub(w, { plant: 'restarts-without-answer' });
    const seen: { daemon?: Proc } = {};
    const failure = await failureOf(() => check(w, seen));
    failsNaming(failure, seen.daemon ? daemonName(seen.daemon) : "Codex's daemon (pid", 'restarts-without-answer');
    expect(failure, 'the twin fails at the restart, not elsewhere').toContain('restarted without your answer');
  });
});
