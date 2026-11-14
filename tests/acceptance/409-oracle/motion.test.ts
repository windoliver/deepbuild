// #409.c9b3929c (AC2): "Motion share measured in the app matches the outside film gate on the same export within
// 0.005"
//
// Oracle lane (README): the outside film gate the issue's Oracle page pins (a single MIT-licensed script that reads only
// an MP4), run against our output as #136 asks. Its tests require a slow push to read red (its fast-motion ratio under
// 0.035) and a punch green (0.06 or more); that ratio is craft@1's motion share (12 fps, 320 px wide, grey, the caption
// band masked, cuts and cross-fades left out, a pair counted at a mean difference of 9 levels or more).
//
// Fixtures (../409/helpers.ts): the slow film (three 3 s shots, each a slow 7.5% push, joined by cuts) and the lively
// film (three 4 s shots, a cut and a 2 s cross-fade, with a bar sweeping across the first two for a second each), both
// 640 × 360 at 12 frames a second, made by the agent and exported by deep-show to an MP4; the verdict on a claim whose
// brief names motion_share alone gives the app's measure of the same film (its row's `measure.share`).
//
// asserts: the gate reads the slow export red (fast_ratio under 0.035) and the lively export green (0.06 or more), as
// its own tests ask of a slow push and a punch; and for each film |the app's motion share − the gate's fast_ratio| ≤
// 0.005. BLOCKED, never PASS, when the gate (pinned by SHA-256), uv, ffmpeg or ffprobe can't be found, with one line
// saying how to unblock it. Wrong program: the base (motion_share has no row and no measure).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  AC, FULL, TIMEOUT, blockedUnless, briefOf, docId, judge, livelyFilm, measureOf, named, show, slowFilm, useBuilds, useFolders, type Film,
} from '../409/helpers.ts';

const bin = useBuilds([FULL]);
const folder = useFolders();

/** The gate: `DEEP_FILM_GATE`, else this fixed path outside the repository. */
const GATE_PATH = process.env['DEEP_FILM_GATE'] ?? join(homedir(), 'Library', 'Caches', 'deepbuild', 'film-gate', 'film_gate.py');
/** The gate's bytes at the commit the Oracle page pins (`scripts/film_gate.py` in its vendored folder). */
const GATE_SHA256 = '2d375cc2bea291e7a1b837d5755b49fbda72f5f75515758c09bf7d83cd269e52';
const UNBLOCK = `unblock: save the outside film gate the #409 Oracle page pins (doneright/oracles/issues/409.md on branch doneright of DeepBuildAI/deepbuild: its scripts/film_gate.py) at ${GATE_PATH}, or name it in DEEP_FILM_GATE`;
const TOOLS = ['/opt/homebrew/bin', '/usr/local/bin'];
const which = (name: string): string | null => {
  for (const dir of [...(process.env['PATH'] ?? '').split(':'), ...TOOLS]) if (dir && existsSync(join(dir, name))) return join(dir, name);
  return null;
};

/** The gate's report on an MP4, through `uv run --script` (its inline metadata names numpy and opencv-python-headless). */
function gate(uv: string, mp4: string, cwd: string): Record<string, unknown> {
  const path = [...TOOLS, ...(process.env['PATH'] ?? '').split(':')].join(':');
  const r = spawnSync(uv, ['run', '--quiet', '--script', GATE_PATH, mp4, '--json', '--no-template'], { cwd, encoding: 'utf8', env: { ...process.env, PATH: path }, timeout: 1_800_000, maxBuffer: 64 * 1024 * 1024 });
  blockedUnless(!r.error, `the outside film gate runs under uv: ${r.error?.message ?? ''}`);
  // Exit 2 is its red light, 0 green or yellow; 1 means it couldn't read the file.
  expect([0, 2], `the outside film gate reads our export ${mp4} (exit ${r.status}): ${(r.stderr ?? '').slice(-2000)}`).toContain(r.status);
  return JSON.parse(r.stdout) as Record<string, unknown>;
}

describe(`${AC[2]} motion share measured in the app matches the outside film gate on the same export`, () => {
  it(`${AC[2]} on a slow film and a lively one, the app's motion share is the gate's fast_ratio within 0.005`, () => {
    blockedUnless(existsSync(GATE_PATH), `the outside film gate isn't at ${GATE_PATH}; ${UNBLOCK}`);
    const sha = createHash('sha256').update(readFileSync(GATE_PATH)).digest('hex');
    blockedUnless(sha === GATE_SHA256, `${GATE_PATH} hashes to ${sha}, not the pinned ${GATE_SHA256}; ${UNBLOCK}`);
    const uv = which('uv');
    blockedUnless(uv !== null, 'uv isn\'t installed; unblock: brew install uv');
    blockedUnless(which('ffmpeg') !== null && which('ffprobe') !== null, 'ffmpeg and ffprobe aren\'t installed; unblock: brew install ffmpeg');

    const out = folder();
    const brief = briefOf(named('motion_share'));
    const films: Film[] = [
      { name: 'slow', doc: docId(1), document: slowFilm(docId(1)), brief, exported: true },
      { name: 'lively', doc: docId(2), document: livelyFilm(docId(2)), brief, exported: true },
    ];
    const { judged } = judge(bin(FULL), folder(), films, { out, silent: true });
    // The gate on each export first, then the app's measure of the same film.
    const failures: string[] = [];
    const ratios = new Map<string, { ratio: number; at: string }>();
    for (const f of films) {
      const mp4 = join(out, `${f.name}.mp4`);
      blockedUnless(existsSync(mp4), `the export of the ${f.name} film is at ${mp4}`);
      const report = gate(uv!, mp4, out);
      const theirs = report['fast_ratio'];
      const at = `the gate's cuts at ${show(report['cut_times_s'] as never)} s and cross-fades at ${show(report['dissolve_times_s'] as never)} s`;
      if (typeof theirs !== 'number') { failures.push(`the gate's report on the ${f.name} export has no fast_ratio: ${show(report as never, 800)}`); continue; }
      if (f.name === 'slow' && !(theirs < 0.035)) failures.push(`the gate reads the slow export at ${theirs}, not red (under 0.035), as its slow-push test asks (${at})`);
      if (f.name === 'lively' && !(theirs >= 0.06)) failures.push(`the gate reads the lively export at ${theirs}, not green (0.06 or more), as its punch test asks (${at})`);
      ratios.set(f.name, { ratio: theirs, at });
    }
    for (const f of films) {
      const g = ratios.get(f.name);
      if (!g) continue;
      const share = measureOf(judged[f.name], 'motion_share', `the ${f.name} film`)['share'];
      if (typeof share !== 'number') { failures.push(`the ${f.name} film's motion_share row has no measure.share: ${show(share)}`); continue; }
      if (!(Math.abs(share - g.ratio) <= 0.005)) failures.push(`the ${f.name} film: the app's motion share is ${share}, the gate's fast_ratio ${g.ratio}, ${Math.abs(share - g.ratio).toFixed(4)} apart, over 0.005 (${g.at})`);
    }
    expect(failures, `motion share against the outside film gate:\n  ${failures.join('\n  ')}`).toEqual([]);
  }, TIMEOUT);
});
