// AC4 #503.89909452, Oracle lane, WAV: the cases of one upstream engine's WAV reading test (pinned on the oracle page
// at ed1daf0bf0, tests/scene/test_audio_stream_wav.cpp), ported as cases, not code: 8-bit and 16-bit PCM, mono and
// stereo, a 440 Hz sine on the first channel and a 261.63 Hz sine on the second over the full range of the format, one
// second at 44.1 kHz; the same at 38 kHz for 38,000 frames; and an empty 8-bit file. That test writes each file and
// reads it back, checking its rate, channel count, length and samples equal what was written; here the worker reads
// it, and its samples are held to the reference decode by PCM hash (each sample ÷ 2^(depth − 1); 8-bit WAV is unsigned,
// its sample the byte less 128).
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { AC4, FULL, TIMEOUT, decodeAll, none, requireMac, sha256, useShow, useTemp, type Pcm } from './helpers.ts';

const show_ = useShow([FULL]);
const temp = useTemp();

interface Case { name: string; bits: 8 | 16; stereo: boolean; rate: number; frames: number }
const CASES: Case[] = [
  { name: 'mono PCM8', bits: 8, stereo: false, rate: 44_100, frames: 44_100 },
  { name: 'mono PCM16', bits: 16, stereo: false, rate: 44_100, frames: 44_100 },
  { name: 'stereo PCM8', bits: 8, stereo: true, rate: 44_100, frames: 44_100 },
  { name: 'stereo PCM16', bits: 16, stereo: true, rate: 44_100, frames: 44_100 },
  { name: 'stereo PCM16 at 38 kHz', bits: 16, stereo: true, rate: 38_000, frames: 38_000 },
  { name: 'empty PCM8', bits: 8, stereo: false, rate: 44_100, frames: 0 },
];

/** The case's file (a plain 44-byte PCM header) and its reference decode. */
function made(c: Case): { wav: Buffer; ref: Buffer } {
  const ch = c.stereo ? 2 : 1; const width = c.bits / 8; const data = Buffer.alloc(c.frames * ch * width); const ref = Buffer.alloc(c.frames * ch * 4);
  for (let n = 0; n < c.frames; n++) for (let k = 0; k < ch; k++) {
    const s = Math.sin(((2 * Math.PI * (k === 0 ? 440 : 261.63)) / c.rate) * n);
    const i = n * ch + k;
    if (c.bits === 8) {
      const u = Math.trunc(((s + 1) / 2) * 255);
      data[i] = u; ref.writeFloatLE((u - 128) / 128, 4 * i);
    } else {
      const v = Math.trunc(((s + 1) / 2) * 65535) - 32768;
      data.writeInt16LE(v, 2 * i); ref.writeFloatLE(v / 32768, 4 * i);
    }
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0, 'ascii'); head.writeUInt32LE(36 + data.length, 4); head.write('WAVE', 8, 'ascii');
  head.write('fmt ', 12, 'ascii'); head.writeUInt32LE(16, 16); head.writeUInt16LE(1, 20); head.writeUInt16LE(ch, 22);
  head.writeUInt32LE(c.rate, 24); head.writeUInt32LE(c.rate * ch * width, 28); head.writeUInt16LE(ch * width, 32); head.writeUInt16LE(c.bits, 34);
  head.write('data', 36, 'ascii'); head.writeUInt32LE(data.length, 40);
  return { wav: Buffer.concat([head, data]), ref };
}

describe(`${AC4} an upstream engine's WAV cases on our WAV decoder`, () => {
  it(`${AC4} 8- and 16-bit, mono and stereo, at 44.1 and 38 kHz, and an empty file, read back with their rate, channels, length and samples`, () => {
    requireMac('the decode worker');
    const dir = temp();
    const files = CASES.map((c, i) => {
      const { wav, ref } = made(c);
      const path = join(dir, `case-${i}.wav`); writeFileSync(path, wav);
      return { c, path, ref };
    });
    const decoded = decodeAll(show_.bin(FULL), temp(), files.map((f) => ({ name: f.c.name, path: f.path, out: temp() })));
    const failures: string[] = [];
    for (const f of files) {
      const got = decoded.get(f.c.name)!;
      if (typeof got === 'string') { failures.push(got); continue; }
      const p = got as Pcm; const ch = f.c.stereo ? 2 : 1;
      if (p.rate !== f.c.rate || p.channels !== ch || p.frames !== f.c.frames) failures.push(`${f.c.name}: read back as ${p.frames} frames of ${p.channels} channels at ${p.rate} Hz, written ${f.c.frames} of ${ch} at ${f.c.rate}`);
      if (sha256(p.bytes) !== sha256(f.ref)) failures.push(`${f.c.name}: its samples read back aren't those written (PCM hash ${sha256(p.bytes)}, the reference ${sha256(f.ref)})`);
    }
    none(failures, 'the upstream WAV cases through our decoder');
  }, TIMEOUT);
});
