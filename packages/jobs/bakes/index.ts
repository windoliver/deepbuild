// The analysis bake's model kinds (#1819; canvas primitives: Analysis bake): the job kinds bake.words, bake.beats and
// bake.activity, each on one pinned tool, its analyzer, that runs an open model on this package's model host
// (host/host.py) and declares its weight files by hash. A job's input `pcm` is an asset's decoded PCM, interleaved f32
// little-endian, so the job's key is the analyzer's version, its weights and the PCM's hash. Its one output, `bake`,
// is the record media_bake reads; a record's output check holds it to the kind and the tool that ran. The host's
// address is the one this package's manifest names for its tools.
import { readFileSync } from 'node:fs';

interface Row { kind: string; tool: string; host: string }
const manifest: { job_tools: Row[] } = JSON.parse(readFileSync(new URL('./deepbuild.json', import.meta.url), 'utf8'));

/** Each tool's weight files on its host, by name and SHA-256. */
const CHARSIU = [
  { name: 'charsiu-en_w2v2_fc_10ms.bin', sha256: '6dc8a18422db7c22e951d5f72dc2afc267b942eb0b8459ac6dcc0cf412536de1' },
  { name: 'charsiu-en_w2v2_fc_10ms.json', sha256: '7406aa4f917267640865688aa62f2337664a3abb9a49a2f204d932b53aeb6cb7' },
  { name: 'charsiu-tokenizer_en_cmu.json', sha256: '781514e251e9615ea4a05bbf3760ffcf8ec2ebe67355f411177ea64b0602d897' },
  { name: 'cmudict-0.7b.dict', sha256: '81917843c7f44ce2b094ac63873c2c7a4cf802040792c455ba3ca406891c3d22' },
];
const WEIGHTS: Record<string, { name: string; sha256: string }[]> = {
  'bake.words': CHARSIU,
  'bake.beats': [{ name: 'beat_this-final0.ckpt', sha256: '8c328b45f59d8dd3dff219253ff6a8d6482be57d0133a29140e2febbf8eb8331' }],
  'bake.activity': [{ name: 'silero_vad-6.2.3.jit', sha256: 'e1122837f4154c511485fe0b9c64455f7b929c96fbb8d79fbdb336383ebd3720' }],
};
/** The PCM's layout: its rate in Hz and its channel count. */
const PCM = {
  type: 'object',
  properties: { sample_rate: { type: 'integer', minimum: 1 }, channels: { type: 'integer', minimum: 1 } },
  required: ['sample_rate', 'channels'],
  additionalProperties: false,
};
const INPUTS: Record<string, Record<string, { media: string }>> = {
  'bake.words': { pcm: { media: 'audio/x-f32le' }, text: { media: 'text/plain' } },
  'bake.beats': { pcm: { media: 'audio/x-f32le' } },
  'bake.activity': { pcm: { media: 'audio/x-f32le' } },
};

interface Spec { runner?: string; outputs?: Record<string, string> }

/** A record's check: JSON whose kind is the job's and whose analyzer is the tool that ran. */
function recordCheck(kind: string) {
  const name = `${kind}_record`;
  return async (spec: Spec) => {
    let why: string | undefined;
    try {
      const record = JSON.parse(Buffer.from(String(spec?.outputs?.bake ?? ''), 'base64').toString('utf8'));
      if (record.kind !== kind) why = `the record's kind is ${JSON.stringify(record.kind)}, not ${kind}`;
      else if (record.analyzer !== spec.runner) why = `the record names the analyzer ${JSON.stringify(record.analyzer)}, and ${spec.runner} ran`;
    } catch {
      why = 'the output bake is no JSON record';
    }
    return {
      outcome: why ? 'failed' : 'passed', testsRun: 1, evidence: [], read: [], mask: null,
      failures: why ? [{ test: name, file: 'index.ts', line: 1, stack: null, assertion: true, message: `${name}: ${why}` }] : [],
    };
  };
}

export default async function (deep: any): Promise<void> {
  for (const row of manifest.job_tools) {
    const { kind, tool, host } = row;
    await deep.registerCheck(`${kind}_record`, recordCheck(kind));
    // The qualification can't judge a model by text; an empty PCM's call shows only that the tool answers.
    const empty = Object.fromEntries(Object.keys(INPUTS[kind]!).map((n) => [n, '']));
    await deep.registerJob(kind, {
      schema: { params: PCM, inputs: INPUTS[kind] },
      outputs: { bake: { media: 'application/json' } },
      key: ['tool', 'params', 'inputs'],
      output_checks: [`${kind}_record`],
      qualification: { fixtures: [{ name: 'answers', params: { sample_rate: 16000, channels: 1 }, inputs: empty, expect: {} }] },
    });
    await deep.registerJobTool(kind, {
      tool,
      params: PCM,
      run: { url: `http://${host}/${tool}` },
      weights: WEIGHTS[kind],
      qualification: { same_bytes: true },
    });
  }
}
