// AC7: deep-hook run for a Claude Code session's SessionStart, with CLAUDE_CODE_MESSAGING_SOCKET and
// CLAUDE_CODE_MESSAGING_TOKEN in the environment its agent gave it, as Claude Code exports them before any hook runs.
// With no hub listening, deep-hook spools its request byte for byte, which is exactly what it sends the hub (design:
// Hook protocol): that report holds the inbox address and nothing of the token, neither its value nor a part, hash or
// encoding of it. Then a hub starts and replays the spool, and the token is nowhere in the record or in any file of
// DeepBuild's folder. A report that carries the token's value fails, naming the field.
import { join } from 'node:path';
import { afterAll, describe, it } from 'vitest';
import {
  AC7, ClaudeSession, DEEP_HOOK, PLANT, REPO, SOCKET_VAR, TOKEN_VAR, allEvents, cleanup, filesHolding, forms, inbox, makeWorld, must,
  needRecordings, pathsHolding, run, settle, shown, spooled, startHub, tag, type Line,
} from './helpers.ts';

afterAll(cleanup, 60_000);

async function report(hook: string, plant?: string): Promise<void> {
  const w = makeWorld();
  const s = ClaudeSession.open(w, w.repo, { hook });
  const address = await inbox(w, s.pid);
  const token = tag(16);
  s.env = { [SOCKET_VAR]: address, [TOKEN_VAR]: token, ...(plant ? { DEEP_HUB_PLANT: plant } : {}) };
  await s.start();
  const line = spooled(w).find((l: Line) => l.event === 'SessionStart' && l.payload?.session_id === s.id);
  must(line !== undefined, `BLOCKED: ${AC7} with no hub listening, deep-hook spooled no SessionStart request for ${s.id}: ${JSON.stringify(spooled(w)).slice(0, 1500)}`);
  const secret = forms(token);
  const carried = pathsHolding(line, secret);
  must(carried.length === 0, `${AC7} deep-hook's SessionStart report carries the token's value in the field ${carried.join(', ')}; it may carry nothing of ${TOKEN_VAR}`);
  const { payload: _payload, ...reportOwn } = line;
  must(pathsHolding(reportOwn, [address]).length > 0, `${AC7} deep-hook's SessionStart report must hold the session's inbox address ${address}, from ${SOCKET_VAR}, beside the agent's payload: ${JSON.stringify(reportOwn).slice(0, 1500)}`);

  // What reaches the hub: the spool replayed into a hub that starts now.
  const hub = await startHub(w);
  const events = await settle(hub, (e) => e.some((x) => x.kind === 'session.start' && x.session === s.id), 60_000);
  must(events.some((x) => x.kind === 'session.start' && x.session === s.id), `BLOCKED: ${AC7} the hub recorded no session.start for ${s.id} from the spool`);
  const recorded = pathsHolding(await allEvents(hub), secret);
  must(recorded.length === 0, `${AC7} the record holds the token's value in ${recorded.join(', ')}`);
  const files = filesHolding(w.root, secret);
  must(files.length === 0, `${AC7} the token's value is in ${files.map((f) => join('~/.deepbuild', f)).join(', ')}`);
  must(!secret.some((v) => hub.stderr().includes(v)), `${AC7} the hub's own output holds the token's value`);
}

/** deep-hook built with its env-plants feature, in a target folder of its own so the suite's plain build stays as it is. */
async function plantedHook(): Promise<string> {
  const target = join(REPO, 'target', 'acceptance-3405-plants');
  const env = { ...process.env, CARGO_TARGET_DIR: target, CARGO_INCREMENTAL: '0', CARGO_PROFILE_DEV_DEBUG: '0', DEEP_LEASE_WAIT: '60', PATH: `/opt/homebrew/opt/rustup/bin:${process.env.PATH ?? '/usr/bin:/bin'}` };
  const r = await run(join(REPO, 'scripts/lease'), ['cargo', 'build', '--locked', '-q', '-p', 'deep-hook', '--bin', 'deep-hook', '--features', 'env-plants'], { env, cwd: REPO, timeoutMs: 90 * 60_000 });
  must(r.code === 0, `BLOCKED: ${AC7} deep-hook with --features env-plants didn't build: ${shown(r)}`);
  return join(target, 'debug', 'deep-hook');
}

describe(`${AC7} deep-hook's SessionStart report holds the inbox address and nothing of CLAUDE_CODE_MESSAGING_TOKEN`, () => {
  it(`${AC7} the report deep-hook sends at SessionStart holds ${SOCKET_VAR}'s address, and the token is nowhere in it, the record or DeepBuild's files`, async (ctx) => {
    if (!needRecordings(ctx)) return;
    await report(DEEP_HOOK);
  }, 600_000);

  it(`${AC7} the planted deep-hook whose report carries the token's value (${PLANT.tokenInReport}) fails this test, naming the field`, async (ctx) => {
    if (!needRecordings(ctx)) return;
    const hook = await plantedHook();
    const failure = await report(hook, PLANT.tokenInReport).then(() => undefined, (e: Error) => e);
    must(failure !== undefined, `${AC7} the planted deep-hook ${PLANT.tokenInReport} must fail this test; it passed`);
    must(/carries the token's value in the field \S+/.test(failure.message) && !/^BLOCKED/.test(failure.message), `${AC7} the planted deep-hook ${PLANT.tokenInReport} must fail naming the field that carries the token; it failed with: ${failure.message}`);
  }, 120 * 60_000);
});
