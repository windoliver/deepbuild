// The #154 Oracle lane's tools, redrafted for #3525: the #154 redraft suite's helpers with the take's fetch moved to
// deep_job (../154-redraft-3525b/helpers.ts, which re-exports ../154-redraft/helpers.ts and shadows fetchTake and
// scoreWorld), so both lanes build and ask the same binaries the same way, and the upstream test's numbers as this lane
// ports them, exactly as ../154-oracle-redraft/helpers.ts has them.
export * from '../154-redraft-3525b/helpers.ts';

/** The upstream file, pinned by commit (doneright/oracles/vendor/wpt-2f57f45d21/...), and its license. */
export const UPSTREAM = {
  project: 'web-platform-tests/wpt',
  commit: '2f57f45d21482f94b36123dfcec77ae7ab859bc1',
  file: 'webaudio/the-audio-api/the-audiobuffersourcenode-interface/sample-accurate-scheduling.html',
  license: 'BSD-3-Clause',
} as const;
/** Upstream's `sampleOffsets`: where it schedules each impulse, inside and across render quanta. */
export const SAMPLE_OFFSETS = [0, 3, 512, 517, 1000, 1005, 20000, 21234, 37590] as const;
/**
 * Each offset gets its own window this many samples long (3 × 2^14), so a note's place inside any block of up to 16,384
 * samples is upstream's own offset, and each 0.26 s note ends long before the next window starts.
 */
export const SPACING = 49_152;
