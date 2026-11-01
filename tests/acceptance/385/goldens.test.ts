// Criterion 4: goldens render with Vello CPU's f32 pipeline at the scalar SIMD level; the same fixture at the NEON
// level differs by at most one code value per channel, and a golden asked at a detected SIMD level or through the u8
// pipeline is refused, naming the setting.
//
// `deep-canvas-render raster` draws goldens. README: it takes `simd` (scalar | neon | detected, default scalar),
// `pipeline` (f32 | u8, default f32) and `golden` (default true); a golden asked with any setting but scalar f32 is
// refused `golden_config` with `path` naming the setting, and nothing is written; `golden: false` draws a reading at
// the settings asked. Every answer names its renderer and settings. The fixtures are this suite's: the writer layer,
// the ramp in every blend mode, the sectors and the OKLab gradient. At the base `raster` ignores the three fields and
// names no renderer.
import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  LOOK, MODES, RENDER, answers, blendDoc, drawLine, inconclusive, lockedVersions, obj, oklabDoc, readDrawn, sectorsDoc, useBuilds, useDir, within,
  writerDoc, type JsonObject,
} from './helpers.ts';

const builds = useBuilds([RENDER]);
const dir = useDir('deep-385-goldens-');
const FIXTURES: [string, JsonObject][] = [['writer', writerDoc()], ['oklab', oklabDoc()], ['sectors', sectorsDoc()], ...MODES.map((m) => [`blend-${m}`, blendDoc(m)] as [string, JsonObject])];

/** The answer's renderer and settings. */
function rendererOf(answer: JsonObject, what: string): JsonObject {
  return obj(answer['renderer'], `${what}: the answer's renderer`);
}

describe('C4 goldens: Vello CPU\'s f32 pipeline at the scalar SIMD level', () => {
  it('C4 every golden names Vello CPU, f32, scalar; and the same fixture at the NEON level differs by at most one code value per channel', () => {
    if (process.arch !== 'arm64') inconclusive(`the NEON level needs an aarch64 machine; this is ${process.arch}`);
    const d = dir();
    const lines = FIXTURES.flatMap(([, doc]) => [drawLine(d, doc, LOOK), drawLine(d, doc, LOOK, { golden: false, simd: 'neon', pipeline: 'f32' })]);
    const out = answers(builds.bin(RENDER), ['raster'], lines);
    const failures: string[] = [];
    for (const [i, [name]] of FIXTURES.entries()) {
      const golden = readDrawn(lines[2 * i]!, out[2 * i]!, `${name}: the golden`);
      const neon = readDrawn(lines[2 * i + 1]!, out[2 * i + 1]!, `${name}: at NEON`);
      const g = rendererOf(golden.report, `${name}: the golden`);
      expect(g, `${name}: the golden is Vello CPU ${lockedVersions('vello_cpu').join(' or ')}, its f32 pipeline at the scalar level`).toEqual({ name: 'vello_cpu', version: lockedVersions('vello_cpu')[0], pipeline: 'f32', simd: 'scalar' });
      expect(golden.report['golden'], `${name}: the answer says it is a golden`).toBe(true);
      expect(rendererOf(neon.report, `${name}: at NEON`), `${name}: the reading names the NEON level`).toMatchObject({ name: 'vello_cpu', pipeline: 'f32', simd: 'neon' });
      expect(neon.report['golden'], `${name}: a reading at NEON is no golden`).toBe(false);
      const r = within(neon.image, golden.image, 1);
      if (r.share !== 1) failures.push(`${name}: at NEON (${r.worst?.x}, ${r.worst?.y}) is ${JSON.stringify(r.worst?.a)} against the golden's ${JSON.stringify(r.worst?.b)}, ${r.worst?.diff} codes`);
    }
    expect(failures, 'NEON against scalar, per channel').toEqual([]);
  }, 1_800_000);

  it('C4 a golden asked at the detected SIMD level, or through the u8 pipeline, is refused naming the setting, and writes nothing; the same asked as a reading draws', () => {
    const d = dir();
    const detected = drawLine(d, writerDoc(), LOOK, { simd: 'detected' });
    const u8 = drawLine(d, writerDoc(), LOOK, { pipeline: 'u8' });
    const both = drawLine(d, writerDoc(), LOOK, { golden: true, simd: 'detected', pipeline: 'u8' });
    const readingDetected = drawLine(d, writerDoc(), LOOK, { golden: false, simd: 'detected' });
    const readingU8 = drawLine(d, writerDoc(), LOOK, { golden: false, pipeline: 'u8' });
    const [a, b, c, e, f] = answers(builds.bin(RENDER), ['raster'], [detected, u8, both, readingDetected, readingU8]);
    expect(a, 'a golden at the detected SIMD level is refused, naming simd').toMatchObject({ ok: false, code: 'golden_config', path: 'simd' });
    expect(b, 'a golden through the u8 pipeline is refused, naming pipeline').toMatchObject({ ok: false, code: 'golden_config', path: 'pipeline' });
    expect(c!['ok'], 'a golden with both is refused').toBe(false);
    expect(c!['code'], 'a golden with both is refused as a golden config').toBe('golden_config');
    for (const [line, what] of [[detected, 'detected'], [u8, 'u8'], [both, 'both']] as const) expect(existsSync(String(line['out'])), `the refused golden (${what}) wrote no PNG`).toBe(false);
    const rd = readDrawn(readingDetected, e!, 'a reading at the detected level');
    expect(rendererOf(rd.report, 'the detected reading'), 'a reading at the detected level names the level it found, never scalar').toMatchObject({ name: 'vello_cpu', pipeline: 'f32', simd: process.arch === 'arm64' ? 'neon' : expect.not.stringMatching(/^scalar$/) });
    const ru = readDrawn(readingU8, f!, 'a reading through u8');
    expect(rendererOf(ru.report, 'the u8 reading'), 'a reading through u8 names it').toMatchObject({ name: 'vello_cpu', pipeline: 'u8', simd: 'scalar' });
  }, 1_800_000);
});
