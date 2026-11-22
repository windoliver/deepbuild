// AC7 #2892.95bb7e98: "The lab's step hashes through `probe()` equal the merge base's, and two exports of one piece on two
// machines are byte-identical"
//
// asserts:
//   - the lab's bundle stores the player compressed (else it is the merge base's form and the comparison proves nothing);
//     the merge base's deep-show, built from its tree (`git archive` of `git merge-base HEAD origin/main`), exports the
//     lab on the same track; each bundle played in headless Chrome (#172's server and browser) and seeked to each step
//     1 … 600 in turn: probe()'s step and step hashes (the world's and the logic item's) at every seek are the merge
//     base's, else the first step that differs is named with both hashes;
//   - on this Mac, two exports of the lab in clean homes (fresh HOME and TMPDIR, another user, other paths, 1.5 s apart)
//     are byte-identical; the planted exporter `web_gzip_header_time` (it writes the export's time into each stored
//     file's gzip header) beside a clean export differs, naming a file the bundle stores compressed;
//   - two machines: this Mac's export and one made on the Linux aarch64 host (`DEEP_LINUX_AARCH64`,
//     `DEEP_LINUX_AARCH64_DIR`, as #172's criterion 6) in a clean home are byte-identical; BLOCKED when no host is
//     configured, never a pass.
// Wrong programs: a player whose stepping the change moved (names the step); a compressor whose output carries the time,
// the host or the machine's zlib build (the planted header time on one machine, the Linux host across two).
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  FULL, LAB_STEPS, REPO, TIMEOUT, blocked, bundleDifference, done, failsNaming, none, play, useBrowsers, useShow, useTemp, type JsonValue,
} from '../172/helpers.ts';
import { AC, baseShow, cleanExport, exportIn, gitEnv, linuxExport, storedFiles, storedPlayerFailures, type Stored } from './helpers.ts';

const shows = useShow([FULL]);
const temp = useTemp();
const browsers = useBrowsers();
const HEADER_TIME = 'web_gzip_header_time';
const pause = (ms: number): void => { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); };
const macArm64 = (): void => {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') blocked(`this export must run on macOS arm64; this is ${process.platform} ${process.arch}. Unblock: run this file on the reference Mac`);
};

interface Seeked { step: number; hash: JsonValue }
/** Every step 1 … 600 in turn, seeked as a host sets currentTime, read through probe(): its step and step hashes. */
async function stepHashes(folder: string, what: string): Promise<Seeked[]> {
  const p = browsers(await play(folder));
  await p.tab.mustBeReady(what);
  const out = await p.tab.evaluate<Seeked[]>(`(async () => { const p = document.querySelector('deep-player'); const out = [];
    const read = async () => JSON.parse(JSON.stringify(await p.probe()));
    for (let k = 1; k <= ${LAB_STEPS}; k++) {
      p.currentTime = k / 60;
      let v = await read(); const until = performance.now() + 5000;
      while (v.step !== k && performance.now() < until) { await new Promise((d) => setTimeout(d, 10)); v = await read(); }
      out.push({ step: v.step, hash: v.step_hash ?? null });
    }
    return out; })()`, 1_800_000);
  await done(p);
  return out;
}

describe(`${AC[7]} the lab steps as the merge base's, and bundles are byte-identical on two machines`, () => {
  it(`${AC[7]} the lab's step hashes through probe() at every step 1 … ${LAB_STEPS} equal the merge base's`, async () => {
    const what = 'the lab exported to the web';
    const lab = { out: join(temp(), 'bundle'), evidence: temp() };
    const receipt = exportIn(shows(FULL), REPO, process.env, lab.evidence, lab.out, what);
    none(storedPlayerFailures(lab.out, receipt, what), 'the bundle stores the player compressed, as the decision says');
    const base = baseShow(temp(), 'the merge base\'s deep-show');
    const old = { out: join(temp(), 'bundle'), evidence: temp() };
    exportIn(base.bin, base.cwd, gitEnv(), old.evidence, old.out, `the lab exported by the merge base ${base.base}`);
    const now = await stepHashes(lab.out, what);
    const then = await stepHashes(old.out, `the merge base's bundle (${base.base})`);
    const f: string[] = [];
    for (let i = 0; i < LAB_STEPS; i++) {
      const a = now[i]; const b = then[i];
      if (!a || !b) { f.push(`seek ${i + 1}: no reading (${a ? 'the merge base' : 'this change'} answered none)`); break; }
      if (a.step !== b.step || JSON.stringify(a.hash) !== JSON.stringify(b.hash)) { f.push(`seek to step ${i + 1}: this change's player reads step ${a.step} with ${JSON.stringify(a.hash)}, the merge base's step ${b.step} with ${JSON.stringify(b.hash)}`); break; }
    }
    console.log(`${AC[7]} ${now.length} seeks read against the merge base ${base.base}; step ${LAB_STEPS}: ${JSON.stringify(now[LAB_STEPS - 1] ?? null)}`);
    none(f, `the lab's step hashes through probe() equal the merge base's (${base.base})`);
  }, TIMEOUT);

  it(`${AC[7]} two exports of the lab in clean homes on this Mac are byte-identical, and the planted ${HEADER_TIME} differs, naming a stored file`, () => {
    macArm64();
    const dir = temp();
    const a = cleanExport(shows(FULL), dir, 'deep2892a', 1);
    none(storedPlayerFailures(a.out, a.receipt, 'the first export'), 'the bundle stores the player compressed, as the decision says');
    pause(1_500);
    const b = cleanExport(shows(FULL), dir, 'deep2892bb', 3);
    const diff = bundleDifference(a.out, b.out);
    expect(diff, `two exports of the lab on this Mac are byte-identical${diff ? `: ${diff}` : ''}`).toBeNull();
    pause(1_500);
    const p = cleanExport(shows(FULL), dir, 'deep2892c', 2, HEADER_TIME);
    const pdiff = bundleDifference(a.out, p.out);
    const compressed = new Set([...storedFiles(a.receipt, 'the first export'), ...storedFiles(p.receipt, 'the planted export')].filter((f: Stored) => f.compressed).map((f) => f.path));
    const named = [...compressed].find((path) => pdiff?.startsWith(`${path} `));
    const failures = pdiff ? [`the bundles differ: ${pdiff}${named ? ` (${named} is stored compressed)` : ''}`] : [];
    console.log(`${AC[7]} planted ${HEADER_TIME}: ${failures.join(' | ') || 'byte-identical'}`);
    failsNaming(failures, 'stored compressed', `the planted ${HEADER_TIME}`);
  }, TIMEOUT);

  it(`${AC[7]} the lab exported on two machines, this Mac and a Linux aarch64 host, in clean homes, is byte-identical; with no Linux host configured, BLOCKED`, () => {
    const dir = temp();
    const linux = linuxExport(dir, 'the lab exported on Linux aarch64');
    macArm64();
    const mac = cleanExport(shows(FULL), dir, 'deep2892m', 1);
    none(storedPlayerFailures(mac.out, mac.receipt, 'this Mac\'s export'), 'the bundle stores the player compressed, as the decision says');
    const diff = bundleDifference(mac.out, linux);
    expect(diff, `the Linux aarch64 bundle is byte-identical to this Mac's${diff ? `: ${diff}` : ''}`).toBeNull();
  }, TIMEOUT);
});
