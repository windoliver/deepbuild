// The Oracle lane builds and asks the same binary the same way as the #549 suite: its helpers and fixtures, re-exported
// (../549/, read only).
export {
  AC, FULL, Script, TIMEOUT, copiesOf, lastArray, none, presented, putEvidence, rendersOf, runShow, scenario, useBuilds, useChildren, useTemp,
} from '../549/helpers.ts';
export type { Copy, Render } from '../549/helpers.ts';
export { DOC, stubDoc, stubProgram } from '../549/fixtures.ts';
export type { Plays } from '../549/fixtures.ts';
