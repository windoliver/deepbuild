// The Oracle lane's tools: the #539 suite's own (../539/helpers.ts, ../539/programs.ts, ../539/fixtures.ts), imported
// read only, so both lanes build and ask the same binary the same way (README: The surface under test).

export {
  AC, DOC, Script, TIMEOUT, binOf, focusOf, none, prebuild, presented, putEvidence, runShow, scenario, show, useTemp,
  type JsonObject, type Rect,
} from '../539/helpers.ts';
export { worldProgram, type Cell, type WorldPlan } from '../539/programs.ts';
export { pickControl, putAtlas, rowId, slider, stripDoc } from '../539/fixtures.ts';
