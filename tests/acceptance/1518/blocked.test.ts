// #1518.ef499157: "With the transcriber missing, `cut.heard` is BLOCKED, naming it, and a planted check that passes on an
// empty transcript fails"
//
// Six tone words, word 2 left out (README: Fixtures), in a film that is the claim's one deliverable. The judgment
// (blockedFailures): the verdict's cut.heard row is BLOCKED and the verdict isn't PASS; the row holds one cut.heard_unrun
// entry naming the document, the item `cut`, the job narration.transcript and the transcriber whisper-cpp@1.9.5, the
// cut result's PCM by its hash (kept in the store), 48 kHz, two channels, English. Then the transcriber itself is
// missing: deepbuild/speech installed and its model host stopped, deep_job narration.transcript on that PCM is BLOCKED
// naming whisper-cpp@1.9.5 and makes no transcript, and the verdict holds the same judgment. The planted
// cut_heard_passes_empty, which reads the missing transcript as an empty one and fails no lost word, fails it.
import { describe, expect, it } from 'vitest';
import {
  AC, DOC, FULL, ITEM, RATE, SPEECH, TIMEOUT, TRANSCRIBER, TRANSCRIPT, coded, fieldOf, filmRun, keepAllBut, openWorld, outputOf, PLANTED, presented,
  proof, rowFrom, runJob, show, soundFilm, stageWav, stopHost, storedIntact, toneTake, useShow, useTemp, verdictCall, withPlugin, type JsonObject,
} from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const take = toneTake(6);
const KEEP = keepAllBut(6, [2]);

/** The judgment: the cut.heard row BLOCKED, naming the transcriber, with its PCM kept. Failures as sentences. */
function blockedFailures(verdict: JsonObject, evidence: string): { failures: string[]; pcm: string | null } {
  const f: string[] = [];
  const rows = (Array.isArray(verdict['requirements']) ? verdict['requirements'] : []).filter((r): r is JsonObject => typeof r === 'object' && r !== null && !Array.isArray(r) && (r['from'] as JsonObject | undefined)?.['default'] === 'cut.heard');
  if (rows.length !== 1) return { failures: [`the verdict holds ${rows.length} rows with from: {default: "cut.heard"}, not one: ${show(verdict['requirements'] ?? null, 1500)}`], pcm: null };
  const row = rows[0]!;
  if (row['result'] !== 'BLOCKED') f.push(`the cut.heard row is ${String(row['result'])}, not BLOCKED, while no transcript of the cut result exists: ${show(row, 1500)}`);
  if (verdict['result'] === 'PASS') f.push('the claim\'s verdict is PASS while cut.heard has not run');
  const entries = coded(row, 'cut.heard_unrun');
  if (entries.length !== 1) return { failures: [...f, `the row holds ${entries.length} cut.heard_unrun entries, not one for the item ${ITEM}: ${show(row, 1500)}`], pcm: null };
  const e = entries[0]!;
  const v = (k: string) => fieldOf(e, k);
  const want: [string, unknown][] = [['item', ITEM], ['job', TRANSCRIPT], ['analyzer', TRANSCRIBER], ['sample_rate', RATE], ['channels', 2], ['locale', 'en']];
  for (const [k, x] of want) if (v(k) !== x) f.push(`the cut.heard_unrun entry's ${k} is ${JSON.stringify(v(k) ?? null)}, not ${JSON.stringify(x)}: ${show(e, 800)}`);
  if (String(v('doc') ?? '').toLowerCase() !== DOC.a.toLowerCase()) f.push(`the cut.heard_unrun entry names the document ${JSON.stringify(v('doc') ?? null)}, not ${DOC.a}`);
  const pcm = typeof v('pcm_sha256') === 'string' ? (v('pcm_sha256') as string) : null;
  if (!pcm || !storedIntact(evidence, pcm)) f.push(`the store doesn't keep the cut result's PCM by the hash the entry names (${JSON.stringify(pcm)}) for the job`);
  return { failures: f, pcm };
}

describe(`${AC[7]} with the transcriber missing cut.heard is BLOCKED naming it; a check passing on an empty transcript fails`, () => {
  it(`${AC[7]} with no transcript, and with the transcriber's host stopped so its job can't run, the cut.heard row is BLOCKED naming ${TRANSCRIBER}`, async () => {
    const bin = shows.bin(FULL);
    const w = await openWorld();
    const s = stageWav(w.evidence, take);
    const doc = soundFilm(s.sha, [s.record], KEEP, 3);
    const [shown, v0] = filmRun(bin, w.evidence, doc, [verdictCall], 'the cut with no transcript');
    presented(shown, 'the cut with no transcript');
    const first = blockedFailures(v0!, w.evidence);
    expect(first.failures, first.failures.join(' | ')).toEqual([]);

    await withPlugin(w, SPEECH);
    await stopHost(w, SPEECH);
    const job = await runJob(w, { op: 'run', kind: TRANSCRIPT, tool: TRANSCRIBER, params: JSON.stringify({ sample_rate: RATE, channels: 2, locale: 'en', names: [] }), inputs: [{ name: 'pcm', sha256: first.pcm! }] });
    const [, v1] = filmRun(bin, w.evidence, doc, [verdictCall], 'the cut after the transcriber could not run');
    const after = blockedFailures(v1!, w.evidence);
    proof('ac7-blocked.json', { before: rowFrom(v0!, 'cut.heard', 'before'), job: job.outcome.value, after: v1 });

    expect(String(job.outcome.value['status']).toUpperCase(), `${TRANSCRIPT} on ${TRANSCRIBER}, its host stopped: BLOCKED, never done: ${job.outcome.text.slice(0, 800)}`).toBe('BLOCKED');
    expect(job.outcome.text.includes(TRANSCRIBER), `the BLOCKED reply names ${TRANSCRIBER}: ${job.outcome.text.slice(0, 800)}`).toBe(true);
    expect(outputOf(job.outcome, 'transcript'), 'no transcript is made').toBeUndefined();
    expect(after.failures, `after the transcriber could not run: ${after.failures.join(' | ')}`).toEqual([]);
  }, TIMEOUT);

  it(`${AC[7]} the planted cut_heard_passes_empty, which reads the missing transcript as an empty one, fails the same judgment`, () => {
    const evidence = temp();
    const s = stageWav(evidence, take);
    const [shown, verdict] = filmRun(shows.bin(FULL), evidence, soundFilm(s.sha, [s.record], KEEP, 3), [verdictCall], 'the cut with no transcript', { planted: PLANTED.empty });
    presented(shown, 'the cut with no transcript, planted');
    const { failures } = blockedFailures(verdict!, evidence);
    proof('ac7-planted.json', { verdict, failures });
    expect(failures.length, `the judgment fails the check that passes on an empty transcript: ${show(verdict, 1500)}`).toBeGreaterThan(0);
  }, TIMEOUT);
});
