// The Oracle lane builds and asks the same binary the same way as the #550 suite: its helpers and fixtures, and the stub
// game of #549's Oracle lane, re-exported (../550/, ../549/, read only).
export {
  AC, FULL, TIMEOUT, caughtFailures, hashFailures, matchCall, namedFailures, netCopiesOf, none, play, playedOnFailures, players, scenario, useBuilds, useChildren, useTemp,
} from '../550/helpers.ts';
export { BALL_VX_FIELD, UNIT_SHIFT, rally } from '../550/fixtures.ts';
export { Script, presented, putEvidence, runShow } from '../549/helpers.ts';
export { DOC, stubDoc, stubProgram } from '../549/fixtures.ts';
