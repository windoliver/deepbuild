// How often an agent drives a panel to passing assertions on its first try (#124): a reading, never a pass or a
// fail. It takes five runs of one agent at one pinned version; under four of five first tries, it opens one open
// item on the extension guide naming the agent and a step that failed, so the guide's teaching is looked at.
//   import { driveReading } from './scripts/drive-reading.mjs'

const RUNS = 5;
const ENOUGH = 4;

/** `{agent: {name, version}, runs: [{version, first_try, failed_step}]}` as the reading; throws when it can't be read. */
export function driveReading({ agent, runs }) {
  if (!agent?.name || !agent.version) throw Error('a reading pins the agent\'s name and version');
  if (!Array.isArray(runs) || runs.length !== RUNS) throw Error(`a reading takes ${RUNS} runs per agent, got ${Array.isArray(runs) ? runs.length : 'none'}`);
  const off = runs.filter((r) => r.version !== agent.version);
  if (off.length) throw Error(`every run is on ${agent.name} ${agent.version}; ${off.length} ran on ${[...new Set(off.map((r) => r.version))].join(', ')}`);
  const missed = runs.filter((r) => r.first_try !== true);
  if (missed.some((r) => typeof r.failed_step !== 'string' || !r.failed_step)) throw Error('each run that missed its first try names the step that failed');
  const firstTry = RUNS - missed.length;
  return {
    agent: agent.name,
    version: agent.version,
    runs: RUNS,
    first_try: firstTry,
    open_item: firstTry < ENOUGH
      ? { on: 'extension-guide', text: `${agent.name} ${agent.version} drove the panel to passing assertions on its first try in ${firstTry} of ${RUNS} runs; a first drive failed at ${missed[0].failed_step}.` }
      : null,
  };
}
