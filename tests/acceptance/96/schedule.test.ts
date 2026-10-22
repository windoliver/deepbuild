// AC13 one writer's flood never delays another's patch: a check queue per writer, quotas, and revisions that
// become current only at a latch. Played on the hub's virtual display clock, so it reads no wall time.
import { describe, expect, it } from 'vitest';
import {
  ALPHA, ASALPHA, ASBRAVO, BRAVO, FLICKS, P, create, issues, node, num, outcome, patch, send, show, ulid, useBinaries, useFolders, world,
  type JsonObject,
} from './helpers.ts';

useBinaries();
const { evidence } = useFolders();

const REFRESH_HZ = 60;
const PERIOD = FLICKS / REFRESH_HZ; // 11,760,000 flicks
const LEAD = 1_411_200; // 2 ms before each vsync
const CHECK = 352_800; // 0.5 ms of the checker per patch it takes
const CLOCK = { refresh_hz: REFRESH_HZ, lead: LEAD, check: CHECK };
const QUOTA = 60;
const FLOOD = 6_000;
const B_AT = FLICKS / 2;
const B_PATCH = P(9_999);
const isLatch = (t: number): boolean => (t + LEAD) % PERIOD === 0 && t + LEAD > 0;
const firstLatchFrom = (t: number): number => Math.ceil((t + LEAD) / PERIOD) * PERIOD - LEAD;

/** Alpha's 6,000 valid patches in 1 s, each creating a dot of its own, and bravo's one patch at 0.5 s. */
function scenario(planted?: string): JsonObject {
  const flood = Array.from({ length: FLOOD }, (_, i) => ({
    at: Math.floor((i * FLICKS) / FLOOD),
    call: send(ASALPHA, patch(ulid('01JB96A', i + 1), 0, [create(node(`alpha.d${i}`, `Dot ${i}`, [i % 600, 300]))])),
  }));
  const b = { at: B_AT, call: send(ASBRAVO, patch(B_PATCH, 0, [create(node('bravo.note', 'Note', [300, 160]))])) };
  const calls = [...flood.filter((f) => f.at <= B_AT), b, ...flood.filter((f) => f.at > B_AT)].map((c) => ({ ...c.call, at: c.at }));
  const quotas = { [ALPHA.id]: { patches_per_s: QUOTA }, [BRAVO.id]: { patches_per_s: QUOTA } };
  return world(evidence(), calls, { clock: CLOCK, quotas, ...(planted ? { planted } : {}) });
}

interface Timed { patch: string; writer: 'alpha' | 'bravo'; outcome: string; arrived: number; checked: number | null; current: number | null; codes: string[] }
function timed(sc: JsonObject, replies: JsonObject[]): Timed[] {
  const calls = sc['calls'] as JsonObject[];
  return replies.map((r, i) => {
    const call = calls[i]!;
    const p = call['patch'] as JsonObject;
    const t = (k: string): number | null => (r[k] === null || r[k] === undefined ? null : num(r[k], `reply ${i + 1}: ${k}`));
    return {
      patch: String(p['patch']), writer: call['session'] === ALPHA.id ? 'alpha' : 'bravo', outcome: outcome(r),
      arrived: num(r['arrived'], `reply ${i + 1}: arrived`), checked: t('checked'), current: t('current'), codes: issues(r).map((x) => x.code),
    };
  });
}

