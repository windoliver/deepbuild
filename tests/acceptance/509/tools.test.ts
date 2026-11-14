// #509.72d0ae67: "deep_job lists the speech kind with Kokoro, the platform voices and Azure as its tools; a test
// plug-in's speech tool that passes the kind's qualification appears beside them and speaks the kind's fixture line,
// while a planted list kept as an enum in code leaves it out and fails, naming the tool"
//
// A real hub with deepbuild/speech installed from packages/jobs/speech (its model host on 8720). deep_job {op: "list"}
// holds the kind `speech`, held by deepbuild/speech, with kokoro@0.9.4, platform-say@1.0.0 and azure-speech@1.0.0
// among its tools. The test plug-in test/speech-voice (fixtures/voice) registers one more tool, test-voice@1.0.0,
// through deep.registerJobTool: a local program that answers the kind's qualification fixture, the empty line, with an
// empty WAV, and speaks the kind's fixture line ("The quick brown fox jumps over the lazy dog.") from a recording the
// test makes with `say -v Samantha`. The judge: the install succeeds (the qualification passes), the list holds the tool
// beside the three under `speech`, and deep_job runs it on the fixture line to done, its `audio` the tool's recording
// and its `record` naming the tool, the line and the audio's hash. Each failure names test-voice@1.0.0. On the clean
// hub the judge finds nothing; on the planted hub `job-speech-tools-enum` (DEEP_HUB_PLANT), whose tool list is the
// three first-party names kept in code, it fails, every failure naming the tool.
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, AZURE, FIXTURE_LINE, KOKORO, PLATFORM, SPEECH, TIMEOUT, done, install, kinds, lineWav, openWorld, outputOf, proof, readJson, runJob, sha256, shown,
  toolsOf, voicePlugin, withPlugin, type Line,
} from './helpers.ts';

const TOOL = 'test-voice@1.0.0';
const PLUGIN = 'test/speech-voice';
const FIRST_PARTY = [KOKORO, PLATFORM, AZURE];

/** One world's judge: the first-party list, then the test tool installed, listed and run on the fixture line. */
async function judgeTools(plant?: string): Promise<{ failures: string[]; firstParty: Line[]; seen: Line }> {
  const w = await openWorld([], plant);
  await withPlugin(w, SPEECH);
  const before = await kinds(w);
  const speech = before.find((k) => k['kind'] === 'speech');
  const wav = lineWav();
  const dir = await voicePlugin(join(w.tmp, 'voice'), { id: PLUGIN, tool: 'test-voice', version: '1.0.0' }, wav);
  const installed = await install(w, dir);
  const listed = toolsOf(await kinds(w), 'speech');
  const run = await runJob(w, { op: 'run', kind: 'speech', tool: TOOL, params: JSON.stringify({ say: FIXTURE_LINE, voice: 'samantha', rate: 1 }) });
  const failures: string[] = [];
  if (installed.code !== 0) failures.push(`${TOOL}: deep install of ${PLUGIN} is refused, though its tool passes the kind's qualification: ${shown(installed)}`);
  const mine = listed.find((t) => t['tool'] === TOOL);
  if (!mine) failures.push(`${TOOL}: deep_job lists no such tool under speech beside ${FIRST_PARTY.join(', ')}: ${JSON.stringify(listed.map((t) => t['tool']))}`);
  else if (mine['plugin'] !== PLUGIN) failures.push(`${TOOL}: deep_job lists it under ${JSON.stringify(mine['plugin'])}, not ${PLUGIN}`);
  for (const t of FIRST_PARTY) if (mine && !listed.some((x) => x['tool'] === t)) failures.push(`${TOOL} is listed, but not beside ${t}: ${JSON.stringify(listed.map((x) => x['tool']))}`);
  let record: Line | undefined;
  if (!done(run.outcome)) failures.push(`${TOOL}: deep_job doesn't run it on the kind's fixture line to done: ${run.outcome.text.slice(0, 800)}`);
  else {
    const audio = outputOf(run.outcome, 'audio');
    const rec = outputOf(run.outcome, 'record');
    if (audio !== sha256(wav)) failures.push(`${TOOL}: its audio for the fixture line is ${JSON.stringify(audio)}, not the tool's recording ${sha256(wav)}`);
    if (!rec) failures.push(`${TOOL}: its run on the fixture line answers no record`);
    else {
      record = readJson(w.evidence, rec, `${TOOL}'s record`);
      if (record['say'] !== FIXTURE_LINE || !String(record['engine']).includes('test-voice') || record['audio_sha256'] !== audio) {
        failures.push(`${TOOL}: its record must name the tool, the fixture line and the audio's hash: ${JSON.stringify(record)}`);
      }
    }
  }
  return { failures, firstParty: (speech?.['tools'] ?? []) as Line[], seen: { plant: plant ?? null, before, install: installed, listed, run: run.outcome.value, record: record ?? null } };
}

describe(`${AC[9]} the speech kind's tools are a registered list: the first-party three and a test plug-in's tool beside them`, () => {
  it(`${AC[9]} deep_job lists speech with ${KOKORO}, ${PLATFORM} and ${AZURE}; ${TOOL} qualifies, is listed beside them and speaks the fixture line`, async () => {
    const clean = await judgeTools();
    proof('ac9-tools.json', clean);
    for (const t of FIRST_PARTY) {
      expect(clean.firstParty.find((x) => x['tool'] === t)?.['plugin'], `deep_job lists ${t} under the kind speech, registered by ${SPEECH.id}: ${JSON.stringify(clean.firstParty)}`).toBe(SPEECH.id);
    }
    expect(clean.failures, 'the test tool joins the kind and speaks its fixture line').toEqual([]);
  }, TIMEOUT);

  it(`${AC[9]} the planted hub job-speech-tools-enum, its tool list kept in code, leaves ${TOOL} out and fails, every failure naming it`, async () => {
    const planted = await judgeTools('job-speech-tools-enum');
    proof('ac9-planted-enum.json', planted);
    expect(planted.failures.length, 'the planted hub fails the judge').toBeGreaterThan(0);
    expect(planted.failures.filter((f) => !f.includes(TOOL)), `every failure names ${TOOL}: ${JSON.stringify(planted.failures)}`).toEqual([]);
  }, TIMEOUT);
});
