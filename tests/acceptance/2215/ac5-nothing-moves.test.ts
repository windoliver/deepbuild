// AC5 #2215.64bff3ff: Nothing else moves: every corpus document without both features on one material keeps its frame
// hashes, in raster and in finals.
//
// The corpus (helpers: `CORPUS`; README: The corpus): #422’s castle, the surfaces example, #428’s brushed anisotropic
// ball (anisotropy, no transmission) and #428’s frosted panes (transmission, no anisotropy), none with both features on
// one material. Each drawn by `view3d` at frame 0, one `deep-gpu run`; each frame’s hashes are the SHA-256s its final
// target (PNG) and its linear target (f32) are named by. Raster: each equals `hashes.json`’s, recorded at the base
// 5f5791e2d on the machine it names (README: The corpus); on another machine or macOS version, INCONCLUSIVE. Finals: the
// corpus as path-traced finals at 64 samples; without one (the base has none: #178), BLOCKED naming #178, and with one
// but no final hashes recorded at the merge base, BLOCKED until they are (README: The corpus). Each test prints the
// hashes it read, so a record is made by the same reading.
// Wrong programs: any change that moves a corpus frame, such as one that lists or stretches a part with only one of the
// two features, or retraces a material without both.
import { describe, it } from 'vitest';
import {
  AC, CORPUS, blocked, corpusCalls, finalReply, frameAt, framesOf, inconclusive, machine, none, readHashes, requireMetal, run, str, useDir, useGpu,
  type Hashes, type JsonObject,
} from './helpers.ts';

const ID = AC[5];
const bin = useGpu();
const dir = useDir();
/** The finals’ samples: enough to hash, few enough for the castle (README: The corpus). */
const FINAL_SAMPLES = 64;

type Read = Record<string, { final: string; linear: string }>;
function hashesOf(replies: JsonObject[], what: string): Read {
  const got: Read = {};
  CORPUS.forEach((m, i) => {
    const f = frameAt(framesOf(replies[i]!, `${m.name} (${what})`), 0, m.name);
    got[m.name] = { final: str(f.final, `${m.name}: final`), linear: str(f.linear, `${m.name}: linear`) };
  });
  return got;
}
function moved(got: Read, want: Hashes['raster'], base: string): string[] {
  const failures: string[] = [];
  for (const m of CORPUS) {
    const w = want[m.name];
    if (!w) { failures.push(`${m.name}: no hash recorded for it`); continue; }
    for (const k of ['final', 'linear'] as const) if (got[m.name]![k] !== w[k]) failures.push(`${m.name}: its ${k} target hashes ${got[m.name]![k]}, not ${w[k]} as at ${base}`);
  }
  return failures;
}

describe(`${ID} nothing else moves`, () => {
  it(`${ID} in raster, every corpus document keeps its frame hashes`, () => {
    requireMetal();
    const out = dir();
    const got = hashesOf(run(bin(), out, corpusCalls(out, null)), 'raster');
    console.log(`${ID}: raster hashes ${JSON.stringify(got)}`);
    const rec = readHashes(); const here = machine();
    if (here.model !== rec.recorded.model || here.os !== rec.recorded.os) {
      inconclusive(`the raster hashes were recorded on ${rec.recorded.model}, macOS ${rec.recorded.os}; this is ${here.model}, macOS ${here.os}`);
    }
    none(moved(got, rec.raster, rec.recorded.base), 'the corpus in raster');
  }, 3_600_000);

  it(`${ID} in finals, every corpus document keeps its frame hashes`, () => {
    requireMetal();
    const out = dir();
    const replies = run(bin(), out, corpusCalls(out, FINAL_SAMPLES));
    CORPUS.forEach((m, i) => finalReply(replies[i]!, FINAL_SAMPLES, `${m.name} as a final`));
    const got = hashesOf(replies, 'final');
    console.log(`${ID}: final hashes at ${FINAL_SAMPLES} samples ${JSON.stringify(got)}`);
    const rec = readHashes().final; const here = machine();
    if (!rec) blocked('no final frame hashes are recorded for the corpus: finals (#178) came after this suite', 'record them from this test’s printed hashes at the merge base, on the machine that runs it (README: The corpus)');
    if (here.model !== rec.model || here.os !== rec.os) inconclusive(`the final hashes were recorded on ${rec.model}, macOS ${rec.os}; this is ${here.model}, macOS ${here.os}`);
    if (rec.samples !== FINAL_SAMPLES) blocked(`the final hashes were recorded at ${rec.samples} samples, not ${FINAL_SAMPLES}`, 'record them again at the merge base');
    none(moved(got, rec.hashes, rec.base), 'the corpus in finals');
  }, 7_200_000);
});