/** What the criterion asks of bravo's patch, as failures; empty when it holds. */
function bravoFailures(all: Timed[]): string[] {
  const out: string[] = [];
  const b = all.find((t) => t.patch === B_PATCH);
  if (!b) return [`no reply for bravo's patch ${B_PATCH}`];
  if (b.outcome !== 'applied' || b.checked === null || b.current === null) return [`bravo's patch ${B_PATCH} was ${b.outcome}, checked ${b.checked}, current ${b.current}`];
  // At most the one patch already on the checker goes first: B waits one slot, then takes its own.
  if (b.checked - b.arrived > 2 * CHECK) out.push(`bravo's patch ${B_PATCH} arrived at ${b.arrived} and was checked at ${b.checked}, ${((b.checked - b.arrived) / FLICKS * 1000).toFixed(1)} ms later, behind alpha's backlog`);
  const jumped = all.filter((t) => t.writer === 'alpha' && t.arrived < b.arrived && t.checked !== null && t.checked > b.checked!).length;
  if (jumped === 0) out.push(`bravo's patch ${B_PATCH} was checked after every alpha patch that arrived before it: no backlog was passed`);
  if (b.current !== firstLatchFrom(b.checked)) out.push(`bravo's patch ${B_PATCH} became current at ${b.current}, not at the first latch after its check, ${firstLatchFrom(b.checked)}`);
  return out;
}

describe('AC13 with writer A\'s quota at 60 patches a second sending 6,000 valid patches in 1 s and writer B sending one patch at 0.5 s, B\'s patch is checked ahead of A\'s later backlog and current at the first latch after its check; A\'s extra patches are superseded or refused, never applied mid-frame', () => {
  it('AC13 bravo\'s patch is checked ahead of alpha\'s backlog and is current at the first latch after its check', () => {
    const sc = scenario();
    const all = timed(sc, show(sc).replies);
    expect(bravoFailures(all), 'bravo\'s patch jumps alpha\'s backlog and lands at the next latch').toEqual([]);
  });

  it('AC13 alpha\'s patches beyond its quota are superseded or refused, at most 60 apply in any second, and nothing becomes current between latches', () => {
    const sc = scenario();
    const all = timed(sc, show(sc).replies);
    const alpha = all.filter((t) => t.writer === 'alpha');
    expect(alpha.length).toBe(FLOOD);
    const outcomes = new Set(alpha.map((t) => t.outcome));
    expect([...outcomes].every((o) => ['applied', 'superseded', 'refused'].includes(o)), `alpha's outcomes are applied, superseded or refused: ${[...outcomes].join(', ')}`).toBe(true);
    const applied = alpha.filter((t) => t.outcome === 'applied');
    expect(applied.length, 'alpha is rate-limited, not shut out: some of its patches apply').toBeGreaterThan(0);
    expect(applied.length, 'most of the flood does not apply').toBeLessThan(FLOOD);
    for (const t of alpha.filter((x) => x.outcome === 'refused')) expect(t.codes, `alpha's refused ${t.patch} is over its quota`).toContain('over_quota');
    const at = applied.map((t) => t.checked!).sort((x, y) => x - y);
    for (let i = 0; i < at.length; i++) {
      const inSecond = at.filter((c) => c >= at[i]! && c < at[i]! + FLICKS).length;
      expect(inSecond, `alpha has at most ${QUOTA} patches applied in the second from ${at[i]}`).toBeLessThanOrEqual(QUOTA);
    }
    for (const t of all.filter((x) => x.outcome === 'applied')) {
      expect(t.current, `${t.patch} applied has the latch it became current at`).not.toBeNull();
      expect(isLatch(t.current!), `${t.patch} became current at ${t.current}, a latch (vsync minus the lead), never mid-frame`).toBe(true);
      expect(t.current! >= t.checked!, `${t.patch} became current after its check`).toBe(true);
    }
    for (const t of all.filter((x) => x.outcome !== 'applied')) expect(t.current, `${t.patch}, ${t.outcome}, never became current`).toBeNull();
  });

  it('AC13 one FIFO check queue across writers delays bravo, and this test fails on it, naming bravo\'s patch', () => {
    const sc = scenario('one_fifo_check_queue');
    const all = timed(sc, show(sc).replies);
    const failures = bravoFailures(all);
    expect(failures.length, 'the check fails on one FIFO queue').toBeGreaterThan(0);
    expect(failures.join('\n'), 'naming bravo\'s patch').toContain(B_PATCH);
  });
});
