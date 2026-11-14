// The #204 Oracle lane's tools: the #204 suite's helpers (../204/helpers.ts), so both lanes build and drive the same
// binary the same way, and the two upstream tests' numbers as this lane ports them.
export * from '../204/helpers.ts';

/** The upstream tests the Oracle page pins (doneright/oracles/issues/204.md, vendored under doneright/oracles/vendor/ on
 * branch `doneright` of DeepBuildAI/deepbuild), at their pinned commit, and their license. */
export const UPSTREAM = {
  commit: '2f57f45d21482f94b36123dfcec77ae7ab859bc1',
  oscillator: 'the-oscillatornode-interface/osc-basic-waveform.html',
  scheduling: 'the-audiobuffersourcenode-interface/sample-accurate-scheduling.html',
  license: 'BSD-3-Clause',
} as const;

/** The upstream tests' rate: 44.1 kHz. */
export const UPSTREAM_RATE = 44_100;
/** Upstream's render quantum. */
export const QUANTUM = 128;
