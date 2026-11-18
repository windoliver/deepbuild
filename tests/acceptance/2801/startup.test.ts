// #2801's three criteria: while a dev hub's core starts, a control call waits or is refused plainly as starting, never
// with an internal error's message (AC1); `deep hub status` polled every 2 s from the moment `deep hub start` returns
// never drops from an answer back to no answer (AC2); and `deep hub start` returns only once the core answers
// hub.health, so a `deep hub status` right after it succeeds (AC3). Each test starts its own hub with the `deep` CLI of
// this checkout (`deep hub start --root <scratch>`) and holds its core's start open (helpers.ts, holdStart; README).
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import {
  classify, cleanup, deep, requireDeepHook, holdStart, hubLog, plainStartup, probe, scratch, showTries, sleep, type Hold, type Probe, type Try,
} from './helpers.ts';

beforeAll(requireDeepHook);
afterEach(cleanup, 120_000);

/** Releases `h` `holdMs` after its reader arrives, or `idleMs` after `since()` is set if no reader ever comes. */
function releaseAfter(h: Hold, holdMs: number, until?: () => boolean): void {
  void h.reader.then(async () => {
    const end = Date.now() + holdMs;
    while (Date.now() < end && !(until?.() ?? false)) await sleep(10);
    h.release();
  });
}

describe('AC1 #2801.9ff40b64 while the hub starts, a control call waits for the core or is refused as starting, never with an internal error', () => {
  it('AC1 #2801.9ff40b64 hub.health and events.read sent every 100 ms on the socket from the moment `deep hub start --root` runs until the core has started: every refusal is a plain unavailable naming the startup, none carries an internal error\'s message', async () => {
    const { home, root } = scratch();
    const held = holdStart(root);
    // Each hold lasts 3 s from its reader's arrival: 3 s in which the core is starting with its thread free, then 3 s
    // with it held.
    releaseAfter(held.evidence, 3000);
    releaseAfter(held.transcripts, 3000);
    const t0 = Date.now();
    const started = deep(home, ['hub', 'start', '--root', root]);
    let startRan: Awaited<typeof started> | undefined;
    void started.then((r) => { startRan = r; });
    const probes: Promise<Probe>[] = [];
    const settled: Probe[] = [];
    let n = 0;
    // Until a hub.health sent after both holds were released (or 60 s after start returned, for a start that reads
    // neither file) is answered with the health; 150 s at most.
    for (;;) {
      const method = n++ % 2 === 0 ? 'hub.health' : 'events.read';
      probes.push(probe(root, method, method === 'events.read' ? { after: 0, limit: 10 } : {}, 60_000).then((p) => { settled.push(p); return p; }));
      await sleep(100);
      const doneAt = held.evidence.releasedAt !== undefined && held.transcripts.releasedAt !== undefined
        ? Math.max(held.evidence.releasedAt, held.transcripts.releasedAt)
        : startRan && Date.now() - startRan.ended > 60_000 ? startRan.ended : undefined;
      if (doneAt !== undefined && settled.some((p) => p.method === 'hub.health' && p.sent > doneAt && p.outcome.kind === 'answer')) break;
      if (Date.now() - t0 > 150_000) break;
    }
    const all = await Promise.all(probes);
    const start = await started;
    const at = (ms: number) => `+${ms - t0} ms`;
    const show = (p: Probe) => `${p.method} sent ${at(p.sent)}, settled ${at(p.settled)}: ${p.outcome.kind} ${JSON.stringify(p.outcome.kind === 'answer' ? Object.keys(p.outcome.result).slice(0, 6) : p.outcome.kind === 'refusal' ? p.outcome.error : p.outcome.why)}`;
    const summary = `deep hub start exit ${start.code} at ${at(start.ended)}; evidence journal read from ${held.evidence.readerAt ? at(held.evidence.readerAt) : 'never'}, released ${held.evidence.releasedAt ? at(held.evidence.releasedAt) : 'never'}; transcript cursors read from ${held.transcripts.readerAt ? at(held.transcripts.readerAt) : 'never'}, released ${held.transcripts.releasedAt ? at(held.transcripts.releasedAt) : 'never'}; ${all.length} calls: ${all.filter((p) => p.outcome.kind === 'answer').length} answered, ${all.filter((p) => p.outcome.kind === 'refusal').length} refused, ${all.filter((p) => p.outcome.kind === 'none').length} unanswered`;
    // Each distinct refusal, with how many calls got it and when the first and last of them were sent.
    const kinds = new Map<string, Probe[]>();
    for (const p of all) if (p.outcome.kind === 'refusal') { const k = `${p.method} ${JSON.stringify(p.outcome.error)}`; kinds.set(k, [...(kinds.get(k) ?? []), p]); }
    const refusals = [...kinds].map(([k, ps]) => `  ${ps.length} × sent ${at(ps[0]!.sent)} to ${at(ps.at(-1)!.sent)}: ${k}`).join('\n');
    console.log(`AC1 ${summary}\n${refusals}`);
    expect(start.code, `deep hub start --root exits 0: ${start.stderr}\n${hubLog(root)}`).toBe(0);
    const bad = all.filter((p) => p.outcome.kind === 'refusal' && !plainStartup(p.outcome.error));
    expect(bad.map(show), `refusals that are not a plain unavailable naming the startup, or carry an internal error's message (${summary}); every distinct refusal:\n${refusals}`).toEqual([]);
    expect(all.some((p) => p.method === 'hub.health' && p.outcome.kind === 'answer' && typeof p.outcome.result.start === 'string'), `the core started and hub.health answered with the health (${summary})\n${hubLog(root)}`).toBe(true);
  }, 300_000);
});

