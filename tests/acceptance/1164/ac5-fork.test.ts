// AC5 #1164.535ab8f5: "Seeking back to 2.5 s and pressing 5 forks the track: fork_at reads that flick, the five later
// entries are gone, the track's hash changes, and the full-state hash from there equals a straight run of the forked
// track; seeks and scrubs alone never change the track's hash"
//
// asserts: after the game is played with keys (README: The play), the track is read (`track`, chosen); the playhead is
// moved to 4 s, scrubbed through 4.2, 4.4, 4.6, 4.8 and 5 s, then to 6 s and 1 s (#384's `playhead` control), and the
// track's hash and entries are as they were. Then the playhead goes to 2.5 s and key 5 is pressed at that moment: its
// entry is stamped at 2.5 s; the track's `fork_at` is 2.5 s, its entries are the two presses before 2.5 s and the new
// one (the five later entries gone), and its hash differs. `logic` then gives, from step 75 (2.5 s) on, every
// checkpoint's full-state hash and step hash that a fresh headless process gives for the forked track loaded whole
// (`track` with `load`, chosen) and run straight. Wrong program: the merge base, which has no `track` call.
import { describe, expect, it } from 'vitest';
import {
  AC, Script, TIMEOUT, appendedOf, game, keepProof, keyCall, logicCall, logicOf, none, prebuild, program, putEvidence, runShow, same,
  scenario, sec, seekCall, show, showBin, stepOf, trackCall, trackOf, playedOf, useDir,
} from './helpers.ts';

prebuild(() => { showBin(); program('rules'); });
const dir = useDir();

describe(`${AC[5]} a seek back and a press fork the track; seeks and scrubs alone don't`, () => {
  it(`${AC[5]} seeking back to 2.5 s and pressing 5 forks the track at that flick, drops the five later entries and changes its hash, and the full-state hash from there equals a straight run of the forked track; seeks and scrubs alone never change the track's hash`, () => {
    const p = program('rules');
    putEvidence(dir(), p.bytes);
    const s = new Script(game(p.sha));
    const played = s.add((at) => trackCall(at));
    for (const t of [4, 4.2, 4.4, 4.6, 4.8, 5, 6, 1]) s.add((at) => seekCall(sec(t), at));
    const scrubbed = s.add((at) => trackCall(at));
    const at = s.next();
    s.calls.push(seekCall(sec(2.5), at), keyCall('5', at));
    const press = s.calls.length - 1;
    s.next();
    const forked = s.add((when) => trackCall(when));
    const lg = s.add((when) => logicCall(when, { seeks: [stepOf(sec(2.5))] }));
    const r = runShow(scenario(dir(), s.calls), 'AC5: the game played, seeked, scrubbed, then forked');
    playedOf(r, s, 'AC5');
    const before = trackOf(r[played]!, 'AC5: the track as played');
    const after = trackOf(r[scrubbed]!, 'AC5: the track after seeks and scrubs');
    const entry = appendedOf(r[press]!, 'AC5: key 5 after the seek back to 2.5 s');
    const fork = trackOf(r[forked]!, 'AC5: the forked track');

    const fresh = new Script(game(p.sha), { play: false });
    fresh.add((when) => trackCall(when, fork.raw));
    const straight = fresh.add((when) => logicCall(when));
    const rf = runShow(scenario(dir(), fresh.calls, { headless: true }), 'AC5: a straight run of the forked track in a fresh process');
    expect(rf[0]!['outcome'], `AC5: the fresh process presents the game: ${show(rf[0])}`).toBe('presented');
    keepProof('ac5-fork.json', { before: before.raw, beforeHash: before.hash, fork: fork.raw, forkHash: fork.hash, forkAt: fork.forkAt, logic: r[lg], straight: rf[straight] });

    const failures: string[] = [];
    expect(before.entries.length, `AC5: the play recorded seven entries: ${show(before.raw)}`).toBe(7);
    if (after.hash !== before.hash || !same(after.raw, before.raw)) failures.push(`${AC[5]} seeks and scrubs alone changed the track: hash ${before.hash} → ${after.hash}`);
    if (entry.t !== sec(2.5) || entry.control !== 'c5') failures.push(`${AC[5]} key 5 after the seek back is ${show(entry.raw)}, not an entry on c5 at flick ${sec(2.5)} (2.5 s)`);
    if (fork.forkAt !== sec(2.5)) failures.push(`${AC[5]} fork_at reads ${show(fork.forkAt)}, not ${sec(2.5)} (2.5 s)`);
    const kept = before.raw.filter((_, i) => before.entries[i]!.t <= sec(2.5));
    const later = before.entries.filter((e) => e.t > sec(2.5));
    if (later.length !== 5) failures.push(`${AC[5]} the play has ${later.length} entries after 2.5 s, not five`);
    if (!same(fork.raw.slice(0, -1), kept) || fork.entries.length !== kept.length + 1) failures.push(`${AC[5]} the forked track holds ${show(fork.raw)}: not the ${kept.length} entries before 2.5 s and the new one`);
    if (fork.entries.some((e) => later.some((l) => same(l.raw, e.raw)))) failures.push(`${AC[5]} the forked track still holds a later entry: ${show(fork.raw)}`);
    if (fork.hash === before.hash) failures.push(`${AC[5]} the forked track's hash ${fork.hash} didn't change`);

    const live = logicOf(r[lg]!, 'AC5: logic after the fork');
    const run = logicOf(rf[straight]!, 'AC5: the straight run');
    const from = stepOf(sec(2.5));
    const deep = new Map(run.checkpoints.map((c) => [c.step, c.deep]));
    const later2 = live.checkpoints.filter((c) => c.step >= from);
    if (later2.length === 0) failures.push(`${AC[5]} no checkpoint at or after step ${from} to compare`);
    for (const c of later2) if (deep.get(c.step) !== c.deep) failures.push(`${AC[5]} checkpoint ${c.step}: the forked run's full-state hash ${c.deep}, the straight run's ${show(deep.get(c.step))}`);
    const sk = live.seeks[0]?.checkpoint;
    if (!sk || deep.get(sk.step) !== sk.deep) failures.push(`${AC[5]} the seek to step ${from} reaches checkpoint ${show(sk)}, the straight run's full-state hash there ${show(sk ? deep.get(sk.step) : null)}`);
    const hashes = new Map(run.steps.map((x) => [x.step, x.hash]));
    const differ = live.steps.find((x) => x.step >= from && (x.hash === null || hashes.get(x.step) !== x.hash));
    if (differ) failures.push(`${AC[5]} step ${differ.step}: the forked run's step hash ${show(differ.hash)}, the straight run's ${show(hashes.get(differ.step))}`);
    none(failures, 'AC5: the fork, and seeks and scrubs that change nothing');
  }, TIMEOUT);
});
