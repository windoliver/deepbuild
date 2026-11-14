// AC5: "A model bake whose runner job can't start is BLOCKED naming the analyzer, never PASS"
//
// The activity bake of AC3's fixture (fixtures/synth.ts speechUnderMusic). Through the design's surfaces (README: The
// surface): media_bake {kind: activity, analyzer: silero-vad@6.2.3} with no record is BLOCKED and keeps the PCM; the
// model host starts and deepbuild/bakes installs (its tools qualify on the host), then the host is stopped, so the job
// can't start: its host doesn't answer. deep_job's bake.activity on silero-vad@6.2.3 must then be BLOCKED, naming the
// analyzer, with no output, and called again BLOCKED on the same ask: one unblock ask in the record, naming the
// analyzer. The bake stays BLOCKED, naming the analyzer, with no readings: never a pass. The planted hub
// `job-host-down-done` (DEEP_HUB_PLANT, README: Planted programs) answers such a job done with an empty record, and
// the judge fails it, naming the analyzer.
import { describe, expect, it } from 'vitest';
import { pcmBytes, sha256, speechUnderMusic, wavF32 } from './fixtures/synth.ts';
import { AC, JOB, TIMEOUT, VAD, asks, bakes, blocked, lastPos, mustBlockForPcm, openWorld, proof, recordOf, runJob, stopHost, useShow, withBakes, type Bake, type HubPlant, type Line } from './helpers.ts';

const show = useShow();

/** One world's bake whose job can't start, judged: its failures, each naming the analyzer, and what was seen. */
async function judgeBlocked(plant?: HubPlant): Promise<{ failures: string[]; seen: Line }> {
  const fx = speechUnderMusic();
  const wav = wavF32(fx.samples, fx.rate);
  const asset = sha256(wav);
  const w = await openWorld([wav], plant);
  const ask: Bake = { asset, kind: 'activity', analyzer: VAD, threshold: 0.5 };
  const pcm = mustBlockForPcm(show(), w, ask, pcmBytes(fx.samples), 'the phrases under music, with no record');
  await withBakes(w);
  await stopHost(w);

  const failures: string[] = [];
  const job = `the job ${JOB.activity} on ${VAD} for the PCM ${pcm}, its model host not answering`;
  const pos = await lastPos(w);
  const first = await runJob(w, JOB.activity, VAD, [{ name: 'pcm', sha256: pcm }], fx.rate);
  const second = await runJob(w, JOB.activity, VAD, [{ name: 'pcm', sha256: pcm }], fx.rate);
  const unblocks = (await asks(w, pos)).filter((a) => a.kind === 'unblock');
  const [after] = bakes(show(), w, [ask], 'the phrases under music, after the job');
  const seen: Line = { pcm, first: first.outcome.value, second: second.outcome.value, yeses: [...first.yeses, ...second.yeses], unblocks: unblocks.map((a) => ({ handle: a.handle, ...a.data })), bake: after };
  for (const [label, o] of [['called once', first.outcome], ['called again', second.outcome]] as const) {
    if (String(o.value.status).toUpperCase() !== 'BLOCKED') failures.push(`${job}, ${label}, must be BLOCKED naming ${VAD}, never a pass; it answered ${o.text.slice(0, 800)}`);
    else if (!o.text.includes(VAD)) failures.push(`${job}, ${label}, is BLOCKED but doesn't name the analyzer ${VAD}: ${o.text.slice(0, 800)}`);
    if (recordOf(o) !== undefined) failures.push(`${job}, ${label}, answered a record ${String(recordOf(o))}: a job that can't start makes none (${VAD})`);
  }
  if (first.outcome.value.ask !== second.outcome.value.ask) failures.push(`${job}, called twice, must wait on one ask; it answered ${JSON.stringify(first.outcome.value.ask)} then ${JSON.stringify(second.outcome.value.ask)} (${VAD})`);
  if (unblocks.length !== 1 || !unblocks[0]!.text.includes(VAD)) failures.push(`${job} must raise one unblock ask naming ${VAD}; the record gained ${unblocks.length}: ${JSON.stringify(unblocks.map((a) => a.data)).slice(0, 1500)}`);
  const said = JSON.stringify(after);
  if (!blocked(after!) || !said.includes(VAD)) failures.push(`the activity bake by ${VAD}, its job unable to start, must stay BLOCKED naming ${VAD}, with no readings; it answered ${said.slice(0, 800)}`);
  return { failures, seen };
}

describe('AC5 a model bake whose job can\'t start is BLOCKED naming the analyzer', () => {
  it(`${AC[5]} with its model host stopped, the activity bake's job is BLOCKED naming ${VAD} with one unblock ask, and the bake stays BLOCKED, never a pass; the planted hub job-host-down-done fails, naming the analyzer`, async () => {
    const clean = await judgeBlocked();
    proof('ac5-blocked.json', clean);
    expect(clean.failures, 'the job and the bake are BLOCKED naming the analyzer, never a pass').toEqual([]);

    const plant: HubPlant = 'job-host-down-done';
    const planted = await judgeBlocked(plant);
    proof('ac5-planted.json', { plant, ...planted });
    expect(planted.failures.length > 0 && planted.failures.every((f) => f.includes(VAD)), `the planted hub ${plant} fails, each failure naming ${VAD}: ${JSON.stringify(planted.failures)}`).toBe(true);
    expect(planted.failures[0] ?? '', `the planted hub ${plant} answers the job as a pass, which fails first`).toMatch(/must be BLOCKED naming/);
  }, TIMEOUT);
});
