// A library take's samples (#154): WAVE PCM at 8, 16, 24 or 32 bits or 32-bit float, or FLAC, mixed to one channel
// at its own rate. A take's bytes are its asset's, by hash; nothing here reads a path.
import { decode as flac } from './flac.mjs';

/** `{rate, samples: Float64Array}` of a take's bytes, one channel, each sample in [−1, 1]. */
export function take(bytes) {
  const b = Buffer.from(bytes);
  if (b.subarray(0, 4).toString('latin1') === 'fLaC') {
    const d = flac(b);
    const n = d.channels[0].length;
    const out = new Float64Array(n);
    const scale = 2 ** (d.bps - 1) * d.channels.length;
    for (const ch of d.channels) for (let i = 0; i < n; i++) out[i] += ch[i] / scale;
    return { rate: d.rate, samples: out };
  }
  if (b.subarray(0, 4).toString('latin1') !== 'RIFF' || b.subarray(8, 12).toString('latin1') !== 'WAVE') throw Error('a take is a WAVE or FLAC file');
  let at = 12;
  let fmt;
  let data;
  while (at + 8 <= b.length) {
    const id = b.subarray(at, at + 4).toString('latin1');
    const len = b.readUInt32LE(at + 4);
    if (id === 'fmt ') {
      const tag = b.readUInt16LE(at + 8);
      // WAVE_FORMAT_EXTENSIBLE names its own format in the first two bytes of its subformat.
      const format = tag === 0xfffe && len >= 26 ? b.readUInt16LE(at + 32) : tag;
      fmt = { format, channels: b.readUInt16LE(at + 10), rate: b.readUInt32LE(at + 12), bits: b.readUInt16LE(at + 22) };
    }
    if (id === 'data') data = b.subarray(at + 8, Math.min(b.length, at + 8 + len));
    at += 8 + len + (len % 2);
  }
  if (!fmt || !data) throw Error('a WAVE take without fmt and data');
  const float = fmt.format === 3;
  if (!float && fmt.format !== 1) throw Error(`a WAVE take of format ${fmt.format}, neither PCM nor float`);
  const width = fmt.bits / 8;
  const frames = Math.floor(data.length / (width * fmt.channels));
  const out = new Float64Array(frames);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c++) {
      const o = (i * fmt.channels + c) * width;
      if (float) sum += data.readFloatLE(o);
      else if (width === 1) sum += (data[o] - 128) / 128;
      else sum += data.readIntLE(o, width) / 2 ** (fmt.bits - 1);
    }
    out[i] = sum / fmt.channels;
  }
  return { rate: fmt.rate, samples: out };
}
