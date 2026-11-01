// #309.5: with a second relay deployed, Join keeps using the chosen one until you switch; stopping the chosen relay
// fails the Join with its reason and never moves to the other; a protocol change whose interop run covers only the
// shipped relay fails the kit, naming the relay left out.
//
// Two shipped relays run on 127.0.0.1, each behind a plain TCP pass-through this file owns, which counts every
// connection a client opens to that relay, so which relay a Join used is read here, not from the client. A Join is a
// test client's `relay_client` call on the macOS backend, given the chosen relay; the kit is `node
// scripts/relay-kit.mjs`, the lane relay, with its planted twin `--planted interop_shipped_only` (README: The surface
// under test). At the base there is no relay, no relay_client call and no scripts/relay-kit.mjs.
import { describe, expect, it } from 'vitest';
import { lastJson, lanes, matchId, MACOS_BACKEND, obj, runAsync, runClients, startDoor, startRelay, str, strs, useBins, useCerts, useCleanup, useOut, type JsonObject } from './helpers.ts';

const bins = useBins(['deep-show', 'deep-relay']);
const certs = useCerts();
const out = useOut();
useCleanup();
const FRAMES = 20;

interface Kit { exit: number | null; stdout: string; status: string; protocolChanged: boolean; implementations: string[]; interop: string[]; leftOut: string[] }
async function kit(planted?: string): Promise<Kit> {
  const r = await runAsync([process.execPath, 'scripts/relay-kit.mjs', ...(planted ? ['--planted', planted] : [])], { timeoutMs: 1_800_000 });
  const what = `node scripts/relay-kit.mjs${planted ? ` --planted ${planted}` : ''}`;
  const report: JsonObject = obj(obj(lastJson(r.stdout), `${what}'s last stdout line (exit ${r.status}; ${r.stdout.slice(-800)} ${r.stderr.slice(-800)})`)['relay_kit'], `${what}: relay_kit`);
  const changed = report['protocol_changed'];
  expect(typeof changed, `${what}: protocol_changed is a boolean`).toBe('boolean');
  return {
    exit: r.status, stdout: r.stdout, status: str(report['status'], `${what}: status`), protocolChanged: changed === true,
    implementations: strs(report['implementations'], `${what}: implementations`), interop: strs(report['interop'], `${what}: interop`), leftOut: strs(report['left_out'], `${what}: left_out`),
  };
}

describe('#309.5 the relay is the one you chose', () => {
  it('#309.5 with a second relay deployed, Join keeps using the chosen relay until you switch; stopping the chosen relay fails the Join with its reason and never moves to the other', async () => {
    const chosen = await startRelay(bins.bin('deep-relay'), certs());
    const second = await startRelay(bins.bin('deep-relay'), certs());
    const toChosen = await startDoor(chosen.host);
    const toSecond = await startDoor(second.host);
    const show = bins.bin('deep-show');
    const pair = (relay: string, tag: string) => {
      const match = matchId();
      return runClients(show, out(), certs().ca, [{ name: `${tag}-a`, relay, match, frames: FRAMES }, { name: `${tag}-b`, relay, match, frames: FRAMES }]);
    };

    // Two Joins in a row with the chosen relay, the second relay running all along.
    for (const tag of ['first', 'again']) {
      for (const c of await pair(toChosen.url, tag)) {
        expect(c.backend.name, `client ${c.name} runs on the network seam's macOS backend`).toBe(MACOS_BACKEND);
        expect(c.outcome, `client ${c.name} joined through the chosen relay and exchanged (reason: ${c.reason})`).toBe('exchanged');
        expect(c.received.length, `client ${c.name} received its peer's frames`).toBe(FRAMES);
      }
      expect(toChosen.connections(), `the ${tag} Join connected to the chosen relay`).toBeGreaterThanOrEqual(2);
      expect(toSecond.connections(), `the ${tag} Join opened no connection to the second relay`).toBe(0);
    }

    // The chosen relay stops: its process is stopped by PID and its door closes, so its host refuses connections.
    await chosen.stop();
    await toChosen.close();
    const [stopped] = await runClients(show, out(), certs().ca, [{ name: 'stopped', relay: toChosen.url, match: matchId(), frames: FRAMES, players: 2 }]);
    expect(stopped!.outcome, `the Join with the chosen relay stopped fails (reason: ${stopped!.reason})`).toBe('failed');
    expect(stopped!.reason ?? '', 'the failed Join says why, naming the chosen relay\'s host').toContain(toChosen.host);
    expect(stopped!.sent.length, 'it sent no frame').toBe(0);
    expect(toSecond.connections(), 'the failed Join never moved to the second relay').toBe(0);

    // You switch: a Join given the second relay uses it.
    for (const c of await pair(toSecond.url, 'switched')) {
      expect(c.outcome, `client ${c.name} joined through the relay you switched to (reason: ${c.reason})`).toBe('exchanged');
    }
    expect(toSecond.connections(), 'after you switch, the Join connects to the second relay').toBeGreaterThanOrEqual(2);
    await toSecond.close();
    await second.stop();
  }, 1_200_000);

  it('#309.5 the kit (the lane relay, node scripts/relay-kit.mjs) passes when the interop run covers every relay implementation', async () => {
    const lane = (await lanes()).find((l) => l.name === 'relay');
    expect(lane, 'scripts/lanes.mjs has a lane named relay in checks (the local preflight)').toBeDefined();
    expect(lane!.commands.some((c) => c.includes('scripts/relay-kit.mjs')), `the lane relay runs scripts/relay-kit.mjs: ${JSON.stringify(lane!.commands)}`).toBe(true);
    const k = await kit();
    expect(k.implementations, 'the kit lists the shipped relay, deep-relay, among the relay implementations').toContain('deep-relay');
    expect(k.implementations.filter((r) => !k.interop.includes(r)), 'the interop run covered every relay implementation').toEqual([]);
    expect(k.leftOut, 'the kit names no relay left out').toEqual([]);
    expect(k.status, 'the kit passes').toBe('PASS');
    expect(k.exit, 'node scripts/relay-kit.mjs exits 0').toBe(0);
  }, 1_800_000);

  it('#309.5 a protocol change whose interop run covers only the shipped relay (node scripts/relay-kit.mjs --planted interop_shipped_only) fails the kit, naming the relay left out', async () => {
    const k = await kit('interop_shipped_only');
    expect(k.protocolChanged, 'the kit sees the planted protocol change').toBe(true);
    expect(k.interop, 'the planted interop run covered only the shipped relay').toEqual(['deep-relay']);
    const leftOut = k.implementations.filter((r) => !k.interop.includes(r));
    expect(leftOut.length, `there is a relay implementation beside the shipped one for the run to leave out: ${JSON.stringify(k.implementations)}`).toBeGreaterThan(0);
    expect([...k.leftOut].sort(), 'the kit\'s left_out is every implementation the interop run missed').toEqual([...leftOut].sort());
    const lines = k.stdout.split('\n').filter((l) => /^FAIL\b/.test(l));
    for (const r of leftOut) expect(lines.some((l) => l.includes(r)), `a FAIL line names the relay left out, ${r}: ${JSON.stringify(lines)}`).toBe(true);
    expect(k.status, 'the kit fails').toBe('FAIL');
    expect(k.exit, 'node scripts/relay-kit.mjs exits non-zero').not.toBe(0);
  }, 1_800_000);
});
