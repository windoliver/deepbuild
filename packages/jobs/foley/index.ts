// foley@1's renderer (#155; canvas primitives: Foley `foley.render@1`): the job kind foley.render on its one tool,
// foley-render@1.0.0, the program in ./tool that the hub runs with Node. A run renders one foley preset into 3 levels
// × 4 round robins: its params hold the preset's value as its pack carries it and the seed (a film's plan gives the
// preset's own name, `foley.<material>.<action>@1`, whose action sets the voice's span), and it takes no input files,
// so the key is hash(tool@version, params). Its outputs are the twelve variants `l<level>r<rr>`, each a 48 kHz mono
// 16-bit WAVE, and `meta`, each variant's hash, length, level and round robin, and made_by. Its output check is
// `foley.render.variants`: each variant is a 48 kHz WAVE that isn't silent throughout, and is the one meta hashes.
import { createHash } from 'node:crypto';

const LEVELS = 3;
const ROUND_ROBINS = 4;
const RATE = 48000;
const VARIANTS = Array.from({ length: LEVELS * ROUND_ROBINS }, (_, i) => `l${Math.floor(i / ROUND_ROBINS) + 1}r${(i % ROUND_ROBINS) + 1}`);

const PARAMS = {
  type: 'object',
  properties: {
    preset: { type: 'object' },
    seed: { type: 'string' },
    levels: { type: 'integer', const: LEVELS },
    round_robins: { type: 'integer', const: ROUND_ROBINS },
    sample_rate: { type: 'integer', const: RATE },
  },
  required: ['preset', 'seed', 'levels', 'round_robins', 'sample_rate'],
  additionalProperties: false,
};

/** The kind's qualification: a 2 ms noise burst, tapped, and the meta a tool must write. */
const FIXTURE_PARAMS = {
  preset: {
    nodes: {
      src: { kind: 'noise', color: 'white' },
      env: { kind: 'env', attack: 0, hold: 0, decay: 0.002, sustain: 0, release: 0 },
      burst: { kind: 'gain', gain: 0 },
      out: { kind: 'gain', gain: 'vel' },
    },
    edges: [['src', 'burst', 'in'], ['env', 'burst', 'gain'], ['burst', 'out', 'in']],
    out: 'out',
    params: { vel: { unit: 'level', range: [0, 1], default: 1 } },
    cost: 6,
  },
  seed: 'qualify.noise.tap@1', levels: LEVELS, round_robins: ROUND_ROBINS, sample_rate: RATE,
};
const FIXTURE_META = '{"seed":"qualify.noise.tap@1","sample_rate":48000,"levels":3,"round_robins":4,"variants":{"l1r1":{"sha256":"ea5e0dd7f3e9909d3c06c86b7d8beab60c13b8861af46d7e815db6c7424a69d8","length":97,"level":1,"round_robin":1},"l1r2":{"sha256":"de7ae48af079ca4bf3c8b69d2e02c5ad5e7844c507616858fd665af65dec7577","length":97,"level":1,"round_robin":2},"l1r3":{"sha256":"f660833f1946d95f621a61a27087ba8f96cf609265a3bce659138e712b7b05d0","length":97,"level":1,"round_robin":3},"l1r4":{"sha256":"c533ca83ac4a9a212228011699503a47f827d36d5935369ecaa4e8a45ec15c12","length":97,"level":1,"round_robin":4},"l2r1":{"sha256":"9d25057ec2da1a47856d5f6b0182fba2c7f9c4c59ea1d06e12d060b4e6c13ff6","length":97,"level":2,"round_robin":1},"l2r2":{"sha256":"14ef06430d753e23b5f9f96d6894d00edb15029096c5c58cd4ad2bfd1910967a","length":97,"level":2,"round_robin":2},"l2r3":{"sha256":"b3ee7225500b5a2339879f3c9d451f739bd8a64b9de6be8a91c4782ece937c35","length":97,"level":2,"round_robin":3},"l2r4":{"sha256":"ff684d1d7ed99538a911f498f941bd0a1767aa82ab24b7d771e1e31c310debde","length":97,"level":2,"round_robin":4},"l3r1":{"sha256":"d2c39da4c50bda4f2e2b611b3537cfc54be9578c7ab1dd9fb3703341780a8f3f","length":97,"level":3,"round_robin":1},"l3r2":{"sha256":"58ebb57f413021ba690c97b40b7395be3631caec93a7fca41b62ba525f655627","length":97,"level":3,"round_robin":2},"l3r3":{"sha256":"80b1f5e2f8a8b7fdb903d8d74c5cadc999d644f4b1f8c999d7527655e2ea244e","length":97,"level":3,"round_robin":3},"l3r4":{"sha256":"8ca268880f0b61d8b11e406af5842a9d8ed7afc325cd9da90b2cf1d6fc29b51a","length":97,"level":3,"round_robin":4}},"made_by":{"tool":"foley-render","version":"1.0.0","synthetic":true}}';

