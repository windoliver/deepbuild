// The speech plug-in (#509; canvas primitives: Narration: speech engines, Check input: narration.transcript@1): the job
// kinds speech and narration.transcript, whose tools run on this package's model host (host/host.py) at the address its
// manifest names. speech takes {say, voice, rate} and no inputs, so its key is the tool's name@version, its weights and
// those three; it writes `audio`, a 16-bit mono WAV at the engine's own rate, and `record`, which its output check
// speech.audio holds to the WAV and the tool. narration.transcript takes a line's PCM, interleaved f32 little-endian, and
// writes `transcript`, the record of what the pinned transcriber heard. The engines are registered here, one tool each,
// never listed in the hub: another plug-in's speech tool joins the kind the same way once it passes its qualification,
// the empty line, which every tool answers with an empty WAV and no call, so installing never makes a paid call. The
// kind's fixture line, which a new tool speaks through deep_job to show it joins, is
// `The quick brown fox jumps over the lazy dog.`
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

interface Row { kind: string; tool: string; host: string }
const manifest: { job_tools: Row[] } = JSON.parse(readFileSync(new URL('./deepbuild.json', import.meta.url), 'utf8'));

type Weight = { name: string; sha256: string };
const KOKORO: Weight[] = [
  { name: 'kokoro-config.json', sha256: '5abb01e2403b072bf03d04fde160443e209d7a0dad49a423be15196b9b43c17f' },
  { name: 'kokoro-v1_0.pth', sha256: '496dba118d1a58f5f3db2efc88dbdc216e0483fc89fe6e47ee1f2c53f18ad1e4' },
  { name: 'kokoro-af_heart.pt', sha256: '0ab5709b8ffab19bfd849cd11d98f75b60af7733253ad0d67b12382a102cb4ff' },
  { name: 'kokoro-bf_emma.pt', sha256: 'd0a423deabf4a52b4f49318c51742c54e21bb89bbbe9a12141e7758ddb5da701' },
  { name: 'kokoro-zf_xiaobei.pt', sha256: '9b76be63dab4f4f96962030acc0126a9aee9728608fbbe115e2b58a2bd504df6' },
];
const WHISPER: Weight[] = [
  { name: 'whisper.cpp-1.9.5.tar.gz', sha256: 'ff1a9053feb509ff9d7729703355541ae9690073a6b1c40eb692c962e0dc1720' },
  { name: 'ggml-base.en.bin', sha256: 'a03779c86df3323075f5e796cb2ce5029f00ec8869eee3fdfb897afe36c6d002' },
  { name: 'ggml-small.bin', sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b' },
  { name: 'nltk-averaged_perceptron_tagger_eng.zip', sha256: '6025f530624335c67d6547d44757b357b4e79bae030a0383e9887a92c1718f0b' },
  { name: 'nltk-cmudict.zip', sha256: 'd07cca47fd72ad32ea9d8ad1219f85301eeaf4568f8b6b73747506a71fb5afd6' },
];
/**
 * Each tool: its files on the host by hash, the capabilities its call needs, its price per call in USD, and whether a
 * rerun gives the same bytes. Azure Speech's price is for a line of up to 1,000 characters at $15 per million, the
 * most its host speaks in one call.
 */
const TOOLS: Record<string, { weights?: Weight[]; needs?: string[]; cost?: { usd: number }; same_bytes: boolean }> = {
  'kokoro@0.9.4': { weights: KOKORO, same_bytes: true },
  'platform-say@1.0.0': { needs: ['say'], same_bytes: false },
  'azure-speech@1.0.0': { needs: ['azure-speech-key'], cost: { usd: 0.015 }, same_bytes: false },
  'whisper-cpp@1.9.5': { weights: WHISPER, same_bytes: true },
};
const KINDS: Record<string, { params: object; inputs: Record<string, { media: string }>; outputs: Record<string, { media: string }>; check: string; fixture: Record<string, unknown> }> = {
  speech: {
    params: {
      type: 'object',
      properties: { say: { type: 'string' }, voice: { type: 'string' }, rate: { type: 'number', minimum: 0.5, maximum: 2, default: 1 } },
      required: ['say', 'voice'],
      additionalProperties: false,
    },
    inputs: {},
    outputs: { audio: { media: 'audio/wav' }, record: { media: 'application/json' } },
    check: 'speech.audio',
    // The empty line: an empty WAV and no call, whatever the voice.
    fixture: { say: '', voice: '' },
  },
  'narration.transcript': {
    params: {
      type: 'object',
      properties: {
        sample_rate: { type: 'integer', minimum: 1 }, channels: { type: 'integer', minimum: 1 },
        locale: { type: 'string', minLength: 1 }, names: { type: 'array', items: { type: 'string' }, default: [] },
      },
      required: ['sample_rate', 'channels', 'locale'],
      additionalProperties: false,
    },
    inputs: { pcm: { media: 'audio/x-f32le' } },
    outputs: { transcript: { media: 'application/json' } },
    check: 'narration.transcript_record',
    // No PCM: the record of an empty line, and no model run.
    fixture: { sample_rate: 16000, channels: 1, locale: 'en' },
  },
};

interface Spec { runner?: string; outputs?: Record<string, string> }
const bytesOf = (spec: Spec, name: string): Buffer => Buffer.from(String(spec?.outputs?.[name] ?? ''), 'base64');
const outcome = (name: string, why: string | undefined) => ({
  outcome: why ? 'failed' : 'passed', testsRun: 1, evidence: [], read: [], mask: null,
  failures: why ? [{ test: name, file: 'index.ts', line: 1, stack: null, assertion: true, message: `${name}: ${why}` }] : [],
});

/** A 16-bit mono PCM WAV's samples, or why it isn't one. */
function samplesOf(wav: Buffer): Int16Array | string {
  if (wav.length < 12 || wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') return 'the audio is no RIFF WAVE file';
  let format: { tag: number; channels: number; bits: number } | undefined;
  for (let at = 12; at + 8 <= wav.length;) {
    const id = wav.toString('ascii', at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    if (at + 8 + size > wav.length) return `the audio's ${id} chunk runs past its end`;
    if (id === 'fmt ' && size >= 16) format = { tag: wav.readUInt16LE(at + 8), channels: wav.readUInt16LE(at + 10), bits: wav.readUInt16LE(at + 22) };
    if (id === 'data') {
      if (!format || format.tag !== 1 || format.channels !== 1 || format.bits !== 16) return 'the audio is no 16-bit mono PCM WAV';
      const data = wav.subarray(at + 8, at + 8 + size - (size % 2));
      return new Int16Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.length));
    }
    at += 8 + size + (size % 2);
  }
  return 'the audio has no data chunk';
}

/** speech.audio: the WAV parses, it isn't silent throughout unless `say` is empty, and the record names the tool and the audio's hash. */
async function speechAudio(spec: Spec) {
  let why: string | undefined;
  try {
    const audio = bytesOf(spec, 'audio');
    const record = JSON.parse(bytesOf(spec, 'record').toString('utf8'));
    const samples = samplesOf(audio);
    const sha = createHash('sha256').update(audio).digest('hex');
    // Silent: every sample under −60 dBFS, |s| ÷ 32768 below 10^−3.
    const loud = typeof samples === 'string' ? 0 : samples.reduce((most, s) => Math.max(most, Math.abs(s)), 0);
    if (typeof samples === 'string') why = samples;
    else if (record?.kind !== 'speech') why = `the record's kind is ${JSON.stringify(record?.kind)}, not speech`;
    else if (record.engine !== spec.runner) why = `the record names the engine ${JSON.stringify(record.engine)}, and ${spec.runner} ran`;
    else if (record.audio_sha256 !== sha) why = `the record names the audio ${JSON.stringify(record.audio_sha256)}, and the audio is ${sha}`;
    else if (record.say !== '' && loud / 32768 < 1e-3) why = `the audio is silent throughout: its loudest sample, ${loud}, is under −60 dBFS, and say isn't empty`;
  } catch {
    why = 'the output record is no JSON record';
  }
  return outcome('speech.audio', why);
}

/** narration.transcript_record: the record's kind is the job's, its analyzer is the tool that ran, and it holds what was heard. */
async function transcriptRecord(spec: Spec) {
  let why: string | undefined;
  const listed = (v: unknown) => Array.isArray(v) && v.every((w) => typeof w?.text === 'string' && Array.isArray(w?.phonemes) && w.phonemes.every((p: unknown) => typeof p === 'string'));
  try {
    const record = JSON.parse(bytesOf(spec, 'transcript').toString('utf8'));
    if (record?.kind !== 'narration.transcript') why = `the record's kind is ${JSON.stringify(record?.kind)}, not narration.transcript`;
    else if (record.analyzer !== spec.runner) why = `the record names the analyzer ${JSON.stringify(record.analyzer)}, and ${spec.runner} ran`;
    else if (typeof record.text !== 'string' || !listed(record.words) || !listed(record.names)) why = 'the record holds no text, words and names, each word and name its text and phonemes';
  } catch {
    why = 'the output transcript is no JSON record';
  }
  return outcome('narration.transcript_record', why);
}

export default async function (deep: any): Promise<void> {
  await deep.registerCheck('speech.audio', speechAudio);
  await deep.registerCheck('narration.transcript_record', transcriptRecord);
  for (const [kind, k] of Object.entries(KINDS)) {
    await deep.registerJob(kind, {
      schema: { params: k.params, inputs: k.inputs },
      outputs: k.outputs,
      key: ['tool', 'params', 'inputs'],
      output_checks: [k.check],
      qualification: { fixtures: [{ name: kind === 'speech' ? 'empty-line' : 'no-pcm', params: k.fixture, inputs: Object.fromEntries(Object.keys(k.inputs).map((n) => [n, ''])), expect: {} }] },
    });
  }
  for (const { kind, tool, host } of manifest.job_tools) {
    const { same_bytes, ...declared } = TOOLS[tool]!;
    await deep.registerJobTool(kind, { tool, params: KINDS[kind]!.params, run: { url: `http://${host}/${tool}` }, ...declared, qualification: { same_bytes } });
  }
}
