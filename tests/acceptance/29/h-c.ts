// Fork C's helpers: loop-scenario checks, the seeded replay of 30 recorded sessions (AC24, AC32, AC41) and the audits
// that read a trace. Pure data; nothing here stands in for the gate runner.
import type { CheckDef, Needs, Scenario, SessionScript, ScriptEvent, Trace } from '../../../packages/gate/src/index.ts';
import { check, edit, prompt, script, stop } from './helpers.ts';

export const J = 'journey:checkout';
export const unit = (ms = 2000): CheckDef => check('unit', ms, { inputs: ['src/**'] });
export const journey = (ends?: 'passed' | 'failed' | Record<string, 'passed' | 'failed'>, ms = 300_000): CheckDef =>
  check(J, ms, { inputs: ['src/**'], deadline_ms: ms, ...(ends ? { ends } : {}) });

// ---- Globs: `**` any number of segments, `*` within one.
export function globRe(glob: string): RegExp {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*' && glob[i + 1] === '*') { re += '.*'; i++; if (glob[i + 1] === '/') i++; }
    else if (c === '*') re += '[^/]*';
    else re += c.replace(/[.+?^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}
export const touches = (inputs: string[], changed: string[]): boolean =>
  changed.length > 0 && (inputs.length === 0 || changed.some((p) => inputs.some((g) => globRe(g).test(p))));

// ---- A deterministic generator (mulberry32).
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SEED = Number(process.env.AC29_SEED ?? 2910);
export const SESSIONS = 30;
export const STOPS_PER_SESSION = 6;
export const STOP_EVERY = 20_000;

/** 30 recorded sessions: a stop every 20 s, each stop's checks taking 5 to 90 s by their recorded runs. */
export function replay(seed: number, slots: number): Scenario {
  const r = rng(seed);
  const int = (lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
  const sessions: SessionScript[] = [];
  for (let s = 1; s <= SESSIONS; s++) {
    const id = `R${s}`;
    const offset = int(0, 19) * 1000;
    const snaps = Array.from({ length: STOPS_PER_SESSION }, (_, n) => `${id}-${n + 1}-${Math.floor(r() * 0xfffffff).toString(16).padStart(7, '0')}`);
    const failing = new Set<string>();
    snaps.forEach((sn) => { if (r() < 0.12) failing.add(sn); });
    const ends = (on: boolean): Record<string, 'passed' | 'failed'> => Object.fromEntries(snaps.map((sn) => [sn, on && failing.has(sn) ? 'failed' : 'passed']));
    const heavy = (n: string, lo: number, hi: number, inputs: string[], o: Partial<CheckDef> & { fail?: boolean } = {}): CheckDef => {
      const { fail, ...rest } = o;
      return check(n, int(lo, hi) * 1000, { inputs, ends: ends(fail === true), ...rest });
    };
    const checks: CheckDef[] = [
      heavy('lint', 5, 12, ['src/**']),
      heavy('typecheck', 8, 30, ['src/**'], { fail: true }),
      heavy('unit', 10, 40, ['src/**'], { on_base: 'fails', needs: r() < 0.3 ? { cores: 2, memory_mb: 512 } : {} }),
      heavy('journey:flow', 40, 90, ['src/**']),
      heavy('docs', 20, 60, ['docs/**']),
    ];
    const events: ScriptEvent[] = [];
    snaps.forEach((sn, n) => {
      const at = offset + n * STOP_EVERY;
      const roll = r();
      const changed = roll < 0.6 ? ['src/a.ts'] : roll < 0.8 ? ['docs/a.md'] : ['src/a.ts', 'docs/a.md'];
      const sorted = r() < 0.15 ? 'proceed' as const : undefined;
      events.push(prompt(at, 'human'), edit(at + 500, sn, changed), stop(at + 1000, sn, { changed, ...(sorted ? { sorted } : {}), id: sn }));
    });
    sessions.push(script(id, 'claude', checks, events));
  }
  return { config: { slots }, sessions };
}

export interface Audit { holds: string[]; lines: string[]; stopped: string[]; overlap: string[]; late: string[]; host: string[] }
const byKey = (rs: Trace['runs']) => {
  const m = new Map<string, Trace['runs']>();
  for (const r of rs) m.set(`${r.session}/${r.check}`, [...(m.get(`${r.session}/${r.check}`) ?? []), r]);
  return m;
};
/** Every hold: replied within its 60 s, no Stop timeout, a verdict line or a line naming what still runs, with its expected time. */
export function auditHolds(t: Trace, hold = 60_000, timeout = 600_000): Pick<Audit, 'holds' | 'lines'> {
  const out: Pick<Audit, 'holds' | 'lines'> = { holds: [], lines: [] };
  for (const s of t.stops) {
    const held = s.reply_at - s.at;
    if (held > hold || held >= timeout - 5000) out.holds.push(`${s.stop} (${s.session}) replied after ${held} ms`);
    const ok = /PASS|sent back|\d+ checks? (running|queued|waits for the loop)/.test(s.line) && (s.verdict !== 'pending' || /about/.test(s.line) || /waits for the loop/.test(s.line));
    if (!ok) out.lines.push(`${s.stop}: line ${JSON.stringify(s.line)} (verdict ${s.verdict}) names neither a verdict nor each unfinished check with its expected time`);
  }
  return out;
}
/** AC32's three audits on a trace of a replay. */
export function auditQueue(t: Trace, sc: Scenario): Pick<Audit, 'stopped' | 'overlap' | 'late'> {
  const out: Pick<Audit, 'stopped' | 'overlap' | 'late'> = { stopped: [], overlap: [], late: [] };
  if (t.max_running_by_ask_check > 1) out.overlap.push(`max_running_by_ask_check ${t.max_running_by_ask_check}`);
  for (const r of t.runs) if (r.outcome === 'stopped') out.stopped.push(r.run);
  for (const [key, runs] of byKey(t.runs)) {
    for (const a of runs) for (const b of runs) {
      if (a.run >= b.run) continue;
      if (a.started_at < b.ended_at && b.started_at < a.ended_at) out.overlap.push(`${key}: ${a.run} and ${b.run} run at once`);
      if (a.queued_at !== null && b.queued_at !== null && a.queued_at < b.started_at && b.queued_at < a.started_at && a.queued_at < a.started_at && b.queued_at < b.started_at) out.overlap.push(`${key}: ${a.run} and ${b.run} wait queued at once`);
    }
  }
  for (const r of t.runs) {
    if (r.lane !== 'slow' || r.started_by === 'fast_lane') continue;
    const sess = sc.sessions.find((x) => x.id === r.session)!;
    const def = sess.checks.find((c) => c.id === r.check)!;
    const stops = t.stops.filter((s) => s.session === r.session);
    const own = stops.find((s) => s.snapshot === r.snapshot);
    if (own && own.kind !== 'ends_turn') out.late.push(`${r.run}: a slow run of ${r.check} started on ${r.snapshot}, whose stop's reply was ${own.kind}`);
    const evs = sess.events.filter((e): e is Extract<ScriptEvent, { kind: 'stop' }> => e.kind === 'stop');
    const mine = evs.find((e) => e.snapshot === r.snapshot);
    for (const e of evs) if (mine && e.at > mine.at && e.at <= r.started_at && touches(def.inputs, e.changed)) { out.late.push(`${r.run}: a slow run of ${r.check} started on ${r.snapshot} after ${e.snapshot} changed its inputs`); break; }
  }
  return out;
}
export const filled = (n: Partial<Needs> | undefined): Needs => ({ cores: 1, memory_mb: 0, stack_slot: 0, gpus: 0, ...n });
/** AC41: every run records host `local` and needs equal to what its check declared, with its expected time. */
export function auditRecords(t: Trace, sc: Scenario): string[] {
  const bad: string[] = [];
  for (const r of t.runs) {
    const def = sc.sessions.find((x) => x.id === r.session)!.checks.find((c) => c.id === r.check)!;
    if (r.host !== 'local') bad.push(`${r.run}: host ${JSON.stringify(r.host)}`);
    if (JSON.stringify(r.needs) !== JSON.stringify(filled(def.needs)) && !(Object.keys(filled(def.needs)).every((k) => (r.needs as unknown as Record<string, number>)?.[k] === (filled(def.needs) as unknown as Record<string, number>)[k]))) bad.push(`${r.run}: needs ${JSON.stringify(r.needs)} against declared ${JSON.stringify(filled(def.needs))}`);
    if (typeof r.expected_ms !== 'number' || r.expected_ms !== def.expected_ms) bad.push(`${r.run}: expected_ms ${r.expected_ms} against declared ${def.expected_ms}`);
  }
  return bad;
}