interface Spec { outputs?: Record<string, string> }
interface Meta { variants?: Record<string, { sha256?: unknown; length?: unknown }> }

/** Why a variant isn't a 48 kHz mono 16-bit WAVE that sounds, the one meta names, or nothing. */
function fault(id: string, bytes: Buffer, meta: Meta): string | undefined {
  if (bytes.length < 12 || bytes.toString('latin1', 0, 4) !== 'RIFF' || bytes.toString('latin1', 8, 12) !== 'WAVE') return `${id} isn't a RIFF WAVE file`;
  let fmt: { tag: number; channels: number; rate: number; bits: number } | undefined;
  let data: Buffer | undefined;
  for (let at = 12; at + 8 <= bytes.length;) {
    const len = bytes.readUInt32LE(at + 4);
    const id4 = bytes.toString('latin1', at, at + 4);
    if (id4 === 'fmt ' && len >= 16) fmt = { tag: bytes.readUInt16LE(at + 8), channels: bytes.readUInt16LE(at + 10), rate: bytes.readUInt32LE(at + 12), bits: bytes.readUInt16LE(at + 22) };
    if (id4 === 'data') data = bytes.subarray(at + 8, Math.min(bytes.length, at + 8 + len));
    at += 8 + len + (len % 2);
  }
  if (!fmt || !data) return `${id} has no fmt and data`;
  if (fmt.tag !== 1 || fmt.channels !== 1 || fmt.rate !== RATE || fmt.bits !== 16) return `${id} is format ${fmt.tag}, ${fmt.channels} channels at ${fmt.rate} Hz and ${fmt.bits} bits, not mono 16-bit PCM at ${RATE} Hz`;
  const frames = Math.floor(data.length / 2);
  let sounds = false;
  for (let i = 0; i < frames && !sounds; i++) sounds = data.readInt16LE(i * 2) !== 0;
  if (!sounds) return `${id} is silent throughout`;
  const named = meta.variants?.[id];
  if (!named) return `meta names no variant ${id}`;
  const sha = createHash('sha256').update(bytes).digest('hex');
  if (named.sha256 !== sha) return `${id} hashes to ${sha}, and meta names ${String(named.sha256)}`;
  if (named.length !== frames) return `${id} holds ${frames} samples, and meta names ${String(named.length)}`;
  return undefined;
}

export default async function (deep: any): Promise<void> {
  await deep.registerCheck('foley.render.variants', async (spec: Spec) => {
    let found: string[];
    try {
      const out = spec?.outputs ?? {};
      const meta = JSON.parse(Buffer.from(String(out.meta ?? ''), 'base64').toString('utf8')) as Meta;
      found = VARIANTS.map((id) => fault(id, Buffer.from(String(out[id] ?? ''), 'base64'), meta)).filter((f): f is string => f !== undefined);
    } catch (e) {
      found = [`foley.render.variants: the meta can't be read: ${e instanceof Error ? e.message : String(e)}`];
    }
    return {
      outcome: found.length ? 'failed' : 'passed', testsRun: 1, evidence: [], read: [], mask: null,
      failures: found.map((message) => ({ test: 'foley.render.variants', file: 'index.ts', line: 1, stack: null, assertion: true, message })),
    };
  });
  await deep.registerJob('foley.render', {
    schema: { params: PARAMS, inputs: {} },
    outputs: { ...Object.fromEntries(VARIANTS.map((id) => [id, { media: 'audio/wav' }])), meta: { media: 'application/json' } },
    key: ['tool', 'params', 'inputs'],
    output_checks: ['foley.render.variants'],
    qualification: { fixtures: [{ name: 'noise-tap', params: FIXTURE_PARAMS, inputs: {}, expect: { meta: FIXTURE_META } }] },
  });
  await deep.registerJobTool('foley.render', {
    tool: 'foley-render@1.0.0',
    params: PARAMS,
    run: { dir: 'tool', entry: 'render.mjs' },
    qualification: { same_bytes: true },
  });
}
