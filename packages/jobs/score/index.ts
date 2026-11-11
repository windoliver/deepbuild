// score@1's renderer (#154; canvas primitives: Score `score.music@1` and `score.render@1`, As built): the job kind
// score.render on its one tool, score-render@1.0.0, the program in ./tool that the hub runs with Node. A run renders
// one stem of a score from the plan `deep-show run`'s `score_plan` call answers: its params are that stem's events in
// samples, its instruments and its loop region, and its list input `samples` the takes its library presets name, so
// the key is hash(tool@version, params, the takes' hashes) and an edit to another part misses no other stem's key.
// Its outputs are `stem`, a 48 kHz stereo 24-bit FLAC, and `meta`, the stem's note_on, loop, credits and made_by.
// Its output check is score.pitch, `score.render.pitch`: every declared note measured in the stem itself.
import { outOfTune } from './tool/pitch.mjs';

const PARAMS = {
  type: 'object',
  properties: {
    stem: { type: 'string' },
    seed: { type: 'string' },
    sample_rate: { type: 'integer', minimum: 48000, maximum: 48000, default: 48000 },
    format: { enum: ['flac'], default: 'flac' },
    loop: { type: ['object', 'null'], default: null },
    instruments: { type: 'object' },
    credits: { type: 'array', items: { type: 'object' }, default: [] },
    events: { type: 'array', items: { type: 'object' } },
  },
  required: ['stem', 'seed', 'instruments', 'events'],
  additionalProperties: false,
};

/** The kind's qualification: a plucked note and a sine, a tenth of a second each, and the meta a tool must write. */
const FIXTURE_PARAMS = {
  stem: 'q', seed: 'qualify', loop: null, credits: [],
  instruments: { p: { source: { pluck: { preset: 'nylon' } } }, s: { source: { synth: { preset: 'sine' } } } },
  events: [{ id: 'n1', inst: 'p', at: 0, dur: 4800, pitch: 64 }, { id: 'n2', inst: 's', at: 2400, dur: 4800, pitch: 69.5 }],
};
const FIXTURE_META = '{"stem":"q","sample_rate":48000,"length":9600,"loop":null,"note_on":[{"event":"n1","sample":0,"pitch":64,"take":null,"attack":0},{"event":"n2","sample":2400,"pitch":69.5,"take":null,"attack":0.005}],"credits":[],"made_by":{"tool":"score-render","version":"1.0.0","synthetic":true,"made_from":[]},"stem_sha256":"e9000ff985d1621f085a553068fd5b1a5540e5a274de3a9b53ee74f41bd7c098"}';

interface Spec { outputs?: Record<string, string> }

export default async function (deep: any): Promise<void> {
  await deep.registerCheck('score.render.pitch', async (spec: Spec) => {
    let found: string[];
    try {
      const stem = Buffer.from(String(spec?.outputs?.stem ?? ''), 'base64');
      const meta = JSON.parse(Buffer.from(String(spec?.outputs?.meta ?? ''), 'base64').toString('utf8'));
      found = outOfTune(stem, meta);
    } catch (e) {
      found = [`score.pitch: the stem or its meta can't be read: ${e instanceof Error ? e.message : String(e)}`];
    }
    return {
      outcome: found.length ? 'failed' : 'passed', testsRun: 1, evidence: [], read: [], mask: null,
      failures: found.map((message) => ({ test: 'score.render.pitch', file: 'tool/pitch.mjs', line: 1, stack: null, assertion: true, message })),
    };
  });
  await deep.registerJob('score.render', {
    schema: { params: PARAMS, inputs: { samples: { media: 'audio/*', many: true } } },
    outputs: { stem: { media: 'audio/flac' }, meta: { media: 'application/json' } },
    key: ['tool', 'params', 'inputs'],
    output_checks: ['score.render.pitch'],
    qualification: { fixtures: [{ name: 'pluck-and-sine', params: FIXTURE_PARAMS, inputs: {}, expect: { meta: FIXTURE_META } }] },
  });
  await deep.registerJobTool('score.render', {
    tool: 'score-render@1.0.0',
    params: PARAMS,
    run: { dir: 'tool', entry: 'render.mjs' },
    qualification: { same_bytes: true },
  });
}