describe('AC2 #2801.a166701c polled every 2 s from the moment deep hub start returns, deep hub status never drops from an answer back to no answer', () => {
  it('AC2 #2801.a166701c `deep hub status --root` every 2 s from the moment `deep hub start --root` exits, until the health has answered three times in a row: no try after an answered one (health or refusal) gets no answer', async () => {
    const { home, root } = scratch();
    const held = holdStart(root);
    const tries: Try[] = [];
    let startEnded: number | undefined;
    // The first hold ends once a try has had an answer after `deep hub start` returned, or 4 s after its reader came
    // with `deep hub start` still waiting (a start that waits for the core); the second once a try got no answer, or
    // 5 s after its reader came, so a try's 2 s timeout falls inside it.
    releaseAfter(held.evidence, 30_000, () => (startEnded === undefined && held.evidence.readerAt !== undefined && Date.now() - held.evidence.readerAt >= 4000) || tries.some((t) => t.kind !== 'none'));
    releaseAfter(held.transcripts, 5000, () => tries.some((t, i) => t.kind === 'none' && tries.slice(0, i).some((u) => u.kind !== 'none')));
    const t0 = Date.now();
    const start = await deep(home, ['hub', 'start', '--root', root]);
    startEnded = Date.now();
    const deadline = Date.now() + 120_000;
    let next = Date.now();
    for (;;) {
      const r = await deep(home, ['hub', 'status', '--root', root], 30_000);
      tries.push(classify(r, startEnded));
      const last3 = tries.slice(-3);
      if (last3.length === 3 && last3.every((t) => t.kind === 'health')) break;
      if (Date.now() > deadline) break;
      next += 2000;
      await sleep(Math.max(0, next - Date.now()));
      next = Math.max(next, Date.now());
    }
    const summary = `deep hub start exit ${start.code} after ${startEnded - t0} ms; evidence journal read ${held.evidence.readerAt ? `${held.evidence.readerAt - startEnded} ms` : 'never'}, released ${held.evidence.releasedAt ? `${held.evidence.releasedAt - startEnded} ms` : 'never'}; transcript cursors read ${held.transcripts.readerAt ? `${held.transcripts.readerAt - startEnded} ms` : 'never'}, released ${held.transcripts.releasedAt ? `${held.transcripts.releasedAt - startEnded} ms` : 'never'} (times from start's return)\n${showTries(tries)}`;
    console.log(`AC2 ${summary}`);
    expect(start.code, `deep hub start --root exits 0: ${start.stderr}\n${hubLog(root)}`).toBe(0);
    expect(tries.slice(-3).every((t) => t.kind === 'health'), `the health answered three tries in a row within 120 s\n${summary}`).toBe(true);
    const first = tries.findIndex((t) => t.kind !== 'none');
    const dropped = tries.filter((t, i) => first >= 0 && i > first && t.kind === 'none');
    expect(dropped.length, `tries after the first answered one (try ${first + 1}) that got no answer:\n${summary}`).toBe(0);
  }, 300_000);
});

describe('AC3 #2801.9e13fccc deep hub start exits 0 only once the core answers hub.health, so deep hub status right after it succeeds', () => {
  it('AC3 #2801.9e13fccc `deep hub status --root` run the moment `deep hub start --root` exits 0 exits 0 with the health JSON', async () => {
    const { home, root } = scratch();
    const held = holdStart(root);
    let status: Awaited<ReturnType<typeof deep>> | undefined;
    let startEnded: number | undefined;
    // The core's start is held until the status run after `deep hub start` has finished, or 5 s after the hold's reader
    // came with `deep hub start` still waiting (a start that waits for the core). The second hold isn't used here.
    releaseAfter(held.evidence, 60_000, () => status !== undefined || (startEnded === undefined && held.evidence.readerAt !== undefined && Date.now() - held.evidence.readerAt >= 5000));
    held.transcripts.release();
    const t0 = Date.now();
    const start = await deep(home, ['hub', 'start', '--root', root]);
    startEnded = Date.now();
    status = await deep(home, ['hub', 'status', '--root', root], 30_000);
    const what = `deep hub start exit ${start.code} after ${startEnded - t0} ms (${start.stderr.trim() || 'no stderr'}); the core's start held from ${held.evidence.readerAt ? `+${held.evidence.readerAt - t0} ms` : 'never'} to ${held.evidence.releasedAt ? `+${held.evidence.releasedAt - t0} ms` : 'not yet'}; deep hub status right after: exit ${status.code} after ${status.ended - status.began} ms, stdout ${status.stdout.trim().slice(0, 300) || '(none)'}, stderr ${status.stderr.trim().slice(0, 400) || '(none)'}`;
    console.log(`AC3 ${what}`);
    expect(start.code, `deep hub start --root exits 0: ${what}\n${hubLog(root)}`).toBe(0);
    expect(status.code, `deep hub status right after deep hub start exits 0: ${what}`).toBe(0);
    const health = JSON.parse(status.stdout.trim().split('\n').pop() ?? 'null') as { start?: unknown; pid?: unknown } | null;
    expect(typeof health?.start === 'string' && Number.isInteger(health?.pid), `its stdout is the hub's health, one JSON line with its start ID and PID: ${what}`).toBe(true);
  }, 300_000);
});
