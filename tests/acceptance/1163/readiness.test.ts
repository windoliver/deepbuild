// AC7 #1163.cf2adc67: "With the bed's asset removed from the store, the export stops at its readiness gate naming the
// asset, leaves no partial file, and the run reads BLOCKED, never PASS"
//
// The bed's WAV is put into the scenario's evidence store and removed again before the run, so the film names an asset
// the store doesn't hold when it is presented and exported whole as MP4. The reply must be #501's stop (`outcome:
// "stopped"`, `gate: "readiness"`, no frame drawn, its issues naming the asset's SHA-256) and read `state: "BLOCKED"`
// (README: The surface under test), and the output folder must hold nothing, at the output path or a temporary name.
// No planted program: the issue names none for this criterion; the base, whose stop reads no state, is the wrong one.
import { rmSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'vitest';
import { AC, TIMEOUT, bedWav, exportWhole, filesUnder, film, int, none, present, presented, putEvidence, runShow, scenario, show, useRoot, useShow } from './helpers.ts';

const shows = useShow();
const temp = useRoot();

describe(`${AC[7]} a missing bed stops the export at its readiness gate`, () => {
  it(`${AC[7]} with the bed's asset removed from the store, the export stops at its readiness gate naming the asset, leaves no file in its folder, and reads BLOCKED, never PASS`, () => {
    const evidence = temp(); const out = temp();
    const bed = putEvidence(evidence, bedWav());
    rmSync(join(evidence, bed.slice(0, 2), bed.slice(2)));
    const [shown, reply] = runShow(shows.bin(), scenario(evidence, [present(film(bed)), exportWhole(join(out, 'film.mp4'))]), 'the film with its bed removed from the store');
    presented(shown, 'the film');
    const f: string[] = [];
    if (reply!['outcome'] !== 'stopped') f.push(`the export didn't stop (outcome ${show(reply!['outcome'])}): ${show(reply, 800)}`);
    else {
      if (reply!['gate'] !== 'readiness') f.push(`the export stopped at ${show(reply!['gate'])}, not its readiness gate`);
      const drawn = int(reply!['frames_drawn'], 'the stop: frames_drawn');
      if (drawn !== 0) f.push(`the export drew ${drawn} frames before it stopped`);
      if (!JSON.stringify(reply!['issues'] ?? null).includes(bed)) f.push(`the stop's issues don't name the asset ${bed}: ${show(reply, 800)}`);
    }
    if (reply!['state'] === 'PASS') f.push('the run reads PASS');
    else if (reply!['state'] !== 'BLOCKED') f.push(`the run reads ${show(reply!['state'])}, not BLOCKED`);
    const left = filesUnder(out);
    if (left.length) f.push(`the export left ${left.join(', ')} in its output folder: a partial file`);
    none(f, 'the readiness gate');
  }, TIMEOUT);
});
