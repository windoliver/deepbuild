// The encode job kind (#518; canvas primitives: Export: encode job): encoding as a registered job kind, with today's
// encoders as its first tools. An export renders, hashes and checks its canonical frames and streams each one to the
// tool that registers its codec, so the kind's input is the frames' hashes in order, their format (BGRA8, or NV12
// with its conversion pass's version) and the PCM's hash, and the frames themselves arrive while the export draws:
// no job runs it on its own, and it is never skipped as a cache hit. Its one output is the delivery's file. A tool
// qualifies in the canvas core (`encode_qualify`): it encodes the export kinds' fixture film, and its delivery, read
// back from its own bytes in a fresh decode worker apart from the tool, passes export.fidelity, export.color and the
// sync rule. Every delivery runs those kinds again, so nothing a tool says is trusted.
//
// The first tools are the build's own, run by the canvas core as its encode tool process: `videotoolbox`, the
// platform's encoder on macOS, and `png-sequence`, our own PNG sequence writer. Their names are the ones an
// export's receipt gives its `encoder` (crates/deep-show/src/export/tools.rs).

const PARAMS = {
  type: 'object',
  properties: {
    codec: { type: 'string' },
    container: { type: ['string', 'null'], default: null },
    keyframe_interval: { type: ['integer', 'null'], default: null },
    quality: { enum: ['draft', 'standard', 'master'], default: 'standard' },
    bitrate: { type: ['integer', 'null'], default: null },
  },
  required: ['codec'],
  additionalProperties: false,
};

export default async function (deep: any): Promise<void> {
  await deep.registerJob('encode', {
    schema: { params: PARAMS, inputs: { frames: { media: 'application/json' }, pcm: { media: 'audio/*' } } },
    outputs: { file: { media: 'application/octet-stream' } },
    key: ['tool', 'params', 'inputs'],
    output_checks: [],
    qualification: { fixtures: [], core: 'encode_qualify' },
  });
  await deep.registerJobTool('encode', {
    tool: 'videotoolbox@1.0.0',
    params: PARAMS,
    codecs: ['h264', 'hevc', 'prores_4444'],
    containers: ['mp4', 'mov'],
    hardware: true,
    input: 'memory',
    frame_delay: 0,
    run: { core: true },
    qualification: { same_bytes: false },
  });
  await deep.registerJobTool('encode', {
    tool: 'png-sequence@1.0.0',
    params: PARAMS,
    codecs: ['png_seq'],
    containers: ['png'],
    hardware: false,
    input: 'memory',
    frame_delay: 0,
    run: { core: true },
    qualification: { same_bytes: false },
  });
}
